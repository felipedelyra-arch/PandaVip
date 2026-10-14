/**
 * Teste das Firestore Security Rules contra o emulador.
 *
 * Existe por causa do commit `11df0cd`, que trocou a regra de `users` por uma
 * lista branca de campos e nunca rodou em runtime. Lista branca incompleta não
 * dá erro de deploy: ela quebra em silêncio, na hora do cadastro do cliente.
 *
 * Cada caso positivo aqui copia LITERALMENTE os campos de um ponto de escrita
 * do app. Quando alguém acrescentar um campo numa dessas telas sem pôr na
 * lista, é este arquivo que aponta o dedo.
 *
 * Rodar:  cd firebase && npm test        (com o emulador do Firestore no ar)
 */
const { test, before, after, beforeEach, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
// As bibliotecas moram em functions/node_modules — não há um segundo
// node_modules só para os testes.
const mod = (nome) =>
  require(path.join(__dirname, "..", "functions", "node_modules", nome));

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = mod("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  deleteField,
  serverTimestamp,
  Timestamp,
  setLogLevel,
} = mod("firebase/firestore");

const UID = "socio_teste";
const OUTRO = "outro_socio";
let env;

before(async () => {
  setLogLevel("error"); // sem o ruído de "permission denied" esperado
  env = await initializeTestEnvironment({
    projectId: "pandavip-rules-test",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"),
    },
  });
});

after(async () => {
  if (env) await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Espelho do admin (setAdminRole grava): `isAdmin()` das rules também o lê.
  await semRegras((db) => setDoc(doc(db, "users", "chefe"), { role: "admin" }));
});

/** Cliente do próprio sócio. */
const eu = (email = "felipe@teste.local") => env.authenticatedContext(UID, { email }).firestore();
/** Cliente admin (custom claim role=admin). */
const admin = () => env.authenticatedContext("chefe", {
  role: "admin",
  firebase: { sign_in_second_factor: "totp" },
}).firestore();
/** Cliente deslogado. */
const anonimo = () => env.unauthenticatedContext().firestore();

/** Semeia um doc ignorando as rules (é o que o backend faria). */
async function semRegras(fn) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

// ---------------------------------------------------------------------------
// users — os pontos de escrita reais do app
// ---------------------------------------------------------------------------

describe("users: escritas que o app faz hoje", () => {
  test("signup_screen.dart:116 — cria o perfil no cadastro", async () => {
    await assertSucceeds(
      setDoc(
        doc(eu(), "users", UID),
        {
          nome: "Felipe",
          email: "felipe@teste.local",
          telefone: "14999990000",
          nascimento: Timestamp.fromDate(new Date(1990, 0, 1)),
          criadoEm: serverTimestamp(),
        },
        { merge: true }
      )
    );
  });

  test("termosAceitosEm: serverTimestamp passa, data forjada não (create e update)", async () => {
    await assertSucceeds(
      setDoc(doc(eu(), "users", UID), { termosAceitosEm: serverTimestamp(), termosVersao: "2026-10-06" }, { merge: true })
    );
    await assertSucceeds(
      setDoc(doc(eu(), "users", UID), { termosAceitosEm: serverTimestamp() }, { merge: true })
    );
    await assertFails(
      setDoc(doc(eu(), "users", UID), { termosAceitosEm: Timestamp.fromDate(new Date(2020, 0, 1)) }, { merge: true })
    );
    await semRegras((db) => deleteDoc(doc(db, "users", UID)));
    await assertFails(
      setDoc(doc(eu(), "users", UID), { termosAceitosEm: Timestamp.fromDate(new Date(2020, 0, 1)) })
    );
  });

  test("auth_perfil.dart:27 — garantirPerfil depois do login social", async () => {
    await assertSucceeds(
      setDoc(
        doc(eu("felipe@gmail.com"), "users", UID),
        {
          uid: UID,
          nome: "Felipe do Google",
          email: "felipe@gmail.com",
          fotoUrl: "https://exemplo/foto.jpg",
          criadoEm: serverTimestamp(),
        },
        { merge: true }
      )
    );
  });

  test("completar_perfil_screen.dart:83 — completa o cadastro", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertSucceeds(
      setDoc(
        doc(eu(), "users", UID),
        {
          telefone: "14999990000",
          nascimento: Timestamp.fromDate(new Date(1990, 0, 1)),
        },
        { merge: true }
      )
    );
  });

  test("settings_screen.dart:857 — edita os dados pessoais", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID, nome: "Antigo" }));
    await assertSucceeds(
      updateDoc(doc(eu(), "users", UID), {
        nome: "Felipe Maestrello",
        telefone: "14988887777",
        endereco: "Rua X, 10",
        nascimento: null,
      })
    );
  });

  test("profile_screen.dart:244 — troca a foto de perfil", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertSucceeds(
      updateDoc(doc(eu(), "users", UID), { fotoUrl: "https://exemplo/nova.jpg" })
    );
  });

  test("push_service.dart:51 — salva o token de push", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertSucceeds(
      setDoc(doc(eu(), "users", UID), { fcmToken: "tok_abc" }, { merge: true })
    );
  });

  test("push_service.dart:42 — apaga o token ao desligar avisos", async () => {
    await semRegras((db) =>
      setDoc(doc(db, "users", UID), { uid: UID, fcmToken: "tok_abc" })
    );
    await assertSucceeds(
      setDoc(doc(eu(), "users", UID), { fcmToken: deleteField() }, { merge: true })
    );
  });

  test("escrita parcial NÃO pode apagar campo que só o backend grava", async () => {
    await semRegras((db) =>
      setDoc(doc(db, "users", UID), {
        uid: UID,
        codigoSocio: "A2B3C4",
        gatewayCustomerId: "237611651",
      })
    );
    await assertSucceeds(
      setDoc(doc(eu(), "users", UID), { nome: "Novo nome" }, { merge: true })
    );
    // `withSecurityRulesDisabled` não repassa o retorno do callback — o valor
    // sai por variável.
    let depois;
    await env.withSecurityRulesDisabled(async (ctx) => {
      depois = await getDoc(doc(ctx.firestore(), "users", UID));
    });
    assert.strictEqual(depois.get("codigoSocio"), "A2B3C4");
    assert.strictEqual(depois.get("gatewayCustomerId"), "237611651");
    assert.strictEqual(depois.get("nome"), "Novo nome");
  });
});

// ---------------------------------------------------------------------------
// users — o que a lista branca precisa barrar
// ---------------------------------------------------------------------------

describe("users: escritas que precisam ser barradas", () => {
  test("sócio não pode se promover a admin", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(updateDoc(doc(eu(), "users", UID), { role: "admin" }));
  });

  test("e-mail do perfil só aceita o da conta (nem o de outra pessoa)", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(updateDoc(doc(eu(), "users", UID), { email: "vitima@exemplo.com" }));
    await assertSucceeds(updateDoc(doc(eu(), "users", UID), { email: "Felipe@Teste.local" }));
  });

  test("e-mail antigo já gravado não trava as outras escritas", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID, email: "velho@exemplo.com" }));
    await assertSucceeds(updateDoc(doc(eu(), "users", UID), { telefone: "14999990000" }));
  });

  test("marketingOptIn e analyticsOptIn: só booleano", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertSucceeds(updateDoc(doc(eu(), "users", UID), { marketingOptIn: false, analyticsOptIn: true }));
    await assertFails(updateDoc(doc(eu(), "users", UID), { marketingOptIn: "nao" }));
    await assertFails(updateDoc(doc(eu(), "users", UID), { analyticsOptIn: 1 }));
  });

  test("sócio não pode forjar gatewayCustomerId (cobrança na conta alheia)", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(
      updateDoc(doc(eu(), "users", UID), { gatewayCustomerId: "da_vitima" })
    );
  });

  test("sócio não pode forjar codigoSocio (identidade no PDV)", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(
      updateDoc(doc(eu(), "users", UID), { codigoSocio: "VITIMA" })
    );
  });

  test("sócio não pode inflar o contador de indicações", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(updateDoc(doc(eu(), "users", UID), { indicacoes: 9999 }));
  });

  // --- tipo e tamanho dos campos (bemFormado, em firestore.rules) ---
  //
  // A lista branca sozinha só diz QUAIS campos entram. Estes casos cobrem a
  // outra metade: o que cabe dentro deles. Sem a validação, todos os quatro
  // primeiros PASSAVAM.

  test("nome gigante é barrado (documento inflado de propósito)", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(
      updateDoc(doc(eu(), "users", UID), { nome: "x".repeat(5000) })
    );
  });

  test("nome que não é texto é barrado", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(updateDoc(doc(eu(), "users", UID), { nome: 42 }));
    await assertFails(
      updateDoc(doc(eu(), "users", UID), { nome: { primeiro: "Felipe" } })
    );
  });

  test("nascimento tem que ser data, não texto", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(
      updateDoc(doc(eu(), "users", UID), { nascimento: "01/01/1990" })
    );
  });

  test("idade mínima de 14 anos, só quando a data muda", async () => {
    const anosAtras = (n) => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - n);
      return Timestamp.fromDate(d);
    };
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(updateDoc(doc(eu(), "users", UID), { nascimento: anosAtras(13) }));
    await assertSucceeds(updateDoc(doc(eu(), "users", UID), { nascimento: anosAtras(15) }));
    // Perfil antigo com data abaixo do limite continua salvando o resto.
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID, nascimento: anosAtras(10) }));
    await assertSucceeds(updateDoc(doc(eu(), "users", UID), { nome: "Ana" }));
  });

  test("uid do documento não pode apontar para outro sócio", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(updateDoc(doc(eu(), "users", UID), { uid: OUTRO }));
  });

  test("fotoUrl gigante é barrada", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertFails(
      updateDoc(doc(eu(), "users", UID), {
        fotoUrl: "https://exemplo/" + "a".repeat(4000),
      })
    );
  });

  test("o que o app escreve de verdade continua passando", async () => {
    // Contraprova dos casos acima: tetos folgados não podem ter apertado
    // nenhum cadastro legítimo. Nome longo real, endereço completo e uma URL
    // de foto do Google com query string.
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    await assertSucceeds(
      updateDoc(doc(eu(), "users", UID), {
        nome: "Maria Aparecida da Conceição Albuquerque dos Santos Filho",
        telefone: "+55 (14) 99999-0000",
        endereco: "Rua das Acácias, 1234, apto 91B, Jardim Panorama, Bauru/SP, 17012-345",
        fotoUrl:
          "https://lh3.googleusercontent.com/a/" + "b".repeat(120) + "=s96-c",
      })
    );
  });

  test("endereço de entrega salvo: partes conhecidas passam, campo estranho não", async () => {
    await semRegras((db) => setDoc(doc(db, "users", UID), { uid: UID }));
    const endereco = {
      cep: "00000-000", rua: "Av. Tabajaras", numero: "1443",
      complemento: "", bairro: "Centro", cidade: "Tupã - SP",
    };
    await assertSucceeds(updateDoc(doc(eu(), "users", UID), { enderecoEntrega: endereco }));
    await assertFails(
      updateDoc(doc(eu(), "users", UID), { enderecoEntrega: { ...endereco, isAdmin: true } })
    );
    await assertFails(
      updateDoc(doc(eu(), "users", UID), { enderecoEntrega: { ...endereco, rua: "a".repeat(5000) } })
    );
  });

  test("sócio não lê nem escreve o perfil de outro", async () => {
    await semRegras((db) => setDoc(doc(db, "users", OUTRO), { uid: OUTRO }));
    await assertFails(getDoc(doc(eu(), "users", OUTRO)));
    await assertFails(updateDoc(doc(eu(), "users", OUTRO), { nome: "invadido" }));
  });

  test("admin lê o perfil de qualquer sócio", async () => {
    await semRegras((db) => setDoc(doc(db, "users", OUTRO), { uid: OUTRO }));
    await assertSucceeds(getDoc(doc(admin(), "users", OUTRO)));
  });

  test("admin rebaixado (espelho users/{uid}.role sem 'admin') perde o acesso na hora", async () => {
    await semRegras((db) => setDoc(doc(db, "users", OUTRO), { uid: OUTRO }));
    await semRegras((db) => setDoc(doc(db, "users", "chefe"), { role: null }));
    await assertFails(getDoc(doc(admin(), "users", OUTRO)));
    await semRegras((db) => deleteDoc(doc(db, "users", "chefe")));
    await assertFails(getDoc(doc(admin(), "users", OUTRO)));
  });

  test("admin sem segundo fator no token não lê perfil alheio", async () => {
    await semRegras((db) => setDoc(doc(db, "users", OUTRO), { uid: OUTRO }));
    const semFator = env
      .authenticatedContext("chefe", { role: "admin", firebase: {} })
      .firestore();
    await assertFails(getDoc(doc(semFator, "users", OUTRO)));
  });
});

// ---------------------------------------------------------------------------
// Demais coleções
// ---------------------------------------------------------------------------

describe("outras coleções", () => {
  test("config/app é público — o VersionGate lê antes do login", async () => {
    await semRegras((db) => setDoc(doc(db, "config", "app"), { minBuild: 3 }));
    await assertSucceeds(getDoc(doc(anonimo(), "config", "app")));
    await assertFails(setDoc(doc(anonimo(), "config", "app"), { minBuild: 0 }));
  });

  test("config/restaurante é público — a tela do VersionGate usa o link da loja", async () => {
    await semRegras((db) => setDoc(doc(db, "config", "restaurante"), { telefone: "x" }));
    await assertSucceeds(getDoc(doc(anonimo(), "config", "restaurante")));
  });

  test("o resto de config é fechado: config/starway só o admin lê", async () => {
    await semRegras((db) => setDoc(doc(db, "config", "starway"), { storeId: 1 }));
    await assertFails(getDoc(doc(anonimo(), "config", "starway")));
    await assertFails(getDoc(doc(eu(), "config", "starway")));
    await assertSucceeds(getDoc(doc(admin(), "config", "starway")));
  });

  test("vitrine (plans/promotions/rewards/menu/funcionarios) exige sessão", async () => {
    for (const col of ["plans", "promotions", "rewards", "menu", "funcionarios"]) {
      await semRegras((db) => setDoc(doc(db, col, "x"), { a: 1 }));
      await assertFails(getDoc(doc(anonimo(), col, "x")));
      await assertSucceeds(getDoc(doc(eu(), col, "x")));
      await assertFails(setDoc(doc(eu(), col, "x"), { a: 2 }));
    }
  });

  test("gorjetas: só o dono do resgate usado, para quem atendeu, uma vez", async () => {
    await semRegras(async (db) => {
      await setDoc(doc(db, "redemptions", "r1"), { userId: UID, status: "usado", funcionarioId: "f1" });
      await setDoc(doc(db, "redemptions", "r2"), { userId: UID, status: "disponivel" });
      await setDoc(doc(db, "redemptions", "r3"), { userId: OUTRO, status: "usado", funcionarioId: "f1" });
    });
    const g = (valor, funcionarioId = "f1") => ({ funcionarioId, valor, criadoEm: serverTimestamp() });
    await assertFails(setDoc(doc(eu(), "gorjetas", "r1"), g(10, "f2"))); // outro garçom
    await assertFails(setDoc(doc(eu(), "gorjetas", "r1"), g(5000))); // valor absurdo
    await assertFails(setDoc(doc(eu(), "gorjetas", "r1"), { ...g(10), userId: UID })); // campo extra
    await assertFails(setDoc(doc(eu(), "gorjetas", "r2"), g(10))); // ainda não usado
    await assertFails(setDoc(doc(eu(), "gorjetas", "r3"), g(10))); // resgate de outro
    await assertFails(setDoc(doc(eu(), "gorjetas", "nao-existe"), g(10)));
    // Validado pelo admin sem garçom: não há a quem dar gorjeta.
    await semRegras((db) => setDoc(doc(db, "redemptions", "r5"), { userId: UID, status: "usado" }));
    await assertFails(setDoc(doc(eu(), "gorjetas", "r5"), g(10, null)));
    await assertSucceeds(setDoc(doc(eu(), "gorjetas", "r1"), g(10)));
    await assertFails(setDoc(doc(eu(), "gorjetas", "r1"), g(20))); // uma por resgate
    await assertFails(getDoc(doc(eu(), "gorjetas", "r1")));
    await assertSucceeds(getDoc(doc(admin(), "gorjetas", "r1")));
    // "Outro valor": o cliente digita no banco, o app não sabe quanto.
    await semRegras((db) => setDoc(doc(db, "redemptions", "r4"), { userId: UID, status: "usado", funcionarioId: "f1" }));
    await assertSucceeds(setDoc(doc(eu(), "gorjetas", "r4"), g(null)));
  });

  test("pedidos: vê só os seus, e não escreve nem o próprio", async () => {
    await semRegras(async (db) => {
      await setDoc(doc(db, "pedidos", "ped1"), { userId: UID, total: 89.9, status: "novo" });
      await setDoc(doc(db, "pedidos", "ped2"), { userId: OUTRO, total: 50, status: "novo" });
    });
    await assertSucceeds(getDoc(doc(eu(), "pedidos", "ped1")));
    // Pedido de outro sócio leva nome, telefone e endereço dele dentro.
    await assertFails(getDoc(doc(eu(), "pedidos", "ped2")));
    // O total é dinheiro: quem grava é `criarPedido`, lendo o preço do banco.
    await assertFails(updateDoc(doc(eu(), "pedidos", "ped1"), { total: 0 }));
    await assertFails(setDoc(doc(eu(), "pedidos", "ped3"), { userId: UID, total: 0.01 }));
  });

  test("payments e redemptions: cada um vê só o que é seu", async () => {
    await semRegras(async (db) => {
      await setDoc(doc(db, "payments", "p1"), { userId: UID, valor: 10 });
      await setDoc(doc(db, "payments", "p2"), { userId: OUTRO, valor: 10 });
      await setDoc(doc(db, "redemptions", "r1"), { userId: UID });
      await setDoc(doc(db, "redemptions", "r2"), { userId: OUTRO });
    });
    await assertSucceeds(getDoc(doc(eu(), "payments", "p1")));
    await assertFails(getDoc(doc(eu(), "payments", "p2")));
    await assertSucceeds(getDoc(doc(eu(), "redemptions", "r1")));
    await assertFails(getDoc(doc(eu(), "redemptions", "r2")));
    // Nem o dono escreve: resgate e cobrança só saem de Cloud Function.
    await assertFails(updateDoc(doc(eu(), "redemptions", "r1"), { status: "usado" }));
    await assertFails(updateDoc(doc(eu(), "payments", "p1"), { valor: 0 }));
  });

  test("central de avisos: dono marca como lida e apaga, mas não cria", async () => {
    await semRegras((db) =>
      setDoc(doc(db, "users", UID, "notifications", "n1"), {
        titulo: "Oi",
        lida: false,
      })
    );
    await assertSucceeds(
      updateDoc(doc(eu(), "users", UID, "notifications", "n1"), { lida: true })
    );
    await assertFails(
      setDoc(doc(eu(), "users", UID, "notifications", "n2"), { titulo: "falso" })
    );
    // Marcar como lida não abre o resto do aviso pra edição.
    await assertFails(
      updateDoc(doc(eu(), "users", UID, "notifications", "n1"), { titulo: "trocado" })
    );
    // Apagar só some da caixa do sócio; o histórico do painel é notificationLogs.
    await semRegras((db) =>
      setDoc(doc(db, "users", OUTRO, "notifications", "n9"), { titulo: "Oi", lida: false })
    );
    await assertFails(deleteDoc(doc(eu(), "users", OUTRO, "notifications", "n9")));
    await assertSucceeds(deleteDoc(doc(eu(), "users", UID, "notifications", "n1")));
  });

  test("índices reversos de código são invisíveis ao cliente", async () => {
    await semRegras(async (db) => {
      await setDoc(doc(db, "socioCodes", "A2B3C4"), { uid: UID });
      await setDoc(doc(db, "referralCodes", "XYZ123"), { uid: UID });
    });
    await assertFails(getDoc(doc(eu(), "socioCodes", "A2B3C4")));
    await assertFails(getDoc(doc(admin(), "socioCodes", "A2B3C4")));
    await assertFails(getDoc(doc(eu(), "referralCodes", "XYZ123")));
  });

  test("cupons de um prêmio são invisíveis ao cliente e ao admin", async () => {
    // O estoque virou um documento por unidade (functions/src/lib/cupons.ts).
    // Quem reserva é a Cloud Function; abrir a subcoleção entregaria a lista de
    // quem resgatou o quê, que é dado de outro sócio.
    await semRegras(async (db) => {
      await setDoc(doc(db, "rewards", "rw1"), { titulo: "Rodízio", estoque: 5 });
      await setDoc(doc(db, "rewards", "rw1", "cupons", "c1"), {
        status: "usado",
        userId: OUTRO,
      });
    });
    // O prêmio em si continua legível — é a vitrine.
    await assertSucceeds(getDoc(doc(eu(), "rewards", "rw1")));
    await assertFails(getDoc(doc(eu(), "rewards", "rw1", "cupons", "c1")));
    await assertFails(getDoc(doc(admin(), "rewards", "rw1", "cupons", "c1")));
    await assertFails(
      setDoc(doc(eu(), "rewards", "rw1", "cupons", "c2"), { status: "livre" })
    );
  });

  test("controle de exclusão de conta é fechado até para o próprio uid", async () => {
    await semRegras((db) => setDoc(doc(db, "exclusoes", UID), { uid: UID, etapa: 3 }));
    await assertFails(getDoc(doc(eu(), "exclusoes", UID)));
    await assertFails(getDoc(doc(admin(), "exclusoes", UID)));
    await assertFails(setDoc(doc(eu(), "exclusoes", UID), { etapa: 7 }));
  });

  test("rateLimits é fechado — zerar o próprio contador não pode existir", async () => {
    // O contador que limita chamada por sócio (functions/src/lib/rateLimit.ts).
    // Se o cliente pudesse escrever aqui, apagar o documento seria a primeira
    // coisa que quem está abusando faria, e o limite não limitaria nada. Ler
    // também não: a contagem diz quanto ainda dá pra tentar antes do teto.
    const chave = `${UID}__redeemReward__999`;
    await semRegras((db) => setDoc(doc(db, "rateLimits", chave), { n: 30 }));
    await assertFails(getDoc(doc(eu(), "rateLimits", chave)));
    await assertFails(getDoc(doc(admin(), "rateLimits", chave)));
    await assertFails(setDoc(doc(eu(), "rateLimits", chave), { n: 0 }));
    await assertFails(updateDoc(doc(eu(), "rateLimits", chave), { n: 0 }));
  });

  test("notificationLogs: só admin lê", async () => {
    await semRegras((db) => setDoc(doc(db, "notificationLogs", "l1"), { enviados: 5 }));
    await assertFails(getDoc(doc(eu(), "notificationLogs", "l1")));
    await assertSucceeds(getDoc(doc(admin(), "notificationLogs", "l1")));
  });

  test("coleção desconhecida cai no fallback que nega tudo", async () => {
    await assertFails(setDoc(doc(eu(), "coisa_nova", "x"), { a: 1 }));
    await assertFails(getDoc(doc(admin(), "coisa_nova", "x")));
  });
});
