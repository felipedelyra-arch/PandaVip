/**
 * Número do PDV (functions/src/lib/consumo.ts): "143.82" virou 14382 e
 * gravava R$ 14.382,00 no extrato do sócio.
 *
 * Rodar:  cd firebase/functions && npm run build && npm run test:consumo
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { num } = require("../functions/lib/lib/consumo");

test("num aceita os formatos que o PDV manda", () => {
  assert.equal(num("143.82"), 143.82);
  assert.equal(num("143,82"), 143.82);
  assert.equal(num("1.234,56"), 1234.56);
  assert.equal(num(143.82), 143.82);
  assert.equal(num(" 80 "), 80);
});

test("num devolve 0 para lixo", () => {
  for (const lixo of [undefined, null, "abc", "", NaN, Infinity, {}]) assert.equal(num(lixo), 0, String(lixo));
});
