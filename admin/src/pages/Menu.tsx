import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Plus, Trash2, Star, Eye, EyeOff, UtensilsCrossed, Pencil } from "lucide-react";
import { toast } from "sonner";
import { db, storage } from "../lib/firebase";
import { useCollection } from "../lib/useCollection";
import type { MenuItem } from "../lib/types";
import {
  Card,
  Button,
  Badge,
  Spinner,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionTitle,
  Segmented,
  Switch,
} from "../components/ui";
import { Modal, ConfirmDialog, Field, inputBase } from "../components/Modal";
import { demoBlock } from "../lib/demo";
import { brl } from "../lib/format";

type Filtro = "todos" | "destaque" | "fora";

const vazio: Partial<MenuItem> = {
  nome: "",
  descricao: "",
  preco: 0,
  categoria: "",
  imagem: null,
  destaque: false,
  disponivel: true,
  ordem: 0,
  codigo: null,
};

export function Menu() {
  const { data, loading, error } = useCollection<MenuItem>("menu");
  const [editando, setEditando] = useState<Partial<MenuItem> | null>(null);
  const [excluir, setExcluir] = useState<MenuItem | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const visiveis = useMemo(
    () =>
      data.filter((i) =>
        filtro === "destaque"
          ? i.destaque && i.disponivel
          : filtro === "fora"
            ? !i.disponivel
            : true
      ),
    [data, filtro]
  );

  /**
   * Mesma ordenação do app (`cardapioProvider`): prato por `ordem` e desempate
   * pelo nome; categoria entra na posição do menor `ordem` que ela tem dentro.
   * Se mudar aqui, mude lá — senão o painel mostra uma ordem e o app, outra.
   */
  const categorias = useMemo(() => {
    const mapa = new Map<string, MenuItem[]>();
    visiveis.forEach((i) => {
      const chave = i.categoria?.trim() || "Outros";
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(i);
    });
    const lista = [...mapa.entries()].map(([nome, itens]) => ({
      nome,
      itens: itens.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome)),
    }));
    return lista.sort(
      (a, b) => a.itens[0].ordem - b.itens[0].ordem || a.nome.localeCompare(b.nome)
    );
  }, [visiveis]);

  // Sugestões do campo categoria: o que já existe. Evita "Sushi" e "sushis"
  // virarem duas seções no app por causa de digitação.
  const nomesCategorias = useMemo(
    () => [...new Set(data.map((i) => i.categoria?.trim()).filter(Boolean))].sort(),
    [data]
  );

  function abrir(item?: MenuItem) {
    setEditando(item ?? { ...vazio });
    setArquivo(null);
  }

  async function salvar() {
    if (!editando?.nome?.trim()) return toast.error("Informe o nome do prato.");
    if (demoBlock("Prato não salvo")) return setEditando(null);
    setSalvando(true);
    try {
      let imagem = editando.imagem ?? null;
      if (arquivo) {
        const r = ref(storage, `menu/${Date.now()}_${arquivo.name}`);
        await uploadBytes(r, arquivo);
        imagem = await getDownloadURL(r);
      }
      const codigo = editando.codigo ? Number(editando.codigo) : null;
      if (codigo !== null && (!Number.isInteger(codigo) || codigo < 1)) {
        setSalvando(false);
        return toast.error("O código do prato deve ser um número inteiro.");
      }
      const dono = codigo && data.find((i) => i.codigo === codigo && i.id !== editando.id);
      if (dono) {
        setSalvando(false);
        return toast.error(`O código ${codigo} já é de "${dono.nome}".`);
      }
      const payload = {
        codigo,
        nome: editando.nome.trim(),
        descricao: editando.descricao?.trim() ?? "",
        preco: Number(editando.preco ?? 0),
        categoria: editando.categoria?.trim() || "Outros",
        imagem,
        destaque: editando.destaque ?? false,
        disponivel: editando.disponivel ?? true,
        ordem: Number(editando.ordem ?? 0),
      };
      if (editando.id) await updateDoc(doc(db, "menu", editando.id), payload);
      else await addDoc(collection(db, "menu"), payload);
      toast.success("Prato salvo. Já está no app.");
      setEditando(null);
      setArquivo(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  /** Liga/desliga sem abrir o formulário — é o gesto do dia a dia. */
  async function alternar(item: MenuItem, campo: "destaque" | "disponivel") {
    if (demoBlock("Alteração não salva")) return;
    try {
      await updateDoc(doc(db, "menu", item.id), { [campo]: !item[campo] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorState mensagem={error} />;

  const fora = data.filter((i) => !i.disponivel).length;
  const destaques = data.filter((i) => i.destaque && i.disponivel).length;

  return (
    <div>
      <PageHeader
        titulo="Cardápio"
        eyebrow="O que o cliente vê no app"
        descricao={
          data.length
            ? `${data.length} pratos · ${destaques} na vitrine da Home${fora ? ` · ${fora} fora do ar` : ""}`
            : undefined
        }
        acao={
          <Button onClick={() => abrir()}>
            <Plus size={17} /> Novo prato
          </Button>
        }
      />

      {data.length === 0 ? (
        <EmptyState
          mensagem="Cardápio vazio. Cadastre o primeiro prato e ele aparece no app na hora."
          acao={
            <Button onClick={() => abrir()}>
              <Plus size={17} /> Novo prato
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel="Filtrar pratos"
              value={filtro}
              onChange={setFiltro}
              options={[
                { valor: "todos", label: `Todos · ${data.length}` },
                { valor: "destaque", label: `Na Home · ${destaques}` },
                { valor: "fora", label: `Fora do ar · ${fora}` },
              ]}
            />
          </div>

          {visiveis.length === 0 ? (
            <EmptyState
              mensagem={
                filtro === "destaque"
                  ? "Nenhum prato na vitrine da Home. Ligue a estrela num prato pra ele aparecer lá."
                  : "Nenhum prato fora do ar. Está tudo disponível."
              }
            />
          ) : (
            <div className="flex flex-col gap-7">
              {categorias.map((cat) => (
                <section key={cat.nome}>
                  <SectionTitle
                    acao={
                      <span className="tabular text-[13px] text-tinta-3">
                        {cat.itens.length} {cat.itens.length === 1 ? "prato" : "pratos"}
                      </span>
                    }
                  >
                    {cat.nome}
                  </SectionTitle>

                  <Card plano>
                    <ul className="divide-y divide-linha">
                      {cat.itens.map((i) => (
                        <LinhaPrato
                          key={i.id}
                          item={i}
                          onEditar={() => abrir(i)}
                          onAlternar={(campo) => alternar(i, campo)}
                          onExcluir={() => setExcluir(i)}
                        />
                      ))}
                    </ul>
                  </Card>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={!!editando}
        onClose={() => setEditando(null)}
        title={editando?.id ? "Editar prato" : "Novo prato"}
      >
        {editando && (
          <>
            <Field label="Nome">
              <input
                className={inputBase}
                value={editando.nome ?? ""}
                onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                placeholder="Combinado especial"
              />
            </Field>
            <Field label="Descrição" hint="Uma frase curta. É o que aparece embaixo do nome no app.">
              <textarea
                className={inputBase}
                rows={2}
                value={editando.descricao ?? ""}
                onChange={(e) => setEditando({ ...editando, descricao: e.target.value })}
                placeholder="20 peças variadas: sashimi, uramaki e niguiri."
              />
            </Field>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="Preço">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={inputBase}
                  value={editando.preco ?? 0}
                  onChange={(e) => setEditando({ ...editando, preco: Number(e.target.value) })}
                />
              </Field>
              <Field label="Código" hint="Mesmo número na Starway. Opcional.">
                <input
                  type="number"
                  min="1"
                  className={inputBase}
                  value={editando.codigo ?? ""}
                  onChange={(e) =>
                    setEditando({ ...editando, codigo: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </Field>
              <Field label="Ordem" hint="Menor número aparece primeiro na categoria.">
                <input
                  type="number"
                  className={inputBase}
                  value={editando.ordem ?? 0}
                  onChange={(e) => setEditando({ ...editando, ordem: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="Categoria" hint="Vira uma seção do cardápio no app. Reaproveite os nomes que já existem.">
              <input
                className={inputBase}
                list="categorias-menu"
                value={editando.categoria ?? ""}
                onChange={(e) => setEditando({ ...editando, categoria: e.target.value })}
                placeholder="Combinados & Sushi"
              />
              <datalist id="categorias-menu">
                {nomesCategorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Foto do prato" hint="Sem foto, o app mostra o ícone de talher.">
              <input
                type="file"
                accept="image/*"
                className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-superficie-2 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-tinta"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
            </Field>

            <div className="mb-5 divide-y divide-linha rounded-2xl border border-linha px-3.5">
              <div className="py-2.5">
                <Switch
                  checked={editando.disponivel ?? true}
                  onChange={(v) => setEditando({ ...editando, disponivel: v })}
                  label="Disponível"
                  hint="Desligue quando acabar o ingrediente: some do app sem apagar o cadastro."
                />
              </div>
              <div className="py-2.5">
                <Switch
                  checked={editando.destaque ?? false}
                  onChange={(v) => setEditando({ ...editando, destaque: v })}
                  label="Mostrar na Home"
                  hint='Entra na vitrine "Destaques do cardápio", na primeira tela do app.'
                />
              </div>
            </div>

            <Button onClick={salvar} disabled={salvando} className="w-full">
              {salvando ? "Salvando..." : "Salvar prato"}
            </Button>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={async () => {
          if (demoBlock("Prato não excluído")) return;
          if (excluir) {
            await deleteDoc(doc(db, "menu", excluir.id));
            toast.success("Prato excluído.");
          }
        }}
        title="Excluir prato?"
        message={`"${excluir?.nome}" sai do cardápio pra sempre. Se é só falta do ingrediente hoje, desligue "Disponível" — ele some do app e volta com um toque.`}
        confirmLabel="Excluir prato"
      />
    </div>
  );
}

function LinhaPrato({
  item: i,
  onEditar,
  onAlternar,
  onExcluir,
}: {
  item: MenuItem;
  onEditar: () => void;
  onAlternar: (campo: "destaque" | "disponivel") => void;
  onExcluir: () => void;
}) {
  return (
    <li
      className={`group flex items-center gap-3 pr-2 transition-colors hover:bg-superficie-2 ${
        i.disponivel ? "" : "opacity-60"
      }`}
    >
      {/* A linha inteira abre a edição — é a ação de 90% dos toques. Os botões
          da direita ficam fora do alvo pra não brigar com ela. */}
      <button
        onClick={onEditar}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-marca/8">
          {i.imagem ? (
            <img src={i.imagem} alt="" className="h-full w-full object-cover" />
          ) : (
            <UtensilsCrossed size={18} className="text-marca-tinta" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            {i.codigo ? <Badge color="gray">#{i.codigo}</Badge> : null}
            <span className="truncate text-sm font-semibold">{i.nome}</span>
            {i.destaque && i.disponivel && <Badge color="orange">Na Home</Badge>}
            {!i.disponivel && <Badge color="gray">Fora do ar</Badge>}
          </span>
          {i.descricao && (
            <span className="mt-0.5 line-clamp-1 block text-[13px] text-tinta-3">
              {i.descricao}
            </span>
          )}
        </span>

        <span className="tabular shrink-0 text-sm font-bold">{brl(i.preco)}</span>
      </button>

      <div className="flex shrink-0 items-center">
        <BotaoIcone
          ativo={i.destaque}
          titulo={i.destaque ? "Tirar da vitrine da Home" : "Colocar na vitrine da Home"}
          onClick={() => onAlternar("destaque")}
        >
          <Star size={16} fill={i.destaque ? "currentColor" : "none"} />
        </BotaoIcone>
        <BotaoIcone
          ativo={!i.disponivel}
          titulo={i.disponivel ? "Tirar do ar" : "Voltar pro ar"}
          onClick={() => onAlternar("disponivel")}
        >
          {i.disponivel ? <Eye size={16} /> : <EyeOff size={16} />}
        </BotaoIcone>
        <button
          title="Editar prato"
          aria-label={`Editar ${i.nome}`}
          onClick={onEditar}
          className="rounded-lg p-2 text-tinta-3 transition-colors hover:bg-superficie hover:text-tinta sm:hidden"
        >
          <Pencil size={16} />
        </button>
        <button
          title="Excluir prato"
          aria-label={`Excluir ${i.nome}`}
          onClick={onExcluir}
          className="rounded-lg p-2 text-tinta-3 transition-colors hover:bg-erro/10 hover:text-erro-tinta"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  );
}

function BotaoIcone({
  ativo,
  titulo,
  onClick,
  children,
}: {
  ativo: boolean;
  titulo: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo}
      onClick={onClick}
      className={`rounded-lg p-2 transition-colors hover:bg-superficie ${
        ativo ? "text-marca-tinta" : "text-tinta-3 hover:text-tinta"
      }`}
    >
      {children}
    </button>
  );
}
