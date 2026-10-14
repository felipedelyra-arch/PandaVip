import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

/**
 * Limite de chamadas por pessoa, por ação, numa janela de tempo.
 *
 * ## Por que existe
 *
 * Toda `onCall` daqui exigia sessão e mais nada. Sessão é de graça: qualquer um
 * cria uma conta e, do lado dele, um `for` de mil iterações chamando
 * `createCheckoutSession` custa nada — do lado do dono custa mil checkouts no
 * gateway de pagamento, mil leituras de `plans`, e as 10 instâncias do `maxInstances` global
 * ocupadas, o que derruba o app pra quem está no salão querendo pagar a conta.
 *
 * O `maxInstances: 10` sozinho não protege: ele limita o gasto, não o abuso.
 * Uma pessoa saturando as 10 instâncias é exatamente o que ele NÃO impede.
 *
 * ## Como funciona
 *
 * Janela fixa. O id do documento carrega a janela (`uid__acao__<bloco>`), então
 * a janela velha morre sozinha em vez de precisar ser zerada — e
 * `limparRateLimits` (manutencao.ts) varre o que sobrou uma vez por dia.
 *
 * Uma transação por chamada, num documento que só aquela pessoa naquela ação
 * toca. Não há disputa entre sócios diferentes, então não repete o gargalo que
 * `lib/cupons.ts` teve que desmontar.
 *
 * ## O que ele NÃO é
 *
 * Não é proteção contra bot: quem quiser gastar contas novas contorna criando
 * várias. Quem cuida disso é o App Check (ver `REQUER_APP_CHECK` em guards.ts).
 * Este aqui limita o estrago por conta, que é o caso comum — script bobo,
 * botão preso, app em laço de retry.
 */

export interface Limite {
  /** Quantas chamadas cabem na janela. */
  max: number;
  /** Tamanho da janela, em segundos. */
  janelaSegundos: number;
}

/**
 * Tetos por ação. Números pensados pra uso humano com folga larga: quem está
 * usando o app de verdade nunca chega perto, e quem chega está automatizando.
 */
export const LIMITES = {
  // Dinheiro / gateway externo: cada chamada vira objeto no gateway de pagamento.
  createCheckoutSession: { max: 10, janelaSegundos: 600 },
  cancelSubscription: { max: 5, janelaSegundos: 600 },
  // Arrependimento: reembolsa no gateway. Repetir é legítimo só se o MP caiu.
  desistirAssinatura: { max: 5, janelaSegundos: 600 },
  // Pix gera QR no gateway; cartão cria assinatura. Mesmo teto do checkout.
  criarPixAssinatura: { max: 10, janelaSegundos: 600 },
  assinarComCartao: { max: 10, janelaSegundos: 600 },

  // Estoque de prêmio. O caminho já é idempotente por par (prêmio, pessoa),
  // mas cada tentativa lê assinatura + prêmio e pode reservar cupom.
  redeemReward: { max: 30, janelaSegundos: 600 },

  // Pedido: cada chamada lê o cardápio inteiro do pedido e grava uma comanda.
  // Teto folgado pro sócio que erra o endereço e refaz, apertado o bastante
  // pra ninguém encher a cozinha de comanda falsa.
  criarPedido: { max: 20, janelaSegundos: 600 },
  cancelarPedido: { max: 20, janelaSegundos: 600 },

  // Indicação: é aqui que alguém tentaria farmar benefício na força bruta,
  // chutando códigos de 6 caracteres. 20 chutes por 10 min torna inviável.
  applyReferral: { max: 20, janelaSegundos: 600 },
  ensureReferralCode: { max: 20, janelaSegundos: 600 },

  // Exclusão de conta: é retomável de propósito, então repetir é legítimo —
  // mas repetir centenas de vezes varre `subscriptions` e `redemptions` a cada
  // volta.
  deleteAccount: { max: 10, janelaSegundos: 3600 },

  // Cópia dos dados (LGPD): lê várias coleções por chamada.
  exportarMeusDados: { max: 5, janelaSegundos: 3600 },

  // Muda status de pedido. Teto de admin: numa noite cheia o dono toca em
  // "preparando" e "saiu" de dezenas de pedidos.
  mudarStatusPedido: { max: 600, janelaSegundos: 3600 },

  // Ações de admin. Teto alto: o dono lança consumo a noite inteira no salão.
  // Serve pra conter conta de funcionário comprometida, não pra atrapalhar.
  lancarConsumo: { max: 300, janelaSegundos: 3600 },
  validateRedemption: { max: 600, janelaSegundos: 3600 },
  sendPush: { max: 20, janelaSegundos: 3600 },
  setAdminRole: { max: 20, janelaSegundos: 3600 },
  novaSenhaAtendimento: { max: 10, janelaSegundos: 3600 },
  backfillCodigosSocio: { max: 200, janelaSegundos: 3600 },
  // Pedidos de titulares atendidos pelo painel (LGPD, art. 18).
  exportarDadosDeSocio: { max: 60, janelaSegundos: 3600 },
  excluirContaDeSocio: { max: 30, janelaSegundos: 3600 },
} as const satisfies Record<string, Limite>;

export type Acao = keyof typeof LIMITES;

/** Coleção dos contadores. Fechada pro cliente nas rules. */
const COLECAO = "rateLimits";

/**
 * Consome uma unidade do limite de [uid] em [acao]. Lança `resource-exhausted`
 * quando estourou — código que o cliente Firebase entrega como
 * `FirebaseFunctionsException(code: 'resource-exhausted')`.
 *
 * Falha de infraestrutura aqui **não bloqueia** a ação: se o Firestore recusar
 * a transação, o limitador deixa passar e registra no log. Um limitador que
 * derruba a assinatura do sócio quando ele próprio tropeça é pior que o abuso
 * que ele evita.
 *
 * ⚠️ Exceção: disputa no próprio contador (`ABORTED`, ou o prazo estourado
 * esperando a vez) **bloqueia**. O documento é de uma pessoa só, então disputa
 * nele quer dizer rajada paralela da mesma conta — e deixar passar aqui era o
 * furo: cem chamadas simultâneas se atropelavam e todas saíam liberadas.
 */
export async function consumir(uid: string, acao: Acao): Promise<void> {
  const { max, janelaSegundos } = LIMITES[acao];
  const bloco = Math.floor(Date.now() / (janelaSegundos * 1000));
  const ref = db.doc(`${COLECAO}/${uid}__${acao}__${bloco}`);

  let estourou = false;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const atual = (snap.get("n") as number | undefined) ?? 0;
      if (atual >= max) {
        estourou = true;
        return;
      }
      tx.set(
        ref,
        {
          n: FieldValue.increment(1),
          uid,
          acao,
          // Carimbo usado só pela faxina (e pela política de TTL do Firestore).
          // A janela de verdade é o bloco no id do documento.
          expiraEm: new Date(Date.now() + janelaSegundos * 1000),
        },
        { merge: true }
      );
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    // 10 = ABORTED, 4 = DEADLINE_EXCEEDED (gRPC).
    if (code === 10 || code === 4) {
      estourou = true;
    } else {
      console.error(`[rateLimit] falhou em ${acao} de ${uid}; deixando passar:`, err);
      return;
    }
  }

  if (estourou) {
    throw new HttpsError(
      "resource-exhausted",
      "Muitas tentativas seguidas. Espere um pouco e tente de novo."
    );
  }
}
