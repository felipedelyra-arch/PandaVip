/**
 * Verificação do cancelamento: a cobrança para na hora, os benefícios seguem
 * até o fim do período pago (Termos, item 4) e a faxina encerra depois.
 *
 * Roda a function de verdade (`cancelSubscription.run`), o webhook
 * (`sincronizar`, `estornarCartao`) e a faxina (`vencerPix`) contra o emulador.
 *
 * Uso: npm --prefix firebase/functions run build &&
 *      firebase emulators:exec --only firestore --project seu-projeto "node ../loadtest/verificar-cancelamento.js"
 */
const path = require("path");
const { db, exigirEmulador } = require("./lib");

const lib = path.join(__dirname, "..", "firebase", "functions", "lib");
const { cancelSubscription, desistirAssinatura } = require(path.join(lib, "subscriptions.js"));
const { sincronizar, vencerPix, vigoraAgora, estornarCartao } = require(path.join(lib, "lib", "assinaturas.js"));
const { somarMeses } = require(path.join(lib, "lib", "gateway.js"));

let falhas = 0;
function checar(nome, condicao, detalhe = "") {
  const ok = Boolean(condicao);
  if (!ok) falhas++;
  console.log(`  ${ok ? "OK    " : "FALHOU"} ${nome}${detalhe ? `  (${detalhe})` : ""}`);
}

const dias = (n) => new Date(Date.now() + n * 86400000);
const cancelar = (uid) => cancelSubscription.run({ auth: { uid, token: {} }, data: {} });
const cartao = (uid, extra = {}) =>
  db.doc(`subscriptions/${uid}`).set({
    userId: uid, planId: "mensal", status: "active", formaPagamento: "cartao", proximaCobranca: dias(20), ...extra,
  });
const pagou = (uid, quando) =>
  db.doc(`payments/mp_${uid}`).set({
    userId: uid, metodo: "cartao", status: "aprovado", tipo: "assinatura", preapprovalId: uid, valor: 4.9, data: quando,
  });
const mpCancelou = (uid) =>
  sincronizar({ id: uid, status: "cancelled", payer_id: 1, next_payment_date: null, external_reference: `${uid}|mensal` });

const desistir = (uid) => desistirAssinatura.run({ auth: { uid, token: {} }, data: {} });
const erroDe = (p) => p.then(() => null, (e) => e.message);
const preap = (id, status = "authorized") => ({ id, status, payer_id: 1, next_payment_date: null, external_reference: `${id}|mensal` });

/** F1: cartão aceito pelo MP não libera nada antes da 1ª cobrança aprovada. */
async function verificarPending() {
  console.log("\n=== Cartão pending até a 1ª cobrança ===\n");
  await sincronizar(preap("pn_a"));
  let s = await db.doc("subscriptions/pn_a").get();
  checar("authorized sem cobrança vira pending", s.get("status") === "pending");
  checar("pending não dá benefício", !vigoraAgora(s));
  await sincronizar(preap("pn_a"));
  checar("notificação repetida segue pending", (await db.doc("subscriptions/pn_a").get()).get("status") === "pending");

  await db.doc("payments/mp_pn_a").set({
    userId: "pn_a", metodo: "cartao", status: "aprovado", tipo: "assinatura", preapprovalId: "pn_a", valor: 4.9, data: new Date(),
  });
  await sincronizar(preap("pn_a"));
  s = await db.doc("subscriptions/pn_a").get();
  checar("cobrança aprovada promove a active", s.get("status") === "active" && vigoraAgora(s));

  // Assinatura antiga (sem pagamento ligado ao preapproval) não é rebaixada.
  await cartao("pn_legado");
  await sincronizar(preap("pn_legado"));
  checar("active antigo não é rebaixado", (await db.doc("subscriptions/pn_legado").get()).get("status") === "active");

  // past_due só volta a active com cobrança aprovada.
  await cartao("pn_pd", { status: "past_due" });
  await sincronizar(preap("pn_pd"));
  checar("past_due sem cobrança nova segue past_due", (await db.doc("subscriptions/pn_pd").get()).get("status") === "past_due");

  // Quem assinou e cancelou na janela não leva nada.
  await cartao("pn_c", { status: "pending" });
  await cancelar("pn_c");
  checar("cancelar pending encerra na hora", (await db.doc("subscriptions/pn_c").get()).get("status") === "canceled");

  // Pix: cancelar é inócuo (não perde o período pago).
  await db.doc("subscriptions/pix_pn_x").set({
    userId: "pn_x", planId: "mensal", status: "active", formaPagamento: "pix", ativaAte: dias(20),
  });
  const r = await cancelar("pn_x");
  const px = await db.doc("subscriptions/pix_pn_x").get();
  checar("cancelSubscription no Pix é no-op", r.ok && px.get("status") === "active" && !px.get("canceladaEm"));
}

/** A1/F2: desistência em 7 dias, reembolso no MP (fetch simulado) e resgates cancelados. */
async function verificarDesistencia() {
  console.log("\n=== Desistência (arrependimento) ===\n");
  const chamadas = [];
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), method: opcoes.method ?? "GET", idem: opcoes.headers?.["X-Idempotency-Key"] });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  process.env.MP_ACCESS_TOKEN = "token-de-teste";
  try {
    await cartao("ds_a", { gatewaySubscriptionId: "ds_a" });
    await pagou("ds_a", dias(-2));
    await db.doc("redemptions/r1__ds_a").set({ userId: "ds_a", rewardId: "r1", codigo: "AAA", status: "disponivel" });
    await db.doc("redemptions/r2__ds_a").set({ userId: "ds_a", rewardId: "r2", codigo: "BBB", status: "usado" });
    const r = await desistir("ds_a");
    const s = await db.doc("subscriptions/ds_a").get();
    checar("cartão: responde ok com 1 reembolso", r.ok && r.reembolsados === 1);
    checar("cartão: assinatura cancelada por arrependimento", s.get("status") === "canceled" && s.get("motivo") === "arrependimento" && !vigoraAgora(s));
    checar("cartão: pagamento marcado estornado", (await db.doc("payments/mp_ds_a").get()).get("status") === "estornado");
    const reemb = chamadas.find((c) => c.url.endsWith("/v1/payments/ds_a/refunds"));
    checar("cartão: POST /refunds com chave = id do pagamento", reemb?.method === "POST" && reemb.idem === "reembolso-ds_a");
    checar("cartão: preapproval cancelado no MP", chamadas.some((c) => c.url.endsWith("/preapproval/ds_a") && c.method === "PUT"));
    checar("resgate disponível vira cancelado", (await db.doc("redemptions/r1__ds_a").get()).get("status") === "cancelado");
    checar("resgate já usado não muda", (await db.doc("redemptions/r2__ds_a").get()).get("status") === "usado");
    const n = chamadas.length;
    const r2 = await desistir("ds_a");
    checar("repetir é idempotente (0 reembolsos, sem nova chamada ao MP)", r2.ok && r2.reembolsados === 0 && chamadas.length === n);
    // Webhook refunded depois: nada muda.
    await estornarCartao({ id: "ds_a", status: "refunded" });
    checar("webhook refunded depois é inócuo", (await db.doc("subscriptions/ds_a").get()).get("motivo") === "arrependimento");

    await cartao("ds_b", { gatewaySubscriptionId: "ds_b" });
    await pagou("ds_b", dias(-10));
    checar("depois de 7 dias recusa", (await erroDe(desistir("ds_b"))) === "Prazo de 7 dias para desistir já passou.");
    checar("sem nenhum reembolso no MP para ds_b", !chamadas.some((c) => c.url.includes("ds_b/refunds")));

    checar("sem assinatura recusa", (await erroDe(desistir("ds_nada"))) === "Nenhuma assinatura para desistir.");

    await cartao("ds_p", { status: "pending", gatewaySubscriptionId: "ds_p" });
    checar("pending sem cobrança não tem o que devolver", (await erroDe(desistir("ds_p"))) === "Nenhuma assinatura para desistir.");

    // Sócio antigo renovando: assinatura de 40 dias, cobrança de ontem. Não é o 1º pagamento.
    await cartao("ds_r", { gatewaySubscriptionId: "ds_r", inicioEm: dias(-40) });
    await pagou("ds_r", dias(-1));
    checar("renovação de sócio antigo não é desistência", (await erroDe(desistir("ds_r"))) === "Prazo de 7 dias para desistir já passou.");
    checar("renovação antiga segue ativa", (await db.doc("subscriptions/ds_r").get()).get("status") === "active");

    // MP cai no meio do reembolso: já encerrou e cancelou resgates; repetir termina.
    await cartao("ds_f", { gatewaySubscriptionId: "ds_f" });
    await pagou("ds_f", dias(-1));
    await db.doc("redemptions/r1__ds_f").set({ userId: "ds_f", rewardId: "r1", codigo: "FFF", status: "disponivel" });
    const bom = globalThis.fetch;
    globalThis.fetch = async (url, opcoes = {}) =>
      String(url).includes("/refunds") ? { ok: false, status: 500, json: async () => ({}) } : bom(url, opcoes);
    checar("falha do MP no reembolso devolve erro", (await erroDe(desistir("ds_f"))) !== null);
    globalThis.fetch = bom;
    let f = await db.doc("subscriptions/ds_f").get();
    checar("já encerrada por arrependimento apesar da falha", f.get("status") === "canceled" && f.get("motivo") === "arrependimento" && !vigoraAgora(f));
    checar("resgate já cancelado apesar da falha", (await db.doc("redemptions/r1__ds_f").get()).get("status") === "cancelado");
    checar("pagamento segue aprovado até o reembolso dar certo", (await db.doc("payments/mp_ds_f").get()).get("status") === "aprovado");
    const rf = await desistir("ds_f");
    checar("repetir reembolsa o que faltou", rf.reembolsados === 1 && (await db.doc("payments/mp_ds_f").get()).get("status") === "estornado");

    // Pix com dois meses pagos, devolve só o último: o resto do período vale.
    await db.doc("subscriptions/pix_ds_y").set({
      userId: "ds_y", planId: "mensal", status: "active", formaPagamento: "pix", ativaAte: dias(60),
    });
    await db.doc("payments/mp_9100").set({ userId: "ds_y", metodo: "pix", status: "aprovado", gatewayRef: "9100", valor: 4.9, data: dias(-1) });
    await desistir("ds_y");
    const py = await db.doc("subscriptions/pix_ds_y").get();
    const resta = py.get("ativaAte").toMillis() - Date.now();
    checar("Pix: período pago e não devolvido continua (~1 mês)", py.get("status") === "active" && resta > 25 * 86400000 && resta < 35 * 86400000);

    // Sócio antigo no Pix renovando: não recebe a renovação de volta.
    await db.doc("subscriptions/pix_ds_v").set({
      userId: "ds_v", planId: "mensal", status: "active", formaPagamento: "pix", ativaAte: dias(55),
    });
    await db.doc("payments/mp_9200").set({ userId: "ds_v", metodo: "pix", status: "aprovado", gatewayRef: "9200", valor: 4.9, data: dias(-35) });
    await db.doc("payments/mp_9201").set({ userId: "ds_v", metodo: "pix", status: "aprovado", gatewayRef: "9201", valor: 4.9, data: dias(-1) });
    checar("renovação Pix de sócio antigo não é desistência", (await erroDe(desistir("ds_v"))) === "Prazo de 7 dias para desistir já passou.");
    checar("renovação Pix intocada", (await db.doc("payments/mp_9201").get()).get("status") === "aprovado" && !chamadas.some((c) => c.url.includes("9201")));

    // Pix: devolve o Pix de assinatura, nunca o consumo no salão.
    await db.doc("subscriptions/pix_ds_x").set({
      userId: "ds_x", planId: "mensal", status: "active", formaPagamento: "pix", ativaAte: dias(25),
    });
    await db.doc("payments/mp_9001").set({
      userId: "ds_x", metodo: "pix", status: "aprovado", gatewayRef: "9001", valor: 4.9, data: dias(-1),
    });
    await db.doc("payments/pdv_conta1").set({
      userId: "ds_x", metodo: "pix", status: "aprovado", tipo: "consumo", gatewayRef: "conta1", valor: 80, data: dias(-1),
    });
    const rp = await desistir("ds_x");
    const px = await db.doc("subscriptions/pix_ds_x").get();
    checar("Pix: 1 reembolso e assinatura encerrada", rp.reembolsados === 1 && px.get("status") === "canceled" && px.get("motivo") === "arrependimento");
    checar("Pix: reembolsou o pagamento da assinatura", chamadas.some((c) => c.url.endsWith("/v1/payments/9001/refunds")));
    checar("Pix: consumo no salão intocado", (await db.doc("payments/pdv_conta1").get()).get("status") === "aprovado" && !chamadas.some((c) => c.url.includes("conta1")));
  } finally {
    globalThis.fetch = fetchReal;
    delete process.env.MP_ACCESS_TOKEN;
  }
}

async function main() {
  exigirEmulador();
  console.log("\n=== Cancelamento com período pago ===\n");
  await db.doc("plans/mensal").set({ intervalo: "mês", preco: 4.9 });

  // Ataque: MP já marcou authorized, nenhum pagamento aprovado, cancelou.
  await cartao("cc_z");
  await cancelar("cc_z");
  checar("sem pagamento aprovado encerra na hora", (await db.doc("subscriptions/cc_z").get()).get("status") === "canceled");

  // Conta paga com cartão no restaurante não compra período da assinatura.
  await cartao("cc_x");
  await db.doc("payments/consumo_cc_x").set({
    userId: "cc_x", metodo: "cartao", status: "aprovado", tipo: "consumo", valor: 80, data: dias(-1),
  });
  await cancelar("cc_x");
  checar("consumo no restaurante não segura o período", (await db.doc("subscriptions/cc_x").get()).get("status") === "canceled");

  // Pagamento de período antigo não segura.
  await cartao("cc_y");
  await pagou("cc_y", dias(-40));
  await cancelar("cc_y");
  checar("pagamento de período antigo não segura", (await db.doc("subscriptions/cc_y").get()).get("status") === "canceled");

  // Em dia: pagou há 10 dias.
  const pagoEm = dias(-10);
  await cartao("cc_a");
  await pagou("cc_a", pagoEm);
  await cancelar("cc_a");
  const a = db.doc("subscriptions/cc_a");
  let s = await a.get();
  checar("cancelado segue ativo", s.get("status") === "active");
  checar("ativaAte = pagamento + 1 mês", Math.abs(s.get("ativaAte").toDate() - somarMeses(pagoEm, 1)) < 60000);
  checar("sem próxima cobrança", s.get("proximaCobranca") === null);
  checar("ainda dá benefício", vigoraAgora(s));

  await mpCancelou("cc_a");
  s = await a.get();
  checar("webhook 'cancelled' depois não derruba", s.get("status") === "active" && vigoraAgora(s));

  await vencerPix();
  checar("faxina respeita o período", (await a.get()).get("status") === "active");
  await a.update({ ativaAte: dias(-1) });
  await vencerPix();
  s = await a.get();
  checar("encerra quando o período acaba", s.get("status") === "canceled" && s.get("motivo") === "cancelada_pelo_socio");

  // Cancelou pela conta do Mercado Pago (sem passar pelo app).
  await cartao("cc_m");
  await pagou("cc_m", dias(-5));
  await mpCancelou("cc_m");
  s = await db.doc("subscriptions/cc_m").get();
  checar("cancelado no MP também mantém o período", s.get("status") === "active" && vigoraAgora(s));
  const ate = s.get("ativaAte").toMillis();
  await cancelar("cc_m");
  checar("e o botão do app depois é inócuo", (await db.doc("subscriptions/cc_m").get()).get("ativaAte").toMillis() === ate);

  // Arrependimento: estorno do cartão encerra na hora.
  await estornarCartao({ id: "cc_m", status: "refunded" });
  checar("estorno do cartão encerra na hora", (await db.doc("subscriptions/cc_m").get()).get("status") === "canceled");
  checar("pagamento marcado estornado", (await db.doc("payments/mp_cc_m").get()).get("status") === "estornado");
  // Sem token do MP no emulador o cancelamento lá falha: tem que cair na fila.
  checar("cancelamento no MP vai para a fila se falhar", (await db.doc("cancelamentosPendentes/cc_m").get()).exists);
  await sincronizar({ id: "cc_m", status: "authorized", payer_id: 1, next_payment_date: null, external_reference: "cc_m|mensal" });
  checar("'authorized' depois do estorno não reativa", (await db.doc("subscriptions/cc_m").get()).get("status") === "canceled");

  // Estorno de cobrança antiga (sem tipo/preapprovalId) também encerra.
  await cartao("cc_l");
  await db.doc("payments/mp_cc_l").set({ userId: "cc_l", metodo: "cartao", status: "aprovado", valor: 4.9, data: dias(-3) });
  await estornarCartao({ id: "cc_l", status: "charged_back" });
  checar("estorno de cobrança antiga encerra", (await db.doc("subscriptions/cc_l").get()).get("status") === "canceled");

  // Cobrança recusada (past_due): encerra na hora.
  await cartao("cc_b", { status: "past_due" });
  await pagou("cc_b", dias(-5));
  await cancelar("cc_b");
  checar("past_due encerra na hora", (await db.doc("subscriptions/cc_b").get()).get("status") === "canceled");

  // Cancelar duas vezes não estende nada.
  await cartao("cc_c");
  await pagou("cc_c", dias(-15));
  await cancelar("cc_c");
  const ate1 = (await db.doc("subscriptions/cc_c").get()).get("ativaAte").toMillis();
  await cancelar("cc_c");
  checar("segundo cancelamento é inócuo", (await db.doc("subscriptions/cc_c").get()).get("ativaAte").toMillis() === ate1);

  // Corrida: botão e webhook ao mesmo tempo.
  await cartao("cc_r");
  await pagou("cc_r", dias(-3));
  await Promise.all([cancelar("cc_r"), mpCancelou("cc_r")]);
  s = await db.doc("subscriptions/cc_r").get();
  checar("corrida botão × webhook mantém o período", s.get("status") === "active" && vigoraAgora(s));

  await verificarPending();
  await verificarDesistencia();

  console.log(falhas ? `\n${falhas} FALHA(S)\n` : "\nTudo certo.\n");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
