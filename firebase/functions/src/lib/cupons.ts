import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

/**
 * Pool de cupons de um prêmio.
 *
 * ## Por que isto existe
 *
 * O resgate antigo baixava o estoque com `tx.update(rewards/{id}, {estoque:
 * n-1})` dentro de uma transação. Todo mundo que resgatava o MESMO prêmio
 * disputava o MESMO documento, e o Firestore atende um documento em fila
 * (~1 escrita por segundo sustentada). Medido no emulador: 25 pessoas
 * simultâneas derrubavam 44% dos resgates, 50 derrubavam 92%, com
 * `ABORTED: Transaction lock timeout`.
 *
 * E o cenário não é hipotético: é o desenho do produto. O dono cadastra um
 * rodízio grátis, `onRewardCreated` dispara push pra todos os assinantes, e
 * todo mundo abre o app e toca "resgatar" no mesmo minuto.
 *
 * ## Como funciona agora
 *
 * O estoque vira N documentos em `rewards/{id}/cupons/{i}`. Resgatar é
 * reservar UM cupom, e cada cupom é um documento diferente — então as
 * transações não se cruzam. Duas pessoas só disputam se sortearem o mesmo
 * cupom, e nesse caso uma tenta outro.
 *
 * Comparado a um contador repartido em N pedaços, o cupom não tem o problema
 * de "o pedaço que sorteei está vazio mas ainda há estoque": aqui, cupom
 * ocupado é simplesmente outro sorteio.
 *
 * ## Quem escreve o quê
 *
 * - `estoqueAlvo` — quanto o dono quer que exista. Só o painel escreve.
 * - `estoque`     — quantos ainda estão livres. Só o gatilho escreve, contando
 *                   os cupons. O app segue lendo este campo como sempre leu.
 *
 * A separação é o que impede laço infinito entre os dois gatilhos: reservar um
 * cupom reescreve `estoque` no prêmio, o que dispara o gatilho de sincronia —
 * que não faz nada, porque `estoqueAlvo` não mudou.
 */

/** Tentativas de reserva antes de desistir. */
const SORTEIOS = 8;

/** Quantos candidatos cada tentativa traz. */
const CANDIDATOS = 10;

export interface Cupom {
  status: "livre" | "usado";
  /**
   * Número aleatório em [0,1). É o que espalha o sorteio pelo pool inteiro.
   *
   * Sem ele a consulta `where(status == livre).limit(N)` devolve sempre os
   * MESMOS primeiros cupons, e todo mundo que resgata ao mesmo tempo disputa
   * esse punhado — a fila volta, só que num lugar diferente. Medido: com 200
   * pessoas simultâneas e janela fixa de 20, 17% ainda falhavam por
   * `ABORTED`.
   */
  sorte: number;
  userId?: string;
  redemptionId?: string;
  usadoEm?: FirebaseFirestore.Timestamp;
}

const colecao = (rewardId: string) => db.collection(`rewards/${rewardId}/cupons`);

/**
 * Ajusta o pool para que existam [alvo] cupons LIVRES.
 *
 * Faltando, cria. Sobrando, remove — mas **nunca** um cupom já usado: o dono
 * baixar o estoque não pode apagar o prêmio de quem já resgatou. Por isso a
 * conta é sobre os livres, não sobre o total.
 *
 * Idempotente: rodar duas vezes com o mesmo alvo não muda nada. Gatilho do
 * Firestore entrega pelo menos uma vez, então isso é requisito, não luxo.
 */
export async function sincronizarPool(rewardId: string, alvo: number): Promise<number> {
  const col = colecao(rewardId);
  const livres = await col.where("status", "==", "livre").get();
  const atual = livres.size;

  if (alvo > atual) {
    // Id automático. Já tentei numeração sequencial, que exigia descobrir o
    // último id com `orderBy('__name__','desc')` — e o Firestore recusa isso
    // com `FAILED_PRECONDITION: Firestore does not support descending key
    // scans`. A ordem dos cupons não serve para nada: o resgate sorteia.
    const criar = alvo - atual;
    for (let i = 0; i < criar; i += 450) {
      const lote = db.batch();
      for (let j = i; j < Math.min(i + 450, criar); j++) {
        lote.create(col.doc(), { status: "livre", sorte: Math.random() });
      }
      await lote.commit();
    }
  } else if (alvo < atual) {
    const remover = livres.docs.slice(0, atual - alvo);
    for (let i = 0; i < remover.length; i += 450) {
      const lote = db.batch();
      remover.slice(i, i + 450).forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }
  }

  return alvo;
}

/** Quantos cupons ainda estão livres. Consulta de contagem, não varredura. */
export async function contarLivres(rewardId: string): Promise<number> {
  const snap = await colecao(rewardId).where("status", "==", "livre").count().get();
  return snap.data().count;
}

/**
 * Reserva um cupom para [userId]. Devolve o id do cupom, ou `null` se acabou.
 *
 * A transação toca UM documento de cupom — nunca o documento do prêmio. É daí
 * que vem a capacidade: pessoas diferentes sorteiam cupons diferentes e não
 * esperam umas pelas outras.
 */
export async function reservarCupom(
  rewardId: string,
  userId: string,
  redemptionId: string
): Promise<string | null> {
  const col = colecao(rewardId);

  for (let tentativa = 0; tentativa < SORTEIOS; tentativa++) {
    // Sorteia um ponto do pool e pega os candidatos a partir dele. Duas
    // pessoas simultâneas partem de pontos diferentes, então olham cupons
    // diferentes — é isto que espalha a disputa em vez de concentrá-la.
    const ponto = Math.random();
    let livres = await col
      .where("status", "==", "livre")
      .where("sorte", ">=", ponto)
      .orderBy("sorte")
      .limit(CANDIDATOS)
      .get();

    // Caiu além do último cupom: dá a volta e busca do começo.
    if (livres.empty) {
      livres = await col
        .where("status", "==", "livre")
        .where("sorte", "<", ponto)
        .orderBy("sorte", "desc")
        .limit(CANDIDATOS)
        .get();
    }
    if (livres.empty) return null;

    const escolhido = livres.docs[Math.floor(Math.random() * livres.docs.length)];

    const ok = await db.runTransaction(async (tx) => {
      const snap = await tx.get(escolhido.ref);
      if (!snap.exists || snap.get("status") !== "livre") return false;
      tx.update(escolhido.ref, {
        status: "usado",
        userId,
        redemptionId,
        usadoEm: FieldValue.serverTimestamp(),
      });
      return true;
    });

    if (ok) return escolhido.id;
  }

  // Seis sorteios perdidos seguidos com cupom livre existindo é disputa
  // altíssima, não falta de estoque. Quem chamou decide o que dizer.
  return null;
}

/**
 * Devolve um cupom ao pool.
 *
 * Usado quando o resgate falha DEPOIS de o cupom ter sido reservado — sem
 * isto, o prêmio ficaria preso a um resgate que não existe, e o estoque
 * encolheria sozinho a cada erro.
 */
export async function liberarCupom(rewardId: string, cupomId: string): Promise<void> {
  await colecao(rewardId).doc(cupomId).set(
    {
      status: "livre",
      // Sorteia de novo: devolver o cupom com a mesma posição faria a próxima
      // corrida cair nele com a mesma frequência de antes.
      sorte: Math.random(),
      userId: FieldValue.delete(),
      redemptionId: FieldValue.delete(),
      usadoEm: FieldValue.delete(),
    },
    { merge: true }
  );
}
