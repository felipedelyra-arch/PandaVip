/**
 * Validação do webhook do Mercado Pago e da referência sócio|plano.
 *
 * Assinatura errada aqui é pior que erro: aceitar notificação forjada ativa
 * sócio sem pagamento, e recusar a verdadeira deixa quem pagou sem benefício.
 *
 * Rodar:  cd firebase/functions && npm run build && npm run test:gateway
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { createHmac } = require("node:crypto");
const {
  assinaturaValida,
  lerReferencia,
  referencia,
  MESES,
  pixPagaPlano,
  somarMeses,
  horaBrasilia,
  emailPagador,
} = require("../functions/lib/lib/gateway");

const secret = "segredo-de-teste";
const assinar = (manifesto, s = secret) => createHmac("sha256", s).update(manifesto).digest("hex");
// `agora` fixo no mesmo instante do `ts` de teste (a conferência de 5 min usa ms).
const base = { xRequestId: "req-1", dataId: "123456", secret, agora: 1742505638000 };

test("aceita a assinatura no formato documentado", () => {
  const v1 = assinar("id:123456;request-id:req-1;ts:1742505638;");
  assert.equal(assinaturaValida({ ...base, xSignature: `ts=1742505638,v1=${v1}` }), true);
});

test("omite do manifesto o par que não veio", () => {
  const v1 = assinar("id:123456;ts:1742505638;");
  assert.equal(assinaturaValida({ ...base, xRequestId: undefined, xSignature: `ts=1742505638,v1=${v1}` }), true);
});

test("recusa segredo errado, id trocado, ts trocado e cabeçalho ausente ou torto", () => {
  const v1 = assinar("id:123456;request-id:req-1;ts:1742505638;");
  const ok = `ts=1742505638,v1=${v1}`;
  assert.equal(assinaturaValida({ ...base, secret: "outro", xSignature: ok }), false);
  assert.equal(assinaturaValida({ ...base, dataId: "999", xSignature: ok }), false);
  assert.equal(assinaturaValida({ ...base, xSignature: `ts=1742505639,v1=${v1}` }), false);
  assert.equal(assinaturaValida({ ...base, xSignature: undefined }), false);
  assert.equal(assinaturaValida({ ...base, xSignature: "lixo" }), false);
  assert.equal(assinaturaValida({ ...base, xSignature: `v1=${v1}` }), false);
});

test("recusa notificação com ts fora de 5 minutos (reenvio de captura)", () => {
  // ts em segundos (10 dígitos), agora em ms.
  const v1 = assinar("id:123456;request-id:req-1;ts:1742505638;");
  const sig = `ts=1742505638,v1=${v1}`;
  const t = 1742505638000;
  assert.equal(assinaturaValida({ ...base, xSignature: sig, agora: t + 4 * 60_000 }), true);
  assert.equal(assinaturaValida({ ...base, xSignature: sig, agora: t + 6 * 60_000 }), false);
  assert.equal(assinaturaValida({ ...base, xSignature: sig, agora: t - 6 * 60_000 }), false);
});

test("ts em milissegundos (13 dígitos) também vale, dentro de 5 minutos", () => {
  const v1 = assinar("id:123456;request-id:req-1;ts:1742505638000;");
  const sig = `ts=1742505638000,v1=${v1}`;
  assert.equal(assinaturaValida({ ...base, xSignature: sig, agora: 1742505638000 + 60_000 }), true);
  assert.equal(assinaturaValida({ ...base, xSignature: sig, agora: 1742505638000 + 6 * 60_000 }), false);
});

test("ErroMercadoPago guarda só status e cause.code, nunca o corpo", () => {
  const { ErroMercadoPago } = require("../functions/lib/lib/gateway");
  const e = new ErroMercadoPago(400, { cause: [{ code: 3034 }], payer: { email: "a@b.c" } });
  assert.equal(e.causa, "3034");
  assert.ok(!e.message.includes("a@b.c") && !("corpo" in e));
});

test("referência vai e volta, e lixo vira null", () => {
  assert.deepEqual(lerReferencia(referencia("uidABC", "mensal")), { uid: "uidABC", planId: "mensal" });
  for (const lixo of [undefined, 42, "", "so-uid", "a|", "|b", "a|b|c"]) {
    assert.equal(lerReferencia(lixo), null, String(lixo));
  }
});

test("intervalo do plano: o que o painel grava e o que o seed gravou", () => {
  for (const [k, v] of Object.entries({ "mês": 1, mensal: 1, trimestre: 3, trimestral: 3, ano: 12, anual: 12 })) {
    assert.equal(MESES[k], v, k);
  }
});

test("Pix só libera o mês se pago, em reais, por Pix e no valor do plano", () => {
  const ok = { id: 1, status: "approved", payment_method_id: "pix", currency_id: "BRL", transaction_amount: 4.9 };
  assert.equal(pixPagaPlano(ok, 4.9), true);
  assert.equal(pixPagaPlano({ ...ok, status: "pending" }, 4.9), false);
  assert.equal(pixPagaPlano({ ...ok, transaction_amount: 0.01 }, 4.9), false);
  assert.equal(pixPagaPlano({ ...ok, payment_method_id: "visa" }, 4.9), false);
  assert.equal(pixPagaPlano({ ...ok, currency_id: "USD" }, 4.9), false);
});

test("período do Pix soma meses de calendário", () => {
  assert.equal(somarMeses(new Date("2026-10-02T12:00:00Z"), 1).toISOString(), "2026-11-02T12:00:00.000Z");
  assert.equal(somarMeses(new Date("2026-12-15T12:00:00Z"), 1).toISOString(), "2027-01-15T12:00:00.000Z");
});

test("expiração do Pix vai no horário de Brasília", () => {
  assert.equal(horaBrasilia(new Date("2026-10-02T18:30:00.000Z")), "2026-10-02T15:30:00.000-03:00");
});

test("emailPagador: e-mail do MP vai pro dono, um por sócio, nunca o do cliente", () => {
  process.env.MP_EMAIL_PAGADOR = " dono@exemplo.com ";
  assert.strictEqual(emailPagador("abc123"), "dono+abc123@exemplo.com");
  process.env.MP_EMAIL_PAGADOR = "sem-arroba";
  assert.throws(() => emailPagador("abc123"));
});
