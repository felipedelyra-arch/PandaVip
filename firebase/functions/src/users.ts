import { beforeUserCreated, HttpsError } from "firebase-functions/v2/identity";
import { onCall } from "firebase-functions/v2/https";
import { db } from "./lib/admin";
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import { garantirCodigoSocio } from "./lib/codigoSocio";
import { requireAdmin, DOMINIO_RESERVADO } from "./lib/guards";
import { consumir } from "./lib/rateLimit";

/**
 * Orçamento de tempo de [onAuthUserCreate], em milissegundos.
 *
 * Função bloqueante do Auth tem teto **rígido de 7 segundos** imposto pela
 * plataforma, e não é configurável: passou disso, o Firebase devolve erro e o
 * **cadastro do sócio falha**. Não é "fica pra depois" — a conta não nasce.
 *
 * O caminho aqui é uma leitura, uma escrita e uma transação que pode sortear
 * até cinco vezes. Cada uma é rápida sozinha; o problema é a soma delas num
 * momento ruim: instância fria (a primeira pessoa da manhã paga isso), rajada
 * de cadastro no dia em que o dono divulga o clube no salão, ou o Firestore
 * respondendo devagar. É justamente quando mais gente está entrando junto.
 *
 * 4,5s deixa margem confortável antes do corte da plataforma.
 */
const ORCAMENTO_CADASTRO_MS = 4500;

/** Quanto do orçamento a carteirinha pode consumir. O perfil vem primeiro. */
const ORCAMENTO_CODIGO_MS = 2000;

/**
 * Devolve o resultado de [promessa], ou `null` se ela passar de [ms].
 *
 * O trabalho não é cancelado — não dá pra cancelar uma escrita do Firestore no
 * meio. Ele segue e provavelmente termina; o que muda é que **ninguém espera
 * por ele**, e é a espera que derruba o cadastro.
 */
async function comPrazo<T>(promessa: Promise<T>, ms: number, oQue: string): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const prazo = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[cadastro] ${oQue} passou de ${ms}ms; seguindo sem esperar.`);
      resolve(null);
    }, ms);
  });
  try {
    return await Promise.race([promessa, prazo]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Ao criar conta (Auth), garante o doc de perfil em users/.
 * Escrita pelo backend => ignora rules, mas mantém consistência.
 *
 * ⚠️ **Nada aqui pode lançar erro nem demorar.** Isto roda dentro do cadastro:
 * o que falhar aqui vira "não foi possível criar sua conta" na cara de quem
 * está se cadastrando. Por isso todo passo tem prazo e todo erro é engolido
 * com log — as duas redes de segurança existem e são baratas:
 *
 *   - perfil ausente: `onAuthUserCreate` não é a única porta. O app grava o
 *     perfil ao completar o cadastro, e as rules permitem;
 *   - carteirinha ausente: `backfillCodigosSocio` gera sob demanda pelo painel,
 *     e `garantirCodigoSocio` é idempotente.
 *
 * Perder o código de sócio de alguém é um botão no painel. Perder o cadastro é
 * perder o sócio.
 */
export const onAuthUserCreate = beforeUserCreated(async (event) => {
  const user = event.data;
  if (!user) return;
  // E-mail da conta de atendimento (`novaSenhaAtendimento`): ninguém se
  // cadastra com ele pelo app. Sem isto, quem chegasse primeiro herdaria o
  // papel de atendente quando o dono criasse o acesso dos garçons.
  if (user.email?.toLowerCase().endsWith(DOMINIO_RESERVADO)) {
    throw new HttpsError("permission-denied", "E-mail não permitido.");
  }

  const comecou = Date.now();
  const ref = db.doc(`users/${user.uid}`);

  try {
    // `create`, não `get` + `set`: o `comPrazo` não cancela a escrita, então
    // num cold start ela podia chegar DEPOIS do app ter gravado nome e
    // telefone — e o `set` sem merge apagava tudo. `create` falha se o doc já
    // existe, e a escrita atrasada vira um no-op em vez de perda de dados.
    await comPrazo(
      ref
        .create({
          uid: user.uid,
          nome: user.displayName ?? "",
          email: user.email ?? "",
          telefone: user.phoneNumber ?? "",
          endereco: null,
          fcmToken: null,
          role: null,
          criadoEm: FieldValue.serverTimestamp(),
        })
        // Atrasada ou duplicada, a rejeição chega sem ninguém esperando:
        // sem este catch ela vira unhandled rejection e derruba a instância.
        .catch((err) => console.warn(`[cadastro] perfil de ${user.uid} não criado:`, err?.code ?? err)),
      ORCAMENTO_CADASTRO_MS - (Date.now() - comecou),
      "gravação do perfil"
    );
  } catch (err) {
    console.error(`Falha ao criar perfil de ${user.uid}:`, err);
  }

  // Depois do create. A carteirinha lê isso
  // direto do doc, então já nasce pronta — sem chamada extra do app.
  // Falha ou demora aqui não pode barrar o cadastro: o backfill recupera.
  const sobrou = ORCAMENTO_CADASTRO_MS - (Date.now() - comecou);
  if (sobrou > 250) {
    try {
      await comPrazo(
        garantirCodigoSocio(user.uid),
        Math.min(ORCAMENTO_CODIGO_MS, sobrou),
        "código de sócio"
      );
    } catch (err) {
      console.error(`Falha ao gerar codigoSocio de ${user.uid}:`, err);
    }
  } else {
    console.warn(`[cadastro] sem tempo pro código de ${user.uid}; fica pro backfill.`);
  }
  return;
});

/** Quantos perfis são varridos por chamada. */
const BACKFILL_VARREDURA = 2000;
/** Quantos códigos são gerados por chamada (cada um é uma transação). */
const BACKFILL_GERADOS = 250;
/** Transações simultâneas. Documentos distintos, então não disputam nada. */
const BACKFILL_PARALELO = 10;

/**
 * Gera o código de sócio de quem foi criado antes desta funcionalidade existir.
 * Roda sob demanda pelo painel; é seguro chamar quantas vezes quiser, porque
 * quem já tem código é pulado.
 *
 * ⚠️ Processa um PEDAÇO por chamada e devolve `continua` + `cursor`. Antes
 * varria `users` inteiro e rodava uma transação por pessoa, uma esperando a
 * outra: com alguns milhares de pendentes isso passava dos 60s de timeout, a
 * função morria no meio e o painel só via um erro genérico — sem saber quantos
 * códigos tinham sido gravados antes de cair.
 *
 * Quem chama repete enquanto `continua` for true, passando o `cursor` de volta.
 */
export const backfillCodigosSocio = onCall(async (req) => {
  const chamador = await requireAdmin(req);
  await consumir(chamador, "backfillCodigosSocio");
  const { cursor } = (req.data ?? {}) as { cursor?: string };

  // `codigoSocio` está AUSENTE em quem não tem (não é null), e o Firestore não
  // consulta campo ausente. Por isso a varredura é por id, paginada — o id é o
  // único campo que todo documento tem.
  let q = db
    .collection("users")
    .orderBy(FieldPath.documentId())
    .select("codigoSocio")
    .limit(BACKFILL_VARREDURA);
  if (cursor) q = q.startAfter(cursor);

  const snap = await q.get();
  const pendentes = snap.docs.filter((d) => !d.get("codigoSocio"));
  const lote = pendentes.slice(0, BACKFILL_GERADOS);

  let gerados = 0;
  const falhas: string[] = [];
  for (let i = 0; i < lote.length; i += BACKFILL_PARALELO) {
    await Promise.all(
      lote.slice(i, i + BACKFILL_PARALELO).map(async (doc) => {
        try {
          await garantirCodigoSocio(doc.id);
          gerados++;
        } catch (err) {
          console.error(`Backfill falhou em ${doc.id}:`, err);
          falhas.push(doc.id);
        }
      })
    );
  }

  // Se o corte por BACKFILL_GERADOS sobrou gente, o próximo pedaço recomeça no
  // último realmente processado — e não no fim da varredura, que pularia os
  // pendentes que ficaram de fora.
  const ultimo = lote.length < pendentes.length
    ? lote[lote.length - 1]?.id
    : snap.docs[snap.docs.length - 1]?.id;

  const continua = snap.size === BACKFILL_VARREDURA || lote.length < pendentes.length;

  return {
    varridos: snap.size,
    gerados,
    falhas,
    continua,
    cursor: continua ? ultimo : null,
  };
});
