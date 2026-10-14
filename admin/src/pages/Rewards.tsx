import { useState } from "react";
import { addDoc, collection, deleteDoc, doc, limit, updateDoc, where } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { Plus, Pencil, Trash2, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { db, storage, functions } from "../lib/firebase";
import { useCollection, useCollectionQuery } from "../lib/useCollection";
import { useContagem } from "../lib/useContagem";
import { avisarMudanca } from "../lib/aoVivo";
import type { Redemption, Reward, RewardTipo } from "../lib/types";
import {
  Card,
  Button,
  Badge,
  Spinner,
  EmptyState,
  ErrorState,
  PageHeader,
} from "../components/ui";
import { Modal, ConfirmDialog, Field, inputBase } from "../components/Modal";
import { demoBlock } from "../lib/demo";
import { toLocalInput } from "../lib/oferta";

const tipos: RewardTipo[] = ["rodizio", "prato", "sobremesa", "cupom"];
const vazio: Partial<Reward> = { titulo: "", descricao: "", tipo: "cupom", estoque: 1, resgatavelAte: null };

/** Quantos resgates pendentes a lista do caixa carrega de uma vez. */
const TETO_PENDENTES = 50;

/** Formata o prazo pra exibição. */
function fmtPrazo(d?: Date | null): string {
  if (!d) return "Sem prazo";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function Rewards() {
  const { data, loading, error } = useCollection<Reward>("rewards");
  // O total vai no resumo lá em cima. Contar no servidor evita baixar
  // `redemptions` inteira só pra exibir um número.
  const totalPendentes = useContagem(
    "redemptions",
    () => [where("status", "==", "disponivel")],
    "disponivel",
    (r) => r.status === "disponivel"
  );

  // A lista de baixo é outra coisa: o dono valida resgate por resgate no caixa,
  // então precisa dos documentos, não da contagem. Sem `orderBy` de propósito —
  // combinar com o filtro de status exigiria um índice composto que não existe,
  // e a fila é curta. O teto evita virar uma coleção inteira se acumular.
  const { data: resgates } = useCollectionQuery<Redemption>(
    "redemptions",
    () => [where("status", "==", "disponivel"), limit(TETO_PENDENTES)],
    "disponivel",
    TETO_PENDENTES
  );

  // Em modo demo o hook devolve a coleção inteira, sem aplicar o filtro — sem
  // isto o painel de demonstração listaria resgate já usado como pendente, e
  // ainda brigaria com a contagem ao lado. Em produção é redundante e grátis.
  const pendentes = resgates.filter((r) => r.status === "disponivel");
  const [editando, setEditando] = useState<Partial<Reward> | null>(null);
  const [excluir, setExcluir] = useState<Reward | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!editando?.titulo) return toast.error("Informe o título.");
    if (demoBlock("Premiação não salva")) return setEditando(null);
    setSalvando(true);
    try {
      let imagem = editando.imagem ?? null;
      if (arquivo) {
        const r = ref(storage, `rewards/${Date.now()}_${arquivo.name}`);
        await uploadBytes(r, arquivo);
        imagem = await getDownloadURL(r);
      }
      const payload = {
        titulo: editando.titulo,
        descricao: editando.descricao ?? "",
        tipo: editando.tipo ?? "cupom",
        // O campo escrito é `estoqueAlvo` — quantos o dono QUER disponíveis. O
        // `estoque` que aparece na lista é calculado pelo gatilho, contando os
        // cupons livres (functions/src/rewards.ts). Escrever `estoque` aqui
        // seria brigar com o gatilho pelo mesmo campo.
        estoqueAlvo: Number(editando.estoque ?? 0),
        valor: Number(editando.valor ?? 0),
        resgatavelAte: editando.resgatavelAte ?? null,
        imagem,
      };
      if (editando.id) await updateDoc(doc(db, "rewards", editando.id), payload);
      else await addDoc(collection(db, "rewards"), payload);
      toast.success("Premiação salva.");
      setEditando(null);
      setArquivo(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function validar(codigo: string) {
    if (demoBlock("Resgate não validado")) return;
    try {
      await httpsCallable(functions, "validateRedemption")({ codigo });
      toast.success("Resgate validado.");
      // "N resgates esperando validação" é contagem: reconta na hora.
      avisarMudanca("redemptions");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorState mensagem={error} />;

  return (
    <div>
      <PageHeader
        titulo="Premiações"
        descricao={
          totalPendentes
            ? `${totalPendentes} resgate(s) esperando validação no caixa`
            : "Prêmios que o restaurante libera pros sócios"
        }
        acao={
          <Button onClick={() => setEditando({ ...vazio })}>
            <Plus size={18} /> Nova premiação
          </Button>
        }
      />

      {data.length === 0 ? (
        <EmptyState
          mensagem="Nenhuma premiação cadastrada. Cadastre um prêmio pros sócios resgatarem."
          acao={
            <Button onClick={() => setEditando({ ...vazio })}>
              <Plus size={18} /> Nova premiação
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{r.titulo}</h3>
                <Badge color={r.estoque > 0 ? "green" : "red"}>Estoque {r.estoque}</Badge>
              </div>
              <p className="mt-1 text-sm text-panda-cinza-texto">{r.descricao}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge color="gray">{r.tipo}</Badge>
                <Badge color="orange">Sócios</Badge>
                <Badge color={r.resgatavelAte ? "green" : "gray"}>Resgate: {fmtPrazo(r.resgatavelAte)}</Badge>
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setEditando(r)}>
                  <Pencil size={16} /> Editar
                </Button>
                <Button variant="ghost" onClick={() => setExcluir(r)}>
                  <Trash2 size={16} className="text-panda-vermelho" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-10 mb-1 text-lg font-bold">Resgates pra validar</h2>
      <p className="mb-4 text-sm text-panda-cinza-texto">
        O cliente mostra o código no caixa. Confira e valide aqui.
      </p>
      {pendentes.length === 0 ? (
        <EmptyState mensagem="Nada pra validar agora." />
      ) : (
        <div className="flex flex-col gap-2">
          {pendentes.map((r) => (
            // Um cartão por resgate, com o código grande e o botão de largura
            // cheia: é o que o dono faz de pé no caixa, com o celular na mão.
            <Card key={r.id}>
              <div className="text-sm text-panda-cinza-texto">{r.rewardTitulo}</div>
              <div className="tabular mt-1 font-mono text-xl font-bold tracking-wider">
                {r.codigo}
              </div>
              <Button
                variant="outline"
                className="mt-3 w-full sm:w-auto"
                onClick={() => validar(r.codigo)}
              >
                <CheckCircle size={16} /> Validar resgate
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!editando} onClose={() => setEditando(null)} title={editando?.id ? "Editar premiação" : "Nova premiação"}>
        {editando && (
          <>
            <Field label="Título">
              <input className={inputBase} value={editando.titulo ?? ""} onChange={(e) => setEditando({ ...editando, titulo: e.target.value })} />
            </Field>
            <Field label="Descrição">
              <textarea className={inputBase} rows={2} value={editando.descricao ?? ""} onChange={(e) => setEditando({ ...editando, descricao: e.target.value })} />
            </Field>
            <Field label="Tipo">
              <select className={inputBase} value={editando.tipo ?? "cupom"} onChange={(e) => setEditando({ ...editando, tipo: e.target.value as RewardTipo })}>
                {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <div className="grid gap-x-3 sm:grid-cols-2">
              <Field
                label="Quanto vale (R$)"
                hint="Preço de cardápio. É com isso que o app soma o “você já economizou” do sócio. 0 = não conta."
              >
                <input type="number" step="0.01" min="0" className={inputBase} value={editando.valor ?? 0} onChange={(e) => setEditando({ ...editando, valor: Number(e.target.value) })} />
              </Field>
              <Field
                label="Estoque"
                hint="Quantos ainda podem ser resgatados. Diminuir nunca tira o prêmio de quem já resgatou."
              >
                <input type="number" min="0" className={inputBase} value={editando.estoque ?? 0} onChange={(e) => setEditando({ ...editando, estoque: Number(e.target.value) })} />
              </Field>
              <Field label="Resgatar até">
                <input
                  type="datetime-local"
                  className={inputBase}
                  value={toLocalInput(editando.resgatavelAte)}
                  onChange={(e) => setEditando({ ...editando, resgatavelAte: e.target.value ? new Date(e.target.value) : null })}
                />
              </Field>
            </div>
            <p className="mb-3 text-xs text-panda-cinza-texto">
              Deixe o prazo em branco para sem limite. Premiações são exclusivas de sócios e cada pessoa resgata uma vez.
            </p>
            <Field label="Foto do prêmio" hint="Recomendado. Prêmio com foto chama mais atenção no app; sem foto aparece só o ícone.">
              <input type="file" accept="image/*" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </Field>
            <Button onClick={salvar} disabled={salvando} className="w-full">
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={async () => {
          if (demoBlock("Premiação não excluída")) return;
          if (excluir) {
            await deleteDoc(doc(db, "rewards", excluir.id));
            toast.success("Premiação excluída.");
          }
        }}
        title="Excluir premiação?"
        message={`"${excluir?.titulo}" será removida.`}
      />
    </div>
  );
}
