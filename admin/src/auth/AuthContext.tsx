import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "../lib/firebase";
import { IS_DEMO, demoAdminUser } from "../lib/demo";

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  /** Garçom: só abre a tela `/garcom` (validar código de resgate). */
  isAtendente: boolean;
  /** O token atual foi emitido com segundo fator (TOTP). */
  signInSecondFactor: boolean;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>({
  user: null,
  isAdmin: false,
  isAtendente: false,
  signInSecondFactor: false,
  loading: true,
  logout: async () => {},
});

/** Quem está logado sem admin: a tela de acesso negado libera quase na hora. */
const RECONFERIR_SEM_ADMIN = 5_000;
/** Quem é admin: perder o acesso tira a pessoa do painel sem esperar o token vencer. */
const RECONFERIR_ADMIN = 5 * 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(
    IS_DEMO ? (demoAdminUser as unknown as User) : null
  );
  const [isAdmin, setIsAdmin] = useState(IS_DEMO);
  const [isAtendente, setIsAtendente] = useState(false);
  const [signInSecondFactor, setSignInSecondFactor] = useState(IS_DEMO);
  const [loading, setLoading] = useState(!IS_DEMO);

  useEffect(() => {
    if (IS_DEMO) return; // modo demo: admin fake, sem Firebase
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Lê a custom claim role=admin do token (setada por Cloud Function).
        // Se falhar (rede do celular, App Check), cai no login em vez de
        // deixar o loading preso para sempre.
        try {
          const token = await u.getIdTokenResult(true);
          setIsAdmin(token.claims.role === "admin");
          setIsAtendente(token.claims.role === "atendente");
          setSignInSecondFactor(!!token.signInSecondFactor);
        } catch (err) {
          console.error("[painel] não deu pra ler o token:", err);
          setIsAdmin(false);
          setIsAtendente(false);
          setSignInSecondFactor(false);
        }
      } else {
        setIsAdmin(false);
        setIsAtendente(false);
        setSignInSecondFactor(false);
      }
      setLoading(false);
    });
  }, []);

  // A permissão de admin mora numa claim do token, e o token só era relido no
  // login. Conceder admin deixava a pessoa presa em "Acesso negado" até ela
  // recarregar a página; revogar deixava quem perdeu o acesso navegando até o
  // token vencer (1 h). Agora a claim é reconferida de tempos em tempos e ao
  // voltar para a aba — só com a aba visível. Falha de rede mantém o estado.
  useEffect(() => {
    if (IS_DEMO || !user) return;
    let vivo = true;

    const conferir = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const token = await user.getIdTokenResult(true);
        if (vivo) {
          setIsAdmin(token.claims.role === "admin");
          setIsAtendente(token.claims.role === "atendente");
          setSignInSecondFactor(!!token.signInSecondFactor);
        }
      } catch {
        // Sem rede: fica como está e tenta de novo na próxima volta.
      }
    };

    const timer = window.setInterval(
      conferir,
      isAdmin ? RECONFERIR_ADMIN : RECONFERIR_SEM_ADMIN
    );
    document.addEventListener("visibilitychange", conferir);
    return () => {
      vivo = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", conferir);
    };
  }, [user, isAdmin]);

  return (
    <AuthCtx.Provider
      value={{ user, isAdmin, isAtendente, signInSecondFactor, loading, logout: () => signOut(auth) }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthCtx);
}
