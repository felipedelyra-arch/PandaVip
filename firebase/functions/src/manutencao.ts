import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "./lib/admin";
import { vencerPix } from "./lib/assinaturas";
import { executarExclusao } from "./account";
import { MP_ACCESS_TOKEN } from "./lib/segredos";

/**
 * Faxina dos contadores de limite de chamada (`rateLimits`).
 *
 * Cada janela vira um documento novo (ver `lib/rateLimit.ts`), então a coleção
 * cresce com o uso e nada a limpa. O documento velho é inofensivo — a janela
 * dele já passou e ninguém mais consulta —, mas ocupa armazenamento pra sempre.
 *
 * O ideal é a política de TTL nativa do Firestore no campo `expiraEm`, que
 * apaga sozinho e não custa operação de escrita:
 *
 *   gcloud firestore fields ttls update expiraEm \
 *     --collection-group=rateLimits --enable-ttl --project=<projeto>
 *
 * Esta função é a rede pra enquanto o TTL não estiver configurado, e é barata:
 * quando o TTL estiver ligado ela não acha nada e sai na primeira volta.
 */
export const limparRateLimits = onSchedule(
  { schedule: "every 24 hours", timeZone: "America/Sao_Paulo" },
  async () => {
    const agora = new Date();
    let apagados = 0;

    // Teto por execução, mesmo desenho de `limparAvisosAntigos`: vale mais
    // terminar dentro do tempo do que ser cortado no meio de um lote.
    for (let volta = 0; volta < 20; volta++) {
      const velhos = await db
        .collection("rateLimits")
        .where("expiraEm", "<", agora)
        .limit(450)
        .get();
      if (velhos.empty) break;

      const lote = db.batch();
      velhos.docs.forEach((d) => lote.delete(d.ref));
      await lote.commit();
      apagados += velhos.size;

      if (velhos.size < 450) break;
    }

    if (apagados) logger.info("Faxina dos contadores de limite.", { apagados });
  }
);

/** Pix não renova sozinho: avisa antes de vencer e encerra o que venceu (`lib/assinaturas.ts`). */
export const vencerAssinaturasPix = onSchedule(
  { schedule: "every 60 minutes", timeZone: "America/Sao_Paulo" },
  async () => {
    await vencerPix();
  }
);

/**
 * Conta que nunca informou `nascimento` e tem mais de 30 dias, sem assinatura,
 * é apagada: pode ser de menor de 14 anos (Política) e é dado sem finalidade.
 * Quase sempre é cadastro com Google/Apple abandonado em /completar-perfil.
 * Admin nunca entra.
 *
 * ponytail: o Firestore não consulta campo ausente, então varre os perfis com
 * mais de 30 dias e filtra aqui; teto de 100 exclusões por execução.
 * Vira `where` se a base passar de dezenas de milhares.
 */
export const excluirContasIncompletas = onSchedule(
  { schedule: "every 24 hours", timeZone: "America/Sao_Paulo", secrets: [MP_ACCESS_TOKEN] },
  async () => {
    const corte = new Date(Date.now() - 30 * 86_400_000);
    const perfis = await db.collection("users").where("criadoEm", "<", corte).select("nascimento", "role").get();
    let apagadas = 0;
    for (const p of perfis.docs) {
      if (apagadas >= 100) break;
      if (p.get("nascimento") || p.get("role") === "admin") continue;
      const subs = await db.collection("subscriptions").where("userId", "==", p.id).limit(1).get();
      if (!subs.empty) continue;
      try {
        await executarExclusao(p.id);
        apagadas++;
      } catch (err) {
        logger.error("Exclusão de conta incompleta falhou.", { uid: p.id, err });
      }
    }
    if (apagadas) logger.info("Contas incompletas excluídas.", { apagadas });
  }
);
