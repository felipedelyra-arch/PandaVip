/**
 * Verificação do Dashboard por agregação (admin/src/lib/useDashboardStats.ts).
 *
 * O risco não é desempenho, é o número mudar. Somar no servidor só vale se der
 * exatamente o mesmo resultado que somar em memória — senão o dono passa a ver
 * um faturamento errado, e errado em silêncio.
 *
 * Este script roda os DOIS caminhos sobre os mesmos dados e compara.
 *
 * Uso: node loadtest/verificar-dashboard.js
 */
const { db, exigirEmulador, cronometrar, ms } = require("./lib");

const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function janelaDeMeses(agora) {
  return Array.from({ length: 6 }, (_, k) => {
    const d = new Date(agora.getFullYear(), agora.getMonth() - (5 - k), 1);
    return {
      inicio: d,
      fim: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999),
      rotulo: meses[d.getMonth()],
    };
  });
}

/** Caminho ANTIGO: baixa tudo e soma em JavaScript. */
async function antigo(agora) {
  let lidos = 0;
  const baixar = async (col) => {
    const s = await db.collection(col).get();
    lidos += s.size;
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  };

  const [users, subs, payments, redemptions] = await Promise.all([
    baixar("users"),
    baixar("subscriptions"),
    baixar("payments"),
    baixar("redemptions"),
  ]);
  await baixar("promotions");
  await baixar("rewards");

  const janela = janelaDeMeses(agora);
  const paraData = (v) => (v && v.toDate ? v.toDate() : v);
  const soma = (inicio, fim) =>
    payments
      .filter((p) => {
        const d = paraData(p.data);
        return p.status === "aprovado" && d && d >= inicio && d <= fim;
      })
      .reduce((a, p) => a + (p.valor || 0), 0);

  return {
    lidos,
    stats: {
      ativos: subs.filter((s) => s.status === "active").length,
      cadastrados: users.filter((u) => u.role !== "admin").length,
      novosMes: users.filter((u) => {
        const d = paraData(u.criadoEm);
        return d && d >= janela[5].inicio;
      }).length,
      cancelados: subs.filter((s) => s.status === "canceled").length,
      resgates: redemptions.length,
      pendentes: redemptions.filter((r) => r.status === "disponivel").length,
      receita: janela.map((j) => soma(j.inicio, j.fim)),
      crescimento: janela.map(
        (j) =>
          users.filter((u) => {
            const d = paraData(u.criadoEm);
            return d && d <= j.fim;
          }).length
      ),
    },
  };
}

/** Caminho NOVO: consultas de agregação, espelhando useDashboardStats.ts. */
async function novo(agora) {
  let consultas = 0;
  const contar = async (q) => {
    consultas++;
    return (await q.count().get()).data().count;
  };
  const somar = async (inicio, fim) => {
    consultas++;
    const snap = await db
      .collection("payments")
      .where("status", "==", "aprovado")
      .where("data", ">=", inicio)
      .where("data", "<=", fim)
      .aggregate({ total: require("./lib").AggregateField.sum("valor") })
      .get();
    return snap.data().total ?? 0;
  };

  const janela = janelaDeMeses(agora);
  const users = db.collection("users");
  const subs = db.collection("subscriptions");
  const resg = db.collection("redemptions");

  const [totalUsuarios, admins, ativos, cancelados, novosMes, resgates, pendentes] =
    await Promise.all([
      contar(users),
      contar(users.where("role", "==", "admin")),
      contar(subs.where("status", "==", "active")),
      contar(subs.where("status", "==", "canceled")),
      contar(users.where("criadoEm", ">=", janela[5].inicio)),
      contar(resg),
      contar(resg.where("status", "==", "disponivel")),
    ]);

  const receita = await Promise.all(janela.map((j) => somar(j.inicio, j.fim)));
  const crescimento = await Promise.all(
    janela.map((j) => contar(users.where("criadoEm", "<=", j.fim)))
  );

  return {
    consultas,
    stats: {
      ativos,
      cadastrados: Math.max(0, totalUsuarios - admins),
      novosMes,
      cancelados,
      resgates,
      pendentes,
      receita,
      crescimento,
    },
  };
}

async function main() {
  exigirEmulador();
  const agora = new Date();
  console.log("\n=== Dashboard: somar em memória x somar no servidor ===\n");

  const [a, tA] = await cronometrar(() => antigo(agora));
  const [n, tN] = await cronometrar(() => novo(agora));

  console.log(`ANTES : ${a.lidos} documentos baixados em ${ms(tA)}`);
  console.log(`DEPOIS: ${n.consultas} consultas de agregação em ${ms(tN)}\n`);

  let iguais = true;
  for (const chave of Object.keys(a.stats)) {
    const x = JSON.stringify(a.stats[chave]);
    const y = JSON.stringify(n.stats[chave]);
    const ok = x === y;
    if (!ok) iguais = false;
    console.log(`  ${ok ? "OK  " : "DIFERE"} ${chave.padEnd(12)} ${x}${ok ? "" : `  !=  ${y}`}`);
  }

  console.log(
    `\ndocumentos lidos: ${a.lidos} -> ~${n.consultas} consultas ` +
      `(agregação cobra 1 leitura a cada 1.000 entradas de índice)`
  );
  console.log(`\n${iguais ? "PASSOU — os números batem" : "FALHOU — número mudou"}`);
  process.exit(iguais ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
