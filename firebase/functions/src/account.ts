import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { FieldValue, type Query } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db, auth, storage } from "./lib/admin";
import { gateway } from "./lib/gateway";
import { requireAuth, requireAdmin, idValido } from "./lib/guards";
import { consumir } from "./lib/rateLimit";
import { MP_ACCESS_TOKEN } from "./lib/segredos";

/**
 * Exclusão de conta (LGPD + exigência das lojas).
 *
 * São oito etapas que mexem em quatro sistemas diferentes — gateway de
 * pagamento, Firestore, Storage e Auth — e não existe transação que as cubra.
 * Antes elas rodavam em sequência, sem marcar progresso: queda de rede, timeout
 * ou erro do gateway no meio deixava a conta **meio apagada**, sem nada que
 * retomasse. Assinatura cancelada e perfil ainda de pé, ou perfil apagado e
 * login ainda funcionando.
 *
 * Agora cada etapa concluída é gravada em `exclusoes/{uid}`. Chamar de novo
 * continua de onde parou, e [finalizarExclusoes] varre uma vez por dia o que
 * ficou pelo caminho — inclusive o caso em que a última etapa falha e o sócio
 * não tem mais como pedir de novo, porque a conta de login já não existe.
 */

/** Ordem das etapas. O número gravado é a última CONCLUÍDA. */
const ETAPAS = {
  GATEWAY: 1,
  ASSINATURAS: 2,
  RESGATES: 3,
  INDICES: 4,
  PERFIL: 5,
  ARQUIVOS: 6,
  LOGIN: 7,
  // Depois do login de propósito: não renumera as etapas já gravadas em
  // `exclusoes/{uid}` e, para exclusões antigas (etapa 7), a varredura diária
  // anonimiza os pedidos sozinha. O uid segue conhecido pelo próprio doc de
  // controle, e isto roda no servidor, então o token morto do cliente não atrapalha.
  PEDIDOS: 8,
  // Depois de PEDIDOS pelo mesmo motivo: exclusões já concluídas (etapa 8)
  // voltam na varredura diária e ganham esta limpeza.
  PAGAMENTOS: 9,
} as const;

const FINAL = ETAPAS.PAGAMENTOS;

/** Apaga tudo que casa com a consulta, em voltas de 450. */
async function apagarEmLote(query: Query) {
  for (;;) {
    const snap = await query.limit(450).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 450) return;
  }
}

/** Atualiza tudo que casa com a consulta, em voltas de 450. A própria mudança tira o doc da consulta. */
async function desvincular(query: Query, campos: Record<string, unknown>) {
  for (;;) {
    const snap = await query.limit(450).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, campos));
    await batch.commit();
    if (snap.size < 450) return;
  }
}

/**
 * Tira os dados pessoais dos pedidos de [uid], mantendo itens, valores, datas e
 * status (registro fiscal). Pagina por id para não repetir o que já foi limpo.
 */
async function anonimizarPedidos(uid: string) {
  let ultimo: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db.collection("pedidos").where("userId", "==", uid).orderBy("__name__").limit(450);
    if (ultimo) q = q.startAfter(ultimo);
    const snap = await q.get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => {
      const itens = (d.get("itens") as Record<string, unknown>[] | undefined) ?? [];
      // Pedido que a Starway ainda não levou: não há mais para quem entregar.
      const cancelar = d.get("status") === "novo" && !d.get("exportadoEm");
      batch.update(d.ref, {
        ...(cancelar
          ? {
              status: "cancelado",
              statusEm: FieldValue.serverTimestamp(),
              statusPor: "exclusao",
            }
          : {}),
        nome: "",
        telefone: "",
        endereco: "",
        enderecoPartes: null,
        observacao: "",
        itens: itens.map((i) => ({ ...i, obs: "" })),
        anonimizadoEm: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    if (snap.size < 450) return;
    ultimo = snap.docs[snap.docs.length - 1];
  }
}

/**
 * Pagamentos de consumo no salão do [uid]: tira mesa, atendente e itens (dado
 * do que a pessoa comeu e onde), mantendo valor, data e método — o que o
 * financeiro e o fisco precisam. Não há `userId` a remover: o vínculo é o
 * registro de pagamento que a Política declara guardar.
 */
async function limparConsumo(uid: string) {
  const vazio = { mesa: FieldValue.delete(), atendente: FieldValue.delete(), itens: FieldValue.delete() };
  let ultimo: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db
      .collection("payments")
      .where("userId", "==", uid)
      .where("tipo", "==", "consumo")
      .orderBy("__name__")
      .limit(450);
    if (ultimo) q = q.startAfter(ultimo);
    const snap = await q.get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, vazio));
    await batch.commit();
    if (snap.size < 450) return;
    ultimo = snap.docs[snap.docs.length - 1];
  }
}

/**
 * Executa as etapas que faltam para [uid], a partir da última concluída.
 *
 * Cada etapa é idempotente por si: apagar o que já não existe não é erro. A
 * marcação evita repetir trabalho, não evita repetição danosa.
 *
 * Exportada para `loadtest/verificar-exclusao.js` poder exercitá-la contra os
 * emuladores sem passar pela camada de autenticação.
 */
export async function executarExclusao(uid: string): Promise<number> {
  const controle = db.doc(`exclusoes/${uid}`);
  const atual = (await controle.get()).get("etapa") as number | undefined;
  let feito = atual ?? 0;

  const concluir = async (etapa: number) => {
    feito = etapa;
    await controle.set(
      { uid, etapa, atualizadoEm: FieldValue.serverTimestamp() },
      { merge: true }
    );
  };

  // O perfil precisa ser lido ANTES de ser apagado: é dele que saem os códigos
  // dos índices reversos.
  const perfil = await db.doc(`users/${uid}`).get();

  if (feito < ETAPAS.GATEWAY) {
    const subs = await db.collection("subscriptions").where("userId", "==", uid).get();
    for (const s of subs.docs) {
      const gatewaySubId = s.get("gatewaySubscriptionId") as string | undefined;
      if (!gatewaySubId) continue;
      try {
        await gateway().cancelarAssinatura(gatewaySubId);
      } catch (err) {
        // Não barra a exclusão: o sócio pediu para apagar os dados, e segurar
        // tudo por causa do gateway o deixaria preso sem ter o que fazer.
        //
        // Mas também não engole. Este `catch` já foi vazio, com a suposição de
        // que erro era "já cancelada" — e o erro real era o segredo do gateway
        // não declarado nesta function. A conta sumia com a assinatura ainda
        // cobrando, sem log nenhum. Agora fica registrado para cancelar à mão.
        // O contrato de `cancelarAssinatura` é resolver sem erro quando já
        // estiver cancelada; então chegar aqui é, por definição, pendência.
        const id = gatewaySubId.replace(/\//g, "_");
        await db.doc(`cancelamentosPendentes/${id}`).set(
          {
            gatewaySubscriptionId: gatewaySubId,
            userId: uid,
            formaPagamento: s.get("formaPagamento") ?? null,
            erro: String(err),
            criadoEm: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        logger.error("Assinatura NÃO cancelada no gateway durante a exclusão.", {
          uid,
          gatewaySubId,
          err,
        });
      }
    }
    await concluir(ETAPAS.GATEWAY);
  }

  if (feito < ETAPAS.ASSINATURAS) {
    await apagarEmLote(db.collection("subscriptions").where("userId", "==", uid));
    await concluir(ETAPAS.ASSINATURAS);
  }

  if (feito < ETAPAS.RESGATES) {
    await apagarEmLote(db.collection("redemptions").where("userId", "==", uid));
    // Cupons guardam quem resgatou: solta o vínculo e mantém `usado`, senão o
    // estoque voltaria. E os indicados por esta pessoa perdem o uid dela.
    await desvincular(db.collectionGroup("cupons").where("userId", "==", uid), {
      userId: FieldValue.delete(),
      redemptionId: FieldValue.delete(),
    });
    await desvincular(db.collection("users").where("indicadoPorUid", "==", uid), {
      indicadoPorUid: FieldValue.delete(),
    });
    await concluir(ETAPAS.RESGATES);
  }

  if (feito < ETAPAS.INDICES) {
    // Índices reversos código -> uid. Deixados para trás, continuam resolvendo
    // para um uid que não existe mais: `acharUsuario` (lib/consumo.ts)
    // devolveria esse uid e o consumo do salão viraria conta de um dono que já
    // apagou a conta. E, para a LGPD, o índice guardaria um identificador
    // vinculável depois do "apague meus dados".
    const codigoSocio = perfil.get("codigoSocio") as string | undefined;
    const codigoIndicacao = perfil.get("codigoIndicacao") as string | undefined;
    if (codigoSocio) await db.doc(`socioCodes/${codigoSocio}`).delete();
    if (codigoIndicacao) await db.doc(`referralCodes/${codigoIndicacao}`).delete();
    await concluir(ETAPAS.INDICES);
  }

  if (feito < ETAPAS.PERFIL) {
    // Perfil + subcoleções (a central de avisos pode ter centenas de docs).
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await concluir(ETAPAS.PERFIL);
  }

  if (feito < ETAPAS.ARQUIVOS) {
    try {
      await storage.bucket().deleteFiles({ prefix: `users/${uid}/` });
    } catch {
      // Sem arquivos para apagar, ou Storage ainda não habilitado no projeto.
    }
    await concluir(ETAPAS.ARQUIVOS);
  }

  if (feito < ETAPAS.LOGIN) {
    // Por último: invalida o token do cliente, e depois disto ele não tem mais
    // como chamar esta função. Por isso é a última etapa do cliente
    // (PEDIDOS roda depois, só no servidor).
    try {
      await auth.deleteUser(uid);
    } catch (err) {
      if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
    }
    await concluir(ETAPAS.LOGIN);
  }

  if (feito < ETAPAS.PEDIDOS) {
    // O login já foi apagado: falhar aqui faria o app dizer "conta NÃO
    // excluída", o que é falso. Fica na etapa anterior e a varredura diária
    // termina.
    try {
      await anonimizarPedidos(uid);
      await concluir(ETAPAS.PEDIDOS);
    } catch (err) {
      logger.error("Anonimização dos pedidos falhou; a varredura retoma.", { uid, err });
    }
  }

  if (feito >= ETAPAS.PEDIDOS && feito < ETAPAS.PAGAMENTOS) {
    try {
      await limparConsumo(uid);
      await concluir(ETAPAS.PAGAMENTOS);
    } catch (err) {
      logger.error("Limpeza do consumo falhou; a varredura retoma.", { uid, err });
    }
  }

  return feito;
}

/** O sócio pede a exclusão da própria conta. */
export const deleteAccount = onCall({ secrets: [MP_ACCESS_TOKEN] }, async (req) => {
  const uid = requireAuth(req);
  // A conta de atendimento é de todos os garçons: um deles não derruba os
  // celulares da equipe inteira entrando no app e excluindo "a própria" conta.
  if (req.auth?.token.role === "atendente") {
    throw new HttpsError("permission-denied", "Esta conta é do restaurante. Peça ao gerente.");
  }
  // Irreversível: token roubado de sessão antiga não apaga a conta. O app
  // reautentica antes de chamar.
  const authTime = Number(req.auth?.token.auth_time);
  if (!(Date.now() / 1000 - authTime <= 300)) {
    throw new HttpsError("failed-precondition", "Entre de novo para excluir a conta.");
  }
  await consumir(uid, "deleteAccount");
  const etapa = await executarExclusao(uid);
  return { ok: true, etapa, completo: etapa >= FINAL };
});

const iso = (v: unknown): unknown => {
  if (v && typeof (v as { toDate?: unknown }).toDate === "function") {
    return (v as { toDate(): Date }).toDate().toISOString();
  }
  if (Array.isArray(v)) return v.map(iso);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, iso(x)]));
  }
  return v;
};

/** Cópia dos dados pessoais de [uid] (LGPD art. 18, II e V). */
async function montarExportacao(uid: string) {
  // ponytail: teto de 1000 docs por coleção; paginar se alguém passar disso.
  const lista = async (q: Query) =>
    (await q.limit(1000).get()).docs.map((d) => iso({ id: d.id, ...d.data() }));
  const porUsuario = (c: string) => lista(db.collection(c).where("userId", "==", uid));

  const [perfil, assinaturas, resgates, pedidos, pagamentos, avisos] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    porUsuario("subscriptions"),
    porUsuario("redemptions"),
    porUsuario("pedidos"),
    porUsuario("payments"),
    lista(db.collection(`users/${uid}/notifications`)),
  ]);
  // `indicadoPorUid` é o identificador de outro titular.
  const { fcmToken: _t, indicadoPorUid: _i, ...dadosPerfil } = perfil.data() ?? {};
  return {
    geradoEm: new Date().toISOString(),
    perfil: iso(dadosPerfil),
    assinaturas,
    resgates,
    pedidos,
    pagamentos,
    avisos,
  };
}

export const exportarMeusDados = onCall(async (req) => {
  const uid = requireAuth(req);
  await consumir(uid, "exportarMeusDados");
  return montarExportacao(uid);
});

/** Registro do atendimento a pedido de titular (prova de cumprimento do prazo). */
const registrarAtendimento = (uid: string, acao: "exportar" | "excluir", adminUid: string) =>
  db.collection("atendimentosLgpd").add({ uid, acao, adminUid, em: FieldValue.serverTimestamp() });

/** Admin atende pedido do titular feito por e-mail: mesma cópia do app. */
export const exportarDadosDeSocio = onCall(async (req) => {
  const adminUid = await requireAdmin(req);
  await consumir(adminUid, "exportarDadosDeSocio");
  const uid = idValido((req.data ?? {}).uid, "uid");
  await registrarAtendimento(uid, "exportar", adminUid);
  return montarExportacao(uid);
});

/** Admin atende pedido de exclusão do titular feito por e-mail. */
export const excluirContaDeSocio = onCall({ secrets: [MP_ACCESS_TOKEN] }, async (req) => {
  const adminUid = await requireAdmin(req);
  await consumir(adminUid, "excluirContaDeSocio");
  const uid = idValido((req.data ?? {}).uid, "uid");
  if (uid === adminUid || (await db.doc(`users/${uid}`).get()).get("role") === "admin") {
    throw new HttpsError("failed-precondition", "Conta de administrador não é excluída por aqui.");
  }
  await registrarAtendimento(uid, "excluir", adminUid);
  const etapa = await executarExclusao(uid);
  return { ok: true, completo: etapa >= FINAL };
});

/**
 * Termina as exclusões que pararam no meio.
 *
 * É a rede de segurança que o desenho anterior não tinha: sem ela, uma falha
 * na última etapa deixaria a conta sem dados mas com login ativo, e o sócio não
 * teria como pedir de novo — o app exige sessão, e a sessão é justamente o que
 * sobrou.
 */
export const finalizarExclusoes = onSchedule(
  { schedule: "every 24 hours", timeZone: "America/Sao_Paulo", secrets: [MP_ACCESS_TOKEN] },
  async () => {
    const pendentes = await db
      .collection("exclusoes")
      .where("etapa", "<", FINAL)
      .limit(200)
      .get();

    for (const doc of pendentes.docs) {
      try {
        const etapa = await executarExclusao(doc.id);
        logger.info("Exclusão retomada.", { uid: doc.id, etapa });
      } catch (err) {
        logger.error("Exclusão pendente falhou de novo.", { uid: doc.id, err });
      }
    }

    await retentarCancelamentos();
  }
);

/**
 * Assinaturas que a exclusão não conseguiu cancelar no gateway.
 *
 * A conta já foi apagada; se ninguém cancelar do outro lado, o cartão da
 * pessoa continua sendo cobrado por um clube que ela nem consegue mais abrir.
 * Era uma coleção que só crescia esperando alguém olhar — e ninguém olha.
 *
 * Roda junto da varredura diária: quase sempre a falha era o gateway fora do
 * ar por um minuto, e a segunda tentativa resolve. O que não resolve fica no
 * documento, com a contagem de tentativas e o último erro, pra virar tarefa
 * humana com o histórico do lado.
 */
async function retentarCancelamentos() {
  const pendentes = await db.collection("cancelamentosPendentes").limit(50).get();

  for (const doc of pendentes.docs) {
    const id = doc.get("gatewaySubscriptionId") as string | undefined;
    if (!id) {
      // Documento sem o id da assinatura não tem como ser resolvido por
      // ninguém, nem por máquina nem por gente.
      await doc.ref.delete();
      continue;
    }
    try {
      await gateway().cancelarAssinatura(id);
      // Cancelou: a pendência deixou de existir, e guardá-la só faria a
      // próxima varredura tentar cancelar de novo o que já está cancelado.
      await doc.ref.delete();
      logger.info("Assinatura órfã cancelada no gateway.", { gatewaySubId: id });
    } catch (err) {
      await doc.ref.set(
        {
          tentativas: FieldValue.increment(1),
          ultimoErro: String(err),
          ultimaTentativaEm: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      logger.error("Assinatura órfã continua sem cancelar.", { gatewaySubId: id, err });
    }
  }
}
