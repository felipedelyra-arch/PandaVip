import { HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { auth, db } from "./admin";

/**
 * Exige App Check nas chamadas? Ligado por variável de ambiente, e desligado
 * por padrão de propósito.
 *
 * O App Check está instalado nos TRÊS clientes: Android (Play Integrity) e iOS
 * (App Attest) em `app/lib/main.dart`, e web (reCAPTCHA v3) tanto no build web
 * do app quanto no painel (`admin/src/lib/firebase.ts`). Os dois clientes web
 * só ativam quando a chave de site do reCAPTCHA é passada no build — sem ela
 * se comportam como antes, sem App Check.
 *
 * Continua desligado por padrão porque falta o passo que não é código: criar a
 * chave. Enquanto qualquer cliente legítimo não mandar token, ligar isto o
 * derruba — e era o painel do dono o que segurava o controle desligado para
 * todo mundo.
 *
 * Sequência para ligar (nesta ordem, e não em outra):
 *
 *   1. Firebase Console > App Check > registrar o app **Web** com reCAPTCHA v3
 *      e copiar a chave de site;
 *   2. `VITE_RECAPTCHA_SITE_KEY=` no `.env` do painel e
 *      `--dart-define=RECAPTCHA_SITE_KEY=` no build web do app; publicar os
 *      dois e conferir no console que as três plataformas aparecem enviando
 *      token (App Check > Métricas mostra "verificadas" vs "não verificadas");
 *   3. só então `REQUER_APP_CHECK=true` nas functions;
 *   4. por último, impor no console, que fecha também o acesso direto ao
 *      Firestore e ao Storage pelos SDKs.
 *
 * Pular o passo 2 é o que derruba o app inteiro em produção. A métrica do
 * passo 2 é a prova de que o 3 e o 4 são seguros.
 */
const REQUER_APP_CHECK = process.env.REQUER_APP_CHECK === "true";

/**
 * Recusa a chamada que não trouxe token de App Check válido.
 *
 * É a peça que o limite de chamada (`lib/rateLimit.ts`) não cobre: o limite
 * segura o estrago por conta, isto aqui segura quem cria contas em série a
 * partir de um script com a chave de API copiada do APK.
 */
export function requireAppCheck(req: CallableRequest): void {
  if (!REQUER_APP_CHECK) return;
  if (!req.app) {
    throw new HttpsError(
      "failed-precondition",
      "Chamada sem verificação de app. Atualize o aplicativo."
    );
  }
}

/** Garante que o chamador está autenticado; retorna o uid. */
export function requireAuth(req: CallableRequest): string {
  requireAppCheck(req);
  if (!req.auth) {
    throw new HttpsError("unauthenticated", "Precisa estar autenticado.");
  }
  return req.auth.uid;
}

/**
 * Como [requireAuth], mas recusa conta de e-mail e senha que ainda não
 * confirmou o e-mail.
 *
 * A tela de verificação (`app/lib/features/auth/verificar_email_screen.dart`)
 * só segura quem passa pelo app. Quem chama a API direto, com a chave copiada
 * do APK, criava conta com e-mail inventado e já mandava comanda pra cozinha.
 * Critério próximo ao do app (`precisaVerificarEmailProvider`): Google e Apple
 * entregam o e-mail já confirmado pelo provedor. Diferença: aqui vale o
 * provedor do login ATUAL; o app segura quem tem senha vinculada mesmo
 * entrando pelo Google. O servidor é o lado mais permissivo, então não barra
 * ninguém que o app deixa passar.
 */
export function requireVerified(req: CallableRequest): string {
  const uid = requireAuth(req);
  const token = req.auth!.token;
  if (token.firebase?.sign_in_provider === "password" && token.email_verified !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Confirme seu e-mail para continuar. O link está na sua caixa de entrada."
    );
  }
  return uid;
}

/**
 * Pagar (assinar, pedir) é só para 18+: menor de idade não contrata sem
 * representante, e não há fluxo de autorização de responsável (decisão do
 * dono, 13/10/2026). 14 a 17 anos usam a conta grátis.
 *
 * `nascimento` é Timestamp no perfil. Ausente também barra: a regra de idade
 * das rules só vale quando o campo é enviado.
 */
export function exigirMaiorDeIdade(nascimento: unknown, agora = new Date()): void {
  if (!dataDe(nascimento)) {
    throw new HttpsError("failed-precondition", "Informe sua data de nascimento no perfil para continuar.");
  }
  if (!maiorDeIdade(nascimento, agora)) {
    throw new HttpsError("failed-precondition", "Assinaturas e pedidos são só para maiores de 18 anos.");
  }
}

const dataDe = (nascimento: unknown) => (nascimento as { toDate?: () => Date } | null | undefined)?.toDate?.();

/** 18 anos completos? Sem `nascimento` é `false` (também vale para marketing). */
export function maiorDeIdade(nascimento: unknown, agora = new Date()): boolean {
  const nasc = dataDe(nascimento);
  if (!nasc) return false;
  const dezoito = new Date(nasc);
  dezoito.setUTCFullYear(dezoito.getUTCFullYear() + 18);
  return dezoito <= agora;
}

/** [exigirMaiorDeIdade] lendo o perfil do [uid]. */
export async function exigirMaiorDeIdadeDe(uid: string): Promise<void> {
  exigirMaiorDeIdade((await db.doc(`users/${uid}`).get()).get("nascimento"));
}

/**
 * Id vindo do cliente, antes de virar caminho no Firestore. Sem isto, um
 * `"abc/cupons/x"` montava caminho de outro documento, e um número estourava
 * como erro 500.
 */
export const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

export function idValido(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !ID_VALIDO.test(valor)) {
    throw new HttpsError("invalid-argument", `${campo} inválido.`);
  }
  return valor;
}

/**
 * Garante que o chamador é admin (custom claim role=admin) e que entrou com
 * segundo fator (TOTP): o token precisa trazer `firebase.sign_in_second_factor`.
 *
 * A claim sozinha não basta: o token de quem PERDEU o admin continua assinado
 * por até 1 hora. `setAdminRole` revoga a sessão de quem é rebaixado, e o
 * `checkRevoked` aqui é o que faz essa revogação valer na hora — sem ele, uma
 * conta de funcionário comprometida seguiria promovendo outras contas.
 */
export async function requireAdmin(req: CallableRequest): Promise<string> {
  const uid = requireAuth(req);
  if (req.auth?.token?.role !== "admin") {
    throw new HttpsError("permission-denied", "Acesso restrito a administradores.");
  }
  if (!req.auth?.token?.firebase?.sign_in_second_factor) {
    throw new HttpsError("permission-denied", "Ative a verificação em duas etapas para usar o painel.");
  }
  await exigirSessaoViva(req);
  return uid;
}

async function exigirSessaoViva(req: CallableRequest): Promise<void> {
  const idToken = (req.rawRequest.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  try {
    await auth.verifyIdToken(idToken, true);
  } catch {
    throw new HttpsError("unauthenticated", "Sua sessão foi encerrada. Entre de novo.");
  }
}

/**
 * Conta de atendimento (ver `novaSenhaAtendimento`). Domínio `.invalid`
 * (RFC 2606) de propósito: ninguém recebe e-mail nele, então "esqueci a senha"
 * não vira porta para tomar a conta. O cadastro pelo app com este domínio é
 * recusado no `onAuthUserCreate`.
 */
export const DOMINIO_RESERVADO = "@pandavip.invalid";
export const EMAIL_ATENDIMENTO = `atendimento${DOMINIO_RESERVADO}`;

/**
 * Admin (pelas regras de [requireAdmin], com duas etapas) ou atendente.
 *
 * Atendente é a conta de atendimento (`novaSenhaAtendimento`): uma conta da
 * casa, logada no celular dos garçons, que dá baixa no código de resgate na
 * mesa. Não pede segundo fator (o dono quer duas etapas só no painel admin),
 * e por isso o papel só alcança o que chama esta função — hoje, só
 * `validateRedemption`. Nas rules ela é só mais uma conta logada (lê a Equipe
 * para a lista de nomes). Senha trocada cai na hora pelo `checkRevoked`.
 */
export async function requireEquipe(req: CallableRequest): Promise<string> {
  if (req.auth?.token?.role === "admin") return requireAdmin(req);
  const uid = requireVerified(req);
  // Só a conta da casa: claim `atendente` que tenha sobrado numa conta pessoal
  // (garçom liberado por UID, antes de 14/10) não passa mais.
  if (req.auth?.token?.role !== "atendente" || req.auth.token.email !== EMAIL_ATENDIMENTO) {
    throw new HttpsError("permission-denied", "Acesso restrito à equipe do restaurante.");
  }
  await exigirSessaoViva(req);
  return uid;
}
