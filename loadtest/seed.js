/**
 * Popula o emulador com N sócios, assinaturas e histórico de contas.
 *
 * Uso: node loadtest/seed.js 5000
 *
 * As proporções imitam o Tio Panda: metade dos cadastrados vira assinante, e
 * cada assinante fecha algumas contas de salão por mês.
 */
const { db, exigirEmulador, cronometrar, ms } = require("./lib");

const N = Number(process.argv[2] || 1000);
const CONTAS_POR_SOCIO = Number(process.argv[3] || 4);

async function gravarEmLotes(docs) {
  let escritos = 0;
  for (let i = 0; i < docs.length; i += 450) {
    const lote = db.batch();
    for (const { ref, data } of docs.slice(i, i + 450)) lote.set(ref, data);
    await lote.commit();
    escritos += Math.min(450, docs.length - i);
  }
  return escritos;
}

async function main() {
  exigirEmulador();
  console.log(`Semeando ${N} usuários (${CONTAS_POR_SOCIO} contas por assinante)...`);

  const [, tUsers] = await cronometrar(async () => {
    const docs = [];
    for (let i = 0; i < N; i++) {
      const uid = `u${String(i).padStart(7, "0")}`;
      docs.push({
        ref: db.doc(`users/${uid}`),
        data: {
          uid,
          nome: `Sócio ${i}`,
          email: `socio${i}@teste.local`,
          telefone: "14999990000",
          // Token fictício: o medidor de push não chama o FCM, só conta alvos.
          fcmToken: i % 10 === 0 ? null : `tok_${uid}`,
          codigoSocio: `S${String(i).padStart(5, "0")}`,
          criadoEm: new Date(),
        },
      });
    }
    return gravarEmLotes(docs);
  });
  console.log(`  users: ${N} em ${ms(tUsers)}`);

  const assinantes = Math.floor(N / 2);
  const [, tSubs] = await cronometrar(async () => {
    const docs = [];
    for (let i = 0; i < assinantes; i++) {
      const uid = `u${String(i).padStart(7, "0")}`;
      docs.push({
        ref: db.doc(`subscriptions/sub_${uid}`),
        data: { userId: uid, planId: "plano_unico", status: "active" },
      });
    }
    return gravarEmLotes(docs);
  });
  console.log(`  subscriptions: ${assinantes} em ${ms(tSubs)}`);

  const contas = assinantes * CONTAS_POR_SOCIO;
  const [, tPay] = await cronometrar(async () => {
    const docs = [];
    for (let i = 0; i < assinantes; i++) {
      const uid = `u${String(i).padStart(7, "0")}`;
      for (let c = 0; c < CONTAS_POR_SOCIO; c++) {
        docs.push({
          ref: db.doc(`payments/pdv_${uid}_${c}`),
          data: {
            userId: uid,
            valor: 87.5,
            metodo: "cartao",
            status: "aprovado",
            tipo: "consumo",
            descontoClube: 8.75,
            origem: "pdv",
            data: new Date(Date.now() - c * 86400000),
          },
        });
      }
    }
    return gravarEmLotes(docs);
  });
  console.log(`  payments: ${contas} em ${ms(tPay)}`);

  await db.doc("plans/plano_unico").set({
    nome: "Clube Tio Panda",
    preco: 4.9,
    descontoPercentual: 10,
  });

  console.log(
    `\nPronto. Total ${N + assinantes + contas} documentos ` +
      `(${N} users + ${assinantes} subs + ${contas} payments).`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
