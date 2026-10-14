import { onCall } from "firebase-functions/v2/https";
import { randomInt } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { auth, db } from "./lib/admin";
import { requireAdmin, idValido, EMAIL_ATENDIMENTO } from "./lib/guards";
import { consumir } from "./lib/rateLimit";

/**
 * Concede/revoga a role admin via custom claim.
 * Só um admin existente pode chamar. O primeiro admin deve ser criado
 * manualmente (ver README: firebase auth + setCustomUserClaims via script).
 */
export const setAdminRole = onCall(async (req) => {
  const chamador = await requireAdmin(req);
  await consumir(chamador, "setAdminRole");

  const { makeAdmin } = (req.data ?? {}) as { makeAdmin?: boolean };
  const targetUid = idValido((req.data ?? {}).targetUid, "targetUid");

  const role = makeAdmin ? "admin" : null;
  const anterior = (await auth.getUser(targetUid)).customClaims?.role ?? null;
  await auth.setCustomUserClaims(targetUid, { role });
  // Quem perde poder sai na hora das Cloud Functions: `requireAdmin` e
  // `requireEquipe` conferem a revogação, e o painel cai no próximo refresh.
  // Ganhar poder não derruba a sessão.
  // As rules não enxergam revogação, mas `isAdmin()` também lê o espelho
  // `users/{uid}.role` gravado abaixo.
  if (anterior && anterior !== role && role !== "admin") await auth.revokeRefreshTokens(targetUid);

  // Espelha em Firestore para listar admins no painel.
  await db.doc(`users/${targetUid}`).set({ role }, { merge: true });

  return { ok: true, targetUid, isAdmin: role === "admin", role };
});

/**
 * Conta de atendimento: UMA conta da casa, logada no celular de cada garçom e
 * no balcão, que só abre a tela `/garcom` (role `atendente`, ver
 * `requireEquipe`). Garçom não tem conta própria: escolhe o nome na lista da
 * Equipe a cada validação. Entra e sai garçom sem cadastro de UID. O e-mail
 * fica em `EMAIL_ATENDIMENTO` (lib/guards.ts). Senha nova só por aqui.
 *
 * Senha no formato `Panda-123456-abc`: cumpre a política do projeto (maiúscula,
 * minúscula, número e símbolo — `scripts/configurar-auth.js`, em ENFORCE, que
 * recusaria o login) e dá para ditar a um garçom. ~1,4·10¹⁰ combinações.
 */
export function gerarSenhaAtendimento(): string {
  const letras = "abcdefghijkmnpqrstuvwxyz";
  const num = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const sufixo = Array.from({ length: 3 }, () => letras[randomInt(0, letras.length)]).join("");
  return `Panda-${num}-${sufixo}`;
}

/**
 * Cria a conta de atendimento ou troca a senha dela. Trocar a senha também
 * derruba todos os celulares logados: é o botão de quando um garçom sai.
 * A senha volta uma vez só, para o admin passar à equipe; não fica guardada.
 */
export const novaSenhaAtendimento = onCall(async (req) => {
  const chamador = await requireAdmin(req);
  await consumir(chamador, "novaSenhaAtendimento");
  const senha = gerarSenhaAtendimento();

  // Só reaproveita a conta que esta função criou (uid guardado no config).
  // Qualquer outra com este e-mail é intrusa — alguém que se cadastrou com ele
  // antes do bloqueio no `onAuthUserCreate`, talvez com Google vinculado para
  // voltar depois da troca de senha — e é apagada, não promovida.
  const ref = db.doc("config/atendimento");
  const nossoUid = (await ref.get()).get("uid") as string | undefined;
  let uid: string | null = null;
  try {
    const existente = await auth.getUserByEmail(EMAIL_ATENDIMENTO);
    const soSenha = existente.providerData.every((p) => p.providerId === "password");
    if (existente.uid === nossoUid && soSenha) uid = existente.uid;
    else await auth.deleteUser(existente.uid);
  } catch (err) {
    if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
  }
  if (uid) {
    await auth.updateUser(uid, { password: senha, emailVerified: true, disabled: false });
  } else {
    // Criada pelo Admin SDK: o `beforeUserCreated` não roda, então não nasce
    // perfil em `users` (não aparece como sócio nem cai na limpeza de contas).
    uid = (
      await auth.createUser({
        email: EMAIL_ATENDIMENTO,
        password: senha,
        emailVerified: true,
        displayName: "Atendimento",
      })
    ).uid;
  }
  await auth.setCustomUserClaims(uid, { role: "atendente" });
  await auth.revokeRefreshTokens(uid);
  await ref.set(
    { uid, senhaTrocadaEm: FieldValue.serverTimestamp(), trocadaPor: chamador },
    { merge: true }
  );

  return { email: EMAIL_ATENDIMENTO, senha };
});
