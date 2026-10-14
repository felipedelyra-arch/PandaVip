import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { functions } from "../lib/firebase";
import { useCollection } from "../lib/useCollection";
import type { AppUser, Funcionario } from "../lib/types";
import { Modal, Field, inputBase } from "./Modal";
import { Button } from "./ui";
import { brl } from "../lib/format";
import { demoBlock } from "../lib/demo";

/**
 * Lançamento manual de conta de salão.
 *
 * A ponte enquanto o PDV não envia sozinho: sem isto, mesa, atendente e itens
 * ficam vazios em produção e o sócio nunca vê onde gastou. Grava pela mesma
 * Cloud Function que o PDV vai usar, então quando a integração entrar, esta
 * tela continua valendo pro caso perdido (comanda que não subiu, ajuste).
 */

interface Linha {
  nome: string;
  quantidade: string;
  preco: string;
}

const linhaVazia: Linha = { nome: "", quantidade: "1", preco: "" };

/** `datetime-local` quer 'YYYY-MM-DDTHH:mm' na hora local, sem fuso. */
function agoraLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function LancarConsumo({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: users } = useCollection<AppUser>("users");
  const { data: funcionarios } = useCollection<Funcionario>("funcionarios");

  const [userId, setUserId] = useState("");
  const [comandaId, setComandaId] = useState("");
  const [mesa, setMesa] = useState("");
  const [atendente, setAtendente] = useState("");
  const [metodo, setMetodo] = useState("cartao");
  const [data, setData] = useState(agoraLocal);
  const [itens, setItens] = useState<Linha[]>([{ ...linhaVazia }]);
  const [valorManual, setValorManual] = useState("");
  const [desconto, setDesconto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const socios = useMemo(
    () =>
      [...users].sort((a, b) =>
        (a.nome || a.email || "").localeCompare(b.nome || b.email || "")
      ),
    [users]
  );

  // Soma das linhas. Vira o total, a menos que alguém digite outro valor —
  // conta real tem taxa, couvert e arredondamento que não estão nos itens.
  const somaItens = useMemo(
    () =>
      itens.reduce(
        (a, i) => a + (Number(i.quantidade || 0) || 0) * (Number(i.preco.replace(",", ".")) || 0),
        0
      ),
    [itens]
  );

  const total = valorManual !== "" ? Number(valorManual.replace(",", ".")) || 0 : somaItens;

  function limpar() {
    setUserId("");
    setComandaId("");
    setMesa("");
    setAtendente("");
    setMetodo("cartao");
    setData(agoraLocal());
    setItens([{ ...linhaVazia }]);
    setValorManual("");
    setDesconto("");
  }

  function mudarLinha(i: number, campo: keyof Linha, valor: string) {
    setItens((atual) => atual.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
  }

  async function salvar() {
    if (!userId) return toast.error("Escolha o sócio.");
    if (total <= 0) return toast.error("O valor precisa ser maior que zero.");
    if (demoBlock("Consumo não lançado")) return onClose();

    setSalvando(true);
    try {
      const chamar = httpsCallable(functions, "lancarConsumo");
      await chamar({
        uid: userId,
        comandaId: comandaId.trim() || undefined,
        mesa: mesa.trim() || undefined,
        atendente: atendente.trim() || undefined,
        metodo,
        valor: total,
        // Vazio não é zero: sem valor informado, o backend calcula pelo
        // percentual do plano. Mandar 0 aqui apagaria esse cálculo.
        descontoClube: desconto.trim() === "" ? undefined : desconto.replace(",", "."),
        data: data ? new Date(data).toISOString() : undefined,
        itens: itens
          .filter((l) => l.nome.trim())
          .map((l) => ({
            nome: l.nome.trim(),
            quantidade: Number(l.quantidade) || 1,
            preco: l.preco.replace(",", "."),
          })),
      });
      toast.success("Consumo lançado.");
      limpar();
      onClose();
    } catch (e) {
      // A function devolve mensagem pronta pros casos previstos (sócio não
      // encontrado, comanda repetida) — mostrar ela é melhor que um genérico.
      toast.error((e as Error).message || "Não deu pra lançar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Lançar consumo do salão">
      <Field
        label="Sócio"
        hint="Quem consumiu. É o que liga a conta ao app do cliente."
      >
        <select className={inputBase} value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Escolha…</option>
          {socios.map((u) => (
            <option key={u.uid} value={u.uid}>
              {u.nome || u.email}
              {u.codigoSocio ? ` · ${u.codigoSocio}` : ""}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Mesa" hint="Opcional.">
          <input className={inputBase} value={mesa} onChange={(e) => setMesa(e.target.value)} placeholder="12" />
        </Field>
        <Field label="Atendente" hint="Opcional.">
          <input
            className={inputBase}
            list="lista-atendentes"
            value={atendente}
            onChange={(e) => setAtendente(e.target.value)}
            placeholder="Juliana"
          />
          <datalist id="lista-atendentes">
            {funcionarios.filter((f) => f.ativo).map((f) => (
              <option key={f.id} value={f.nome} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Quando" hint="Padrão: agora.">
          <input type="datetime-local" className={inputBase} value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
        <Field label="Forma de pagamento">
          <select className={inputBase} value={metodo} onChange={(e) => setMetodo(e.target.value)}>
            <option value="cartao">Cartão</option>
            <option value="pix">Pix</option>
            <option value="dinheiro">Dinheiro</option>
          </select>
        </Field>
      </div>

      <Field
        label="Nº da comanda ou nota"
        hint="Opcional, mas é o que impede lançar a mesma conta duas vezes."
      >
        <input className={inputBase} value={comandaId} onChange={(e) => setComandaId(e.target.value)} placeholder="00841" />
      </Field>

      <span className="mb-1.5 block text-[13px] font-semibold">Itens</span>
      <span className="mb-2 block text-xs text-tinta-3">
        É o que responde "onde eu gastei" no app do sócio. Pode deixar vazio e
        informar só o total.
      </span>
      <div className="mb-4 space-y-2">
        {itens.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_3.5rem_5.5rem_2.25rem] items-center gap-2">
            <input
              className={inputBase}
              value={l.nome}
              onChange={(e) => mudarLinha(i, "nome", e.target.value)}
              placeholder="Combinado especial"
            />
            <input
              className={inputBase}
              inputMode="numeric"
              value={l.quantidade}
              onChange={(e) => mudarLinha(i, "quantidade", e.target.value)}
              aria-label="Quantidade"
            />
            <input
              className={inputBase}
              inputMode="decimal"
              value={l.preco}
              onChange={(e) => mudarLinha(i, "preco", e.target.value)}
              placeholder="89,90"
              aria-label="Preço unitário"
            />
            <button
              type="button"
              onClick={() => setItens((a) => (a.length === 1 ? [{ ...linhaVazia }] : a.filter((_, idx) => idx !== i)))}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-tinta-3 transition-colors hover:bg-superficie-2 hover:text-erro"
              aria-label="Remover item"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <Button variant="outline" onClick={() => setItens((a) => [...a, { ...linhaVazia }])}>
          <Plus size={16} /> Adicionar item
        </Button>
      </div>

      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field
          label="Total da conta (R$)"
          hint={somaItens > 0 ? `Soma dos itens: ${brl(somaItens)}. Deixe vazio pra usar ela.` : "Obrigatório."}
        >
          <input
            className={inputBase}
            inputMode="decimal"
            value={valorManual}
            onChange={(e) => setValorManual(e.target.value)}
            placeholder={somaItens > 0 ? somaItens.toFixed(2).replace(".", ",") : "143,82"}
          />
        </Field>
        <Field
          label="Desconto do clube (R$)"
          hint="Vazio = calcula pelo percentual do plano."
        >
          <input
            className={inputBase}
            inputMode="decimal"
            value={desconto}
            onChange={(e) => setDesconto(e.target.value)}
            placeholder="0,00"
          />
        </Field>
      </div>

      <div className="mb-4 flex items-baseline justify-between border-t border-linha pt-3">
        <span className="text-sm font-semibold">Vai lançar</span>
        <span className="tabular text-lg font-bold text-panda-laranja">{brl(total)}</span>
      </div>

      <Button onClick={salvar} disabled={salvando} className="w-full">
        {salvando ? "Lançando…" : "Lançar consumo"}
      </Button>
    </Modal>
  );
}
