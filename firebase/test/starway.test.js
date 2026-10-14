/**
 * Contrato com a Starway (functions/src/webhooks/starway.ts).
 *
 * É JSON que sai da nossa casa pra outra empresa: errar centavo, data ou
 * `productId` aqui vira pedido errado na cozinha deles. O exemplo de venda que
 * o Lucas mandou é a referência — dinheiro em centavos inteiros, data
 * "DD/MM/YYYY", hora "HH:mm".
 *
 * Rodar:  cd firebase/functions && npm run build && npm run test:starway
 */
const { test } = require("node:test");
const assert = require("node:assert");
const {
  pedidoParaStarway,
  centavos,
  dataHoraLocal,
} = require("../functions/lib/webhooks/starway");

// 22/09/2026 19:45 em Tupã (22:45 UTC).
const criadoEm = { toDate: () => new Date("2026-09-22T22:45:00Z") };

const pedido = {
  nome: "Maria",
  telefone: "14998010001",
  itens: [
    { itemId: "temaki", codigo: 24, nome: "Temaki", preco: 14, qtd: 2, subtotal: 28, obs: "sem cebola" },
    { itemId: "refri", codigo: null, nome: "Refrigerante", preco: 8.5, qtd: 1, subtotal: 8.5, obs: "" },
  ],
  subtotal: 36.5,
  taxaEntrega: 5,
  total: 41.5,
  tipo: "entrega",
  loja: "",
  endereco: "Rua das Flores, 123 - Centro, Tupã",
  enderecoPartes: { rua: "Rua das Flores", numero: "123", bairro: "Centro", complemento: "Fundos" },
  pagamento: "dinheiro",
  troco: 50,
  observacao: "campainha quebrada",
  codigoEntrega: "4821",
  criadoEm,
};

test("dinheiro vai em centavos inteiros, nunca em reais", () => {
  assert.equal(centavos(14), 1400);
  assert.equal(centavos(8.5), 850);
  assert.equal(centavos(0.07), 7); // sem sobra de ponto flutuante
  assert.equal(centavos(undefined), 0);

  const j = pedidoParaStarway("abc123456", pedido);
  assert.equal(j.items[0].unitPrice, 1400);
  assert.equal(j.items[0].value, 2800);
  assert.equal(j.sum, 3650);
  assert.equal(j.value, 4150);
  assert.equal(j.taxes, 500);
  assert.equal(j.changeFor, 5000);
});

test("data e hora saem no fuso de Tupã, no formato deles", () => {
  assert.deepEqual(dataHoraLocal(new Date("2026-09-22T22:45:00Z")), {
    date: "22/09/2026",
    time: "19:45",
  });
  // Meia-noite e meia de Tupã ainda é dia 22 lá, dia 23 em UTC.
  assert.deepEqual(dataHoraLocal(new Date("2026-09-23T03:30:00Z")), {
    date: "23/09/2026",
    time: "00:30",
  });
});

test("o item leva o código do painel como productId, e 0 quando falta", () => {
  const j = pedidoParaStarway("abc123456", pedido);
  assert.equal(j.items[0].productId, 24);
  assert.equal(j.items[1].productId, 0);
  assert.equal(j.items[0].amount, 2);
  assert.equal(j.items[0].notes, "sem cebola");
});

test("endereço vai partido, e o nosso id vai no orderReference", () => {
  const j = pedidoParaStarway("pedido-abc123456", pedido);
  assert.equal(j.streetName, "Rua das Flores");
  assert.equal(j.streetNumber, "123");
  assert.equal(j.neighborhoodName, "Centro");
  assert.equal(j.delivery, true);
  assert.equal(j.orderReference, "pedido-abc123456");
  assert.equal(j.orderShortReference, "23456");
  assert.equal(j.paymentMethod, "Dinheiro");
  assert.equal(j.deliveryCode, "4821");
});

test("retirada não é entrega, e a loja escolhe o storeId", () => {
  const retirada = { ...pedido, tipo: "retirada", loja: "amigao", endereco: "", enderecoPartes: null };
  const j = pedidoParaStarway("abc123456", retirada, {
    storeId: 1199,
    storeIdPorLoja: { tabajaras: 1199, amigao: 1200 },
  });
  assert.equal(j.delivery, false);
  assert.equal(j.storeId, 1200);
  assert.equal(j.streetName, "");
  // Sem configuração, vale o storeId do exemplo que eles mandaram.
  assert.equal(pedidoParaStarway("abc123456", retirada).storeId, 1199);
});
