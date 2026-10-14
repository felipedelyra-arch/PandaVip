import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { IS_DEMO, demoData } from "./demo";
import type { Payment, Redemption } from "./types";

/** Quantas linhas de histórico a ficha mostra. */
const TETO = 50;

/**
 * Histórico de um sócio: cobranças e resgates, ao vivo enquanto a ficha está
 * aberta.
 *
 * A tela de Membros assinava `payments` e `redemptions` INTEIRAS só para
 * filtrar, em memória, as linhas de quem o dono clicou. Baixava 10.000 contas
 * de salão para exibir as 6 de uma pessoa — e `payments` cresce a cada conta
 * fechada, para sempre.
 *
 * A consulta é por `userId`, com teto, e só existe enquanto uma ficha está
 * aberta. Listener, e não leitura única: com a ficha aberta, um consumo lançado
 * no salão ou um resgate validado no caixa aparece na hora, sem recarregar. O
 * custo segue limitado ao teto, e a assinatura morre quando a ficha fecha.
 */
export function useFichaDoSocio(uid: string | null) {
  const [pagamentos, setPagamentos] = useState<Payment[]>([]);
  const [resgates, setResgates] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uid) {
      setPagamentos([]);
      setResgates([]);
      return;
    }

    if (IS_DEMO) {
      setPagamentos(
        ((demoData["payments"] ?? []) as Payment[]).filter((p) => p.userId === uid)
      );
      setResgates(
        ((demoData["redemptions"] ?? []) as Redemption[]).filter((r) => r.userId === uid)
      );
      return;
    }

    setLoading(true);

    const paraDate = (v: unknown) =>
      v && typeof v === "object" && "toDate" in v
        ? (v as Timestamp).toDate()
        : (v as Date | undefined);

    // O carregando some quando as DUAS consultas responderam pela primeira vez
    // (com dados ou com erro), não na primeira que chegar.
    let pagamentosChegaram = false;
    let resgatesChegaram = false;
    const talvezPronto = () => {
      if (pagamentosChegaram && resgatesChegaram) setLoading(false);
    };

    const pararPagamentos = onSnapshot(
      query(
        collection(db, "payments"),
        where("userId", "==", uid),
        orderBy("data", "desc"),
        limit(TETO)
      ),
      (pg) => {
        setPagamentos(
          pg.docs.map((d) => ({ id: d.id, ...d.data(), data: paraDate(d.get("data")) }) as Payment)
        );
        pagamentosChegaram = true;
        talvezPronto();
      },
      () => {
        pagamentosChegaram = true;
        talvezPronto();
      }
    );

    const pararResgates = onSnapshot(
      query(
        collection(db, "redemptions"),
        where("userId", "==", uid),
        orderBy("criadoEm", "desc"),
        limit(TETO)
      ),
      (rs) => {
        setResgates(
          rs.docs.map(
            (d) => ({ id: d.id, ...d.data(), criadoEm: paraDate(d.get("criadoEm")) }) as Redemption
          )
        );
        resgatesChegaram = true;
        talvezPronto();
      },
      () => {
        resgatesChegaram = true;
        talvezPronto();
      }
    );

    return () => {
      pararPagamentos();
      pararResgates();
    };
  }, [uid]);

  return { pagamentos, resgates, loading };
}
