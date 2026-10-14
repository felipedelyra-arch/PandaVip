/**
 * Horário de funcionamento (functions/src/lib/expediente.ts).
 *
 * O que esta suíte protege: pedido de madrugada. O app esconde o botão, mas
 * quem decide é o servidor — e a conta do fuso (function em UTC, restaurante
 * em Tupã) é fácil de errar sem um teste olhando.
 *
 * Rodar:  cd firebase/functions && npm run build && npm run test:expediente
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { abertoAgora, janela, agoraLocal } = require("../functions/lib/lib/expediente");

// Sábado 20/09/2026, 21h em Tupã = 00h de domingo em UTC. É o caso que o
// `getDay()` cru erra: em UTC já é domingo.
const sabado21h = new Date("2026-09-20T00:00:00Z");
const semana = {
  dom: "18:00-23:00",
  seg: "",
  ter: "18:00-23:30",
  qua: "18:00-23:30",
  qui: "18:00-23:30",
  sex: "18:00-01:00",
  sab: "18:00-01:00",
};

test("janela entende o formato e recusa o resto", () => {
  assert.deepEqual(janela("18:00-23:30"), [1080, 1410]);
  assert.equal(janela("18:00"), null);
  assert.equal(janela("25:00-26:00"), null);
  assert.equal(janela(""), null);
  assert.equal(janela(undefined), null);
});

test("o dia da semana é o de Tupã, não o de UTC", () => {
  assert.deepEqual(agoraLocal(sabado21h), { dia: 6, minuto: 21 * 60 });
});

test("aberto dentro da janela do dia, fechado fora", () => {
  assert.equal(abertoAgora({ horarios: semana }, sabado21h), true);
  // Sábado 16h em Tupã (19h UTC), antes de abrir.
  assert.equal(abertoAgora({ horarios: semana }, new Date("2026-09-19T19:00:00Z")), false);
  // Segunda 20h em Tupã: dia sem horário = fechado.
  assert.equal(abertoAgora({ horarios: semana }, new Date("2026-09-21T23:00:00Z")), false);
});

test("janela que atravessa a meia-noite segura a madrugada", () => {
  // Domingo 00:30 em Tupã: quem está aberto é o sábado 18:00-01:00.
  assert.equal(abertoAgora({ horarios: semana }, new Date("2026-09-20T03:30:00Z")), true);
  // Domingo 01:30 em Tupã: a janela do sábado já fechou.
  assert.equal(abertoAgora({ horarios: semana }, new Date("2026-09-20T04:30:00Z")), false);
});

test("pausar corta na hora, e doc em branco não fecha o restaurante", () => {
  assert.equal(abertoAgora({ horarios: semana, pedidosPausados: true }, sabado21h), false);
  assert.equal(abertoAgora({}, sabado21h), true);
  assert.equal(abertoAgora(undefined, sabado21h), true);
  assert.equal(abertoAgora({ horarios: { seg: "", ter: "" } }, sabado21h), true);
});
