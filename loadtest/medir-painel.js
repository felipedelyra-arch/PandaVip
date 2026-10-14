/**
 * Cenário 3 — abrir cada página do painel do dono.
 *
 * O painel assinava coleções inteiras, sem `limit` e sem `where`
 * (admin/src/lib/useCollection.ts). Cada abertura lia todos os documentos das
 * coleções que a página usava — e `payments` ganha um documento a cada conta
 * fechada no salão, para sempre.
 *
 * Este medidor compara o que cada página custava ANTES com o que custa DEPOIS
 * da Onda 1. É o número que vira conta no fim do mês e o que decide quando o
 * navegador do dono para de aguentar.
 *
 * Uso: node loadtest/medir-painel.js
 */
const { db, exigirEmulador, cronometrar, ms } = require("./lib");

// Preço de leitura do Firestore (USD por documento). Confirmar na tabela
// oficial antes de citar como número fechado.
const USD_POR_LEITURA = 0.06 / 100000;
const USD_BRL = 5.4;

/** Como era: coleções inteiras por página. */
const ANTES = {
  "Dashboard": ["users", "subscriptions", "payments", "redemptions", "promotions", "rewards"],
  "Membros": ["users", "subscriptions", "plans", "payments", "redemptions"],
  "Financeiro": ["payments", "users"],
  "Notificações": ["users", "subscriptions", "notificationLogs"],
  "Premiações": ["rewards", "redemptions"],
  "Configurações": ["users"],
};

/**
 * Como ficou. `agregacao` conta consultas de agregação (cobram 1 leitura a
 * cada 1.000 entradas de índice, não 1 por documento); `docs` conta documentos
 * realmente baixados; `teto` é o limite da consulta quando existe.
 */
const DEPOIS = {
  Dashboard: {
    agregacao: 19,
    colecoes: ["promotions", "rewards"],
  },
  Membros: {
    agregacao: 0,
    // A ficha de um sócio (cobranças e resgates) só carrega quando alguém abre.
    colecoes: ["users", "subscriptions", "plans"],
  },
  Financeiro: {
    agregacao: 0,
    colecoes: [],
    // Período de 30 dias, teto de 1.000, mais um perfil por sócio da página.
    teto: 1000,
  },
  Notificações: {
    agregacao: 3,
    colecoes: [],
    teto: 100,
  },
  Premiações: {
    agregacao: 1,
    colecoes: ["rewards"],
  },
  Configurações: {
    agregacao: 2,
    colecoes: [],
    teto: 50,
  },
};

async function contar(colecao) {
  const snap = await db.collection(colecao).count().get();
  return snap.data().count;
}

async function main() {
  exigirEmulador();
  console.log("\n=== Custo de abrir cada página do painel ===\n");

  const colecoes = new Set([
    ...Object.values(ANTES).flat(),
    ...Object.values(DEPOIS).flatMap((d) => d.colecoes),
  ]);
  const tamanhos = {};
  for (const col of colecoes) tamanhos[col] = await contar(col);

  console.log("Tamanho das coleções no emulador:");
  for (const [c, n] of Object.entries(tamanhos).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(18)} ${n}`);
  }

  console.log("\nLeituras por abertura de página:\n");
  console.log(`  ${"página".padEnd(16)} ${"antes".padStart(9)}  ${"depois".padStart(9)}   fator`);
  console.log(`  ${"-".repeat(16)} ${"-".repeat(9)}  ${"-".repeat(9)}   -----`);

  let totalAntes = 0;
  let totalDepois = 0;

  for (const [pagina, cols] of Object.entries(ANTES)) {
    const antes = cols.reduce((s, c) => s + (tamanhos[c] ?? 0), 0);
    const d = DEPOIS[pagina];
    const docs = d.colecoes.reduce((s, c) => s + (tamanhos[c] ?? 0), 0);
    // Agregação: 1 leitura por consulta enquanto a coleção couber em 1.000
    // entradas de índice — o piso cobrado, e o caso deste clube por bom tempo.
    const depois = docs + d.agregacao + (d.teto ? Math.min(d.teto, tamanhos["payments"] ?? 0) : 0);
    totalAntes += antes;
    totalDepois += depois;
    const fator = depois > 0 ? `${(antes / depois).toFixed(0)}x` : "—";
    console.log(
      `  ${pagina.padEnd(16)} ${String(antes).padStart(9)}  ${String(depois).padStart(9)}   ${fator}`
    );
  }

  console.log(`  ${"-".repeat(16)} ${"-".repeat(9)}  ${"-".repeat(9)}   -----`);
  console.log(
    `  ${"TOTAL".padEnd(16)} ${String(totalAntes).padStart(9)}  ${String(totalDepois).padStart(9)}` +
      `   ${(totalAntes / totalDepois).toFixed(0)}x`
  );

  const mes = (n) => n * 20 * 30 * USD_POR_LEITURA;
  console.log(
    `\nUma volta por todas as páginas, 20x por dia, 30 dias:` +
      `\n  antes : US$ ${mes(totalAntes).toFixed(2)} (~R$ ${(mes(totalAntes) * USD_BRL).toFixed(2)})` +
      `\n  depois: US$ ${mes(totalDepois).toFixed(2)} (~R$ ${(mes(totalDepois) * USD_BRL).toFixed(2)})`
  );

  const [docs, t] = await cronometrar(async () => {
    let n = 0;
    for (const col of ANTES["Dashboard"]) n += (await db.collection(col).get()).size;
    return n;
  });
  console.log(
    `\nReferência: baixar os ${docs} documentos do Dashboard antigo levava ${ms(t)} no emulador.`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
