import { FieldValue, type DocumentReference, type DocumentSnapshot, type Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "./admin";
import { gateway } from "./gateway";
import { avisarSocio } from "./avisos";
import {
  lerReferencia,
  MESES,
  pixPagaPlano,
  somarMeses,
  type PagamentoPix,
  type Preapproval,
} from "./gateway";

/** Status do `/preapproval` → status que o app e as regras leem. */
const STATUS: Record<string, string> = {
  authorized: "active",
  paused: "past_due",
  cancelled: "canceled",
};

/**
 * A assinatura dá direito ao clube neste instante?
 *
 * `status == "active"` não basta: o Pix vencido só vira `canceled` na faxina
 * de hora em hora (`vencerPix`), e nesse meio-tempo ainda resgatava prêmio.
 * Cartão não tem `ativaAte` — quem manda nele é o Mercado Pago. E só é
 * `active` depois da 1ª cobrança aprovada: antes disso é `pending`
 * (ver [sincronizar]) e não libera benefício.
 */
export function vigoraAgora(sub: DocumentSnapshot, agora = new Date()): boolean {
  if (sub.get("status") !== "active") return false;
  const ate = (sub.get("ativaAte") as Timestamp | undefined)?.toDate();
  return !ate || ate > agora;
}

/** Copia o estado da assinatura no cartão (Mercado Pago) para `subscriptions/{id}`. */
export async function sincronizar(pre: Preapproval) {
  const ref = lerReferencia(pre.external_reference);
  let status = STATUS[pre.status];
  // `pending` é checkout aberto e ainda não pago: não vira documento.
  if (!ref || !status) return;

  // Id = id da assinatura no Mercado Pago: renovação cai no mesmo documento.
  const doc = db.doc(`subscriptions/${pre.id}`);
  const atual = await doc.get();
  const existe = atual.exists;
  // Já encerrada por nós: um preapproval cancelado no MP não volta a cobrar.
  if (atual.get("canceladaEm")) return;
  // Cancelada por qualquer caminho (botão do app, conta do MP, painel do MP):
  // a mesma regra do período pago vale.
  if (status === "canceled" && existe) return encerrarCartao(doc);
  // O MP marca `authorized` assim que o cartão é aceito, mas a 1ª cobrança só
  // sai depois (até 1 hora). Sem pagamento aprovado desta assinatura ela fica
  // `pending`: quem assinava e cancelava na janela levava os prêmios de graça.
  // Quem já estava `active` não é rebaixado (cobrança antiga sem `preapprovalId`);
  // quem estava `past_due` só volta quando a cobrança é aprovada (`cobranca`
  // grava o pagamento antes de chamar esta função).
  if (status === "active" && atual.get("status") !== "active") {
    const pagos = await db.collection("payments").where("preapprovalId", "==", pre.id).get();
    if (!pagos.docs.some((p) => p.get("status") === "aprovado")) {
      status = atual.get("status") === "past_due" ? "past_due" : "pending";
    }
  }
  const promovida = status === "active" && atual.get("status") === "pending";
  await doc.set(
    {
      userId: ref.uid,
      planId: ref.planId,
      status,
      gatewayCustomerId: pre.payer_id ? String(pre.payer_id) : null,
      gatewaySubscriptionId: pre.id,
      formaPagamento: "cartao",
      proximaCobranca: pre.next_payment_date ? new Date(pre.next_payment_date) : null,
      ...(existe ? {} : { inicioEm: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
  if (promovida) {
    await avisarSocio(
      ref.uid,
      { titulo: "Pagamento confirmado", corpo: "Sua assinatura está ativa. Aproveite os benefícios do clube." },
      "assinatura",
      "/planos"
    );
  }
}

/**
 * Encerra a assinatura no cartão respeitando o período já pago (Termos, item
 * 4; CDC art. 51): segue `active` até o último pagamento aprovado + meses do
 * plano, e a faxina (`vencerPix`) encerra depois. Sem pagamento aprovado
 * cobrindo hoje — cobrança recusada, ou assinou e o primeiro débito nem
 * passou — encerra na hora: não há nada pago a honrar (e não vira mês grátis).
 *
 * O fim sai do pagamento, não de `proximaCobranca`: esse campo pode estar
 * atrasado em relação a uma renovação que acabou de passar.
 *
 * Transação: o webhook "cancelled" e o botão do app podem chegar juntos.
 *
 * Só conta pagamento DESTA assinatura (`preapprovalId`): consumo no
 * restaurante também vai para `payments` com metodo "cartao" e não pode
 * comprar período. Pagamentos anteriores a este campo não contam — encerra na
 * hora, o lado seguro (só afeta quem assinou no cartão antes de 12/10/2026).
 */
export async function encerrarCartao(ref: DocumentReference, agora = new Date()) {
  await db.runTransaction(async (tx) => {
    const sub = await tx.get(ref);
    if (!sub.exists || sub.get("canceladaEm")) return;
    let fim: Date | undefined;
    if (sub.get("status") === "active") {
      const plano = (await tx.get(db.doc(`plans/${sub.get("planId")}`))).data();
      const pags = await tx.get(db.collection("payments").where("preapprovalId", "==", ref.id));
      const ultimo = pags.docs
        .filter((p) => p.get("status") === "aprovado")
        .map((p) => (p.get("data") as Timestamp | undefined)?.toDate())
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const f = ultimo && somarMeses(ultimo, MESES[String(plano?.intervalo)] ?? 1);
      if (f && f > agora) fim = f;
    }
    tx.update(
      ref,
      fim
        ? { status: "active", ativaAte: fim, proximaCobranca: null, canceladaEm: FieldValue.serverTimestamp() }
        : { status: "canceled", canceladaEm: FieldValue.serverTimestamp() }
    );
  });
}

/**
 * Cobrança da assinatura no cartão estornada ou contestada: o dinheiro voltou,
 * então o benefício acaba na hora (é o caminho do arrependimento de 7 dias) e
 * a assinatura é cancelada também no Mercado Pago — contestação feita direto
 * no banco deixaria o preapproval cobrando, e o próximo "authorized" a
 * reativaria. `canceladaEm` faz `sincronizar` ignorar qualquer reativação.
 */
export async function estornarCartao(pg: PagamentoPix) {
  const pagRef = db.doc(`payments/mp_${pg.id}`);
  const estornado = await db.runTransaction(async (tx) => {
    const pag = await tx.get(pagRef);
    // Cobrança antiga (antes de 12/10/2026) não tem `tipo`: é assinatura se
    // veio do cartão e não é consumo. Sem `preapprovalId`, vale a assinatura
    // no cartão do sócio que ainda não está encerrada — falhar fechado.
    const tipo = pag.get("tipo");
    const daAssinatura = tipo === "assinatura" || (!tipo && pag.get("metodo") === "cartao");
    if (!pag.exists || !daAssinatura || pag.get("status") !== "aprovado") return null;
    const id = pag.get("preapprovalId") as string | undefined;
    const subs = id
      ? [await tx.get(db.doc(`subscriptions/${id}`))]
      : (await tx.get(db.collection("subscriptions").where("userId", "==", pag.get("userId")))).docs.filter(
          (d) => d.get("formaPagamento") !== "pix" && d.get("status") !== "canceled"
        );
    tx.update(pagRef, { status: "estornado" });
    for (const sub of subs) {
      if (!sub.exists) continue;
      tx.update(sub.ref, {
        status: "canceled",
        motivo: "cartao_estornado",
        canceladaEm: sub.get("canceladaEm") ?? FieldValue.serverTimestamp(),
      });
    }
    return {
      uid: pag.get("userId") as string,
      ids: subs.map((d) => (d.get("gatewaySubscriptionId") as string | undefined) ?? d.id),
    };
  });
  if (!estornado) return;
  await cancelarResgates(estornado.uid);
  for (const id of estornado.ids) await cancelarNoGateway(id, pagRef);
}

/**
 * Códigos de resgate em aberto do [uid] viram `cancelado`: quem perdeu a
 * assinatura por estorno ou desistência não leva o prêmio já resgatado. O
 * cupom continua usado (o estoque não volta).
 */
export async function cancelarResgates(uid: string) {
  const abertos = await db
    .collection("redemptions")
    .where("userId", "==", uid)
    .where("status", "==", "disponivel")
    .get();
  for (let i = 0; i < abertos.size; i += 450) {
    const lote = db.batch();
    abertos.docs
      .slice(i, i + 450)
      .forEach((d) => lote.update(d.ref, { status: "cancelado", canceladoEm: FieldValue.serverTimestamp() }));
    await lote.commit();
  }
}

async function cancelarNoGateway(preapprovalId: string, pagRef: DocumentReference) {
  try {
    await gateway().cancelarAssinatura(preapprovalId);
  } catch (err) {
    // Mesma fila da exclusão de conta: `finalizarExclusoes` tenta de novo.
    logger.error("Estorno sem conseguir cancelar no Mercado Pago.", { preapprovalId, err });
    await db.doc(`cancelamentosPendentes/${preapprovalId.replace(/\//g, "_")}`).set(
      {
        gatewaySubscriptionId: preapprovalId,
        userId: (await pagRef.get()).get("userId") ?? null,
        formaPagamento: "cartao",
        erro: String(err),
        criadoEm: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

const dataBR = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Pix aprovado de assinatura: libera um período do plano.
 *
 * Um documento por sócio (`pix_{uid}`). Pagar antes de vencer soma a partir do
 * vencimento atual, não de hoje: quem renova cedo não perde dias.
 *
 * Idempotente pelo `payments/mp_{id}`, criado na mesma transação: o Mercado
 * Pago reenvia a notificação, e a segunda vez não dá mais um mês de graça.
 *
 * Dinheiro que entrou nunca some: quando o Pix não pode liberar o mês (valor
 * diferente do plano, sócio já paga no cartão, conta excluída), o pagamento é
 * gravado como `conferir` para o dono resolver no painel.
 */
export async function creditarPix(pg: PagamentoPix) {
  if (pg.status !== "approved") return;
  const ref = lerReferencia(pg.external_reference);
  if (!ref) return;

  const plano = (await db.doc(`plans/${ref.planId}`).get()).data();
  const meses = plano ? MESES[String(plano.intervalo)] : undefined;
  const confere = Boolean(plano && meses && pixPagaPlano(pg, Number(plano.preco)));

  const subRef = db.doc(`subscriptions/pix_${ref.uid}`);
  const pagRef = db.doc(`payments/mp_${pg.id}`);
  const perfilRef = db.doc(`users/${ref.uid}`);
  const cartao = db
    .collection("subscriptions")
    .where("userId", "==", ref.uid)
    .where("status", "in", ["active", "past_due"]);

  const resultado = await db.runTransaction(async (tx) => {
    const [pag, sub, perfil] = await tx.getAll(pagRef, subRef, perfilRef);
    if (pag.exists) return null;
    const jaNoCartao = (await tx.get(cartao)).docs.some((d) => d.get("formaPagamento") !== "pix");

    const pagamento = {
      userId: ref.uid,
      valor: Number(pg.transaction_amount),
      metodo: "pix",
      gatewayRef: String(pg.id),
      data: FieldValue.serverTimestamp(),
    };
    const motivo = !perfil.exists
      ? "conta_excluida"
      : jaNoCartao
        ? "ja_assina_no_cartao"
        : !confere
          ? "valor_nao_confere"
          : null;
    if (motivo) {
      tx.create(pagRef, { ...pagamento, status: "conferir", motivo });
      return { motivo };
    }

    const agora = new Date();
    const atual =
      sub.get("status") === "active" ? (sub.get("ativaAte") as Timestamp | undefined)?.toDate() : undefined;
    const ate = somarMeses(atual && atual > agora ? atual : agora, meses!);

    tx.create(pagRef, { ...pagamento, status: "aprovado" });
    tx.set(
      subRef,
      {
        userId: ref.uid,
        planId: ref.planId,
        status: "active",
        formaPagamento: "pix",
        ativaAte: ate,
        proximaCobranca: null,
        avisoVencimentoEm: null,
        motivo: FieldValue.delete(),
        ...(sub.exists ? {} : { inicioEm: FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );
    return { ate };
  });

  if (resultado?.motivo) {
    logger.error("Pix de assinatura recebido sem liberar o mês; conferir no painel.", {
      paymentId: pg.id,
      uid: ref.uid,
      planId: ref.planId,
      motivo: resultado.motivo,
    });
  } else if (resultado?.ate) {
    await avisarSocio(
      ref.uid,
      { titulo: "Pagamento confirmado", corpo: `Sua assinatura está ativa até ${dataBR(resultado.ate)}.` },
      "assinatura",
      "/planos"
    );
  }
}

/**
 * Pix devolvido (estorno ou MED). O pagamento vira `estornado`; se ele tinha
 * liberado período, tira só os meses dele do vencimento. Quem pagou dois meses
 * e teve um devolvido continua com o outro.
 */
export async function estornarPix(pg: PagamentoPix) {
  const ref = lerReferencia(pg.external_reference);
  if (!ref) return;
  const plano = (await db.doc(`plans/${ref.planId}`).get()).data();
  const meses = plano ? MESES[String(plano.intervalo)] ?? 1 : 1;
  const pagRef = db.doc(`payments/mp_${pg.id}`);
  const subRef = db.doc(`subscriptions/pix_${ref.uid}`);
  const encerrou = await db.runTransaction(async (tx) => {
    const [pag, sub] = await tx.getAll(pagRef, subRef);
    const status = pag.get("status");
    // `conferir` também: é o caminho natural do dono para o Pix que não liberou mês.
    if (!pag.exists || (status !== "aprovado" && status !== "conferir")) return false;
    tx.update(pagRef, { status: "estornado" });
    if (status !== "aprovado" || sub.get("status") !== "active") return false;
    const ate = somarMeses((sub.get("ativaAte") as Timestamp).toDate(), -meses);
    const acabou = ate <= new Date();
    tx.update(
      subRef,
      acabou ? { status: "canceled", motivo: "pix_estornado", ativaAte: ate } : { ativaAte: ate }
    );
    return acabou;
  });
  if (encerrou) await cancelarResgates(ref.uid);
}

/**
 * Pix não renova sozinho. De hora em hora: avisa uma vez quem vence em até
 * 3 dias e encerra quem já venceu. Também encerra o cartão cancelado pelo
 * sócio quando o período pago acaba (esse não recebe aviso de "renove com Pix").
 *
 * Cada escrita exige que o documento não tenha mudado desde a leitura
 * (`lastUpdateTime`): um Pix de renovação creditado no meio do laço não pode
 * ser encerrado com base no vencimento antigo.
 *
 * ponytail: lê todo `ativaAte` até daqui a 3 dias, inclusive os já encerrados;
 * filtrar por status pede índice composto. Vira query composta se a base crescer.
 */
export async function vencerPix(agora = new Date()) {
  const limite = new Date(agora.getTime() + 3 * 86_400_000);
  const snap = await db.collection("subscriptions").where("ativaAte", "<=", limite).get();
  for (const d of snap.docs) {
    if (d.get("status") !== "active") continue;
    const pix = d.get("formaPagamento") === "pix";
    const ate = (d.get("ativaAte") as Timestamp).toDate();
    const venceu = ate <= agora;
    if (!venceu && (!pix || d.get("avisoVencimentoEm"))) continue;
    try {
      await d.ref.update(
        venceu
          ? { status: "canceled", motivo: pix ? "pix_vencido" : "cancelada_pelo_socio" }
          : { avisoVencimentoEm: FieldValue.serverTimestamp() },
        { lastUpdateTime: d.updateTime }
      );
    } catch (err) {
      // 9 = FAILED_PRECONDITION: mudou desde a leitura (renovou). Fica pra próxima volta.
      if ((err as { code?: number }).code === 9) continue;
      throw err;
    }
    await avisarSocio(
      d.get("userId"),
      venceu && !pix
        ? { titulo: "Assinatura encerrada", corpo: "O período pago terminou. Assine de novo pelo app quando quiser." }
        : venceu
        ? { titulo: "Assinatura vencida", corpo: "Renove com Pix pelo app para voltar a resgatar prêmios." }
        : { titulo: "Sua assinatura vence em breve", corpo: `Vence em ${dataBR(ate)}. Renove com Pix pelo app.` },
      "assinatura",
      "/planos"
    );
  }
}
