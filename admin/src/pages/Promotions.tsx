import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Plus, Pencil, Trash2, Clock, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { db, storage } from "../lib/firebase";
import { useCollection } from "../lib/useCollection";
import { useAgora } from "../lib/useAgora";
import type { MenuItem, Promotion } from "../lib/types";
import {
  Card,
  Button,
  Badge,
  Spinner,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionTitle,
  LiveDot,
  Switch,
} from "../components/ui";
import { Modal, ConfirmDialog, Field, inputBase } from "../components/Modal";
import { demoBlock } from "../lib/demo";
import {
  statusOferta,
  corStatus,
  janelaTexto,
  resumoJanela,
  restanteTexto,
  toLocalInput,
  fromLocalInput,
} from "../lib/oferta";

const vazia: Partial<Promotion> = {
  titulo: "",
  descricao: "",
  ativa: true,
  apenasAssinantes: false,
  imagem: null,
  validadeInicio: null,
  validadeFim: null,
};

const MINUTO = 60_000;

/** Atalhos de prazo. Cobrem quase toda oferta de restaurante e evitam que o
 *  dono tenha que traduzir "uma semana" em data e hora no dedo. */
const atalhos = [
  {
    label: "Só hoje",
    fim: () => {
      const d = new Date();
      d.setHours(23, 59, 0, 0);
      return d;
    },
  },
  { label: "3 dias", fim: () => new Date(Date.now() + 3 * 1440 * MINUTO) },
  { label: "1 semana", fim: () => new Date(Date.now() + 7 * 1440 * MINUTO) },
  { label: "Sem prazo", fim: () => null },
];

export function Promotions() {
  const agora = useAgora();
  const { data, loading, error } = useCollection<Promotion>("promotions");
  const { data: cardapio } = useCollection<MenuItem>("menu");
  const pratos = useMemo(
    () => [...cardapio].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [cardapio]
  );
  const [editando, setEditando] = useState<Partial<Promotion> | null>(null);
  const [excluir, setExcluir] = useState<Promotion | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);

  // Quem está no ar primeiro, e dentro disso quem termina antes — a ordem em
  // que o dono precisa olhar.
  const ordenadas = useMemo(() => {
    const peso = { "no ar": 0, agendada: 1, inativa: 2, encerrada: 3 } as const;
    return [...data].sort((a, b) => {
      const pa = peso[statusOferta(a, agora)];
      const pb = peso[statusOferta(b, agora)];
      if (pa !== pb) return pa - pb;
      return (a.validadeFim?.getTime() ?? Infinity) - (b.validadeFim?.getTime() ?? Infinity);
    });
  }, [data, agora]);

  async function salvar() {
    if (!editando?.titulo?.trim()) return toast.error("Informe o título.");
    const pct = editando.descontoPct ?? null;
    if (editando.itemId && (!Number.isInteger(pct) || pct! < 1 || pct! > 90))
      return toast.error("Desconto tem que ser um número inteiro de 1 a 90 (%).");
    const { validadeInicio: ini, validadeFim: fim } = editando;
    if (ini && fim && ini >= fim) return toast.error("O fim tem que ser depois do começo.");
    if (fim && fim <= new Date())
      return toast.error("Esse fim já passou. A oferta nasceria encerrada.");
    if (demoBlock("Promoção não salva")) return setEditando(null);
    setSalvando(true);
    try {
      let imagem = editando.imagem ?? null;
      if (arquivo) {
        const r = ref(storage, `promotions/${Date.now()}_${arquivo.name}`);
        await uploadBytes(r, arquivo);
        imagem = await getDownloadURL(r);
      }
      const payload = {
        titulo: editando.titulo.trim(),
        descricao: editando.descricao?.trim() ?? "",
        ativa: editando.ativa ?? true,
        apenasAssinantes: editando.apenasAssinantes ?? false,
        imagem,
        // O app lê esses dois pra decidir se mostra a oferta. Null = sem limite.
        validadeInicio: editando.validadeInicio ?? null,
        validadeFim: editando.validadeFim ?? null,
        // Sem prato, o desconto não vale nada: grava os dois juntos ou nenhum.
        itemId: editando.itemId || null,
        descontoPct: editando.itemId ? pct : null,
      };
      if (editando.id) {
        await updateDoc(doc(db, "promotions", editando.id), payload);
      } else {
        await addDoc(collection(db, "promotions"), payload);
      }
      const agendada = !!payload.validadeInicio && payload.validadeInicio > new Date();
      toast.success(
        agendada
          ? "Promoção agendada. Ela entra no app sozinha na data marcada."
          : "Promoção salva. Já está no app."
      );
      setEditando(null);
      setArquivo(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorState mensagem={error} />;

  const noAr = data.filter((p) => statusOferta(p, agora) === "no ar").length;

  return (
    <div>
      <PageHeader
        titulo="Promoções"
        eyebrow="Ofertas do clube"
        descricao={
          noAr === 1
            ? "1 promoção no ar agora — o cliente está vendo neste minuto."
            : `${noAr} promoções no ar agora — o cliente está vendo neste minuto.`
        }
        acao={
          <Button onClick={() => setEditando({ ...vazia })}>
            <Plus size={17} /> Nova promoção
          </Button>
        }
      />

      {data.length === 0 ? (
        <EmptyState
          mensagem="Nenhuma promoção cadastrada. Crie a primeira e ela aparece no app na hora."
          acao={
            <Button onClick={() => setEditando({ ...vazia })}>
              <Plus size={17} /> Nova promoção
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ordenadas.map((p) => {
            const status = statusOferta(p, agora);
            const acabando =
              status === "no ar" &&
              !!p.validadeFim &&
              p.validadeFim.getTime() - agora.getTime() < 24 * 60 * MINUTO;

            return (
              <Card key={p.id} plano className="flex flex-col overflow-hidden">
                <div className="flex h-32 items-center justify-center overflow-hidden bg-marca/8">
                  {p.imagem ? (
                    <img src={p.imagem} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon size={22} className="text-marca-tinta/50" />
                  )}
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-semibold leading-snug">{p.titulo}</h3>
                    <Badge color={corStatus[status]}>
                      {status === "no ar" && <LiveDot />}
                      {status}
                    </Badge>
                  </div>

                  <p className="line-clamp-2 flex-1 text-sm text-tinta-2">{p.descricao}</p>

                  <div className="mt-3 flex items-start gap-1.5 text-xs text-tinta-3">
                    <Clock size={13} className="mt-0.5 shrink-0" />
                    <span>
                      {janelaTexto(p)}
                      {status === "no ar" && p.validadeFim && (
                        <>
                          {" — "}
                          <strong
                            className={`font-semibold ${acabando ? "text-marca-tinta" : "text-tinta-2"}`}
                          >
                            faltam {restanteTexto(p.validadeFim, agora)}
                          </strong>
                        </>
                      )}
                    </span>
                  </div>

                  {(p.apenasAssinantes || (p.itemId && p.descontoPct)) && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {p.itemId && p.descontoPct ? (
                        <Badge color="green">
                          {p.descontoPct}% off em{" "}
                          {cardapio.find((m) => m.id === p.itemId)?.nome ?? "prato removido"}
                        </Badge>
                      ) : null}
                      {p.apenasAssinantes && <Badge color="orange">Só assinantes</Badge>}
                    </div>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditando(p)}>
                      <Pencil size={15} /> Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Excluir ${p.titulo}`}
                      onClick={() => setExcluir(p)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!editando}
        onClose={() => setEditando(null)}
        title={editando?.id ? "Editar promoção" : "Nova promoção"}
      >
        {editando && (
          <>
            <Field label="Título">
              <input
                className={inputBase}
                value={editando.titulo ?? ""}
                onChange={(e) => setEditando({ ...editando, titulo: e.target.value })}
                placeholder="Rodízio com 20% OFF"
              />
            </Field>
            <Field label="Descrição" hint="O que o cliente ganha, em uma frase.">
              <textarea
                className={inputBase}
                rows={3}
                value={editando.descricao ?? ""}
                onChange={(e) => setEditando({ ...editando, descricao: e.target.value })}
                placeholder="Toda quarta, rodízio completo com desconto pra assinantes."
              />
            </Field>
            <Field label="Imagem do banner" hint="Opcional. Sem imagem, o app mostra só o texto.">
              <input
                type="file"
                accept="image/*"
                className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-superficie-2 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-tinta"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
            </Field>

            <SectionTitle>Desconto no pedido</SectionTitle>
            <div className="grid gap-x-4 sm:grid-cols-[1fr_8rem]">
              <Field
                label="Prato da promoção"
                hint="Opcional. Com prato, o cliente toca na promoção e pede já com desconto."
              >
                <select
                  className={inputBase}
                  value={editando.itemId ?? ""}
                  onChange={(e) => setEditando({ ...editando, itemId: e.target.value || null })}
                >
                  <option value="">Nenhum (só aviso)</option>
                  {pratos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                      {m.disponivel ? "" : " (indisponível)"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Desconto (%)">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={90}
                  step={1}
                  disabled={!editando.itemId}
                  className={inputBase}
                  value={editando.descontoPct ?? ""}
                  onChange={(e) =>
                    setEditando({
                      ...editando,
                      descontoPct: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  placeholder="20"
                />
              </Field>
            </div>

            <SectionTitle>Quanto tempo fica no ar</SectionTitle>
            <div className="mb-4 flex flex-wrap gap-2">
              {atalhos.map((a) => {
                // Marca o atalho que corresponde às datas atuais. Tolerância de
                // um minuto e meio porque o "3 dias" é contado a partir de agora
                // e o relógio anda entre o clique e o desenho da tela.
                const alvo = a.fim();
                const fim = editando.validadeFim ?? null;
                const escolhido = alvo
                  ? !!fim && Math.abs(fim.getTime() - alvo.getTime()) < 90_000
                  : !fim && !editando.validadeInicio;
                return (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() =>
                      setEditando({ ...editando, validadeInicio: null, validadeFim: a.fim() })
                    }
                    aria-pressed={escolhido}
                    className={`min-h-9 rounded-xl border px-3 text-[13px] font-semibold transition-colors ${
                      escolhido
                        ? "border-marca bg-marca/10 text-marca-tinta"
                        : "border-linha text-tinta-2 hover:border-marca hover:text-marca-tinta"
                    }`}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>

            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="Começa em" hint="Vazio = assim que salvar.">
                <input
                  type="datetime-local"
                  className={inputBase}
                  value={toLocalInput(editando.validadeInicio)}
                  onChange={(e) =>
                    setEditando({ ...editando, validadeInicio: fromLocalInput(e.target.value) })
                  }
                />
              </Field>
              <Field label="Termina em" hint="Vazio = até você desligar.">
                <input
                  type="datetime-local"
                  className={inputBase}
                  value={toLocalInput(editando.validadeFim)}
                  onChange={(e) =>
                    setEditando({ ...editando, validadeFim: fromLocalInput(e.target.value) })
                  }
                />
              </Field>
            </div>

            {/* A frase que fecha a dúvida antes de salvar: quantos dias fica no
                ar e até que horas sai. Recalcula a cada tecla. */}
            <p className="mb-5 rounded-xl border border-linha bg-superficie-2 px-3.5 py-3 text-[13px] leading-relaxed text-tinta-2">
              {resumoJanela(
                {
                  ativa: editando.ativa ?? true,
                  validadeInicio: editando.validadeInicio,
                  validadeFim: editando.validadeFim,
                },
                agora
              )}
            </p>

            <div className="mb-5 divide-y divide-linha rounded-2xl border border-linha px-3.5">
              <div className="py-2.5">
                <Switch
                  checked={editando.ativa ?? true}
                  onChange={(v) => setEditando({ ...editando, ativa: v })}
                  label="Ativa"
                  hint="Desligue pra tirar do app sem apagar nem perder as datas."
                />
              </div>
              <div className="py-2.5">
                <Switch
                  checked={editando.apenasAssinantes ?? false}
                  onChange={(v) => setEditando({ ...editando, apenasAssinantes: v })}
                  label="Só para assinantes"
                  hint="Quem não paga a mensalidade não vê esta oferta."
                />
              </div>
            </div>

            <Button onClick={salvar} disabled={salvando} className="w-full">
              {salvando ? "Salvando..." : "Salvar promoção"}
            </Button>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={async () => {
          if (demoBlock("Promoção não excluída")) return;
          if (excluir) {
            await deleteDoc(doc(db, "promotions", excluir.id));
            toast.success("Promoção excluída.");
          }
        }}
        title="Excluir promoção?"
        message={`"${excluir?.titulo}" some pra sempre. Pra tirar do app só por enquanto, desligue "Ativa" na edição.`}
        confirmLabel="Excluir promoção"
      />
    </div>
  );
}
