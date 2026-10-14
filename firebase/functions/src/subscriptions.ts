import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./lib/admin";
import { ErroMercadoPago, gateway, GatewayIndisponivel, MESES, somarMeses } from "./lib/gateway";
import { cancelarResgates, encerrarCartao, sincronizar } from "./lib/assinaturas";
import { requireAuth, requireVerified, idValido, exigirMaiorDeIdadeDe } from "./lib/guards";
import { consumir } from "./lib/rateLimit";
import { MP_ACCESS_TOKEN } from "./lib/segredos";

/**
 * Assinatura do plano, pelo Mercado Pago (`lib/gateway.ts`).
 *
 * Os erros saem como `failed-precondition` com mensagem: o app mostra a
 * mensagem do servidor (`mensagemDeErro`, em chamada.dart). Não é `unavailable`
 * de propósito, porque esse o app traduz como "sem conexão", e o sócio ficaria
 * tentando de novo algo que não vai funcionar.
 */

const SEM_GATEWAY = "A assinatura pelo app ainda não está disponível. Fale com o restaurante.";
const PLANO_INATIVO = "Plano indisponível.";
const GATEWAY_RECUSOU =
  "O Mercado Pago não aceitou o pedido agora. Tente de novo em alguns minutos ou fale com o restaurante.";

/**
 * Status de assinatura que ainda cobra: ativa, com o cartão recusado e o
 * Mercado Pago tentando de novo, ou `pending` (cartão aceito, 1ª cobrança
 * ainda não saiu). O app só enxerga `active`, então quem está em `past_due`
 * vê o botão de assinar — e assinar de novo seria cobrança dobrada.
 */
const QUE_COBRAM = ["active", "past_due", "pending"];

/** Busca a assinatura que ainda cobra. Sem índice composto: um sócio tem poucas. */
async function assinaturaVigente(uid: string) {
  const subs = await db.collection("subscriptions").where("userId", "==", uid).get();
  // `active` com `ativaAte` vencido espera a faxina de hora em hora: já não vale.
  const agora = new Date();
  return subs.docs.find((d) => {
    const ate = (d.get("ativaAte") as Timestamp | undefined)?.toDate();
    return QUE_COBRAM.includes(d.get("status") as string) && !(ate && ate <= agora);
  });
}

function erroDoGateway(err: unknown, contexto: Record<string, unknown>): never {
  if (err instanceof GatewayIndisponivel) {
    logger.error("Assinatura pedida sem gateway configurado.", contexto);
    throw new HttpsError("failed-precondition", SEM_GATEWAY);
  }
  if (err instanceof ErroMercadoPago) {
    logger.error("Mercado Pago recusou a chamada.", { ...contexto, status: err.status, causa: err.causa });
    throw new HttpsError("failed-precondition", GATEWAY_RECUSOU);
  }
  throw err;
}

/**
 * Cria o checkout da assinatura e devolve a URL. A confirmação real vem pelo
 * webhook do gateway, nunca por esta resposta.
 *
 * Não é idempotente do nosso lado (o gateway recebe uma chave de idempotência
 * de 10 minutos). Por isso o app chama com `repetir: false`.
 */
export const createCheckoutSession = onCall({ secrets: [MP_ACCESS_TOKEN] }, async (req) => {
  const uid = requireVerified(req);
  await consumir(uid, "createCheckoutSession");
  const planId = idValido((req.data ?? {}).planId, "planId");

  const planSnap = await db.doc(`plans/${planId}`).get();
  if (!planSnap.exists) throw new HttpsError("not-found", "Plano não existe.");
  if (planSnap.get("ativo") === false) throw new HttpsError("failed-precondition", PLANO_INATIVO);
  await exigirMaiorDeIdadeDe(uid);
  if (!Object.hasOwn(MESES, String(planSnap.get("intervalo")))) {
    logger.error("Plano com intervalo desconhecido.", { planId, intervalo: planSnap.get("intervalo") });
    throw new HttpsError("failed-precondition", "Este plano está com a cobrança mal configurada. Fale com o restaurante.");
  }

  const vigente = await assinaturaVigente(uid);
  if (vigente) {
    throw new HttpsError(
      "already-exists",
      vigente.get("status") === "active"
        ? "Sua assinatura já está ativa."
        : vigente.get("status") === "pending"
          ? "Sua assinatura está aguardando a primeira cobrança."
          : "Sua assinatura está com o pagamento pendente e o Mercado Pago vai tentar cobrar de novo. Confira o cartão na sua conta do Mercado Pago."
    );
  }

  try {
    const { url } = await gateway().criarCheckout({
      uid,
      planId,
      plano: planSnap.data()!,
    });
    return { ok: true, url };
  } catch (err) {
    erroDoGateway(err, { uid, planId });
  }
});

/**
 * Cancela a assinatura do sócio que ainda cobra.
 *
 * A ordem importa: primeiro o gateway, depois o documento. Marcar `canceled`
 * aqui sem ter cancelado lá faria o app dizer "cancelada" enquanto o cartão
 * continua sendo cobrado.
 *
 * Cobrança para na hora; os benefícios seguem até o fim do período já pago
 * (regra em `encerrarCartao`, a mesma do webhook "cancelled").
 */
export const cancelSubscription = onCall({ secrets: [MP_ACCESS_TOKEN] }, async (req) => {
  const uid = requireAuth(req);
  await consumir(uid, "cancelSubscription");

  const sub = await assinaturaVigente(uid);
  if (!sub) throw new HttpsError("not-found", "Sem assinatura ativa.");
  // Pix não renova: não há o que cancelar, e encerrar aqui perderia o período pago.
  if (sub.get("canceladaEm") || sub.get("formaPagamento") === "pix") return { ok: true };

  const gatewaySubId = sub.get("gatewaySubscriptionId") as string | undefined;
  if (gatewaySubId) {
    try {
      await gateway().cancelarAssinatura(gatewaySubId);
    } catch (err) {
      erroDoGateway(err, { uid, gatewaySubId });
    }
  }
  await encerrarCartao(sub.ref);
  return { ok: true };
});

/** Plano válido para cobrar por [uid] (18+), ou o erro já pronto pro app. */
async function planoParaCobrar(uid: string, planIdBruto: unknown) {
  const planId = idValido(planIdBruto, "planId");
  const snap = await db.doc(`plans/${planId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Plano não existe.");
  if (snap.get("ativo") === false) throw new HttpsError("failed-precondition", PLANO_INATIVO);
  await exigirMaiorDeIdadeDe(uid);
  if (!Object.hasOwn(MESES, String(snap.get("intervalo")))) {
    logger.error("Plano com intervalo desconhecido.", { planId, intervalo: snap.get("intervalo") });
    throw new HttpsError("failed-precondition", "Este plano está com a cobrança mal configurada. Fale com o restaurante.");
  }
  return { planId, plano: snap.data()! };
}

/**
 * Pix da assinatura, dentro do app: devolve o copia e cola, e o app desenha o
 * QR. Quem libera o mês é o webhook, quando o Mercado Pago confirma o
 * pagamento (`creditarPix`), nunca esta resposta.
 *
 * Quem já paga no cartão não gera Pix: seriam duas cobranças pelo mesmo mês.
 * Quem já paga por Pix pode gerar de novo, e o período soma.
 */
// Quente: ver criarPedido (pedidos.ts).
export const criarPixAssinatura = onCall({ secrets: [MP_ACCESS_TOKEN], minInstances: 1 }, async (req) => {
  const uid = requireVerified(req);
  await consumir(uid, "criarPixAssinatura");
  const { planId, plano } = await planoParaCobrar(uid, (req.data ?? {}).planId);

  const vigente = await assinaturaVigente(uid);
  if (vigente && vigente.get("formaPagamento") !== "pix") {
    throw new HttpsError("already-exists", "Sua assinatura no cartão já está ativa.");
  }
  try {
    const versao = String(
      (vigente?.get("ativaAte") as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0
    );
    return { ok: true, ...(await gateway().criarPix({ uid, planId, plano, versao })) };
  } catch (err) {
    erroDoGateway(err, { uid, planId, meio: "pix" });
  }
});

/**
 * Assinatura no cartão, dentro do app. O app manda só o token que o Mercado
 * Pago gerou para o cartão; número e código de segurança nunca chegam aqui.
 */
export const assinarComCartao = onCall({ secrets: [MP_ACCESS_TOKEN], minInstances: 1 }, async (req) => {
  const uid = requireVerified(req);
  await consumir(uid, "assinarComCartao");
  const cardToken = idValido((req.data ?? {}).cardToken, "cardToken");
  const { planId, plano } = await planoParaCobrar(uid, (req.data ?? {}).planId);

  const vigente = await assinaturaVigente(uid);
  if (vigente) {
    throw new HttpsError(
      "already-exists",
      vigente.get("formaPagamento") === "pix"
        ? "Sua assinatura por Pix já está ativa. Quando ela vencer, você pode assinar no cartão."
        : "Sua assinatura já está ativa."
    );
  }

  let pre;
  try {
    pre = await gateway().assinarComCartao({ uid, planId, plano, cardToken });
  } catch (err) {
    // 4xx do Mercado Pago aqui é quase sempre o cartão: recusado, sem limite,
    // dados errados. Diz isso, em vez do genérico de "tente mais tarde".
    if (err instanceof ErroMercadoPago && err.status >= 400 && err.status < 500) {
      logger.warn("Cartão recusado na assinatura.", { uid, planId, status: err.status, causa: err.causa });
      throw new HttpsError(
        "failed-precondition",
        "O cartão não foi aceito. Confira os dados ou use outro cartão."
      );
    }
    erroDoGateway(err, { uid, planId, meio: "cartao" });
  }
  // Grava já, sem esperar o webhook: o app fecha a tela assim que vê "active".
  await sincronizar(pre);
  return { ok: true, status: pre.status };
});

/**
 * Soma ao [lote] a retirada de um período do Pix do sócio. Devolve `true` se
 * o que sobra já venceu e a assinatura foi encerrada por arrependimento.
 */
async function tirarPeriodoPix(ref: FirebaseFirestore.DocumentReference, lote: FirebaseFirestore.WriteBatch) {
  const sub = await ref.get();
  const ate = (sub.get("ativaAte") as Timestamp | undefined)?.toDate();
  if (sub.get("status") !== "active" || !ate) return false;
  const plano = (await db.doc(`plans/${sub.get("planId")}`).get()).data();
  const novo = somarMeses(ate, -(MESES[String(plano?.intervalo)] ?? 1));
  const acabou = novo <= new Date();
  lote.update(
    ref,
    acabou ? { status: "canceled", motivo: "arrependimento", ativaAte: novo, canceladaEm: FieldValue.serverTimestamp() } : { ativaAte: novo }
  );
  return acabou;
}

/** Arrependimento (CDC art. 49): 7 dias a partir do 1º pagamento aprovado. */
const JANELA_ARREPENDIMENTO_MS = 7 * 86_400_000;

/**
 * O sócio desiste pelo app em até 7 dias do 1º pagamento aprovado: reembolso
 * integral no Mercado Pago, fim dos benefícios na hora.
 *
 * Cartão: reembolsa os pagamentos aprovados do preapproval e cancela o
 * preapproval (antes, para não cobrar de novo). Pix: reembolsa os Pix de
 * assinatura aprovados nos últimos 7 dias. Os pagamentos viram `estornado` aqui
 * mesmo, então o webhook `refunded` que vem depois não faz nada.
 *
 * Repetível: se o MP cair no meio, tocar de novo continua do que sobrou
 * (a chave de idempotência do reembolso é o id do pagamento). Depois de
 * concluída, repetir responde `reembolsados: 0`.
 */
export const desistirAssinatura = onCall({ secrets: [MP_ACCESS_TOKEN] }, async (req) => {
  const uid = requireAuth(req);
  await consumir(uid, "desistirAssinatura");
  const limite = Date.now() - JANELA_ARREPENDIMENTO_MS;
  const quando = (p: { get(k: string): unknown }) => (p.get("data") as Timestamp | undefined)?.toMillis() ?? 0;

  const subs = (await db.collection("subscriptions").where("userId", "==", uid).get()).docs;
  const aprovados = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) =>
    docs.filter((p) => p.get("status") === "aprovado");

  // Cartão: pagamentos de cada assinatura cujo 1º pagamento está dentro do prazo.
  // Assinatura que começou antes da janela (com 1 dia de folga para a 1ª cobrança
  // sair) é renovação, mesmo que seus pagamentos antigos não estejam ligados a ela.
  const cartoes = [];
  let vencido = false;
  for (const sub of subs.filter((d) => d.get("formaPagamento") !== "pix")) {
    const pags = aprovados((await db.collection("payments").where("preapprovalId", "==", sub.id).get()).docs);
    if (!pags.length) continue;
    const inicio = (sub.get("inicioEm") as Timestamp | undefined)?.toMillis() ?? Infinity;
    if (Math.min(...pags.map(quando)) >= limite && inicio >= limite - 86_400_000) cartoes.push({ sub, pags });
    else vencido = true;
  }
  // Pix: um documento por sócio (`pix_{uid}`); consumo no salão também é Pix
  // em `payments`, mas não tem o prefixo `mp_` nem escapa do `tipo`.
  const pixAprovados = aprovados(
    (await db.collection("payments").where("userId", "==", uid).where("metodo", "==", "pix").get()).docs
  ).filter((p) => p.id.startsWith("mp_") && p.get("tipo") !== "consumo");
  // Arrependimento vale para a 1ª contratação: quem já tem Pix aprovado antes da
  // janela está renovando e não recebe a renovação de volta.
  const renovacaoPix = pixAprovados.some((p) => quando(p) < limite);
  const pixPags = renovacaoPix ? [] : pixAprovados;
  if (renovacaoPix) vencido = true;

  const pagamentos = [...cartoes.flatMap((c) => c.pags), ...pixPags];
  if (!pagamentos.length) {
    if (subs.some((d) => d.get("motivo") === "arrependimento")) return { ok: true, reembolsados: 0 };
    throw new HttpsError(
      "failed-precondition",
      vencido ? "Prazo de 7 dias para desistir já passou." : "Nenhuma assinatura para desistir."
    );
  }

  const pixRef = db.doc(`subscriptions/pix_${uid}`);
  try {
    // 1. Para de cobrar e encerra ANTES de devolver: se o MP cair no meio do
    // reembolso, o sócio já não tem benefício, e os pagamentos que seguem
    // `aprovado` deixam uma nova chamada terminar o que faltou.
    for (const { sub } of cartoes) {
      await gateway().cancelarAssinatura((sub.get("gatewaySubscriptionId") as string | undefined) ?? sub.id);
    }
    if (cartoes.length) {
      const lote = db.batch();
      cartoes.forEach(({ sub }) =>
        lote.update(sub.ref, {
          status: "canceled",
          motivo: "arrependimento",
          ativaAte: Timestamp.now(),
          proximaCobranca: null,
          canceladaEm: sub.get("canceladaEm") ?? FieldValue.serverTimestamp(),
        })
      );
      await lote.commit();
      await cancelarResgates(uid);
    }

    // 2. Devolve um a um. O pagamento só vira `estornado` depois do reembolso.
    for (const p of pagamentos) {
      await gateway().reembolsar((p.get("gatewayRef") as string | undefined) ?? p.id.replace(/^mp_/, ""));
      const lote = db.batch();
      lote.update(p.ref, { status: "estornado", reembolsadoEm: FieldValue.serverTimestamp() });
      // Pix: tira só o período deste pagamento (como `estornarPix`); período pago
      // e não devolvido continua valendo.
      const encerrou = p.get("metodo") === "pix" ? await tirarPeriodoPix(pixRef, lote) : false;
      await lote.commit();
      if (encerrou) await cancelarResgates(uid);
    }
  } catch (err) {
    erroDoGateway(err, { uid, meio: "reembolso" });
  }

  return { ok: true, reembolsados: pagamentos.length };
});
