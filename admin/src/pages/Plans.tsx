import { useState } from "react";
import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "../lib/firebase";
import { useCollection } from "../lib/useCollection";
import type { Plan } from "../lib/types";
import {
  Card,
  Button,
  Badge,
  Spinner,
  EmptyState,
  ErrorState,
  PageHeader,
  LiveDot,
} from "../components/ui";
import { Modal, ConfirmDialog, Field, inputBase } from "../components/Modal";
import { demoBlock } from "../lib/demo";
import { brl } from "../lib/format";

const intervalos = ["mês", "trimestre", "ano"] as const;
const vazio: Partial<Plan> = { nome: "", preco: 0, intervalo: "mês", beneficios: [], recomendado: false };

export function Plans() {
  const { data, loading, error } = useCollection<Plan>("plans");
  const [editando, setEditando] = useState<Partial<Plan> | null>(null);
  const [excluir, setExcluir] = useState<Plan | null>(null);
  const [beneficiosStr, setBeneficiosStr] = useState("");

  function abrir(p?: Plan) {
    setEditando(p ?? { ...vazio });
    setBeneficiosStr((p?.beneficios ?? []).join("\n"));
  }

  async function salvar() {
    if (!editando?.nome) return toast.error("Informe o nome.");
    if (demoBlock("Plano não salvo")) return setEditando(null);
    const payload = {
      nome: editando.nome,
      preco: Number(editando.preco ?? 0),
      intervalo: editando.intervalo ?? "mês",
      beneficios: beneficiosStr.split("\n").map((s) => s.trim()).filter(Boolean),
      // Sempre true: o app usa esse campo pro selo "PLANO ÚNICO" e pra borda
      // destacada do card (plans_screen.dart:133). Com um plano só, é sempre ele.
      recomendado: true,
      descontoPercentual: Number(editando.descontoPercentual ?? 0),
    };
    try {
      if (editando.id) await updateDoc(doc(db, "plans", editando.id), payload);
      else await addDoc(collection(db, "plans"), payload);
      toast.success("Plano salvo.");
      setEditando(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorState mensagem={error} />;

  return (
    <div>
      <PageHeader
        titulo="Plano"
        descricao="O app vende uma assinatura só. Pra mudar o preço ou os benefícios, edite aqui."
        /* O Clube tem um plano só. O botão de criar aparece apenas enquanto
           não existe nenhum — depois disso é edição, não cadastro. */
        acao={
          data.length === 0 ? (
            <Button onClick={() => abrir()}><Plus size={18} /> Criar o plano</Button>
          ) : undefined
        }
      />

      {data.length === 0 ? (
        <EmptyState
          mensagem="Sem plano cadastrado — assim o app não tem o que vender."
          acao={<Button onClick={() => abrir()}><Plus size={18} /> Criar o plano</Button>}
        />
      ) : (
        <div className={data.length === 1 ? "sm:max-w-sm" : "grid gap-4 md:grid-cols-3"}>
          {data.map((p) => (
            <Card key={p.id} className="ring-2 ring-panda-laranja">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{p.nome}</h3>
                <Badge color="green"><LiveDot /> No ar</Badge>
              </div>
              <div className="tabular mt-2 text-3xl font-bold text-panda-laranja">
                {brl(p.preco)} <span className="text-sm font-normal text-panda-cinza-texto">/ {p.intervalo}</span>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-panda-cinza-texto">
                {p.beneficios?.map((b, i) => <li key={i}>• {b}</li>)}
              </ul>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => abrir(p)}><Pencil size={16} /> Editar</Button>
                {/* Sem lixeira no último plano: apagar deixaria o app sem nada
                    pra vender. Só aparece pra limpar planos antigos sobrando. */}
                {data.length > 1 && (
                  <Button variant="ghost" onClick={() => setExcluir(p)}><Trash2 size={16} className="text-panda-vermelho" /></Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!editando} onClose={() => setEditando(null)} title={editando?.id ? "Editar plano" : "Novo plano"}>
        {editando && (
          <>
            <Field label="Nome"><input className={inputBase} value={editando.nome ?? ""} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} /></Field>
            <div className="grid gap-x-3 sm:grid-cols-2">
              <Field label="Preço (R$)"><input type="number" step="0.01" className={inputBase} value={editando.preco ?? 0} onChange={(e) => setEditando({ ...editando, preco: Number(e.target.value) })} /></Field>
              <Field label="Intervalo">
                <select className={inputBase} value={editando.intervalo ?? "mês"} onChange={(e) => setEditando({ ...editando, intervalo: e.target.value as Plan["intervalo"] })}>
                  {intervalos.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Benefícios (um por linha)"><textarea className={inputBase} rows={4} value={beneficiosStr} onChange={(e) => setBeneficiosStr(e.target.value)} /></Field>
            <Field
              label="Desconto do sócio no salão (%)"
              hint="Só é usado quando o PDV fecha a conta sem dizer quanto descontou. Deixe 0 se quem decide o desconto é sempre o caixa."
            >
              <input type="number" step="1" min="0" max="100" className={inputBase} value={editando.descontoPercentual ?? 0} onChange={(e) => setEditando({ ...editando, descontoPercentual: Number(e.target.value) })} />
            </Field>
            <Button onClick={salvar} className="mt-1 w-full">Salvar</Button>
          </>
        )}
      </Modal>

      <ConfirmDialog open={!!excluir} onClose={() => setExcluir(null)}
        onConfirm={async () => { if (demoBlock("Plano não excluído")) return; if (excluir) { await deleteDoc(doc(db, "plans", excluir.id)); toast.success("Plano excluído."); } }}
        title="Excluir plano?" message={`"${excluir?.nome}" será removido.`} />
    </div>
  );
}
