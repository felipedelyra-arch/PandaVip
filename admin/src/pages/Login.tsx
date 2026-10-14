import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { FirebaseError } from "firebase/app";
import {
  getMultiFactorResolver,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  TotpMultiFactorGenerator,
  type MultiFactorResolver,
} from "firebase/auth";
import { toast } from "sonner";
import { auth } from "../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { PandaLogo } from "../components/PandaLogo";
import { Button } from "../components/ui";
import { inputBase } from "../components/Modal";

const codigo = (e: unknown) => (e instanceof FirebaseError ? e.code : "");

/** Conta de atendimento, a mesma para todos os garçons (ver `novaSenhaAtendimento`). */
const EMAIL_ATENDIMENTO = "atendimento@pandavip.invalid";

export function Login() {
  const { user, isAdmin, isAtendente, loading, logout } = useAuth();
  const [params] = useSearchParams();
  // Garçom: só a senha. Quem chega pela tela /garcom já cai neste modo.
  const [garcom, setGarcom] = useState(params.has("garcom"));
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  // Segundo fator pendente: preenchido quando o login pede o código TOTP.
  const [mfa, setMfa] = useState<{ resolver: MultiFactorResolver; uid: string } | null>(null);
  const [codigoMfa, setCodigoMfa] = useState("");

  /** Se o erro pede segundo fator, abre a tela do código; devolve true se tratou. */
  function pedirSegundoFator(err: unknown) {
    if (codigo(err) !== "auth/multi-factor-auth-required") return false;
    const resolver = getMultiFactorResolver(auth, err as FirebaseError & { customData: never });
    const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (!hint) {
      toast.error("Esta conta usa um segundo fator que o painel não suporta.");
      return true;
    }
    setMfa({ resolver, uid: hint.uid });
    return true;
  }

  async function confirmarCodigo(e: React.FormEvent) {
    e.preventDefault();
    if (!mfa) return;
    setBusy(true);
    try {
      await mfa.resolver.resolveSignIn(
        TotpMultiFactorGenerator.assertionForSignIn(mfa.uid, codigoMfa.trim())
      );
    } catch (err) {
      const c = codigo(err);
      toast.error(
        c === "auth/invalid-verification-code"
          ? "Código incorreto. Confira o app autenticador."
          : c === "auth/too-many-requests"
            ? "Muitas tentativas. Espere alguns minutos e tente de novo."
            : "Não deu pra confirmar o código. Volte e entre de novo."
      );
    } finally {
      setBusy(false);
    }
  }

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, garcom ? EMAIL_ATENDIMENTO : email.trim(), senha);
    } catch (err) {
      if (pedirSegundoFator(err)) return;
      toast.error(
        codigo(err) === "auth/too-many-requests"
          ? "Muitas tentativas. Espere alguns minutos e tente de novo."
          : garcom
            ? "Senha incorreta. Peça a senha nova ao gerente."
            : "E-mail ou senha incorretos. Se você entra com o Google, use o botão do Google."
      );
    } finally {
      setBusy(false);
    }
  }

  // Conta criada pelo Google não tem senha: sem este botão o dono que entrou
  // assim no app não tinha como acessar o painel, e "Esqueci a senha" não
  // manda nada para conta sem senha.
  async function entrarComGoogle() {
    setBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      if (pedirSegundoFator(err)) return;
      const c = codigo(err);
      if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return;
      toast.error(
        c === "auth/popup-blocked"
          ? "O navegador bloqueou a janela do Google. Libere pop-ups para este site e tente de novo."
          : "Não deu pra entrar com o Google. Tente de novo."
      );
    } finally {
      setBusy(false);
    }
  }

  async function recuperar() {
    const alvo = email.trim();
    if (!alvo) return toast.error("Digite seu e-mail no campo acima.");
    try {
      await sendPasswordResetEmail(auth, alvo);
      // Com a proteção contra enumeração de e-mail ligada, o Firebase responde
      // "ok" mesmo quando não manda nada (e-mail sem cadastro, ou conta que só
      // entra com Google). A mensagem não pode prometer que o e-mail saiu.
      toast.success(
        "Se esse e-mail tiver acesso com senha, enviamos um link pra criar uma nova. Pode levar alguns minutos: confira também o spam. Se você entra com o Google, use o botão do Google.",
        { duration: 12_000 }
      );
    } catch (err) {
      const c = codigo(err);
      toast.error(
        c === "auth/invalid-email"
          ? "E-mail inválido."
          : c === "auth/too-many-requests"
            ? "Muitas tentativas. Espere alguns minutos e tente de novo."
            : "Não deu pra enviar o e-mail agora. Tente de novo."
      );
    }
  }

  // Logado mas não-admin => bloqueia.
  const acessoNegado = !loading && user && !isAdmin && !isAtendente;

  // Login resolvido: sai do formulário. Sem isto o admin autentica e fica
  // olhando a mesma tela — nada mais nesta rota tira ele daqui.
  if (!loading && user && isAdmin) return <Navigate to="/" replace />;
  // Garçom vai direto para a única tela dele.
  if (!loading && user && isAtendente) return <Navigate to="/garcom" replace />;

  return (
    // min-h + centro: no celular o teclado abrindo encolhe a viewport e o
    // h-screen cortava o botão Entrar.
    <div className="flex min-h-full items-center justify-center bg-marca p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center text-sobre-marca">
          <PandaLogo size={104} />
          <div className="rotulo mt-5 text-sobre-marca!">Painel do restaurante</div>
          <h1 className="display mt-2 text-[30px] leading-none">PandaVip</h1>
          <p className="mt-2.5 text-sm">Acesso restrito à equipe Tio Panda.</p>
        </div>

        <div className="rounded-3xl bg-superficie p-6 shadow-xl">
        {acessoNegado ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-erro/30 bg-erro/8 p-4 text-sm text-erro-tinta">
              <strong className="font-semibold">Acesso negado.</strong> A conta{" "}
              {user.email ?? ""} existe, mas não é administradora. Peça a quem já
              tem acesso para liberar em Configurações.
            </div>
            {/* Sem isto, quem entrou com a conta errada ficava preso aqui. */}
            <Button variant="outline" onClick={() => logout()}>
              Sair e usar outra conta
            </Button>
          </div>
        ) : mfa ? (
          <form onSubmit={confirmarCodigo} className="flex flex-col gap-3">
            <p className="text-center text-sm text-tinta-2">
              Digite o código de 6 dígitos do seu app autenticador.
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="Código de 6 dígitos"
              aria-label="Código de 6 dígitos"
              value={codigoMfa}
              onChange={(e) => setCodigoMfa(e.target.value.replace(/\D/g, ""))}
              className={inputBase}
              autoFocus
              required
            />
            <Button type="submit" disabled={busy || codigoMfa.length !== 6}>
              {busy ? "Confirmando..." : "Confirmar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMfa(null);
                setCodigoMfa("");
              }}
            >
              Voltar
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <form onSubmit={entrar} className="flex flex-col gap-3">
              {garcom ? (
                <p className="text-center text-sm text-tinta-2">
                  Garçom: digite a senha da equipe que o gerente passou.
                </p>
              ) : (
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="E-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputBase}
                  required
                />
              )}
              <input
                type="password"
                autoComplete="current-password"
                placeholder={garcom ? "Senha da equipe" : "Senha"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className={inputBase}
                autoFocus={garcom}
                required
              />
              <Button type="submit" disabled={busy}>
                {busy ? "Entrando..." : "Entrar"}
              </Button>
            </form>
            {garcom ? (
              <button
                type="button"
                onClick={() => setGarcom(false)}
                className="mt-1 self-center text-sm font-medium text-tinta-3 transition-colors hover:text-marca-tinta"
              >
                Sou administrador
              </button>
            ) : (
              <>
                <div className="flex items-center gap-3 text-xs text-tinta-3">
                  <span className="h-px flex-1 bg-current opacity-30" />
                  ou
                  <span className="h-px flex-1 bg-current opacity-30" />
                </div>
                <Button type="button" variant="outline" onClick={entrarComGoogle} disabled={busy}>
                  Entrar com Google
                </Button>
                <Button type="button" variant="outline" onClick={() => setGarcom(true)}>
                  Sou garçom
                </Button>
                <button
                  type="button"
                  onClick={recuperar}
                  className="mt-1 self-center text-sm font-medium text-tinta-3 transition-colors hover:text-marca-tinta"
                >
                  Esqueci a senha
                </button>
              </>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
