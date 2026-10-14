/**
 * Soma e validação do pedido (functions/src/pedidos.ts).
 *
 * É o caminho que decide quanto o sócio paga. Preço aceito do cliente, item
 * fora do cardápio ou total errado aqui viram prejuízo direto do restaurante.
 *
 * Rodar:  cd firebase/functions && npm run build && npm run test:pedidos
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { montarPedido, textoAvisoStatus } = require("../functions/lib/pedidos");

const cardapio = new Map([
  ["rodizio", { nome: "Rodízio", preco: 89.9, disponivel: true }],
  ["refri", { nome: "Refrigerante", preco: 8.5, disponivel: true }],
  ["peixe", { nome: "Peixe do dia", preco: 60, disponivel: false }],
  ["sumiu", null],
]);

const base = {
  pedidoId: "pedido-de-teste-1",
  tipo: "entrega",
  endereco: "Rua das Flores, 123 - Centro",
  pagamento: "dinheiro",
};

const monta = (extra) => montarPedido({ ...base, ...extra }, cardapio);

test("soma o total com o preço do servidor, não com o que o app mandou", () => {
  const p = monta({ itens: [{ id: "rodizio", qtd: 2, preco: 0.01 }, { id: "refri", qtd: 1 }] });
  assert.equal(p.total, 188.3); // 89,90 x 2 + 8,50
  assert.equal(p.itens.find((i) => i.itemId === "rodizio").preco, 89.9);
});

test("id repetido vira uma linha só na comanda", () => {
  const p = monta({ itens: [{ id: "refri", qtd: 1 }, { id: "refri", qtd: 2 }] });
  assert.equal(p.itens.length, 1);
  assert.equal(p.itens[0].qtd, 3);
  assert.equal(p.total, 25.5);
});

test("recusa item que acabou ou saiu do cardápio", () => {
  assert.throws(() => monta({ itens: [{ id: "peixe", qtd: 1 }] }), /acabou por hoje/);
  assert.throws(() => monta({ itens: [{ id: "sumiu", qtd: 1 }] }), /não está mais no cardápio/);
});

test("recusa quantidade que não é gente pedindo comida", () => {
  for (const qtd of [0, -1, 2.5, 999, null, undefined, "muitos"]) {
    assert.throws(() => monta({ itens: [{ id: "refri", qtd }] }), /Item inválido/);
  }
  // Número em texto passa de propósito: "3" é três. O que se barra é o que
  // não é quantidade de comida, não o JSON frouxo de um cliente antigo.
  assert.equal(monta({ itens: [{ id: "refri", qtd: "3" }] }).itens[0].qtd, 3);
});

test("código do prato vai pro item; código inválido vira null", () => {
  const c = new Map([
    ["a", { nome: "Temaki", preco: 20, disponivel: true, codigo: 24 }],
    ["b", { nome: "Suco", preco: 8, disponivel: true, codigo: "abc" }],
  ]);
  const p = montarPedido({ ...base, itens: [{ id: "a", qtd: 1 }, { id: "b", qtd: 1 }] }, c);
  assert.deepEqual(p.itens.map((i) => i.codigo), [24, null]);
});

test("entrega exige endereço; retirada exige loja e não pede endereço", () => {
  const itens = [{ id: "refri", qtd: 1 }];
  assert.throws(() => monta({ itens, endereco: "" }), /Endereço/);
  const r = monta({ itens, tipo: "retirada", endereco: "", loja: "amigao" });
  assert.equal(r.endereco, "");
  assert.equal(r.loja, "amigao");
  assert.throws(() => monta({ itens, tipo: "retirada", endereco: "" }), /loja/);
  assert.throws(() => monta({ itens, tipo: "retirada", loja: "toString" }), /loja/);
  assert.equal(monta({ itens, loja: "amigao" }).loja, "");
});

test("troco precisa cobrir a conta, e some fora do dinheiro", () => {
  const itens = [{ id: "rodizio", qtd: 1 }]; // 89,90
  assert.throws(() => monta({ itens, troco: 50 }), /troco precisa cobrir/);
  assert.equal(monta({ itens, troco: 100 }).troco, 100);
  assert.equal(monta({ itens, pagamento: "cartao_entrega", troco: 100 }).troco, 0);
  // Vindo direto da API, sem passar pelo app.
  for (const troco of [NaN, Infinity, -10, 999999, "abc"]) {
    assert.throws(() => monta({ itens, troco }), /troco inválido/);
  }
  assert.throws(() => monta({ itens, endereco: 12345678901 }), /Endereço de entrega obrigatório/);
  assert.equal(monta({ itens, observacao: { x: 1 } }).observacao, "");
});

test("recusa pedido vazio, pedidoId torto e forma de pagamento inventada", () => {
  assert.throws(() => monta({ itens: [] }), /sem itens/);
  assert.throws(() => monta({ itens: [{ id: "refri", qtd: 1 }], pedidoId: "curto" }), /pedidoId/);
  assert.throws(
    () => monta({ itens: [{ id: "refri", qtd: 1 }], pagamento: "fiado" }),
    /pagamento inválida/
  );
});

test("aviso de status fala a língua de entrega ou retirada, e não toca no pedido novo", () => {
  assert.equal(textoAvisoStatus("novo", "entrega"), null);
  assert.match(textoAvisoStatus("saiu", "entrega").titulo, /entrega/);
  assert.match(textoAvisoStatus("saiu", "retirada").titulo, /retirar/);
  assert.ok(textoAvisoStatus("cancelado", "entrega"));
});

// ---- Promoção com desconto ------------------------------------------------
const AGORA = Date.UTC(2026, 9, 7, 20);
const HORA = 3600e3;
const promos = new Map([
  ["yaki20", { itemId: "rodizio", descontoPct: 20, ativa: true }],
  ["clube10", { itemId: "refri", descontoPct: 10, ativa: true, apenasAssinantes: true }],
  ["off", { itemId: "rodizio", descontoPct: 20, ativa: false }],
  ["velha", { itemId: "rodizio", descontoPct: 20, ativa: true, validadeFim: new Date(AGORA - HORA) }],
  ["futura", { itemId: "rodizio", descontoPct: 20, ativa: true, validadeInicio: new Date(AGORA + HORA) }],
  ["louca", { itemId: "rodizio", descontoPct: 100, ativa: true }],
  ["semprato", { descontoPct: 20, ativa: true }],
  ["sumiu", null],
]);
const comPromo = (itens, socio = false) =>
  montarPedido({ ...base, itens }, cardapio, 0, promos, { agora: AGORA, socio });

test("promoção vigente desconta o prato no servidor e guarda o preço cheio", () => {
  const p = comPromo([{ id: "rodizio", qtd: 2, promoId: "yaki20", preco: 0.01 }]);
  const linha = p.itens[0];
  assert.equal(linha.preco, 71.92); // 89,90 - 20%
  assert.equal(linha.precoOriginal, 89.9);
  assert.equal(linha.promoId, "yaki20");
  assert.equal(linha.descontoPct, 20);
  assert.equal(p.total, 143.84);
});

test("sem promoção o item fica igual e não ganha campos de desconto", () => {
  const linha = comPromo([{ id: "refri", qtd: 1 }]).itens[0];
  assert.equal(linha.preco, 8.5);
  assert.equal(linha.promoId, undefined);
});

test("recusa promoção desligada, fora do prazo, inexistente ou de outro prato", () => {
  for (const promoId of ["off", "velha", "futura", "sumiu", "naoexiste"]) {
    assert.throws(
      () => comPromo([{ id: "rodizio", qtd: 1, promoId }]),
      /promoção não está mais valendo/,
      promoId
    );
  }
  // yaki20 é do rodízio: não serve pra baratear o refrigerante.
  assert.throws(() => comPromo([{ id: "refri", qtd: 1, promoId: "yaki20" }]), /não vale para/);
  assert.throws(() => comPromo([{ id: "rodizio", qtd: 1, promoId: "semprato" }]), /não vale para/);
});

test("desconto fora de 1..90% é recusado mesmo vindo do banco", () => {
  assert.throws(() => comPromo([{ id: "rodizio", qtd: 1, promoId: "louca" }]), /promoção não está mais valendo/);
});

test("promoção só de sócios exige sócio", () => {
  assert.throws(() => comPromo([{ id: "refri", qtd: 1, promoId: "clube10" }]), /exclusiva para sócios/);
  assert.equal(comPromo([{ id: "refri", qtd: 1, promoId: "clube10" }], true).itens[0].preco, 7.65);
});

test("promoId que não é id vira pedido inválido", () => {
  assert.throws(() => comPromo([{ id: "rodizio", qtd: 1, promoId: "../x" }]), /Item inválido/);
});

test("taxa de entrega entra no total só na entrega, e o troco tem que cobrir ela", () => {
  const itens = [{ id: "refri", qtd: 1 }]; // 8,50
  const comTaxa = (extra) => montarPedido({ ...base, itens, ...extra }, cardapio, 5);
  assert.equal(comTaxa({}).taxaEntrega, 5);
  assert.equal(comTaxa({}).subtotal, 8.5);
  assert.equal(comTaxa({}).total, 13.5);
  assert.equal(comTaxa({ tipo: "retirada", loja: "amigao", endereco: "" }).taxaEntrega, 0);
  assert.throws(() => comTaxa({ troco: 10 }), /troco precisa cobrir/);
});

test("id de item com barra ou fora do padrão é recusado antes de virar caminho", () => {
  for (const id of ["a/b", "a/b/c", "x y", ""]) {
    assert.throws(() => monta({ itens: [{ id, qtd: 1 }] }), /Item inválido/, id);
  }
});
