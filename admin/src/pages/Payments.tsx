import { useMemo, useState } from "react";
import { Download, ChevronRight, Store, CreditCard, Plus } from "lucide-react";
import {
  where,
  orderBy,
  limit,
  Timestamp,
  type QueryConstraint,
} from "firebase/firestore";
import { useCollectionQuery } from "../lib/useCollection";
import { useUsuariosPorId } from "../lib/useUsuariosPorId";
import type { AppUser, Payment } from "../lib/types";
import {
  Card,
  Badge,
  Avatar,
  Spinner,
  EmptyState,
  ErrorState,
  PageHeader,
  Button,
  Stat,
  StatRail,
  SectionTitle,
  Segmented,
  LinhaDado,
} from "../components/ui";
import { Sheet } from "../components/Modal";
import { LancarConsumo } from "../components/LancarConsumo";
import { brl, diaHora, metodoLabel } from "../lib/format";
import { quandoTexto } from "../lib/oferta";

type Periodo = "7" | "30" | "90" | "tudo";
type Tipo = "todos" | "assinatura" | "consumo";
type Metodo = "todos" | "cartao" | "pix" | "dinheiro";

/** Cobrança antiga não tem `tipo`; tudo que existia era mensalidade. */
const tipoDe = (p: Payment) => p.tipo ?? "assinatura";

const aprovado = (p: Payment) => p.status === "aprovado";

/**
 * A frase da coluna "O que foi". É o coração do pedido: o dono quer bater o
 * olho e saber onde o dinheiro foi gasto, sem abrir nada.
 */
function descricaoCurta(p: Payment): string {
  if (tipoDe(p) === "assinatura") return "Mensalidade do PandaVip";
  const partes = [p.mesa ? `Mesa ${p.mesa}` : "Consumo no salão"];
  const n = p.itens?.length ?? 0;
  if (n) partes.push(n === 1 ? "1 item" : `${n} itens`);
  if (p.atendente) partes.push(p.atendente);
  return partes.join(" · ");
}

/** Teto de cobranças carregadas por vez. Acima disso a tela avisa. */
const TETO = 1000;

export function Payments() {
  const [periodo, setPeriodo] = useState<Periodo>("30");
  const [tipo, setTipo] = useState<Tipo>("todos");
  const [metodo, setMetodo] = useState<Metodo>("todos");
  const [aberto, setAberto] = useState<Payment | null>(null);
  const [lancando, setLancando] = useState(false);

  // O período vai para a CONSULTA, não para o filtro em memória. Antes a tela
  // baixava `payments` inteira e descartava o que estava fora da janela — e
  // essa coleção ganha um documento a cada conta fechada no salão, para
  // sempre. "Últimos 30 dias" agora custa 30 dias de dados.
  const { data, loading, error, truncado } = useCollectionQuery<Payment>(
    "payments",
    () => {
      const cs: QueryConstraint[] = [];
      if (periodo !== "tudo") {
        cs.push(
          where(
            "data",
            ">=",
            Timestamp.fromMillis(Date.now() - Number(periodo) * 24 * 60 * 60 * 1000)
          )
        );
      }
      cs.push(orderBy("data", "desc"), limit(TETO));
      return cs;
    },
    periodo,
    TETO
  );

  // Só os sócios que aparecem nesta página, buscados por id. A tela lia `users`
  // inteira para resolver nome e e-mail — 5.000 leituras para exibir 50 linhas.
  const uids = useMemo(() => data.map((p) => p.userId), [data]);
  const porUid = useUsuariosPorId(uids);

  const nome = (uid: string) => porUid.get(uid)?.nome || porUid.get(uid)?.email || `${uid.slice(0, 10)}…`;

  // Tipo e método seguem em memória: são poucos valores possíveis, e filtrar no
  // servidor exigiria um índice composto por combinação.
  const filtrados = useMemo(() => {
    return data
      .filter((p) => metodo === "todos" || p.metodo === metodo)
      .filter((p) => tipo === "todos" || tipoDe(p) === tipo);
  }, [data, metodo, tipo]);

  const resumo = useMemo(() => {
    const ok = filtrados.filter(aprovado);
    const total = ok.reduce((a, p) => a + (p.valor || 0), 0);
    const desconto = ok.reduce((a, p) => a + (p.descontoClube || 0), 0);
    return {
      total,
      desconto,
      quantas: ok.length,
      recusadas: filtrados.length - ok.length,
      ticket: ok.length ? total / ok.length : 0,
    };
  }, [filtrados]);

  function exportarCSV() {
    const linhas = [
      ["Cliente", "E-mail", "Tipo", "Mesa", "Atendente", "Itens", "Valor", "Desconto do clube", "Método", "Status", "Data", "Ref"],
      ...filtrados.map((p) => [
        nome(p.userId),
        porUid.get(p.userId)?.email ?? "",
        tipoDe(p),
        p.mesa ?? "",
        p.atendente ?? "",
        (p.itens ?? []).map((i) => `${i.quantidade}x ${i.nome}`).join(" | "),
        String(p.valor),
        String(p.descontoClube ?? 0),
        p.metodo,
        p.status,
        p.data ? p.data.toLocaleString("pt-BR") : "",
        p.gatewayRef ?? "",
      ]),
    ];
    const csv = linhas.map((l) => l.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pagamentos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorState mensagem={error} />;

  const vazioTexto =
    tipo === "consumo"
      ? "Nenhuma conta de salão neste período. Enquanto o sistema de comanda não envia sozinho, use “Lançar consumo” pra registrar a conta na mão — a mensalidade, que vem do gateway, já cai sozinha."
      : "Nenhuma cobrança com esses filtros. Tente um período maior.";

  return (
    <div>
      <PageHeader
        titulo="Pagamentos"
        eyebrow="Dinheiro que entrou"
        descricao="Mensalidade do clube e conta fechada no salão, na mesma lista."
        acao={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportarCSV} disabled={!filtrados.length}>
              <Download size={17} /> Exportar CSV
            </Button>
            {/* Enquanto o PDV não envia sozinho, é por aqui que mesa,
                atendente e itens entram. */}
            <Button onClick={() => setLancando(true)}>
              <Plus size={17} /> Lançar consumo
            </Button>
          </div>
        }
      />

      <LancarConsumo open={lancando} onClose={() => setLancando(false)} />

      {/* A lista tem teto. Sem este aviso, os totais abaixo pareceriam o
          período inteiro quando são só as mais recentes — e o dono fecharia o
          mês com número menor que a verdade, sem nada indicando isso. */}
      {truncado && (
        <div className="mb-4 rounded-xl border border-marca/40 bg-marca/10 px-4 py-3 text-sm text-tinta">
          Mostrando as <strong>{TETO.toLocaleString("pt-BR")}</strong> cobranças
          mais recentes deste período — há mais além disso, e os totais abaixo
          contam só o que está na lista. Escolha um período menor para fechar a
          conta certa.
        </div>
      )}

      {/* Filtros numa fita só, acima dos números: mudar o filtro muda o que os
          números contam, então eles precisam estar à vista juntos. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="Período"
          value={periodo}
          onChange={setPeriodo}
          options={[
            { valor: "7", label: "7 dias" },
            { valor: "30", label: "30 dias" },
            { valor: "90", label: "90 dias" },
            { valor: "tudo", label: "Tudo" },
          ]}
        />
        <Segmented
          ariaLabel="Tipo de cobrança"
          value={tipo}
          onChange={setTipo}
          options={[
            { valor: "todos", label: "Tudo" },
            { valor: "assinatura", label: "Mensalidade" },
            { valor: "consumo", label: "Salão" },
          ]}
        />
        {/* Sem `inputBase` aqui: ele começa com `w-full`, e um `w-auto` depois
            não desempata — as duas utilidades têm a mesma especificidade. */}
        <select
          aria-label="Forma de pagamento"
          className="min-h-9 rounded-xl border border-linha bg-superficie-2 px-3 text-[13px] font-semibold outline-none transition-colors focus:border-marca"
          value={metodo}
          onChange={(e) => setMetodo(e.target.value as Metodo)}
        >
          <option value="todos">Toda forma</option>
          <option value="cartao">Cartão</option>
          <option value="pix">Pix</option>
          <option value="dinheiro">Dinheiro</option>
        </select>
      </div>

      <div className="mb-6 sm:mb-8">
        <StatRail>
          <Stat rotulo="Recebido" valor={brl(resumo.total)} destaque dica="só o que foi aprovado" />
          <Stat
            rotulo="Cobranças"
            valor={String(resumo.quantas)}
            dica={resumo.recusadas ? `${resumo.recusadas} recusada(s)` : "nenhuma recusada"}
          />
          <Stat rotulo="Ticket médio" valor={brl(resumo.ticket)} dica="por cobrança" />
          <Stat
            rotulo="Desconto do clube"
            valor={brl(resumo.desconto)}
            dica="economia dada aos membros"
          />
          <Stat
            rotulo="No salão"
            valor={String(filtrados.filter((p) => tipoDe(p) === "consumo").length)}
            dica="contas de mesa"
          />
        </StatRail>
      </div>

      <SectionTitle>
        {filtrados.length === 1 ? "1 cobrança" : `${filtrados.length} cobranças`}
      </SectionTitle>

      {!filtrados.length ? (
        <EmptyState mensagem={vazioTexto} />
      ) : (
        <Card plano>
          {/* Cabeçalho da tabela só no desktop; no celular cada cobrança é uma
              linha alta com o essencial, que é o que cabe em 360px. */}
          <div className="hidden grid-cols-[1.5fr_1.7fr_9rem_13rem] gap-4 border-b border-linha px-5 py-2.5 sm:grid">
            <span className="rotulo">Cliente</span>
            <span className="rotulo">O que foi</span>
            <span className="rotulo">Quando</span>
            <span className="rotulo text-right">Valor</span>
          </div>

          <ul className="divide-y divide-linha">
            {filtrados.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setAberto(p)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-superficie-2 sm:grid sm:grid-cols-[1.5fr_1.7fr_9rem_13rem] sm:gap-4 sm:px-5"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar nome={nome(p.userId)} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {nome(p.userId)}
                      </span>
                      <span className="block truncate text-xs text-tinta-3">
                        {porUid.get(p.userId)?.email ?? p.userId}
                      </span>
                    </span>
                  </span>

                  <span className="hidden min-w-0 items-center gap-2 sm:flex">
                    <span className="shrink-0 text-tinta-3">
                      {tipoDe(p) === "consumo" ? <Store size={15} /> : <CreditCard size={15} />}
                    </span>
                    <span className="truncate text-sm text-tinta-2">{descricaoCurta(p)}</span>
                  </span>

                  <span className="tabular hidden text-sm text-tinta-2 sm:block">
                    {p.data ? quandoTexto(p.data) : "—"}
                  </span>

                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-right">
                      <span className="tabular block text-sm font-bold">{brl(p.valor)}</span>
                      <span className="block sm:hidden">
                        <span className="text-xs text-tinta-3">{descricaoCurta(p)}</span>
                      </span>
                      {!aprovado(p) && (
                        <span className="mt-1 block sm:hidden">
                          <Badge color="red">{p.status}</Badge>
                        </span>
                      )}
                    </span>
                    <span className="hidden sm:block">
                      {aprovado(p) ? (
                        <Badge color="green">aprovado</Badge>
                      ) : (
                        <Badge color="red">{p.status}</Badge>
                      )}
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-tinta-3" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <FichaPagamento
        pagamento={aberto}
        cliente={aberto ? porUid.get(aberto.userId) : undefined}
        onClose={() => setAberto(null)}
      />
    </div>
  );
}

/**
 * Ficha da cobrança. É onde mora a resposta completa: quem pagou, o que comeu,
 * em que mesa, quem atendeu e quanto o clube abateu.
 */
function FichaPagamento({
  pagamento: p,
  cliente,
  onClose,
}: {
  pagamento: Payment | null;
  cliente?: AppUser;
  onClose: () => void;
}) {
  if (!p) return null;

  const consumo = tipoDe(p) === "consumo";
  const itens = p.itens ?? [];
  const subtotal = itens.reduce((a, i) => a + i.preco * i.quantidade, 0);

  return (
    <Sheet
      open
      onClose={onClose}
      eyebrow={consumo ? "Conta do salão" : "Mensalidade"}
      title={brl(p.valor)}
    >
      <div className="mb-5 flex items-center gap-2">
        {aprovado(p) ? (
          <Badge color="green">aprovado</Badge>
        ) : (
          <Badge color="red">{p.status}</Badge>
        )}
        <Badge color="gray">{metodoLabel(p.metodo)}</Badge>
        {/* Conta digitada no painel não passou por conferência de máquina —
            quem fecha o mês precisa saber disso sem abrir o histórico. */}
        {p.origem === "manual" && <Badge color="orange">lançada à mão</Badge>}
      </div>

      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-linha bg-superficie-2 p-3.5">
        <Avatar nome={cliente?.nome || "?"} size={40} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{cliente?.nome ?? p.userId}</div>
          <div className="truncate text-sm text-tinta-3">
            {cliente?.email ?? "cliente não encontrado no cadastro"}
          </div>
          {cliente?.telefone && (
            <div className="text-sm text-tinta-3">{cliente.telefone}</div>
          )}
        </div>
      </div>

      {consumo && (
        <section className="mb-5">
          <SectionTitle>No salão</SectionTitle>
          <div className="rounded-2xl border border-linha p-3.5">
            <LinhaDado rotulo="Mesa" valor={p.mesa ?? "não informada"} />
            <LinhaDado rotulo="Atendeu" valor={p.atendente ?? "não informado"} />
          </div>
        </section>
      )}

      {itens.length > 0 && (
        <section className="mb-5">
          <SectionTitle>O que foi consumido</SectionTitle>
          <div className="rounded-2xl border border-linha">
            <ul className="divide-y divide-linha">
              {itens.map((i, k) => (
                <li key={`${i.nome}-${k}`} className="flex items-baseline gap-3 px-3.5 py-2.5">
                  <span className="tabular w-7 shrink-0 text-sm font-semibold text-tinta-3">
                    {i.quantidade}×
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{i.nome}</span>
                  <span className="tabular shrink-0 text-sm font-medium">
                    {brl(i.preco * i.quantidade)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-linha px-3.5 py-2.5">
              <LinhaDado rotulo="Soma dos itens" valor={brl(subtotal)} />
              {!!p.descontoClube && (
                <LinhaDado
                  rotulo="Desconto do clube"
                  valor={<span className="text-ok-tinta">− {brl(p.descontoClube)}</span>}
                />
              )}
              <div className="mt-1.5 flex items-baseline justify-between border-t border-linha pt-2.5">
                <span className="text-sm font-semibold">Pago</span>
                <span className="tabular text-lg font-bold">{brl(p.valor)}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {consumo && itens.length === 0 && (
        <p className="mb-5 rounded-2xl border border-dashed border-linha-forte p-3.5 text-sm text-tinta-2">
          Esta conta veio sem a lista de itens. O detalhamento aparece aqui quando
          o sistema de comanda envia os produtos junto com o valor.
        </p>
      )}

      <section>
        <SectionTitle>Registro</SectionTitle>
        <div className="rounded-2xl border border-linha p-3.5">
          <LinhaDado rotulo="Quando" valor={diaHora(p.data)} />
          <LinhaDado rotulo="Forma" valor={metodoLabel(p.metodo)} />
          <LinhaDado
            rotulo="Referência"
            valor={
              p.gatewayRef ? (
                <span className="font-mono text-xs">{p.gatewayRef}</span>
              ) : (
                "—"
              )
            }
          />
          <LinhaDado rotulo="Identificador" valor={<span className="font-mono text-xs">{p.id}</span>} />
        </div>
      </section>
    </Sheet>
  );
}
