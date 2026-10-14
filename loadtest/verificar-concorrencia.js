/**
 * Concorrência nos caminhos que NÃO são o resgate.
 *
 * O resgate já tem `verificar-resgate.js` e `medir-resgate.js`. Aqui vão as
 * outras perguntas de "e se duas pessoas fizerem isso ao mesmo tempo":
 *
 *   1. muita gente criando conta no mesmo instante;
 *   2. muita gente usando o MESMO código de indicação (uma pessoa divulga o
 *      código dela e o grupo inteiro se cadastra junto);
 *   3. muita gente editando o próprio perfil ao mesmo tempo;
 *   4. a MESMA pessoa tocando duas vezes no botão de indicação.
 *
 * O que se procura é documento disputado: no Firestore, escrita concorrente só
 * enfileira quando cai na MESMA linha. Escrita em documentos diferentes não
 * disputa nada, por mais gente que seja.
 *
 * Uso: node loadtest/verificar-concorrencia.js [pessoas]
 */
const path = require("path");
const { db, exigirEmulador, cronometrar, percentis, ms } = require("./lib");

const { garantirCodigoSocio } = require(
  path.join(__dirname, "..", "firebase", "functions", "lib", "lib", "codigoSocio")
);

// ⚠️ Importado do código COMPILADO de produção, de propósito.
//
// Estes dois casos já tiveram uma cópia da lógica escrita à mão aqui dentro —
// e a cópia recebeu a correção de corrida que `referral.ts` não tinha. O teste
// passava com a versão certa enquanto o app rodava a errada. Um teste que não
// executa o código que vai pro ar não prova nada.
//
// Requer `npm --prefix firebase/functions run build` antes de rodar.
const { garantirCodigoIndicacao, aplicarIndicacao } = require(
  path.join(__dirname, "..", "firebase", "functions", "lib", "referral")
);
const { reservarAviso } = require(
  path.join(__dirname, "..", "firebase", "functions", "lib", "push")
);

const PESSOAS = Number(process.argv[2] || 100);

let falhas = 0;
function checar(nome, condicao, detalhe = "") {
  const ok = Boolean(condicao);
  if (!ok) falhas++;
  console.log(`  ${ok ? "OK    " : "FALHOU"} ${nome}${detalhe ? `  (${detalhe})` : ""}`);
}

const uid = (i) => `cc${String(i).padStart(6, "0")}`;

/** Roda [fn] para N pessoas ao mesmo tempo e resume o resultado. */
async function simultaneo(n, fn) {
  const latencias = [];
  const erros = {};
  const [, total] = await cronometrar(async () => {
    await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        try {
          const [, t] = await cronometrar(() => fn(i));
          latencias.push(t);
        } catch (e) {
          const chave = (e.message || String(e.code)).slice(0, 45);
          erros[chave] = (erros[chave] ?? 0) + 1;
        }
      })
    );
  });
  return { ok: latencias.length, erros, total, p: percentis(latencias.length ? latencias : [0]) };
}

async function limpar() {
  for (const col of ["users", "socioCodes", "referralCodes"]) {
    const snap = await db.collection(col).get();
    for (let i = 0; i < snap.size; i += 450) {
      const b = db.batch();
      snap.docs.slice(i, i + 450).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
}

async function main() {
  exigirEmulador();
  console.log(`\n=== Concorrência — ${PESSOAS} pessoas ao mesmo tempo ===\n`);
  await limpar();

  // -------------------------------------------------------------------------
  console.log("1. Cadastro: criar perfil e gerar código de carteirinha");
  {
    const r = await simultaneo(PESSOAS, async (i) => {
      const u = uid(i);
      await db.doc(`users/${u}`).set({
        uid: u,
        nome: `Sócio ${i}`,
        email: `s${i}@teste.local`,
        criadoEm: new Date(),
      });
      return garantirCodigoSocio(u);
    });

    checar(`${PESSOAS} cadastros concluídos`, r.ok === PESSOAS, `${r.ok}`);
    if (Object.keys(r.erros).length) console.log(`    erros: ${JSON.stringify(r.erros)}`);

    const perfis = await db.collection("users").select("codigoSocio").get();
    const codigos = perfis.docs.map((d) => d.get("codigoSocio")).filter(Boolean);
    checar("todo mundo saiu com código", codigos.length === PESSOAS, `${codigos.length}`);
    checar(
      "nenhum código repetido",
      new Set(codigos).size === codigos.length,
      `${new Set(codigos).size} únicos de ${codigos.length}`
    );
    console.log(
      `    tempo ${ms(r.total)} | p50 ${ms(r.p.p50)} | p95 ${ms(r.p.p95)} | máx ${ms(r.p.max)}`
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n2. Editar o próprio perfil, todo mundo junto");
  {
    const r = await simultaneo(PESSOAS, (i) =>
      db.doc(`users/${uid(i)}`).set(
        { telefone: "14999990000", endereco: `Rua ${i}` },
        { merge: true }
      )
    );
    checar(`${PESSOAS} edições sem erro`, r.ok === PESSOAS, `${r.ok}`);
    console.log(`    tempo ${ms(r.total)} | p95 ${ms(r.p.p95)}`);
    console.log("    (documentos diferentes: não há disputa, e não deveria haver mesmo)");
  }

  // -------------------------------------------------------------------------
  console.log("\n3. TODO MUNDO usando o MESMO código de indicação");
  console.log("   (uma pessoa divulga o código dela e o grupo se cadastra junto —");
  console.log("    aqui o contador do indicador é UM documento só, disputado por todos)");
  {
    const padrinho = "cc_padrinho";
    await db.doc(`users/${padrinho}`).set({ uid: padrinho, indicacoes: 0 });
    await db.doc("referralCodes/CONVITE").set({ uid: padrinho });

    const r = await simultaneo(PESSOAS, async (i) => {
      const res = await aplicarIndicacao(uid(i), "CONVITE");
      if (res.estado !== "aplicou") throw new Error(res.estado);
    });

    checar(`${PESSOAS} indicações aceitas`, r.ok === PESSOAS, `${r.ok}`);
    if (Object.keys(r.erros).length) console.log(`    erros: ${JSON.stringify(r.erros)}`);

    const contador = (await db.doc(`users/${padrinho}`).get()).get("indicacoes");
    checar(
      "contador do indicador bate exatamente",
      contador === PESSOAS,
      `contou ${contador}, esperado ${PESSOAS}`
    );
    console.log(`    tempo ${ms(r.total)} | p50 ${ms(r.p.p50)} | p95 ${ms(r.p.p95)}`);
  }

  // -------------------------------------------------------------------------
  console.log("\n4. A MESMA pessoa gerando código de indicação em toque duplo");
  {
    const u = uid(0);
    const [a, b, c] = await Promise.all([
      garantirCodigoIndicacao(u),
      garantirCodigoIndicacao(u),
      garantirCodigoIndicacao(u),
    ]);
    checar("os três toques devolvem o mesmo código", a === b && b === c, `${a}/${b}/${c}`);

    const gravado = (await db.doc(`users/${u}`).get()).get("codigoIndicacao");
    checar("o código gravado é esse mesmo", gravado === a, `${gravado}`);

    // Código órfão: `referralCodes` só pode ter UM documento apontando pra
    // este uid. Sobrando outro, a exclusão de conta (account.ts, etapa
    // ÍNDICES) apaga só o que está no perfil, e o que sobra segue resolvendo
    // pra um sócio que já apagou os dados — inclusive pro PDV do salão.
    const indices = await db.collection("referralCodes").where("uid", "==", u).get();
    checar(
      "nenhum código de indicação órfão",
      indices.size === 1,
      `${indices.size} documento(s) apontando pro mesmo sócio`
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n5. A MESMA pessoa aplicando o MESMO código em toque duplo");
  console.log("   (é o que a fila de pendências do app faz quando a rede volta:");
  console.log("    ela reenvia a chamada, e o padrinho não pode ganhar duas)");
  {
    const padrinho = "cc_padrinho2";
    const afilhado = "cc_afilhado";
    await db.doc(`users/${padrinho}`).set({ uid: padrinho, indicacoes: 0 });
    await db.doc(`users/${afilhado}`).set({ uid: afilhado });
    await db.doc("referralCodes/CONVITE2").set({ uid: padrinho });

    const rs = await Promise.all([
      aplicarIndicacao(afilhado, "CONVITE2"),
      aplicarIndicacao(afilhado, "CONVITE2"),
      aplicarIndicacao(afilhado, "CONVITE2"),
    ]);
    const estados = rs.map((r) => r.estado);

    checar(
      "os três toques dão certo (nenhum vira erro na tela)",
      estados.every((e) => e === "aplicou" || e === "repetido"),
      estados.join(", ")
    );
    checar(
      "só UM deles aplicou de verdade",
      estados.filter((e) => e === "aplicou").length === 1,
      estados.join(", ")
    );

    const contador = (await db.doc(`users/${padrinho}`).get()).get("indicacoes");
    checar("o padrinho ganhou exatamente 1", contador === 1, `contou ${contador}`);

    // E reenviar depois, com a marca já gravada, continua sendo sucesso — não
    // `already-exists`, que a fila trataria como falha permanente e jogaria na
    // caixa de "não enviados" do sócio.
    const depois = await aplicarIndicacao(afilhado, "CONVITE2");
    checar("reenvio posterior devolve 'repetido'", depois.estado === "repetido", depois.estado);

    // Código diferente continua sendo recusado: um por conta.
    await db.doc("referralCodes/OUTRO").set({ uid: padrinho });
    const outro = await aplicarIndicacao(afilhado, "OUTRO");
    checar(
      "código diferente continua recusado",
      outro.estado === "ja_usou_outro",
      outro.estado
    );

    await db.doc(`users/${padrinho}`).delete();
    await db.doc(`users/${afilhado}`).delete();
  }

  // -------------------------------------------------------------------------
  console.log("\n6. O MESMO aviso entregue várias vezes pelo gatilho");
  console.log("   (gatilho gen2 é entrega ao menos uma vez: sem reserva, o push");
  console.log("    do rodízio grátis saía repetido pra base inteira)");
  {
    const ref = db.doc("promotions/promo_teste");
    await ref.set({ titulo: "Rodízio grátis", ativa: true });

    // Seis entregas ao mesmo tempo, que é o pior caso: todas leem antes de
    // qualquer uma gravar.
    const reservas = await Promise.all(
      Array.from({ length: 6 }, () => reservarAviso(ref))
    );
    checar(
      "só UMA entrega ganha o direito de avisar",
      reservas.filter(Boolean).length === 1,
      `${reservas.filter(Boolean).length} de 6`
    );

    // E a entrega que chega depois, com a marca já gravada, também não avisa.
    const atrasada = await reservarAviso(ref);
    checar("entrega atrasada não avisa de novo", atrasada === false);

    // Documento apagado no meio não pode virar aviso fantasma.
    await ref.delete();
    checar("promoção apagada não reserva", (await reservarAviso(ref)) === false);
  }

  await limpar();
  console.log(`\n${falhas === 0 ? "PASSOU — todos os casos" : `FALHOU em ${falhas} caso(s)`}`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
