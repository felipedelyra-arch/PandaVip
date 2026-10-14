import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/admin";
import { requireAuth, requireVerified, ID_VALIDO } from "./lib/guards";
import { consumir } from "./lib/rateLimit";

/**
 * Indicação: cada sócio tem um código, e quem se cadastra usando esse código
 * fica vinculado a ele.
 *
 * ## Por que a regra mora em funções soltas, e não dentro do `onCall`
 *
 * `loadtest/verificar-concorrencia.js` precisa martelar estas duas operações
 * com dezenas de chamadas simultâneas contra o emulador, e `onCall` só é
 * chamável passando pela camada de autenticação. Antes, o teste tinha uma
 * **cópia** da lógica escrita à mão — e a cópia recebeu a correção de corrida
 * que este arquivo não tinha. O teste passava, a produção quebrava.
 *
 * Mesma razão pela qual `account.ts` exporta `executarExclusao`. A regra é uma
 * só: `onCall` cuida de quem pode chamar e de traduzir erro; o que é testável
 * fica fora dele.
 */

/**
 * Garante um código de indicação único pro [uid] e devolve ele.
 *
 * ⚠️ A leitura do perfil acontece DENTRO da transação de propósito. Lendo
 * fora, dois toques rápidos no botão liam o perfil sem código antes de
 * qualquer um gravar, cada um sorteava um candidato diferente e os dois
 * gravavam: sobravam dois documentos em `referralCodes` apontando pro mesmo
 * sócio, e `users.codigoIndicacao` ficava com o do segundo. O primeiro código
 * seguia valendo pra quem já tivesse recebido o convite, mas não aparecia mais
 * em tela nenhuma — e a exclusão de conta (account.ts, etapa ÍNDICES) só apaga
 * o índice que está no perfil, então o outro ficaria pra sempre resolvendo pra
 * um uid apagado.
 *
 * Este é o mesmo desenho de `lib/codigoSocio.ts`; os dois têm que continuar
 * iguais.
 */
export async function garantirCodigoIndicacao(uid: string): Promise<string> {
  const userRef = db.doc(`users/${uid}`);

  for (let i = 0; i < 5; i++) {
    const cand = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
    const lookupRef = db.doc(`referralCodes/${cand}`);

    const code = await db.runTransaction(async (tx) => {
      const [existe, atual] = await Promise.all([tx.get(lookupRef), tx.get(userRef)]);
      // Outro toque chegou primeiro: o código dele é o código, e este
      // candidato é descartado sem nunca ter sido gravado.
      const agora = atual.get("codigoIndicacao") as string | undefined;
      if (agora) return agora;
      if (existe.exists) return null; // colidiu, sorteia outro
      tx.set(lookupRef, { uid, criadoEm: FieldValue.serverTimestamp() });
      tx.set(userRef, { codigoIndicacao: cand }, { merge: true });
      return cand;
    });

    if (code) return code;
  }

  throw new Error(`Não deu pra gerar código de indicação para ${uid}.`);
}

export type ResultadoIndicacao =
  | { estado: "aplicou" }
  | { estado: "repetido" }
  | { estado: "ja_usou_outro" }
  | { estado: "codigo_invalido" }
  | { estado: "auto_indicacao" };

/**
 * Vincula [uid] ao código [code].
 *
 * ## Concorrência
 *
 * A marca `indicadoPor` é gravada numa transação que primeiro confere se já
 * existe. Sem isso, dois toques (ou a fila de pendências do app reenviando)
 * liam o perfil sem marca antes de qualquer um gravar, os dois passavam pelo
 * teste e o padrinho ganhava **duas** indicações por uma pessoa só — que é
 * exatamente o que alguém faria de propósito pra farmar o benefício.
 *
 * ## Repetir é seguro
 *
 * Repetir com o MESMO código devolve `repetido`, não erro. A fila de
 * pendências (`fila_pendentes.dart`) reenvia esta chamada quando a rede volta,
 * e trata `already-exists` como falha permanente: sem esta distinção, uma
 * indicação que deu certo ia parar na caixa de "não enviados" do sócio.
 */
export async function aplicarIndicacao(uid: string, code: string): Promise<ResultadoIndicacao> {
  const codeUp = code.trim().toUpperCase();
  const userRef = db.doc(`users/${uid}`);

  const lookup = await db.doc(`referralCodes/${codeUp}`).get();
  if (!lookup.exists) return { estado: "codigo_invalido" };

  const referrerUid = lookup.get("uid") as string;
  if (referrerUid === uid) return { estado: "auto_indicacao" };

  const resultado = await db.runTransaction<ResultadoIndicacao["estado"]>(async (tx) => {
    const me = await tx.get(userRef);
    const atual = me.get("indicadoPor") as string | undefined;
    if (atual === codeUp) return "repetido";
    if (atual) return "ja_usou_outro";
    tx.set(userRef, { indicadoPor: codeUp, indicadoPorUid: referrerUid }, { merge: true });
    return "aplicou";
  });

  if (resultado !== "aplicou") return { estado: resultado };

  // Fora da transação de propósito. `increment` é atômico por si, e um código
  // que viraliza faria dezenas de transações disputarem o documento do
  // padrinho — a mesma fila que tiramos do resgate em lib/cupons.ts. Só quem
  // venceu a transação acima chega aqui, então não conta duas vezes.
  //
  // Se esta linha falhar, a indicação fica registrada e o contador do padrinho
  // fica um atrás. É o lado certo pra errar: quem foi indicado não perde o
  // vínculo, que é o que decide o benefício na ativação da assinatura.
  await db.doc(`users/${referrerUid}`).set(
    { indicacoes: FieldValue.increment(1) },
    { merge: true }
  );

  return { estado: "aplicou" };
}

/**
 * Garante um código de indicação único pro usuário e o retorna (cria na 1ª vez).
 * Também devolve quantas indicações já rendeu.
 */
export const ensureReferralCode = onCall(async (req) => {
  const uid = requireAuth(req);
  await consumir(uid, "ensureReferralCode");

  let code: string;
  try {
    code = await garantirCodigoIndicacao(uid);
  } catch (err) {
    console.error(`Falha ao gerar código de indicação de ${uid}:`, err);
    throw new HttpsError("internal", "Não foi possível gerar o código.");
  }

  // Depois de gerar: assim o contador vem do documento já atualizado, em vez
  // de uma leitura anterior à gravação.
  const snap = await db.doc(`users/${uid}`).get();
  return { code, indicacoes: (snap.get("indicacoes") as number) ?? 0 };
});

/**
 * Registra que o usuário atual foi indicado por um código. Só uma vez por conta,
 * não pode indicar a si mesmo. Incrementa o contador de quem indicou.
 * A recompensa (benefício pros dois) é concedida na ativação da assinatura
 * — ver hook no webhook de pagamento.
 */
export const applyReferral = onCall(async (req) => {
  const uid = requireVerified(req);
  await consumir(uid, "applyReferral");
  const code = String((req.data ?? {}).code ?? "").trim();
  // Formato errado responde igual a código inexistente: o cadastro só trata
  // `not-found` como recusa, e qualquer outro erro iria pra fila de reenvio.
  if (!ID_VALIDO.test(code)) throw new HttpsError("not-found", "Código de indicação inválido.");

  const r = await aplicarIndicacao(uid, code);
  switch (r.estado) {
    case "codigo_invalido":
      throw new HttpsError("not-found", "Código de indicação inválido.");
    case "auto_indicacao":
      throw new HttpsError("failed-precondition", "Não é possível usar o próprio código de indicação.");
    case "ja_usou_outro":
      throw new HttpsError("already-exists", "Você já usou um código de indicação.");
    case "repetido":
      return { ok: true, repetido: true };
    case "aplicou":
      return { ok: true };
  }
});
