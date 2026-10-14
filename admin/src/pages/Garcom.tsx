import { useState } from "react";
import { where } from "firebase/firestore";
import { Navigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, LogOut } from "lucide-react";
import { functions } from "../lib/firebase";
import { useAuth } from "../auth/AuthContext";
import { Button, Spinner } from "../components/ui";
import { inputBase } from "../components/Modal";
import { PandaLogo } from "../components/PandaLogo";
import { primeiroNome } from "../lib/format";
import { demoBlock, IS_DEMO } from "../lib/demo";
import { useCollection } from "../lib/useCollection";
import type { Funcionario } from "../lib/types";

type Baixa = { premio: string; socio: string; atendente: string | null };

/** Nome escolhido fica no aparelho: no celular do garçom é sempre o mesmo. */
const CHAVE_NOME = "garcom:funcionarioId";
const lerNome = () => {
  try {
    return localStorage.getItem(CHAVE_NOME) ?? "";
  } catch {
    return "";
  }
};

/**
 * Tela do garçom, feita para o celular: o sócio mostra o código do prêmio na
 * mesa, o garçom digita aqui e já sabe o que entregar — sem o cliente ir ao
 * caixa. A conta de atendimento (role `atendente`, uma só para todos os
 * garçons) só vê esta tela; admin também pode usar. Quem atendeu sai da lista
 * da Equipe — é o que vai para o ranking e para o convite de gorjeta do sócio.
 * A baixa é `validateRedemption`, que confere tudo no servidor.
 */
export function Garcom() {
  const { user, isAdmin, isAtendente, signInSecondFactor, loading, logout } = useAuth();
  const [codigo, setCodigo] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [baixa, setBaixa] = useState<Baixa | null>(null);
  const [funcionarioId, setFuncionarioId] = useState(lerNome);
  const { data: equipe } = useCollection<Funcionario>("funcionarios", where("ativo", "==", true));
  const escolhido = equipe.find((f) => f.id === funcionarioId);

  if (loading) return <Spinner />;
  if (!user || (!isAdmin && !isAtendente)) return <Navigate to="/login?garcom" replace />;
  // Admin sem segundo fator nesta sessão: o painel (`Protected`) já trata.
  if (isAdmin && !signInSecondFactor && !IS_DEMO) return <Navigate to="/" replace />;

  async function validar(e: React.FormEvent) {
    e.preventDefault();
    if (demoBlock("Resgate não validado")) return;
    if (!escolhido) return setErro("Toque no seu nome antes de validar.");
    setBusy(true);
    setErro(null);
    try {
      const res = await httpsCallable<{ codigo: string; funcionarioId: string }, Baixa>(
        functions,
        "validateRedemption"
      )({ codigo, funcionarioId: escolhido.id });
      setBaixa(res.data);
      setCodigo("");
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-marca p-5">
      <header className="mb-5 flex items-center gap-3 text-sobre-marca">
        <PandaLogo size={40} />
        <div className="flex-1">
          <div className="rotulo text-sobre-marca!">Atendimento</div>
          <div className="font-semibold">{primeiroNome(user.displayName) ?? user.email}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => logout()} aria-label="Sair">
          <LogOut size={18} />
        </Button>
      </header>

      <div className="mx-auto w-full max-w-sm rounded-3xl bg-superficie p-6 shadow-xl">
        {baixa ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 size={56} className="text-ok" />
            <div className="text-sm text-tinta-2">Código válido. Entregar:</div>
            <div className="display text-2xl leading-tight">{baixa.premio || "Prêmio"}</div>
            {baixa.socio && <div className="text-tinta-2">para {baixa.socio}</div>}
            {baixa.atendente && (
              <div className="text-xs text-tinta-3">Atendido por {baixa.atendente}</div>
            )}
            <Button className="mt-3 w-full" onClick={() => setBaixa(null)}>
              Validar outro código
            </Button>
          </div>
        ) : (
          <form onSubmit={validar} className="flex flex-col gap-3">
            <fieldset>
              <legend className="mb-2 text-center text-sm text-tinta-2">Quem está atendendo?</legend>
              <div className="flex flex-wrap justify-center gap-2">
                {equipe.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={f.id === funcionarioId}
                    onClick={() => {
                      setFuncionarioId(f.id);
                      setErro(null);
                      try {
                        localStorage.setItem(CHAVE_NOME, f.id);
                      } catch {
                        // Sem armazenamento: só não lembra o nome na próxima vez.
                      }
                    }}
                    className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${
                      f.id === funcionarioId
                        ? "border-marca bg-marca text-sobre-marca"
                        : "border-linha bg-superficie text-tinta"
                    }`}
                  >
                    {f.nome}
                  </button>
                ))}
                {equipe.length === 0 && (
                  <p className="text-center text-sm text-tinta-3">
                    Ninguém na Equipe ainda. Peça ao dono para cadastrar no painel.
                  </p>
                )}
              </div>
            </fieldset>
            <label htmlFor="codigo" className="text-center text-sm text-tinta-2">
              Digite o código que aparece no app do cliente.
            </label>
            <input
              id="codigo"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              placeholder="Ex.: A1B2C3D4E5F6"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              className={`${inputBase} text-center font-mono text-xl tracking-[0.2em]`}
              autoFocus
              required
            />
            {erro && (
              <div role="alert" className="rounded-2xl border border-erro/30 bg-erro/8 p-3 text-sm text-erro-tinta">
                {erro}
              </div>
            )}
            <Button type="submit" disabled={busy || !escolhido || codigo.length !== 12}>
              {busy ? "Validando..." : "Validar"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
