import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import {
  assinaturaValida,
  ErroMercadoPago,
  lerReferencia,
  mp,
  PIX_ASSINATURA,
  type PagamentoAutorizado,
  type PagamentoPix,
  type Preapproval,
} from "../lib/gateway";
import { creditarPix, estornarCartao, estornarPix, sincronizar } from "../lib/assinaturas";
import { MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET } from "../lib/segredos";

/**
 * Webhook do Mercado Pago. Único caminho que muda estado de cobrança.
 *
 * A notificação só diz "o objeto X mudou". O estado de verdade é buscado na API
 * com o nosso token: notificação repetida, fora de ordem ou reenviada nunca
 * grava algo que o Mercado Pago não confirme.
 *
 * No painel do Mercado Pago (Suas integrações → Webhooks, modo produção),
 * marcar o evento "Planos e assinaturas".
 */

/** Uma cobrança mensal: registra o pagamento aprovado ou marca a recusa. */
async function cobranca(ap: PagamentoAutorizado) {
  const pre = await mp<Preapproval>(`/preapproval/${encodeURIComponent(ap.preapproval_id)}`);
  const ref = lerReferencia(pre.external_reference);
  if (!ref) return;

  if (ap.payment?.status === "approved") {
    // Id derivado + `create`: o reenvio da mesma cobrança bate em
    // ALREADY_EXISTS em vez de virar receita duplicada no relatório do dono.
    try {
      await db.doc(`payments/mp_${ap.payment.id}`).create({
        userId: ref.uid,
        valor: Number(ap.transaction_amount),
        metodo: "cartao",
        status: "aprovado",
        // Liga o pagamento à assinatura: é o que `encerrarCartao` usa para
        // saber até quando o período está pago (e não confundir com consumo).
        tipo: "assinatura",
        preapprovalId: pre.id,
        gatewayRef: String(ap.payment.id),
        data: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 6) throw err;
    }
    await sincronizar(pre);
  } else if (ap.status === "recycling" || ap.payment?.status === "rejected") {
    // Só rebaixa quem está ativo: não ressuscita assinatura cancelada.
    const doc = db.doc(`subscriptions/${pre.id}`);
    const atual = await doc.get();
    // Cancelada pelo sócio: recusa atrasada não pode travá-la em past_due.
    if (atual.get("status") === "active" && !atual.get("canceladaEm")) {
      await doc.update({ status: "past_due" });
    }
  }
}

/** `type` não entra no manifesto assinado: só os três tópicos assinados no painel do MP passam. */
const TOPICOS = new Set(["payment", "subscription_preapproval", "subscription_authorized_payment"]);

export const mercadoPagoWebhook = onRequest(
  { invoker: "public", secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET] },
  async (req, res) => {
    const secret = MP_WEBHOOK_SECRET.value();
    if (!secret) {
      res.status(500).send("MP_WEBHOOK_SECRET não configurada.");
      return;
    }

    const dataId = req.query["data.id"] as string | undefined;
    const requestId = req.get("x-request-id");
    if (!assinaturaValida({ xSignature: req.get("x-signature"), xRequestId: requestId, dataId, secret })) {
      logger.warn("Webhook do Mercado Pago com assinatura inválida.", { requestId, dataId });
      res.status(401).send("Assinatura inválida.");
      return;
    }

    const tipo = (req.body?.type ?? req.query.type) as string | undefined;
    if (!tipo || !TOPICOS.has(tipo)) {
      res.status(200).send({ ignorado: true });
      return;
    }
    try {
      if (tipo === "subscription_preapproval" && dataId) {
        await sincronizar(await mp<Preapproval>(`/preapproval/${encodeURIComponent(dataId)}`));
      } else if (tipo === "subscription_authorized_payment" && dataId) {
        await cobranca(
          await mp<PagamentoAutorizado>(`/authorized_payments/${encodeURIComponent(dataId)}`)
        );
      } else if (tipo === "payment" && dataId) {
        // Pix da assinatura, e estorno de cobrança do cartão (a aprovação do
        // cartão já chega pelos dois tópicos acima).
        const pg = await mp<PagamentoPix>(`/v1/payments/${encodeURIComponent(dataId)}`);
        const estorno = pg.status === "refunded" || pg.status === "charged_back";
        if (pg.metadata?.tipo === PIX_ASSINATURA) {
          if (estorno) await estornarPix(pg);
          else await creditarPix(pg);
        } else if (estorno) {
          await estornarCartao(pg);
        }
      }
      res.status(200).send({ ok: true });
    } catch (err) {
      // 404: o objeto não existe nesta conta — é o que o botão "Simular" do
      // painel manda. Reenviar não vai fazê-lo existir.
      if (err instanceof ErroMercadoPago && err.status === 404) {
        res.status(200).send({ ignorado: true });
        return;
      }
      logger.error("Erro processando webhook do Mercado Pago.", { tipo, dataId, err });
      res.status(500).send("Erro interno.");
    }
  }
);
