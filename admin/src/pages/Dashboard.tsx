import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Megaphone, Gift, ArrowRight, Plus } from "lucide-react";
import { useCollection } from "../lib/useCollection";
import { useAgora } from "../lib/useAgora";
import { useDashboardStats } from "../lib/useDashboardStats";
import {
  Card,
  Spinner,
  ErrorState,
  PageHeader,
  SectionTitle,
  Stat,
  StatRail,
  Badge,
  LiveDot,
  Button,
} from "../components/ui";
import type { Promotion, Reward } from "../lib/types";
import { brl } from "../lib/format";
import { statusOferta, restanteTexto, quandoTexto } from "../lib/oferta";

// A janela de 6 meses e os rótulos moram em lib/useDashboardStats.ts, junto com
// as consultas que os alimentam.

// ---------------------------------------------------------------------------
// "No ar agora" — a assinatura da tela.
//
// A pergunta que o dono faz dez vezes por dia é "o que meu cliente está vendo
// no app neste minuto, e por quanto tempo ainda". Nenhuma tela respondia: pra
// saber era preciso abrir Promoções, abrir Premiações e comparar data por data.
// Esta faixa é a resposta, e ela se atualiza sozinha (tick de 30s) — a oferta
// que vence com o painel aberto sai daqui sem ninguém dar F5.
// ---------------------------------------------------------------------------

interface ItemNoAr {
  id: string;
  tipo: "promo" | "premio";
  titulo: string;
  fim: Date | null;
  nota?: string;
}

function NoArAgora({
  promocoes,
  premios,
  agora,
}: {
  promocoes: Promotion[];
  premios: Reward[];
  agora: Date;
}) {
  const { noAr, agendadas } = useMemo(() => {
    const noAr: ItemNoAr[] = [];

    promocoes.forEach((p) => {
      if (statusOferta(p, agora) !== "no ar") return;
      noAr.push({
        id: `p_${p.id}`,
        tipo: "promo",
        titulo: p.titulo,
        fim: p.validadeFim ?? null,
        nota: p.apenasAssinantes ? "Só assinantes" : undefined,
      });
    });

    premios.forEach((r) => {
      // Prêmio no ar = tem estoque e o prazo de resgate não passou.
      if (r.estoque <= 0) return;
      if (r.resgatavelAte && agora > r.resgatavelAte) return;
      noAr.push({
        id: `r_${r.id}`,
        tipo: "premio",
        titulo: r.titulo,
        fim: r.resgatavelAte ?? null,
        nota: `${r.estoque} disponíveis`,
      });
    });

    // Quem termina antes vem primeiro; sem prazo desce pro fim da lista.
    noAr.sort((a, b) => (a.fim?.getTime() ?? Infinity) - (b.fim?.getTime() ?? Infinity));

    const agendadas = promocoes
      .filter((p) => statusOferta(p, agora) === "agendada")
      .sort((a, b) => (a.validadeInicio!.getTime() ?? 0) - (b.validadeInicio!.getTime() ?? 0));

    return { noAr, agendadas };
  }, [promocoes, premios, agora]);

  return (
    <section className="mb-6 sm:mb-8">
      <SectionTitle
        acao={
          <Link
            to="/promocoes"
            className="flex items-center gap-1 text-[13px] font-semibold text-tinta-3 transition-colors hover:text-marca-tinta"
          >
            Promoções <ArrowRight size={14} />
          </Link>
        }
      >
        No ar agora no app
      </SectionTitle>

      <Card plano>
        {noAr.length === 0 ? (
          <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-tinta-2">
              Nada no ar. Quem abrir o app agora vê só o cardápio.
            </p>
            <Link to="/promocoes">
              <Button size="sm">
                <Plus size={16} /> Criar promoção
              </Button>
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-linha">
            {noAr.map((item) => (
              <LinhaNoAr key={item.id} item={item} agora={agora} />
            ))}
          </ul>
        )}

        {agendadas.length > 0 && (
          <div className="border-t border-linha bg-superficie-2/60 px-4 py-3 text-[13px] text-tinta-2 sm:px-5">
            <span className="font-semibold text-tinta">
              {agendadas.length === 1
                ? "1 promoção agendada"
                : `${agendadas.length} promoções agendadas`}
            </span>{" "}
            — a próxima é “{agendadas[0].titulo}”, entra{" "}
            {quandoTexto(agendadas[0].validadeInicio!, agora)}.
          </div>
        )}
      </Card>
    </section>
  );
}

function LinhaNoAr({ item, agora }: { item: ItemNoAr; agora: Date }) {
  const Icone = item.tipo === "promo" ? Megaphone : Gift;
  // Últimas 24 horas: o prazo vira laranja. É quando ainda dá pra estender.
  const acabando = !!item.fim && item.fim.getTime() - agora.getTime() < 24 * 60 * 60 * 1000;

  return (
    <li className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-marca/10 text-marca-tinta">
        <Icone size={17} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{item.titulo}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-tinta-3">
          <span>{item.tipo === "promo" ? "Promoção" : "Prêmio"}</span>
          {item.nota && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{item.nota}</span>
            </>
          )}
        </div>
      </div>

      {/* Quanto falta em cima, que horas embaixo: um responde "corro?", o outro
          responde "aviso o salão pra que horas?". */}
      <div className="shrink-0 text-right">
        {item.fim ? (
          <>
            <div
              className={`tabular text-sm font-bold ${
                acabando ? "text-marca-tinta" : "text-tinta"
              }`}
            >
              {restanteTexto(item.fim, agora)}
            </div>
            <div className="tabular mt-0.5 text-xs text-tinta-3">
              sai {quandoTexto(item.fim, agora)}
            </div>
          </>
        ) : (
          <Badge color="green">
            <LiveDot />
            sem prazo
          </Badge>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Gráficos
// ---------------------------------------------------------------------------

/** Balão do gráfico com as cores do painel — o padrão do recharts é branco fixo
 *  e sumia no tema escuro. */
interface BalaoProps {
  /** Injetados pelo recharts — v3 não exporta mais um tipo pro `content`. */
  active?: boolean;
  payload?: { value?: number | string }[];
  label?: string | number;
  formato: (v: number) => string;
  nome: string;
}

function Balao({ active, payload, label, formato, nome }: BalaoProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-linha bg-superficie px-3 py-2 shadow-lg">
      <div className="rotulo mb-1">{label}</div>
      <div className="tabular text-sm font-semibold">
        {formato(Number(payload[0].value))}{" "}
        <span className="font-normal text-tinta-3">{nome}</span>
      </div>
    </div>
  );
}

const eixo = {
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  stroke: "var(--p-tinta-3)",
} as const;

export function Dashboard() {
  const agora = useAgora();
  // Os totais vêm de consultas de agregação, calculadas no servidor. Baixar
  // `users` + `subscriptions` + `payments` + `redemptions` inteiras só pra
  // somar custava 17.531 documentos por abertura, e `payments` cresce a cada
  // conta fechada no salão. Ver lib/useDashboardStats.ts.
  const { data: stats, loading: lu, error: eu, recarregar } = useDashboardStats(agora);
  // Estes dois seguem ao vivo: são listas curtas, e é delas que sai o "no ar
  // agora" das ofertas.
  const { data: promocoes } = useCollection<Promotion>("promotions");
  const { data: premios } = useCollection<Reward>("rewards");
  const erro = eu;

  // Carregando só enquanto ainda não há número nenhum. Era `lu || !stats`: se
  // a primeira carga falhasse, `stats` ficava vazio e a tela girava para
  // sempre, sem nunca mostrar o erro — foi o que aconteceu em produção com a
  // soma do recebido sem índice.
  if (!stats) {
    if (lu) return <Spinner />;
    return <ErrorState mensagem={erro ?? "Não foi possível carregar os números do Início."} />;
  }

  // Comparação em reais, não em porcentagem: com base pequena o percentual vira
  // "+11964%", que é verdade e não ajuda ninguém a decidir nada.
  const comparativo = stats.receitaIndisponivel
    ? "ainda não pôde ser somado"
    : stats.mrrAnterior > 0
      ? `mês passado: ${brl(stats.mrrAnterior)}`
      : "primeiro mês com cobrança";

  return (
    <div>
      <PageHeader
        titulo="Início"
        eyebrow={agora.toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
        })}
        descricao="Como o Clube está indo e o que está valendo neste minuto."
      />

      {erro && (
        <div className="mb-6">
          <ErrorState mensagem={erro} />
        </div>
      )}

      {stats.receitaIndisponivel && (
        <div className="mb-6 rounded-2xl border border-marca/30 bg-marca/8 p-4 text-sm text-marca-tinta">
          O valor recebido ainda não pôde ser somado — os outros números estão
          certos. Ele aparece aqui sozinho assim que a consulta voltar a funcionar.
        </div>
      )}

      <section className="mb-6 sm:mb-8">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle>Números do mês</SectionTitle>
          {/* Somar no servidor é o que evita baixar a base inteira a cada
              abertura. Os números se refazem sozinhos a cada minuto e ao
              voltar para a aba; o botão refaz na hora. */}
          <Button variant="ghost" size="sm" onClick={() => void recarregar()}>
            Atualizar
          </Button>
        </div>
        <StatRail>
          <Stat
            rotulo="Recebido no mês"
            valor={stats.receitaIndisponivel ? "—" : brl(stats.mrr)}
            destaque
            dica={comparativo}
          />
          <Stat
            rotulo="Membros ativos"
            valor={String(stats.ativos)}
            dica={`de ${stats.cadastrados} cadastrados`}
          />
          <Stat rotulo="Novos no mês" valor={String(stats.novosMes)} dica="entraram no clube" />
          <Stat
            rotulo="Cancelamentos"
            valor={String(stats.cancelados)}
            dica="desde o início"
          />
          <Stat
            rotulo="Resgates a validar"
            valor={String(stats.pendentes)}
            dica={`${stats.resgates} no total`}
          />
        </StatRail>
      </section>

      <div className="mb-6 grid gap-4 sm:mb-8 sm:gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>Recebido por mês (R$)</SectionTitle>
          <Card>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={stats.receita} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F47A20" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#F47A20" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {/* Só as horizontais: as verticais já são marcadas pelos meses
                    no eixo de baixo, então repetiriam a informação em traço. */}
                <CartesianGrid vertical={false} stroke="var(--p-linha)" />
                <XAxis dataKey="mes" {...eixo} />
                {/* Sem "R$" no eixo: o prefixo quebrava o rótulo em duas linhas.
                    A moeda já está no título da seção e no balão. */}
                <YAxis
                  {...eixo}
                  width={44}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip
                  cursor={{ stroke: "var(--p-linha-forte)" }}
                  content={<Balao formato={brl} nome="recebido" />}
                />
                <Area
                  type="monotone"
                  dataKey="valor"
                  stroke="#F47A20"
                  strokeWidth={2}
                  fill="url(#rev)"
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--p-superficie)" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <div>
          <SectionTitle>Membros no clube</SectionTitle>
          <Card>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={stats.crescimento} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--p-linha)" />
                <XAxis dataKey="mes" {...eixo} />
                <YAxis {...eixo} width={32} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: "var(--p-linha-forte)" }}
                  content={<Balao formato={(v) => String(v)} nome="membros" />}
                />
                <Line
                  type="monotone"
                  dataKey="membros"
                  stroke="var(--p-ok-tinta)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--p-superficie)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>

      {/* Por último e no fim da página: o número do mês e a tendência abrem a
          tela, e a faixa do que está valendo agora fecha — é o bloco que muda
          sozinho a cada 30s, então fica onde o olho pousa por último. */}
      <NoArAgora promocoes={promocoes} premios={premios} agora={agora} />
    </div>
  );
}
