import { useEffect, useMemo, useRef, useState } from "react";
import { where, orderBy, limit, Timestamp, type QueryConstraint } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Bike, Store, Phone, MapPin, Banknote, Volume2, VolumeX } from "lucide-react";
import { functions } from "../lib/firebase";
import { useCollectionQuery } from "../lib/useCollection";
import { demoBlock } from "../lib/demo";
import type { Pedido } from "../lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LinhaDado,
  PageHeader,
  Segmented,
  Spinner,
  Stat,
  StatRail,
} from "../components/ui";
import { Sheet } from "../components/Modal";
import { brl, diaHora } from "../lib/format";

type Filtro = "andamento" | "hoje" | "tudo";

/** Teto de pedidos carregados por vez. Acima disso a tela avisa. */
const TETO = 300;

/** O status atual e qual é o botão óbvio a partir dele. */
const FLUXO: Record<Pedido["status"], { label: string; cor: "green" | "orange" | "red" | "gray"; proximo?: Pedido["status"]; acao?: string }> = {
  novo: { label: "Novo", cor: "orange", proximo: "aceito", acao: "Aceitar" },
  aceito: { label: "Aceito", cor: "orange", proximo: "preparando", acao: "Começar a preparar" },
  preparando: { label: "Preparando", cor: "orange", proximo: "saiu", acao: "Despachar" },
  saiu: { label: "A caminho", cor: "orange", proximo: "entregue", acao: "Marcar como entregue" },
  entregue: { label: "Entregue", cor: "green" },
  cancelado: { label: "Cancelado", cor: "red" },
};

const encerrado = (p: Pedido) => p.status === "entregue" || p.status === "cancelado";

/**
 * Bipe quando entra pedido novo.
 *
 * Numa cozinha ninguém fica olhando a tela: sem som, o pedido ficava parado
 * até alguém passar pelo computador. Três notas curtas geradas no próprio
 * navegador — arquivo de áudio seria mais um asset pra carregar e pra sumir.
 *
 * O navegador só deixa tocar som depois de um clique na página, então o
 * `AudioContext` nasce no clique do botão de ligar, e a escolha fica no
 * `localStorage` — quem liga uma vez quer ligado todo dia.
 */
function useAvisoSonoro(pedidos: Pedido[], filtro: Filtro) {
  const [ligado, setLigado] = useState(
    () => localStorage.getItem("pandavip:som-pedidos") === "1"
  );
  const audio = useRef<AudioContext | null>(null);
  // `null` = ainda não vi a primeira lista. Sem isso, abrir a tela com cinco
  // pedidos na fila tocava cinco vezes.
  const vistos = useRef<Set<string> | null>(null);

  // Trocar de filtro traz pedidos que já existiam: não é pedido novo.
  useEffect(() => {
    vistos.current = null;
  }, [filtro]);

  useEffect(() => {
    const novos = pedidos.filter((p) => p.status === "novo").map((p) => p.id);
    const antes = vistos.current;
    vistos.current = new Set(novos);
    if (!antes) return;
    if (!ligado || !audio.current) return;
    if (!novos.some((id) => !antes.has(id))) return;

    const ctx = audio.current;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.frequency.value = 880;
      vol.gain.value = 0.08;
      osc.connect(vol).connect(ctx.destination);
      const inicio = ctx.currentTime + i * 0.22;
      osc.start(inicio);
      osc.stop(inicio + 0.15);
    }
  }, [pedidos, ligado]);

  function alternar() {
    const novo = !ligado;
    setLigado(novo);
    localStorage.setItem("pandavip:som-pedidos", novo ? "1" : "0");
    // Criado aqui dentro de propósito: este clique é o gesto que o navegador
    // exige pra liberar áudio. `resume()` cobre a aba que voltou do sono.
    if (novo) {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    }
  }

  return { ligado, alternar };
}

const pagamentoLabel = (p: Pedido["pagamento"]) =>
  p === "dinheiro" ? "Dinheiro" : p === "cartao_entrega" ? "Cartão na entrega" : "Pix na entrega";

/**
 * Pedidos do delivery.
 *
 * Existe porque hoje não há outro lugar onde o pedido apareça: o app cria o
 * documento e ninguém o vê. Quando a Starway entrar, o pedido também cai no
 * PDV e o status passa a vir de lá — esta tela continua servindo de conferência
 * e de plano B pro dia em que a integração cair.
 */
export function Pedidos() {
  const [filtro, setFiltro] = useState<Filtro>("andamento");
  const [aberto, setAberto] = useState<Pedido | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // "Hoje" vai pra consulta; os outros dois filtram em memória. `pedidos`
  // cresce a cada entrega, então baixar tudo pra descartar seria o mesmo erro
  // que a tela de Pagamentos já corrigiu.
  const { data, loading, error, truncado } = useCollectionQuery<Pedido>(
    "pedidos",
    () => {
      const cs: QueryConstraint[] = [];
      if (filtro === "hoje") {
        const inicio = new Date();
        inicio.setHours(0, 0, 0, 0);
        cs.push(where("criadoEm", ">=", Timestamp.fromDate(inicio)));
      }
      cs.push(orderBy("criadoEm", "desc"), limit(TETO));
      return cs;
    },
    filtro === "hoje" ? "hoje" : "resto",
    TETO
  );

  const lista = useMemo(
    () => (filtro === "andamento" ? data.filter((p) => !encerrado(p)) : data),
    [data, filtro]
  );

  const som = useAvisoSonoro(data, filtro);

  const resumo = useMemo(() => {
    const abertos = data.filter((p) => !encerrado(p));
    const entregues = data.filter((p) => p.status === "entregue");
    return {
      abertos: abertos.length,
      novos: data.filter((p) => p.status === "novo").length,
      faturado: entregues.reduce((a, p) => a + (p.total || 0), 0),
    };
  }, [data]);

  async function mudar(pedido: Pedido, status: Pedido["status"]) {
    if (demoBlock("Mudar o status do pedido")) return;
    setSalvando(true);
    setErro(null);
    try {
      await httpsCallable(functions, "mudarStatusPedido")({ pedidoId: pedido.id, status });
      // O onSnapshot devolve o documento novo sozinho; fechar a gaveta aqui
      // evita ela mostrar o status velho por um instante.
      setAberto(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu pra mudar o status.");
    } finally {
      setSalvando(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorState mensagem={error} />;

  return (
    <div>
      <PageHeader
        titulo="Pedidos"
        eyebrow="Delivery e retirada"
        descricao="O que os sócios pediram pelo app. Mudar o status aqui muda o que o cliente vê na hora."
      />

      <StatRail>
        <Stat rotulo="Em andamento" valor={String(resumo.abertos)} />
        <Stat rotulo="Aguardando aceite" valor={String(resumo.novos)} />
        <Stat rotulo="Entregues (na lista)" valor={brl(resumo.faturado)} />
      </StatRail>

      {truncado && (
        <div className="mb-4 rounded-xl border border-marca/40 bg-marca/10 px-4 py-3 text-sm text-tinta">
          Mostrando os <strong>{TETO}</strong> pedidos mais recentes. Use o filtro
          "Hoje" pra fechar o dia sem deixar nada de fora.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Filtro de pedidos"
          value={filtro}
          onChange={setFiltro}
          options={[
            { valor: "andamento", label: "Em andamento" },
            { valor: "hoje", label: "Hoje" },
            { valor: "tudo", label: "Tudo" },
          ]}
        />
        <Button variant="outline" onClick={som.alternar}>
          {som.ligado ? <Volume2 size={16} /> : <VolumeX size={16} />}
          {som.ligado ? "Som ligado" : "Tocar som em pedido novo"}
        </Button>
      </div>

      {!som.ligado && (
        <div className="mb-4 rounded-xl border border-marca/40 bg-marca/10 px-4 py-3 text-sm text-tinta">
          Com o som desligado, o pedido só aparece pra quem estiver olhando a
          tela. Ligue no botão acima e deixe esta página aberta durante o
          expediente.
        </div>
      )}

      {erro && (
        <div className="mb-4 rounded-xl border border-erro/40 bg-erro/10 px-4 py-3 text-sm text-erro-tinta">
          {erro}
        </div>
      )}

      {!lista.length ? (
        <EmptyState
          mensagem={
            filtro === "andamento"
              ? "Nenhum pedido em andamento agora."
              : "Nenhum pedido neste filtro."
          }
        />
      ) : (
        <div className="grid gap-3">
          {lista.map((p) => {
            const f = FLUXO[p.status] ?? FLUXO.novo;
            return (
              <Card key={p.id}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="mt-0.5 text-tinta-3">
                    {p.tipo === "retirada" ? <Store size={18} /> : <Bike size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{p.nome || "Sócio"}</span>
                      <Badge color={f.cor}>{f.label}</Badge>
                      {p.tipo === "retirada" && p.lojaNome && (
                        <Badge color="gray">{p.lojaNome}</Badge>
                      )}
                      {p.pagamento === "dinheiro" && (p.troco ?? 0) > 0 && (
                        <Badge color="gray">Troco p/ {brl(p.troco!)}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-tinta-3">
                      {p.itens.map((i) => `${i.qtd}x ${i.nome}`).join(" · ")}
                    </p>
                    <p className="mt-1 text-xs text-tinta-3">{diaHora(p.criadoEm)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="font-semibold">{brl(p.total)}</span>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setAberto(p)}>
                        Ver
                      </Button>
                      {/* O botão do próximo passo fica na linha: numa noite
                          cheia, "Despachar" tem que ser um toque, não três. */}
                      {f.proximo && (
                        <Button disabled={salvando} onClick={() => mudar(p, f.proximo!)}>
                          {f.acao}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet
        open={!!aberto}
        onClose={() => setAberto(null)}
        title={aberto?.nome || "Pedido"}
        eyebrow={aberto ? FLUXO[aberto.status].label : undefined}
      >
        {aberto && (
          <div className="grid gap-4">
            <div className="grid gap-1">
              {aberto.itens.map((i) => (
                <div key={i.itemId} className="flex justify-between gap-3 text-sm">
                  <span>
                    {i.qtd}x {i.codigo ? `#${i.codigo} ` : ""}{i.nome}
                    {i.descontoPct ? (
                      <span className="font-semibold text-ok-tinta"> ({i.descontoPct}% off promoção)</span>
                    ) : null}
                    {i.obs ? <span className="text-tinta-3"> — {i.obs}</span> : null}
                  </span>
                  <span className="shrink-0 text-tinta-3">{brl(i.preco * i.qtd)}</span>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t border-borda pt-2 font-semibold">
                <span>Total</span>
                <span>{brl(aberto.total)}</span>
              </div>
            </div>

            <div className="grid gap-1">
              <LinhaDado
                rotulo={aberto.tipo === "retirada" ? "Retirada" : "Entrega"}
                valor={
                  aberto.tipo === "retirada" ? (
                    `Busca em: ${aberto.lojaNome || "balcão"}`
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin size={14} /> {aberto.endereco || "Sem endereço"}
                    </span>
                  )
                }
              />
              <LinhaDado
                rotulo="Telefone"
                valor={
                  aberto.telefone ? (
                    <a
                      className="inline-flex items-center gap-1.5 underline"
                      href={`tel:${aberto.telefone.replace(/\D/g, "")}`}
                    >
                      <Phone size={14} /> {aberto.telefone}
                    </a>
                  ) : (
                    "Não informado"
                  )
                }
              />
              <LinhaDado
                rotulo="Pagamento"
                valor={
                  <span className="inline-flex items-center gap-1.5">
                    <Banknote size={14} /> {pagamentoLabel(aberto.pagamento)}
                    {aberto.pagamento === "dinheiro" && (aberto.troco ?? 0) > 0
                      ? ` · troco para ${brl(aberto.troco!)}`
                      : ""}
                  </span>
                }
              />
              {aberto.observacao ? (
                <LinhaDado rotulo="Observação" valor={aberto.observacao} />
              ) : null}
              {aberto.codigoEntrega ? (
                <LinhaDado rotulo="Código de entrega" valor={<b className="tabular">{aberto.codigoEntrega}</b>} />
              ) : null}
              <LinhaDado rotulo="Feito em" valor={diaHora(aberto.criadoEm)} />
            </div>

            {!encerrado(aberto) && (
              <div className="flex flex-wrap gap-2">
                {FLUXO[aberto.status].proximo && (
                  <Button
                    disabled={salvando}
                    onClick={() => mudar(aberto, FLUXO[aberto.status].proximo!)}
                  >
                    {FLUXO[aberto.status].acao}
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={salvando}
                  onClick={() => mudar(aberto, "cancelado")}
                >
                  Cancelar pedido
                </Button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
