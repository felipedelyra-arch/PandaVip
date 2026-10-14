import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomUUID } from "crypto";
import { logger } from "firebase-functions";
import { db } from "./lib/admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireVerified, requireEquipe, idValido } from "./lib/guards";
import { consumir } from "./lib/rateLimit";
import { reservarCupom, liberarCupom } from "./lib/cupons";
import { vigoraAgora } from "./lib/assinaturas";

/**
 * Id do resgate, derivado do prêmio e da pessoa.
 *
 * Faz duas coisas ao mesmo tempo, e por isso substitui a consulta que existia
 * dentro da transação:
 *
 * 1. **Um por pessoa.** A regra do produto vira uma propriedade do banco: não
 *    existe segundo documento possível para o mesmo par.
 * 2. **Idempotência.** A rede cair depois de o resgate ser gravado e antes de
 *    a resposta chegar deixava o sócio vendo "Não foi possível resgatar";
 *    tocar de novo devolvia "Você já resgatou este prêmio" — uma mensagem de
 *    erro para uma operação que deu certo, e sem mostrar o código. Agora a segunda
 *    chamada encontra o próprio resgate e devolve o MESMO código.
 */
const idDoResgate = (rewardId: string, uid: string) => `${rewardId}__${uid}`;

/** Código curto que o dono digita no painel pra dar baixa (`validateRedemption`). */
const novoCodigo = () => randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();

/**
 * Resgata uma premiação (benefício exclusivo de sócios).
 *
 * Ordem das etapas, e o porquê de cada uma:
 *
 *   1. assinatura ativa — só sócio resgata;
 *   2. resgate já existente — devolve o mesmo código (ver [idDoResgate]);
 *   3. prêmio válido — existe e o prazo não passou;
 *   4. reserva um cupom — é aqui que o estoque baixa, num documento só dele;
 *   5. grava o resgate — se falhar, o cupom volta para o pool.
 *
 * O documento do prêmio **não é escrito** neste caminho. Era ele o gargalo:
 * todos os resgates de um prêmio disputavam a mesma linha, e a 50 pessoas
 * simultâneas 92% falhavam com `ABORTED`. Quem atualiza o `estoque` visível é
 * um gatilho, fora do caminho do cliente (ver rewards.ts).
 */
export const redeemReward = onCall(async (req) => {
  const uid = requireVerified(req);
  await consumir(uid, "redeemReward");
  const rewardId = idValido((req.data ?? {}).rewardId, "rewardId");

  // 1. Só sócios resgatam.
  const subs = await db
    .collection("subscriptions")
    .where("userId", "==", uid)
    .where("status", "==", "active")
    .get();
  if (!subs.docs.some((d) => vigoraAgora(d))) {
    throw new HttpsError("permission-denied", "Premiações são exclusivas para sócios.");
  }

  const redemptionRef = db.doc(`redemptions/${idDoResgate(rewardId, uid)}`);

  // 2. Já resgatou? Devolve o mesmo resgate, sem erro e sem consumir estoque.
  const existente = await redemptionRef.get();
  if (existente.exists) {
    return {
      ok: true,
      repetido: true,
      redemptionId: redemptionRef.id,
      codigo: existente.get("codigo") as string,
    };
  }

  // 3. O prêmio precisa existir e estar no prazo.
  const rewardSnap = await db.doc(`rewards/${rewardId}`).get();
  if (!rewardSnap.exists) throw new HttpsError("not-found", "Premiação não existe.");
  const reward = rewardSnap.data()!;

  const resgatavelAte = reward.resgatavelAte as FirebaseFirestore.Timestamp | undefined | null;
  if (resgatavelAte && resgatavelAte.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "Prazo de resgate encerrado.");
  }

  // 4. Reserva o cupom. Sai um documento por pessoa, sem fila no prêmio.
  const cupomId = await reservarCupom(rewardId, uid, redemptionRef.id);
  if (!cupomId) throw new HttpsError("failed-precondition", "Este prêmio esgotou.");

  // 5. Grava o resgate. `create` para que duas chamadas simultâneas da mesma
  // pessoa não gerem dois códigos: a segunda bate em ALREADY_EXISTS.
  const codigo = novoCodigo();
  try {
    await redemptionRef.create({
      userId: uid,
      rewardId,
      rewardTitulo: reward.titulo ?? "",
      cupomId,
      // Congela o valor do prêmio no momento do resgate. Sem isso, o
      // "você já economizou" do app seguiria o preço atual do prêmio — mudar
      // o cardápio reescreveria o passado do sócio.
      valor: Number(reward.valor ?? 0),
      codigo,
      status: "disponivel",
      criadoEm: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 6) {
      // Corrida com a própria pessoa (dois toques). O cupom desta tentativa
      // não serve mais: devolve ao pool e responde com o resgate que venceu.
      await liberarCupom(rewardId, cupomId);
      const vencedor = await redemptionRef.get();
      return {
        ok: true,
        repetido: true,
        redemptionId: redemptionRef.id,
        codigo: vencedor.get("codigo") as string,
      };
    }
    // Falhou por outro motivo: o cupom não pode ficar preso a um resgate que
    // não existe, senão o estoque encolhe sozinho a cada erro.
    await liberarCupom(rewardId, cupomId).catch(() => undefined);
    throw err;
  }

  logger.info("Resgate gravado.", { rewardId, uid, cupomId });
  return { ok: true, redemptionId: redemptionRef.id, codigo };
});

/**
 * Admin ou atendente (o celular dos garçons, logado na conta de atendimento)
 * valida um resgate: marca como usado e devolve o que entregar e para quem.
 * Só o primeiro nome do sócio — é o bastante para conferir na mesa.
 *
 * `funcionarioId` é quem atendeu, escolhido na lista da Equipe. Todos os
 * garçons usam a mesma conta, então é ele que diz quem atendeu: vai para o
 * ranking do painel e para o convite de gorjeta no app do sócio. Obrigatório
 * para a conta de atendimento; o admin pode validar sem (tela de Prêmios).
 */
export const validateRedemption = onCall(async (req) => {
  const chamador = await requireEquipe(req);
  await consumir(chamador, "validateRedemption");
  const dados = req.data ?? {};
  const codigo = idValido(dados.codigo, "codigo").toUpperCase();
  const funcionarioId =
    dados.funcionarioId == null ? null : idValido(dados.funcionarioId, "funcionarioId");
  if (!funcionarioId && req.auth?.token?.role !== "admin") {
    throw new HttpsError("invalid-argument", "Escolha o seu nome antes de validar.");
  }
  let funcionarioNome: string | null = null;
  if (funcionarioId) {
    const f = await db.doc(`funcionarios/${funcionarioId}`).get();
    if (!f.exists || f.get("ativo") === false) {
      throw new HttpsError("failed-precondition", "Esse nome não está mais na equipe.");
    }
    funcionarioNome = String(f.get("nome") ?? "");
  }

  const snap = await db
    .collection("redemptions")
    .where("codigo", "==", codigo)
    .limit(1)
    .get();
  if (snap.empty) throw new HttpsError("not-found", "Resgate não encontrado.");

  const doc = snap.docs[0];
  if (doc.get("userId") === chamador) {
    throw new HttpsError("permission-denied", "Peça para outro atendente validar o seu prêmio.");
  }
  if (doc.get("status") !== "disponivel") {
    throw new HttpsError("failed-precondition", `Resgate já ${doc.get("status")}.`);
  }
  // Quem perdeu a assinatura (cancelou, venceu, estornou) não usa o código, e
  // prêmio com prazo de resgate vencido também não.
  const subs = await db
    .collection("subscriptions")
    .where("userId", "==", doc.get("userId"))
    .where("status", "==", "active")
    .get();
  if (!subs.docs.some((d) => vigoraAgora(d))) {
    throw new HttpsError("failed-precondition", "O dono deste código não é mais sócio.");
  }
  const reward = await db.doc(`rewards/${doc.get("rewardId")}`).get();
  const ate = reward.get("resgatavelAte") as FirebaseFirestore.Timestamp | undefined | null;
  if (ate && ate.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "Prazo deste prêmio encerrado.");
  }
  // Precondição: com vários garçons, dois podem digitar o mesmo código ao
  // mesmo tempo; só o primeiro grava, o outro recebe "já usado".
  try {
    await doc.ref.update(
      {
        status: "usado",
        usadoEm: FieldValue.serverTimestamp(),
        validadoPor: chamador,
        ...(funcionarioId ? { funcionarioId, funcionarioNome } : {}),
      },
      { lastUpdateTime: doc.updateTime }
    );
  } catch (e) {
    if ((e as { code?: number }).code === 9) {
      throw new HttpsError("failed-precondition", "Resgate já usado.");
    }
    throw e;
  }
  const nome = String((await db.doc(`users/${doc.get("userId")}`).get()).get("nome") ?? "");
  return {
    ok: true,
    redemptionId: doc.id,
    premio: String(doc.get("rewardTitulo") ?? ""),
    socio: nome.trim().split(/\s+/)[0] ?? "",
    atendente: funcionarioNome,
  };
});
