import { createHmac, timingSafeEqual } from "crypto";
import type { DocumentData } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import { MP_ACCESS_TOKEN } from "./segredos";

/**
 * Caixa que recebe TODO e-mail do Mercado Pago (decisão do dono, 06/10/2026:
 * cliente não recebe nada do MP, só o dono). Não é segredo — é parâmetro, e o
 * deploy pergunta o valor na primeira vez.
 */
const MP_EMAIL_PAGADOR = defineString("MP_EMAIL_PAGADOR");

/**
 * E-mail que vai pro MP como pagador, no lugar do e-mail do sócio.
 *
 * `dono+<uid>@...`, não o endereço puro: o MP agrupa pagador por e-mail, e
 * todos os sócios com o mesmo endereço virariam "um cliente com 300
 * assinaturas" — prato cheio pro antifraude. O `+uid` separa cada sócio e a
 * entrega cai na mesma caixa (Gmail/Workspace ignoram o que vem depois do +).
 * O sócio nunca vê nem digita isso. O webhook acha o sócio pela
 * `external_reference`, não pelo e-mail.
 */
export function emailPagador(uid: string): string {
  const [local, dominio] = MP_EMAIL_PAGADOR.value().trim().split("@");
  if (!local || !dominio) throw new Error("MP_EMAIL_PAGADOR inválido");
  return `${local}+${uid}@${dominio}`;
}

/**
 * Ponto único onde o gateway de pagamento entra: o **Mercado Pago** (decisão do
 * dono em 11/09/2026), por Assinaturas sem plano associado (`/preapproval`).
 *
 * Chamadas diretas à API REST com `fetch`, sem o SDK: são quatro endpoints, e
 * o SDK seria mais uma dependência pra acompanhar num projeto que já teve 11
 * falhas de segurança em dependência.
 *
 * Sem `MP_ACCESS_TOKEN`, [gateway] lança [GatewayIndisponivel]:
 *   - assinar e cancelar respondem ao sócio com erro claro, sem fingir sucesso;
 *   - a exclusão de conta **registra** o cancelamento que ficou devendo em
 *     `cancelamentosPendentes`, em vez de engoli-lo.
 *
 * ## Por que um ponto único
 *
 * Antes, `subscriptions.ts`, `account.ts` e o webhook chamavam o SDK do gateway
 * direto. Trocar de gateway era caçar chamadas espalhadas — e uma delas
 * (`account.ts`) chamava sem declarar o segredo: `.value()` vinha vazio, o erro
 * caía num `catch {}` vazio e a conta era apagada **com a assinatura ainda
 * cobrando**, sem log nenhum.
 *
 * Toda function que chama [gateway] ou [mp] declara `MP_ACCESS_TOKEN` em
 * `secrets: [...]` — hoje `createCheckoutSession`, `cancelSubscription`,
 * `deleteAccount`, `finalizarExclusoes` e `mercadoPagoWebhook`. Sem isso o
 * segredo chega vazio em produção e só no emulador parece funcionar.
 */

/** O gateway de pagamento ainda não foi configurado neste projeto. */
export class GatewayIndisponivel extends Error {
  constructor() {
    super("Gateway de pagamento não configurado.");
    this.name = "GatewayIndisponivel";
  }
}

/** Resposta não-2xx da API do Mercado Pago. */
export class ErroMercadoPago extends Error {
  /**
   * `cause[0].code` do corpo. O corpo inteiro pode trazer dados do pagador,
   * então não é guardado nem vai para log: só `status` e `causa`.
   */
  readonly causa?: string;

  constructor(readonly status: number, corpo: unknown) {
    const code = (corpo as { cause?: { code?: unknown }[] } | null)?.cause?.[0]?.code;
    super(`Mercado Pago respondeu ${status}${code !== undefined ? ` (causa ${String(code)})` : ""}`);
    this.name = "ErroMercadoPago";
    if (code !== undefined) this.causa = String(code);
  }
}

export interface Gateway {
  /**
   * Cria o checkout da assinatura e devolve a URL para onde o app manda o
   * sócio. Quem confirma a assinatura é o webhook do gateway, **nunca** o
   * retorno desta chamada: o sócio pode fechar a página no meio.
   */
  criarCheckout(p: {
    uid: string;
    planId: string;
    plano: DocumentData;
  }): Promise<{ url: string }>;

  /**
   * Cancela a assinatura no gateway.
   *
   * Tem que resolver **sem erro** quando ela já estiver cancelada ou não
   * existir mais lá. Erro aqui significa "pode continuar cobrando" — quem chama
   * trata assim.
   */
  cancelarAssinatura(gatewaySubscriptionId: string): Promise<void>;

  /**
   * Reembolso integral de um pagamento (arrependimento, CDC art. 49). A chave
   * de idempotência é o próprio id: repetir a chamada não devolve duas vezes.
   */
  reembolsar(paymentId: string): Promise<void>;

  /**
   * Assinatura no cartão sem sair do app. O cartão chega como `cardToken`,
   * gerado pelo app direto no Mercado Pago: o número nunca passa por aqui.
   * A primeira cobrança sai em até 1 hora; as seguintes, todo mês.
   */
  assinarComCartao(p: {
    uid: string;
    planId: string;
    plano: DocumentData;
    cardToken: string;
  }): Promise<Preapproval>;

  /** Cobrança Pix avulsa de um período do plano. Expira em 1 hora. */
  criarPix(p: {
    uid: string;
    planId: string;
    plano: DocumentData;
    /** Muda quando um Pix é creditado, para a renovação não devolver o QR já pago. */
    versao: string;
  }): Promise<{ paymentId: number; qrCode: string; expiraEm: string }>;
}

/** Os campos de `/v1/payments` que o Pix da assinatura usa. */
export interface PagamentoPix {
  id: number;
  status: string; // pending | approved | rejected | cancelled | ...
  transaction_amount: number;
  currency_id?: string;
  payment_method_id?: string;
  external_reference?: string;
  metadata?: Record<string, unknown>;
  date_of_expiration?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string } };
}

/** O que marca, no `metadata`, um Pix que paga assinatura (e não outra coisa). */
export const PIX_ASSINATURA = "assinatura_pix";

/** O Pix pago cobre o plano? Valor, moeda e meio conferidos com o que veio da API. */
export function pixPagaPlano(p: PagamentoPix, preco: number): boolean {
  return (
    p.status === "approved" &&
    p.payment_method_id === "pix" &&
    (p.currency_id ?? "BRL") === "BRL" &&
    Number(p.transaction_amount) + 0.001 >= Number(preco)
  );
}

/** Soma meses de calendário. 31/01 + 1 mês cai em 03/03, e tudo bem: sobra dia, não falta. */
export function somarMeses(base: Date, meses: number): Date {
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d;
}

/** Horário de Brasília no formato que o Mercado Pago pede (sem horário de verão desde 2019). */
export function horaBrasilia(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().replace("Z", "-03:00");
}

/** Os campos de `/preapproval` que o projeto usa. */
export interface Preapproval {
  id: string;
  status: string; // pending | authorized | paused | cancelled
  external_reference?: string;
  payer_id?: number;
  next_payment_date?: string;
  init_point?: string;
}

/** Os campos de `/authorized_payments` (cada cobrança mensal) que o projeto usa. */
export interface PagamentoAutorizado {
  id: number;
  preapproval_id: string;
  status: string; // scheduled | processed | recycling | cancelled
  transaction_amount: number | string;
  payment?: { id: number; status: string };
}

/**
 * Para onde o Mercado Pago devolve o sócio depois do checkout: uma página
 * estática do app web (`app/web/assinatura.html`) que manda voltar pro app.
 *
 * Fixo no servidor de propósito. Já foi `successUrl`/`cancelUrl` vindos do
 * cliente, e quem chamasse a função direto recebia uma URL de checkout
 * **legítima, no comerciante PandaVip**, que ao terminar jogava a pessoa num
 * site escolhido por ele — material perfeito pra golpe.
 */
export const URL_RETORNO = "https://seu-projeto-app.web.app/assinatura.html";

/**
 * Intervalos em meses. O painel grava "mês"/"trimestre"/"ano"
 * (`admin/src/pages/Plans.tsx`), mas o `plans/mensal` de produção nasceu do
 * seed com "mensal" — e assinar dava `internal` por causa disso.
 */
export const MESES: Record<string, number> = {
  "mês": 1,
  mensal: 1,
  trimestre: 3,
  trimestral: 3,
  ano: 12,
  anual: 12,
};

/**
 * `external_reference` da assinatura: é por ele que o webhook sabe de quem é
 * e de qual plano. Uid do Firebase e id de documento nunca têm `|`.
 */
export function referencia(uid: string, planId: string): string {
  return `${uid}|${planId}`;
}

export function lerReferencia(ref: unknown): { uid: string; planId: string } | null {
  if (typeof ref !== "string") return null;
  const [uid, planId, sobra] = ref.split("|");
  return uid && planId && sobra === undefined ? { uid, planId } : null;
}

/**
 * Confere o `x-signature` de uma notificação, como o `WebhookSignatureValidator`
 * do SDK oficial: HMAC-SHA256 de `id:{data.id};request-id:{x-request-id};ts:{ts};`
 * com a assinatura secreta do webhook, omitindo o par que não veio.
 * `data.id` é o da query string, não o do corpo. Recusa `ts` com mais de 5 min.
 */
export function assinaturaValida(p: {
  xSignature?: string;
  xRequestId?: string;
  dataId?: string;
  secret: string;
  /** Só para teste (ms). */
  agora?: number;
}): boolean {
  const partes = new Map(
    (p.xSignature ?? "").split(",").map((s) => {
      const i = s.indexOf("=");
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()] as const;
    })
  );
  const ts = partes.get("ts");
  const v1 = partes.get("v1");
  if (!ts || !/^\d+$/.test(ts) || !v1) return false;
  // Notificação capturada não vale para sempre: `ts` vem em ms e entra no HMAC.
  // O MP manda em ms, mas aceita-se segundos (10 dígitos) também.
  const tsMs = ts.length <= 10 ? Number(ts) * 1000 : Number(ts);
  if (Math.abs((p.agora ?? Date.now()) - tsMs) > 5 * 60_000) return false;

  const manifesto =
    [p.dataId && `id:${p.dataId}`, p.xRequestId && `request-id:${p.xRequestId}`, `ts:${ts}`]
      .filter(Boolean)
      .join(";") + ";";
  const esperado = createHmac("sha256", p.secret).update(manifesto).digest("hex");
  return v1.length === esperado.length && timingSafeEqual(Buffer.from(v1), Buffer.from(esperado));
}

/** Chamada à API do Mercado Pago com o token da conta do restaurante. */
export async function mp<T>(
  caminho: string,
  opcoes: { method?: string; body?: unknown; idempotencia?: string } = {}
): Promise<T> {
  const res = await fetch(`https://api.mercadopago.com${caminho}`, {
    method: opcoes.method ?? "GET",
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN.value()}`,
      "Content-Type": "application/json",
      ...(opcoes.idempotencia ? { "X-Idempotency-Key": opcoes.idempotencia } : {}),
    },
    body: opcoes.body === undefined ? undefined : JSON.stringify(opcoes.body),
    signal: AbortSignal.timeout(15_000),
  });
  const corpo = await res.json().catch(() => null);
  if (!res.ok) throw new ErroMercadoPago(res.status, corpo);
  return corpo as T;
}

const mercadoPago: Gateway = {
  async criarCheckout({ uid, planId, plano }) {
    const meses = MESES[plano.intervalo as string];
    if (!meses) throw new Error(`Intervalo de plano sem equivalente: ${plano.intervalo}`);

    const pre = await mp<Preapproval>("/preapproval", {
      method: "POST",
      // Mesma chave por sócio + plano durante 10 minutos: clique duplo, ou
      // voltar e tocar de novo, não abre um segundo checkout.
      idempotencia: `${uid}-${planId}-${Math.floor(Date.now() / 600_000)}`,
      body: {
        reason: `${plano.nome ?? "Clube"} PandaVip — Tio Panda`,
        external_reference: referencia(uid, planId),
        payer_email: emailPagador(uid),
        auto_recurring: {
          frequency: meses,
          frequency_type: "months",
          transaction_amount: Number(plano.preco),
          currency_id: "BRL",
        },
        back_url: URL_RETORNO,
        status: "pending",
      },
    });
    if (!pre.init_point) throw new ErroMercadoPago(200, pre);
    return { url: pre.init_point };
  },

  async cancelarAssinatura(id) {
    const caminho = `/preapproval/${encodeURIComponent(id)}`;
    try {
      await mp(caminho, { method: "PUT", body: { status: "cancelled" } });
    } catch (err) {
      // Em vez de adivinhar a mensagem de "já estava cancelada", pergunta o
      // estado: se lá não cobra mais, o contrato está cumprido.
      const atual = await mp<Preapproval>(caminho).catch((e) => {
        if (e instanceof ErroMercadoPago && e.status === 404) return null;
        throw e;
      });
      if (atual && atual.status !== "cancelled") throw err;
    }
  },

  async reembolsar(paymentId) {
    await mp(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
      method: "POST",
      body: {},
      idempotencia: `reembolso-${paymentId}`,
    });
  },

  async assinarComCartao({ uid, planId, plano, cardToken }) {
    const meses = MESES[plano.intervalo as string];
    if (!meses) throw new Error(`Intervalo de plano sem equivalente: ${plano.intervalo}`);
    return mp<Preapproval>("/preapproval", {
      method: "POST",
      // O token do cartão é de uso único: mesma chave, mesmo pedido.
      idempotencia: `${uid}-${planId}-cartao-${cardToken}`,
      body: {
        reason: `${plano.nome ?? "Clube"} PandaVip, Tio Panda`,
        external_reference: referencia(uid, planId),
        payer_email: emailPagador(uid),
        card_token_id: cardToken,
        auto_recurring: {
          frequency: meses,
          frequency_type: "months",
          transaction_amount: Number(plano.preco),
          currency_id: "BRL",
        },
        back_url: URL_RETORNO,
        status: "authorized",
      },
    });
  },

  async criarPix({ uid, planId, plano, versao }) {
    const pg = await mp<PagamentoPix>("/v1/payments", {
      method: "POST",
      // Tocar de novo em "Gerar Pix" nos mesmos 10 minutos devolve o mesmo QR,
      // que ainda vale pelo menos 50 minutos (expira em 1 hora).
      idempotencia: `${uid}-${planId}-pix-${versao}-${Math.floor(Date.now() / 600_000)}`,
      body: {
        transaction_amount: Number(plano.preco),
        description: `${plano.nome ?? "Clube"} PandaVip, Tio Panda`,
        payment_method_id: "pix",
        payer: { email: emailPagador(uid) },
        external_reference: referencia(uid, planId),
        metadata: { tipo: PIX_ASSINATURA },
        date_of_expiration: horaBrasilia(new Date(Date.now() + 60 * 60_000)),
      },
    });
    const qrCode = pg.point_of_interaction?.transaction_data?.qr_code;
    if (!qrCode) throw new ErroMercadoPago(200, pg);
    return { paymentId: pg.id, qrCode, expiraEm: pg.date_of_expiration ?? "" };
  },
};

/** O gateway configurado, ou [GatewayIndisponivel] se falta o token. */
export function gateway(): Gateway {
  if (!MP_ACCESS_TOKEN.value()) throw new GatewayIndisponivel();
  return mercadoPago;
}
