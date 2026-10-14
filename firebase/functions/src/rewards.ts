import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "./lib/admin";
import { sincronizarPool, contarLivres } from "./lib/cupons";

/**
 * Gatilhos que mantêm o estoque do prêmio.
 *
 * Dois campos, com donos diferentes — é isso que evita laço entre eles:
 *
 *   `estoqueAlvo`  quanto o dono QUER que exista. Só o painel escreve.
 *   `estoque`      quantos ainda estão livres. Só [estoqueDoPremio] escreve.
 *
 * Reservar um cupom faz [estoqueDoPremio] reescrever `estoque` no prêmio, o
 * que dispara [sincronizarCupons] — que não faz nada, porque `estoqueAlvo`
 * continua igual. Sem a separação, um gatilho alimentaria o outro para sempre.
 */

/**
 * O dono mudou a quantidade: acerta o pool de cupons.
 *
 * Prêmio antigo, criado antes dos cupons existirem, não tem `estoqueAlvo`.
 * Nesse caso o valor de `estoque` que já estava lá vira o alvo — assim o
 * cadastro que o dono fez continua valendo, sem migração manual.
 */
export const sincronizarCupons = onDocumentWritten("rewards/{rewardId}", async (event) => {
  const antes = event.data?.before;
  const depois = event.data?.after;
  const rewardId = event.params.rewardId;

  // Prêmio apagado: os cupons vão junto (subcoleção não some sozinha).
  if (!depois?.exists) {
    await db.recursiveDelete(db.doc(`rewards/${rewardId}`));
    logger.info("Prêmio removido; cupons apagados.", { rewardId });
    return;
  }

  const alvoDepois = depois.get("estoqueAlvo") as number | undefined;
  const alvoAntes = antes?.exists ? (antes.get("estoqueAlvo") as number | undefined) : undefined;

  // Sem `estoqueAlvo`: prêmio de antes desta mudança. Adota o `estoque` atual.
  const alvo = alvoDepois ?? (depois.get("estoque") as number | undefined) ?? 0;

  // Nada a fazer quando o alvo não mudou. É esta guarda que impede o laço com
  // o gatilho de baixo, que escreve `estoque` a cada resgate.
  if (antes?.exists && alvoDepois === alvoAntes && alvoDepois !== undefined) return;

  const n = Math.max(0, Math.floor(Number(alvo) || 0));
  await sincronizarPool(rewardId, n);

  // `estoqueAlvo` fica gravado inclusive para o prêmio antigo, para a próxima
  // passada do gatilho reconhecer que já está sincronizado.
  await db.doc(`rewards/${rewardId}`).set(
    { estoqueAlvo: n, estoque: await contarLivres(rewardId) },
    { merge: true }
  );
  logger.info("Pool de cupons sincronizado.", { rewardId, alvo: n });
});

/**
 * Um cupom mudou de estado: recalcula o `estoque` que o app mostra.
 *
 * Recontar, e não `increment(-1)`: gatilho do Firestore entrega **pelo menos
 * uma vez**, então uma entrega repetida descontaria duas vezes do estoque.
 * Contar de novo dá o mesmo resultado por mais vezes que rode.
 *
 * Roda fora do caminho do cliente de propósito. Vários resgates simultâneos
 * fazem várias entregas escreverem o mesmo documento de prêmio — é a fila que
 * tiramos do resgate. Aqui ela é inofensiva: ninguém está esperando, e o
 * atraso aparece como um número de estoque alguns segundos atrasado.
 */
export const estoqueDoPremio = onDocumentWritten(
  "rewards/{rewardId}/cupons/{cupomId}",
  async (event) => {
    // Só mudança de estado de cupom que JÁ existia interessa aqui — ou seja,
    // reserva e devolução, que são as duas coisas que mexem no que o sócio vê.
    //
    // Criação e remoção de cupom vêm de `sincronizarPool`, e ela grava o
    // `estoque` certo logo depois, com o número contado de uma vez só. Sem
    // esta guarda, o dono cadastrar um prêmio com 1.000 unidades disparava
    // 1.000 entregas deste gatilho, cada uma com uma contagem e uma escrita no
    // MESMO documento de prêmio: 1.000 contagens jogadas fora, 1.000 escritas
    // disputando uma linha só, e a fila de invocações competindo com os
    // resgates de verdade. Agora essas entregas caem fora na primeira linha.
    //
    // Se algum dia outro caminho criar cupom sem passar pela sincronia, o
    // `estoque` fica atrasado até a próxima passada de [conferirEstoques].
    const antes = event.data?.before;
    const depois = event.data?.after;
    if (!antes?.exists || !depois?.exists) return;

    const rewardId = event.params.rewardId;
    const premio = db.doc(`rewards/${rewardId}`);
    if (!(await premio.get()).exists) return; // prêmio apagado no meio

    await premio.set({ estoque: await contarLivres(rewardId) }, { merge: true });
  }
);

/**
 * Confere o `estoque` de todos os prêmios e corrige o que estiver errado.
 *
 * É a rede de segurança do gatilho acima, e existe por um motivo concreto:
 * numa rajada de resgates, dezenas de entregas do gatilho escrevem o MESMO
 * documento de prêmio quase ao mesmo tempo. Parte dessas escritas falha por
 * disputa — e gatilho do Firestore, por padrão, **não tenta de novo**. Enquanto
 * os resgates continuam, o próximo conserta; quando a rajada acaba, o último
 * número errado fica.
 *
 * O efeito é só o número na tela: um prêmio aparecer como esgotado sem estar
 * (aí ninguém resgata algo que existe), ou o contrário (aí a pessoa toca e
 * recebe "Sem estoque"). O resgate em si nunca erra — quem manda é o cupom, e
 * ele é um documento por unidade.
 *
 * A cada 6 horas é frequente o bastante: a divergência só nasce em rajada, e
 * rajada acontece quando o dono dispara um prêmio novo.
 */
export const conferirEstoques = onSchedule(
  { schedule: "every 6 hours", timeZone: "America/Sao_Paulo" },
  async () => {
    // A coleção de prêmios é pequena por natureza — um restaurante tem punhado.
    const premios = await db.collection("rewards").select("estoque").get();

    const corrigidos: { id: string; de: number; para: number }[] = [];
    for (const doc of premios.docs) {
      const real = await contarLivres(doc.id);
      const mostrado = Number(doc.get("estoque") ?? 0);
      if (real === mostrado) continue;

      await doc.ref.set({ estoque: real }, { merge: true });
      corrigidos.push({ id: doc.id, de: mostrado, para: real });
    }

    if (corrigidos.length) {
      logger.warn("Estoque divergente corrigido.", { corrigidos });
    }
  }
);
