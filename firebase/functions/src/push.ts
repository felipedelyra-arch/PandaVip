import { onCall } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db, messaging } from "./lib/admin";
import { requireAdmin, maiorDeIdade } from "./lib/guards";
import { consumir } from "./lib/rateLimit";
import { vigoraAgora } from "./lib/assinaturas";

type Publico = "todos" | "assinantes";
type Origem = "manual" | "promocao" | "premio";

/** Tetos do texto de um aviso. Ver o corte em [sendPush]. */
const MAX_TITULO = 120;
const MAX_CORPO = 1000;

interface Alvo {
  uid: string;
  token?: string;
}

/** Quebra uma lista em pedaços de [tamanho]. */
function emPedacos<T>(itens: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}

/**
 * Roda [fn] sobre os pedaços com no máximo [simultaneos] em voo.
 *
 * O teto existe porque "tudo de uma vez" com dezenas de milhares de sócios
 * abriria conexões demais e estouraria a memória da instância — o que se quer
 * é tirar as idas ao banco da fila, não remover a fila inteira.
 */
async function emParalelo<T, R>(
  pedacos: T[],
  simultaneos: number,
  fn: (p: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (const grupo of emPedacos(pedacos, simultaneos)) {
    out.push(...(await Promise.all(grupo.map(fn))));
  }
  return out;
}

/**
 * Quem deve receber o aviso. Devolve o uid mesmo de quem não tem token: sem
 * token não dá pra tocar o celular, mas o aviso ainda precisa entrar na central
 * do app pra pessoa achar quando abrir.
 *
 * ⚠️ O caminho dos assinantes já foi `where('uid', 'in', lote)` de 30 em 30,
 * sequencial. Com 2.500 assinantes isso dava 85 idas ao banco em fila e comia
 * 68% do timeout de 60s da função — e crescia linear com o clube. Agora os
 * perfis vêm por `getAll` (leitura direta por id, sem query nem índice), em
 * pedaços paralelos. Mesmo número de documentos lidos, ordem de grandeza a
 * menos de viagens.
 */
async function coletarAlvos(onlySubscribers: boolean): Promise<Alvo[]> {
  const alvos = new Map<string, Alvo>();

  // Todo aviso daqui é marketing (os transacionais saem por `avisarSocio`):
  // só 18+ e quem não desligou `marketingOptIn` (ausente = ligado). Sem
  // `nascimento` também fica de fora.
  const somar = (u: FirebaseFirestore.DocumentSnapshot) => {
    if (!maiorDeIdade(u.get("nascimento")) || u.get("marketingOptIn") === false) return;
    const token = u.get("fcmToken");
    alvos.set(u.id, { uid: u.id, token: typeof token === "string" ? token : undefined });
  };

  if (onlySubscribers) {
    const subs = await db
      .collection("subscriptions")
      .where("status", "==", "active")
      .get();
    const uids = [
      ...new Set(subs.docs.filter((d) => vigoraAgora(d)).map((d) => d.get("userId") as string)),
    ].filter(Boolean);

    // Só token, idade e opt-in interessam aqui; a máscara evita trazer o perfil
    // inteiro de cada assinante pra dentro da memória da função.
    const snaps = await emParalelo(
      emPedacos(uids, 300),
      4,
      (lote) =>
        db.getAll(...lote.map((uid) => db.doc(`users/${uid}`)), {
          fieldMask: ["fcmToken", "nascimento", "marketingOptIn"],
        })
    );
    snaps.flat().forEach((u) => {
      if (u.exists) somar(u);
    });
  } else {
    const users = await db.collection("users").select("fcmToken", "nascimento", "marketingOptIn").get();
    users.forEach(somar);
  }

  return [...alvos.values()];
}

/** Grava o aviso na central de cada pessoa, em lotes (limite de 500 por batch). */
async function gravarNaCentral(
  alvos: Alvo[],
  aviso: { titulo: string; corpo: string; tipo: string }
) {
  await emParalelo(emPedacos(alvos, 450), 4, async (lote) => {
    const batch = db.batch();
    lote.forEach((a) => {
      const ref = db.collection("users").doc(a.uid).collection("notifications").doc();
      batch.set(ref, {
        titulo: aviso.titulo,
        corpo: aviso.corpo,
        tipo: aviso.tipo,
        lida: false,
        criadoEm: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  });
}

/** Respostas do FCM que querem dizer "esta instalação não existe mais". */
const ERROS_TOKEN_MORTO = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/**
 * Tokens que o FCM recusou por não existirem mais (app desinstalado ou
 * reinstalado). `envios[i].responses[j]` é a resposta de `lotes[i][j]`.
 */
export function tokensMortos(
  lotes: string[][],
  envios: { responses: { success: boolean; error?: { code: string } }[] }[]
): string[] {
  return envios.flatMap((envio, i) =>
    envio.responses.flatMap((r, j) =>
      !r.success && ERROS_TOKEN_MORTO.has(r.error?.code ?? "") ? [lotes[i][j]] : []
    )
  );
}

/**
 * Apaga do perfil o token que o FCM disse estar morto.
 *
 * Sem isto o servidor seguia mandando push, para sempre, para a instalação
 * antiga de quem reinstalou o app — e o painel mostrava "enviado" para ninguém.
 * A transação só apaga se o perfil ainda guardar o MESMO token: o app pode ter
 * salvado um novo entre o envio e agora, e esse não pode sumir.
 */
async function apagarTokensMortos(alvos: Alvo[], mortos: string[]) {
  if (mortos.length === 0) return;
  const set = new Set(mortos);
  const donos = alvos.filter((a) => a.token && set.has(a.token));
  await emParalelo(donos, 20, (a) =>
    db.runTransaction(async (tx) => {
      const ref = db.doc(`users/${a.uid}`);
      const snap = await tx.get(ref);
      if (snap.get("fcmToken") === a.token) tx.update(ref, { fcmToken: FieldValue.delete() });
    })
  );
}

/** Texto que o dono deixou em branco vira o padrão, e não uma notificação vazia. */
const ouPadrao = (texto: unknown, padrao: string) =>
  (typeof texto === "string" ? texto.trim() : "") || padrao;

/**
 * Único caminho de saída de aviso do Clube. Faz as três coisas que precisam
 * andar juntas:
 *   1. toca o celular (FCM);
 *   2. guarda o aviso na central do app (`users/{uid}/notifications`) — sem
 *      isso a tela "Avisos" do app fica sempre vazia, que era o comportamento
 *      anterior: ninguém escrevia nessa subcoleção;
 *   3. registra o disparo em `notificationLogs`, que vira o histórico do painel.
 */
async function enviarAviso(opts: {
  titulo: string;
  corpo: string;
  publico: Publico;
  origem: Origem;
  tipo?: string;
  imagem?: string;
}): Promise<number> {
  const { titulo, corpo, publico, origem, tipo = "info", imagem } = opts;
  const alvos = await coletarAlvos(publico === "assinantes");

  const tokens = alvos.map((a) => a.token).filter((t): t is string => !!t);
  // sendEachForMulticast aceita até 500 tokens por chamada.
  const lotes = emPedacos(tokens, 500);
  const envios = await emParalelo(lotes, 4, (lote) =>
    messaging.sendEachForMulticast({
      tokens: lote,
      // Só manda `imageUrl` com endereço de verdade. Promoção sem imagem grava
      // `imagem: null`, e a firebase-admin recusa null ("imageUrl must be a
      // valid URL string"): a mensagem inteira caía e o push nunca saía.
      notification: {
        title: titulo,
        body: corpo,
        ...(typeof imagem === "string" && imagem.trim() ? { imageUrl: imagem } : {}),
      },
      android: { priority: "high" },
    })
  );
  const enviados = envios.reduce((s, r) => s + r.successCount, 0);
  const mortos = tokensMortos(lotes, envios);
  logger.info("Aviso enviado.", {
    origem,
    alcancados: alvos.length,
    tokens: tokens.length,
    enviados,
    tokensMortos: mortos.length,
  });

  await gravarNaCentral(alvos, { titulo, corpo, tipo });
  try {
    await apagarTokensMortos(alvos, mortos);
  } catch (err) {
    // O aviso já saiu; a faxina fica para o próximo envio.
    logger.warn("Não deu pra apagar tokens mortos.", { err });
  }

  await db.collection("notificationLogs").add({
    titulo,
    corpo,
    publico,
    origem,
    enviados,
    alcancados: alvos.length,
    criadoEm: FieldValue.serverTimestamp(),
  });

  return enviados;
}

/** Envia para todos ou só assinantes. Só admin. */
export const sendPush = onCall(async (req) => {
  const chamador = await requireAdmin(req);
  await consumir(chamador, "sendPush");
  const { titulo, corpo, onlySubscribers, imagem } = req.data as {
    titulo: string;
    corpo: string;
    onlySubscribers?: boolean;
    imagem?: string;
  };

  if (!titulo?.trim() || !corpo?.trim()) {
    return { ok: false, enviados: 0, erro: "Título e mensagem são obrigatórios." };
  }

  // Corta no tamanho que o FCM mostra. O texto não vai só pro celular: uma
  // cópia é gravada na central de CADA sócio (`gravarNaCentral`), então um
  // corpo colado de 200 KB por engano vira 200 KB × base inteira de escrita —
  // e nada disso apareceria na notificação, que o sistema trunca de qualquer
  // jeito.
  const tituloLimpo = titulo.trim().slice(0, MAX_TITULO);
  const corpoLimpo = corpo.trim().slice(0, MAX_CORPO);

  const enviados = await enviarAviso({
    titulo: tituloLimpo,
    corpo: corpoLimpo,
    publico: onlySubscribers ? "assinantes" : "todos",
    origem: "manual",
    imagem,
  });

  return { ok: true, enviados };
});

// ---------------------------------------------------------------------------
// Promoções
// ---------------------------------------------------------------------------

const paraData = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

/** A promoção está valendo neste instante? Mesma regra do app e do painel. */
function vigente(promo: FirebaseFirestore.DocumentData, agora = new Date()): boolean {
  if (promo.ativa !== true) return false;
  const inicio = paraData(promo.validadeInicio);
  const fim = paraData(promo.validadeFim);
  if (inicio && agora < inicio) return false;
  if (fim && agora > fim) return false;
  return true;
}

/**
 * Reserva o direito de avisar sobre [ref]. Devolve `false` se alguém já pegou.
 *
 * ## Por que a marca é gravada ANTES do envio
 *
 * Gatilho do Firestore em gen2 entrega **pelo menos uma vez**: a mesma criação
 * pode chamar a função duas vezes, e nada no código sabe disso. Marcando
 * depois do envio, a segunda entrega chegava com `avisoEnviadoEm` ainda vazio
 * e disparava tudo de novo — push repetido no celular de cada sócio e o aviso
 * duplicado na central de todo mundo. Numa base de 2.500 assinantes, o dono
 * descobre isso pelo WhatsApp dos clientes.
 *
 * A mesma corrida existe entre `onPromotionCreated` e a passada de 15 minutos
 * de `publicarPromocoesAgendadas`, que filtra pelo mesmo campo.
 *
 * A transação é o que torna a reserva atômica: duas entregas simultâneas leem
 * e escrevem a mesma linha, e só uma sai vencedora.
 *
 * ## O lado ruim, assumido
 *
 * Se o envio falhar depois da reserva, aquela promoção **não avisa mais
 * sozinha** — fica marcada como avisada. Fica o `avisoErro` no documento e o
 * log de erro, e o dono reenvia pela tela de notificações do painel.
 *
 * É a troca certa: um aviso perdido é um botão; um aviso duplicado é a base
 * inteira recebendo push repetido, e não tem botão que desfaça.
 */
export async function reservarAviso(ref: FirebaseFirestore.DocumentReference): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    if (snap.get("avisoEnviadoEm")) return false;
    tx.set(ref, { avisoEnviadoEm: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

async function avisarPromocao(
  ref: FirebaseFirestore.DocumentReference,
  promo: FirebaseFirestore.DocumentData
) {
  if (!(await reservarAviso(ref))) {
    logger.info("Promoção já avisada; entrega repetida ignorada.", { promoId: ref.id });
    return;
  }

  try {
    await enviarAviso({
      titulo: ouPadrao(promo.titulo, "Nova promoção"),
      corpo: ouPadrao(promo.descricao, "Confira no PandaVip."),
      publico: promo.apenasAssinantes ? "assinantes" : "todos",
      origem: "promocao",
      tipo: "promo",
      imagem: promo.imagem,
    });
  } catch (err) {
    logger.error("Promoção reservada mas o aviso falhou; reenviar pelo painel.", {
      promoId: ref.id,
      err,
    });
    await ref.set({ avisoErro: String(err) }, { merge: true });
    throw err;
  }
}

/**
 * Promoção publicada e já valendo: avisa na hora.
 *
 * Promoção **agendada** não avisa aqui — antes avisava, e o cliente recebia
 * "Festival de sashimi!" hoje pra uma oferta que só entra semana que vem, abria
 * o app e não achava nada. Quem cuida dessas é a `publicarPromocoesAgendadas`
 * abaixo, quando a data chega.
 */
export const onPromotionCreated = onDocumentCreated(
  "promotions/{promoId}",
  async (event) => {
    const snap = event.data;
    const promo = snap?.data();
    if (!snap || !promo) return;
    if (!vigente(promo)) {
      logger.info("Promoção fora da janela na criação; aviso adiado.", { promoId: snap.id });
      return;
    }
    await avisarPromocao(snap.ref, promo);
  }
);

/**
 * A cada 15 minutos, avisa sobre as promoções agendadas que acabaram de entrar
 * no ar. `avisoEnviadoEm` garante um aviso só por promoção.
 *
 * A coleção é pequena (um restaurante tem punhado de ofertas), então o filtro é
 * em memória — evita índice composto e o problema de consultar campo ausente.
 */
export const publicarPromocoesAgendadas = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Sao_Paulo" },
  async () => {
    const snap = await db.collection("promotions").where("ativa", "==", true).get();
    const pendentes = snap.docs.filter((d) => !d.get("avisoEnviadoEm") && vigente(d.data()));

    for (const d of pendentes) {
      await avisarPromocao(d.ref, d.data());
      logger.info("Promoção agendada entrou no ar e foi avisada.", { promoId: d.id });
    }
  }
);

// ---------------------------------------------------------------------------
// Faxina da central de avisos
// ---------------------------------------------------------------------------

/** Avisos mais antigos que isto são apagados. */
const DIAS_DE_AVISO = 180;

/**
 * Apaga avisos velhos de todo mundo, uma vez por dia.
 *
 * Cada push grava um documento por sócio e nada apagava. O app já leva um teto
 * de leitura (`kLimiteAvisos`, 50), mas isso só resolveu o custo de LER — a
 * subcoleção continuava crescendo no banco para sempre, ocupando armazenamento
 * e deixando a exclusão de conta cada vez mais lenta.
 *
 * Seis meses é bem mais do que o app mostra. Ninguém rola até lá, e um aviso de
 * promoção de meio ano atrás não serve para nada.
 *
 * Usa consulta de grupo de coleção: uma varredura pega os avisos velhos de
 * todos os sócios de uma vez, em vez de percorrer usuário por usuário. Precisa
 * do índice de `notifications` por `criadoEm` com escopo COLLECTION_GROUP.
 */
export const limparAvisosAntigos = onSchedule(
  { schedule: "every 24 hours", timeZone: "America/Sao_Paulo" },
  async () => {
    const corte = Timestamp.fromMillis(Date.now() - DIAS_DE_AVISO * 86400000);

    let apagados = 0;
    // Teto por execução: a faxina é diária e o que sobrar sai amanhã. Vale mais
    // terminar dentro do tempo do que tentar limpar tudo e ser cortado no meio.
    for (let volta = 0; volta < 40; volta++) {
      const velhos = await db
        .collectionGroup("notifications")
        .where("criadoEm", "<", corte)
        .limit(450)
        .get();
      if (velhos.empty) break;

      const lote = db.batch();
      velhos.docs.forEach((d) => lote.delete(d.ref));
      await lote.commit();
      apagados += velhos.size;

      if (velhos.size < 450) break;
    }

    if (apagados) logger.info("Faxina da central de avisos.", { apagados });
  }
);

// ---------------------------------------------------------------------------
// Prêmios
// ---------------------------------------------------------------------------

/**
 * Prêmio novo com estoque também vira aviso. Antes só promoção avisava, então o
 * dono cadastrava um rodízio grátis e ninguém ficava sabendo.
 */
export const onRewardCreated = onDocumentCreated("rewards/{rewardId}", async (event) => {
  const snap = event.data;
  const premio = snap?.data();
  if (!snap || !premio) return;

  // `estoqueAlvo` é o que o painel escreve; `estoque` só existe depois que o
  // gatilho de cupons roda. Na criação do prêmio o segundo ainda não chegou,
  // então olhar só para ele engoliria o aviso de todo prêmio novo.
  if (((premio.estoqueAlvo ?? premio.estoque) ?? 0) <= 0) return;
  const ate = paraData(premio.resgatavelAte);
  if (ate && ate < new Date()) return;

  // Reserva antes de enviar, pelo mesmo motivo da promoção: entrega repetida
  // do gatilho mandaria o push do rodízio grátis duas vezes pra base inteira.
  // Ver [reservarAviso].
  if (!(await reservarAviso(snap.ref))) {
    logger.info("Prêmio já avisado; entrega repetida ignorada.", { rewardId: snap.id });
    return;
  }

  try {
    await enviarAviso({
      titulo: ouPadrao(premio.titulo, "Novo prêmio no Clube"),
      corpo: ouPadrao(premio.descricao, "Resgate pelo app e retire no restaurante."),
      // Prêmio é benefício de sócio: só quem paga a mensalidade resgata.
      publico: "assinantes",
      origem: "premio",
      tipo: "promo",
      imagem: premio.imagem,
    });
  } catch (err) {
    logger.error("Prêmio reservado mas o aviso falhou; reenviar pelo painel.", {
      rewardId: snap.id,
      err,
    });
    await snap.ref.set({ avisoErro: String(err) }, { merge: true });
    throw err;
  }
});
