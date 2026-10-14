import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { multiFactor, signOut } from "firebase/auth";
import { toast } from "sonner";
import { auth } from "./lib/firebase";
import { useAuth } from "./auth/AuthContext";
import { AtivarDuasEtapas } from "./auth/AtivarDuasEtapas";
import { IS_DEMO } from "./lib/demo";
import { Splash } from "./components/Splash";
import { primeiroNome } from "./lib/format";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Promotions } from "./pages/Promotions";
import { Menu } from "./pages/Menu";
import { Rewards } from "./pages/Rewards";
import { Plans } from "./pages/Plans";
import { Members } from "./pages/Members";
import { Team } from "./pages/Team";
import { Payments } from "./pages/Payments";
import { Pedidos } from "./pages/Pedidos";
import { Notifications } from "./pages/Notifications";
import { Settings } from "./pages/Settings";
import { Garcom } from "./pages/Garcom";

/** Quanto tempo a saudação fica na tela depois que o login resolve. */
const TEMPO_SAUDACAO = 1500;

function Protected({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, signInSecondFactor, loading } = useAuth();
  const [saudando, setSaudando] = useState(true);

  // A saudação segura a tela por um instante depois que o login resolve. Sem
  // isso ela pisca por 200ms e ninguém consegue ler — pior que não ter.
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => setSaudando(false), TEMPO_SAUDACAO);
    return () => clearTimeout(t);
  }, [loading]);

  // Só admin autenticado passa. Resto vai pro login (que mostra "Acesso
  // negado") — e vai direto, sem saudação: não é a pessoa certa.
  if (!loading && (!user || !isAdmin)) return <Navigate to="/login" replace />;

  if (loading || saudando)
    return <Splash nome={loading ? null : primeiroNome(user?.displayName)} />;

  // Admin sem segundo fator não vê o painel (o servidor recusa o token também).
  if (user && !IS_DEMO) {
    if (multiFactor(user).enrolledFactors.length === 0)
      return <AtivarDuasEtapas user={user} />;
    // Tem fator, mas esta sessão entrou sem ele: sai para pedir o código.
    if (!signInSecondFactor) {
      toast.error("Entre de novo com o código do autenticador.", { id: "mfa-relogin" });
      void signOut(auth);
      return <Splash nome={null} />;
    }
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/garcom" element={<Garcom />} />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/promocoes" element={<Promotions />} />
          <Route path="/cardapio" element={<Menu />} />
          <Route path="/premiacoes" element={<Rewards />} />
          <Route path="/planos" element={<Plans />} />
          <Route path="/membros" element={<Members />} />
          <Route path="/equipe" element={<Team />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/pagamentos" element={<Payments />} />
          <Route path="/notificacoes" element={<Notifications />} />
          <Route path="/configuracoes" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
