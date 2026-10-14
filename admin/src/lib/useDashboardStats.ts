import { useCallback, useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  getCountFromServer,
  getAggregateFromServer,
  sum,
  Timestamp,
  type Query,
} from "firebase/firestore";
import { db } from "./firebase";
import { IS_DEMO, demoData } from "./demo";
import { useRecarregarAoVivo } from "./aoVivo";
import type { AppUser, Subscription, Payment, Redemption } from "./types";

/**
 * Números do Dashboard, calculados NO SERVIDOR.
 *
 * O painel montava esses totais em JavaScript, e para isso baixava `users`,
 * `subscriptions`, `payments` e `redemptions` inteiras — 17.531 documentos por
 * abertura no cenário medido (5.000 sócios, 10.000 contas de salão). Duas
 * coisas erradas com isso: `payments` cresce a cada conta fechada no salão e
 * nunca para, então o custo e o tempo de abrir o painel só sobem; e cedo ou
 * tarde o navegador do dono não segura o array.
 *
 * Consulta de agregação cobra 1 leitura a cada 1.000 entradas de índice
 * varridas, em vez de 1 por documento. São ~20 consultas no lugar de 17.531
 * documentos.
 *
 * Agregação é consulta pontual, não listener. Para os cartões não ficarem
 * parados até alguém recarregar a página, as consultas são refeitas ao voltar
 * para a aba e a cada minuto com a aba visível (`useRecarregarAoVivo`), em
 * segundo plano — sem piscar o carregando nem trocar os números por erro
 * passageiro de rede. O botão de atualizar continua refazendo na hora.
 */

export interface DashboardStats {
  ativos: number;
  cadastrados: number;
  novosMes: number;
  mrr: number;
  mrrAnterior: number;
  cancelados: number;
  pendentes: number;
  resgates: number;
  receita: { mes: string; valor: number }[];
  crescimento: { mes: string; membros: number }[];
  /**
   * A soma do recebido falhou — os outros números valem. Separado de propósito:
   * a soma precisa do índice `payments (status, data, valor)`, e quando ele
   * faltou, a falha de UMA consulta derrubava o Promise.all inteiro e o Início
   * girava para sempre em produção.
   */
  receitaIndisponivel: boolean;
}

const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const contar = async (q: Query) => (await getCountFromServer(q)).data().count;

/**
 * Soma `valor` das cobranças aprovadas dentro da janela. `null` quando a
 * consulta falha — o SDK do Firestore já registra o motivo no console, com o
 * link do índice quando é índice.
 */
async function somarReceita(inicio: Date, fim: Date): Promise<number | null> {
  const q = query(
    collection(db, "payments"),
    where("status", "==", "aprovado"),
    where("data", ">=", Timestamp.fromDate(inicio)),
    where("data", "<=", Timestamp.fromDate(fim))
  );
  try {
    const snap = await getAggregateFromServer(q, { total: sum("valor") });
    return snap.data().total ?? 0;
  } catch {
    return null;
  }
}

/** Os 6 meses da janela móvel, terminando no mês corrente. */
function janelaDeMeses(agora: Date) {
  return Array.from({ length: 6 }, (_, k) => {
    const d = new Date(agora.getFullYear(), agora.getMonth() - (5 - k), 1);
    const outroAno = d.getFullYear() !== agora.getFullYear();
    return {
      inicio: d,
      fim: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999),
      // Vira do ano: rotula "Dez/25" pra não parecer o dezembro deste ano.
      rotulo: meses[d.getMonth()] + (outroAno ? `/${String(d.getFullYear()).slice(2)}` : ""),
    };
  });
}

/** Caminho do modo demo: soma em memória os dados fictícios, sem tocar a rede. */
function statsDemo(agora: Date): DashboardStats {
  const users = (demoData["users"] ?? []) as AppUser[];
  const subs = (demoData["subscriptions"] ?? []) as Subscription[];
  const payments = (demoData["payments"] ?? []) as Payment[];
  const redemptions = (demoData["redemptions"] ?? []) as Redemption[];
  const janela = janelaDeMeses(agora);

  const soma = (inicio: Date, fim: Date) =>
    payments
      .filter(
        (p) => p.status === "aprovado" && p.data && p.data >= inicio && p.data <= fim
      )
      .reduce((a, p) => a + (p.valor || 0), 0);

  const mesAtual = janela[5];
  const mesPassado = janela[4];

  return {
    ativos: subs.filter((s) => s.status === "active").length,
    cadastrados: users.filter((u) => u.role !== "admin").length,
    novosMes: users.filter((u) => u.criadoEm && u.criadoEm >= mesAtual.inicio).length,
    mrr: soma(mesAtual.inicio, mesAtual.fim),
    mrrAnterior: soma(mesPassado.inicio, mesPassado.fim),
    cancelados: subs.filter((s) => s.status === "canceled").length,
    pendentes: redemptions.filter((r) => r.status === "disponivel").length,
    resgates: redemptions.length,
    receita: janela.map((j) => ({ mes: j.rotulo, valor: soma(j.inicio, j.fim) })),
    crescimento: janela.map((j) => ({
      mes: j.rotulo,
      membros: users.filter((u) => u.criadoEm && u.criadoEm <= j.fim).length,
    })),
    receitaIndisponivel: false,
  };
}

export function useDashboardStats(agora: Date) {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Só o mês importa para a janela: sem isto o `useAgora` (que anda de minuto
  // em minuto) refaria as 20 consultas o tempo todo.
  const chaveDoMes = `${agora.getFullYear()}-${agora.getMonth()}`;

  /**
   * [silencioso]: atualização de fundo. Não liga o carregando e, se falhar,
   * mantém os números que já estão na tela em vez de mostrar erro.
   */
  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) {
      setLoading(true);
      setError(null);
    }
    try {
      if (IS_DEMO) {
        setData(statsDemo(agora));
        return;
      }

      const janela = janelaDeMeses(agora);
      const mesAtual = janela[5];

      const users = collection(db, "users");
      const subs = collection(db, "subscriptions");
      const resg = collection(db, "redemptions");

      const [
        totalUsuarios,
        admins,
        ativos,
        cancelados,
        novosMes,
        resgates,
        pendentes,
        receitaBruta,
        crescimento,
      ] = await Promise.all([
        contar(query(users)),
        // `cadastrados` é o total menos os admins. Não dá para usar
        // `where('role','!=','admin')`: perfil criado pelo app não tem o campo
        // `role`, e consulta de desigualdade descarta documento sem o campo —
        // os sócios sumiriam da conta.
        contar(query(users, where("role", "==", "admin"))),
        contar(query(subs, where("status", "==", "active"))),
        contar(query(subs, where("status", "==", "canceled"))),
        contar(query(users, where("criadoEm", ">=", Timestamp.fromDate(mesAtual.inicio)))),
        contar(query(resg)),
        contar(query(resg, where("status", "==", "disponivel"))),
        Promise.all(
          janela.map(async (j) => ({
            mes: j.rotulo,
            valor: await somarReceita(j.inicio, j.fim),
          }))
        ),
        Promise.all(
          janela.map(async (j) => ({
            mes: j.rotulo,
            membros: await contar(
              query(users, where("criadoEm", "<=", Timestamp.fromDate(j.fim)))
            ),
          }))
        ),
      ]);

      const receitaIndisponivel = receitaBruta.some((r) => r.valor == null);
      const receita = receitaBruta.map((r) => ({ mes: r.mes, valor: r.valor ?? 0 }));

      setData({
        ativos,
        cadastrados: Math.max(0, totalUsuarios - admins),
        novosMes,
        mrr: receita[5].valor,
        mrrAnterior: receita[4].valor,
        cancelados,
        pendentes,
        resgates,
        receita,
        crescimento,
        receitaIndisponivel,
      });
      setError(null);
    } catch (e) {
      if (!silencioso) setError((e as Error).message);
    } finally {
      if (!silencioso) setLoading(false);
    }
    // `agora` muda de minuto em minuto; a janela só depende do mês.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDoMes]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useRecarregarAoVivo(
    () => void carregar(true),
    ["users", "subscriptions", "redemptions", "payments"],
    60_000
  );

  // Embrulhado: quem passa `recarregar` direto num onClick entregaria o evento
  // como primeiro argumento, e ele seria lido como `silencioso`.
  return { data, loading, error, recarregar: () => carregar() };
}
