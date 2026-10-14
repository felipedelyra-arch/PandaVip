import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Megaphone,
  Gift,
  CreditCard,
  Users,
  HandCoins,
  Receipt,
  Bell,
  Settings,
  LogOut,
  Moon,
  Sun,
  MoreHorizontal,
  RefreshCw,
  UtensilsCrossed,
  Bike,
  X,
  Info,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { PandaLogo } from "./PandaLogo";
import { ErrorBoundary } from "./ErrorBoundary";
import { useAuth } from "../auth/AuthContext";
import { IS_DEMO } from "../lib/demo";
import { useNovaVersao } from "../lib/novaVersao";

interface ItemNav {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  end?: boolean;
  /** Cabeçalho do grupo que começa neste item. */
  grupo?: string;
}

const nav: ItemNav[] = [
  { to: "/", label: "Início", icon: LayoutDashboard, end: true },
  { to: "/promocoes", label: "Promoções", icon: Megaphone, grupo: "O que o cliente vê" },
  { to: "/cardapio", label: "Cardápio", icon: UtensilsCrossed },
  { to: "/pedidos", label: "Pedidos", icon: Bike },
  { to: "/premiacoes", label: "Premiações", icon: Gift },
  { to: "/notificacoes", label: "Notificações", icon: Bell },
  { to: "/membros", label: "Membros", icon: Users, grupo: "Clube" },
  { to: "/equipe", label: "Equipe", icon: HandCoins },
  { to: "/planos", label: "Plano", icon: CreditCard },
  { to: "/pagamentos", label: "Pagamentos", icon: Receipt },
  { to: "/configuracoes", label: "Configurações", icon: Settings, grupo: "Ajustes" },
];

/**
 * Barra de baixo do celular: o que o dono abre em pé no salão, no meio do
 * serviço. Escolhido por frequência de uso, não pela ordem do menu lateral —
 * validar resgate acontece todo dia, mexer no cardápio uma vez por mês.
 */
const rotasCelular = ["/", "/promocoes", "/premiacoes", "/membros"];
const navCelular = rotasCelular.map((r) => nav.find((n) => n.to === r)!);
const navGaveta = nav.filter((n) => !rotasCelular.includes(n.to));

function estiloItem(isActive: boolean) {
  // O ativo é uma ficha clara com barra laranja na borda, não um bloco laranja
  // cheio: com nove itens, um bloco saturado no meio da lista puxa o olho pra
  // longe do conteúdo da página.
  return `relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
    isActive
      ? "bg-superficie-2 font-semibold text-tinta before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-marca"
      : "font-medium text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
  }`;
}

export function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [dark, setDark] = useState(
    () => localStorage.getItem("panda-theme") === "dark"
  );
  const [gaveta, setGaveta] = useState(false);
  const novaVersao = useNovaVersao();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("panda-theme", dark ? "dark" : "light");
  }, [dark]);

  // Trocar de tela fecha a gaveta — senão ela cobre o destino recém-aberto.
  useEffect(() => setGaveta(false), [pathname]);

  // Versão nova publicada com esta aba aberta: a troca de tela é o momento
  // seguro de recarregar, porque a tela anterior já foi deixada e nada que
  // estava sendo digitado se perde. O aviso no topo deixa atualizar antes.
  const rotaAnterior = useRef(pathname);
  useEffect(() => {
    if (rotaAnterior.current === pathname) return;
    rotaAnterior.current = pathname;
    if (novaVersao) window.location.reload();
  }, [pathname, novaVersao]);

  const atual = nav.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));

  async function sair() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="flex min-h-full md:h-screen">
      {/* ---- sidebar (tablet pra cima) ---- */}
      <aside className="hidden w-[15.5rem] shrink-0 flex-col border-r border-linha bg-superficie p-3 md:flex">
        <div className="flex justify-center py-4">
          <PandaLogo size={88} />
        </div>
        <nav className="mt-4 flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon, end, grupo }) => (
            <div key={to}>
              {grupo && <div className="rotulo mt-5 mb-1.5 px-3">{grupo}</div>}
              <NavLink to={to} end={end} className={({ isActive }) => estiloItem(isActive)}>
                <Icon size={18} />
                {label}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="mt-3 flex flex-col gap-0.5 border-t border-linha pt-3">
          <BotaoTema dark={dark} onToggle={() => setDark((d) => !d)} />
          <BotaoSair onSair={sair} />
        </div>
      </aside>

      {/* ---- topo do celular ---- */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center gap-3 border-b border-linha bg-superficie/90 px-4 backdrop-blur md:hidden">
        <PandaLogo size={44} />
        <span className="display text-lg">{atual?.label ?? "Painel"}</span>
      </header>

      <main className="flex-1 overflow-y-auto bg-fundo px-4 pb-28 pt-20 md:px-8 md:pb-10 md:pt-8">
        <div className="mx-auto w-full max-w-6xl">
          {IS_DEMO && (
            <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-marca/25 bg-marca/8 px-4 py-2.5 text-sm text-marca-tinta md:mb-6">
              <Info size={16} aria-hidden className="shrink-0" />
              <span>
                <strong className="font-semibold">Modo demonstração</strong> — dados
                fictícios. Salvar, excluir e enviar estão desligados.
              </span>
            </div>
          )}
          {novaVersao && (
            <div
              role="status"
              className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-marca/25 bg-marca/8 px-4 py-2.5 text-sm text-marca-tinta md:mb-6"
            >
              <RefreshCw size={16} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <strong className="font-semibold">Saiu uma versão nova do painel.</strong>{" "}
                Ela entra sozinha quando você trocar de tela.
              </span>
              <button
                onClick={() => window.location.reload()}
                className="font-semibold underline underline-offset-2"
              >
                Atualizar agora
              </button>
            </div>
          )}
          {/* key: trocar de rota remonta o boundary e limpa o erro da tela anterior. */}
          <ErrorBoundary key={pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      {/* ---- barra de baixo (celular) ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-linha bg-superficie/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {navCelular.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
                isActive ? "text-marca-tinta" : "text-tinta-3"
              }`
            }
          >
            <Icon size={21} />
            {label}
          </NavLink>
        ))}
        <button
          onClick={() => setGaveta(true)}
          className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
            navGaveta.some((n) => pathname.startsWith(n.to))
              ? "text-marca-tinta"
              : "text-tinta-3"
          }`}
        >
          <MoreHorizontal size={21} />
          Mais
        </button>
      </nav>

      {/* ---- gaveta "Mais" (celular) ---- */}
      {gaveta && (
        <div
          className="fixed inset-0 z-40 flex items-end bg-black/45 backdrop-blur-[2px] md:hidden"
          onClick={() => setGaveta(false)}
        >
          <div
            className="w-full rounded-t-3xl border-t border-linha bg-superficie p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="display text-lg">Mais</span>
              <button
                onClick={() => setGaveta(false)}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-tinta-3 hover:bg-superficie-2"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {navGaveta.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={({ isActive }) => estiloItem(isActive)}>
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
              <div className="my-2 h-px bg-linha" />
              <BotaoTema dark={dark} onToggle={() => setDark((d) => !d)} />
              <BotaoSair onSair={sair} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BotaoTema({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-tinta-2 transition-colors hover:bg-superficie-2 hover:text-tinta"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
      {dark ? "Tema claro" : "Tema escuro"}
    </button>
  );
}

function BotaoSair({ onSair }: { onSair: () => void }) {
  return (
    <button
      onClick={onSair}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-tinta-2 transition-colors hover:bg-erro/10 hover:text-erro-tinta"
    >
      <LogOut size={18} />
      Sair
    </button>
  );
}
