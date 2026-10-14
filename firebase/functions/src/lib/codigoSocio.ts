import { randomInt } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

/**
 * Código curto da carteirinha — o que o atendente lê (ou digita) no PDV pra
 * amarrar a conta da mesa ao sócio.
 *
 * Não usa o uid do Firebase de propósito: 28 caracteres aleatórios ninguém
 * digita quando o leitor de QR falha, e é justamente aí que o código precisa
 * funcionar.
 */

/**
 * Sem 0/O, 1/I/L, 5/S, U/V — os pares que o atendente troca lendo do celular
 * do cliente às pressas, no meio do salão.
 */
const ALFABETO = "2346789ABCDEFGHJKMNPQRTWXYZ";
const TAMANHO = 6;

/**
 * ⚠️ `randomInt` (do `crypto`), e não `Math.random()`.
 *
 * O código é **identidade**: é ele que o atendente digita no PDV pra amarrar a
 * conta da mesa a um sócio, e `acharUsuario` (lib/consumo.ts) confia nele sem
 * pedir mais nada. `Math.random()` não é imprevisível — é um gerador com estado
 * interno, e quem observa saídas suficientes (a carteirinha fica na tela, o
 * código sai em cada cadastro) consegue reconstruir esse estado e prever os
 * próximos. Aí o desconto do clube, e a conta, vão para o sócio errado.
 *
 * `randomInt` sorteia sem viés de módulo a partir da fonte do sistema
 * operacional. Mesmo custo na prática, e não dá para prever.
 */
function candidato(): string {
  let s = "";
  for (let i = 0; i < TAMANHO; i++) {
    s += ALFABETO[randomInt(ALFABETO.length)];
  }
  return s;
}

/**
 * Devolve o código do sócio, criando na primeira vez. Idempotente: chamar duas
 * vezes pro mesmo uid devolve o mesmo código.
 *
 * A unicidade vem da coleção `socioCodes/{codigo} -> uid`, mesmo desenho do
 * `referralCodes`: o doc id é o próprio código, então a colisão é impossível
 * dentro da transação — e o PDV resolve o sócio com uma leitura direta, sem
 * query nem índice.
 */
export async function garantirCodigoSocio(uid: string): Promise<string> {
  const userRef = db.doc(`users/${uid}`);

  for (let i = 0; i < 5; i++) {
    const cand = candidato();
    const lookupRef = db.doc(`socioCodes/${cand}`);

    const code = await db.runTransaction(async (tx) => {
      const [userSnap, existe] = await Promise.all([
        tx.get(userRef),
        tx.get(lookupRef),
      ]);

      const jaTem = userSnap.get("codigoSocio") as string | undefined;
      if (jaTem) return jaTem;
      if (existe.exists) return null; // colidiu, tenta outro

      tx.set(lookupRef, { uid, criadoEm: FieldValue.serverTimestamp() });
      tx.set(userRef, { codigoSocio: cand }, { merge: true });
      return cand;
    });

    if (code) return code;
  }

  throw new Error(`Não deu pra gerar codigoSocio para ${uid}.`);
}
