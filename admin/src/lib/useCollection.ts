import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  type QueryConstraint,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { IS_DEMO, demoData, demoDocs } from "./demo";

/** Converte Timestamps do Firestore em Date recursivamente (nível 1). */
function normalize<T>(id: string, data: Record<string, unknown>): T {
  const out: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "toDate" in v) {
      out[k] = (v as Timestamp).toDate();
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/** Assina uma coleção em tempo real. */
export function useCollection<T>(
  path: string,
  ...constraints: QueryConstraint[]
): { data: T[]; loading: boolean; error: string | null } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Modo demo: devolve dados fictícios, sem tocar o Firestore.
    if (IS_DEMO) {
      setData((demoData[path] as T[]) ?? []);
      setLoading(false);
      return;
    }

    const q = query(collection(db, path), ...constraints);
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => normalize<T>(d.id, d.data())));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return { data, loading, error };
}

/**
 * Assina uma coleção com filtros que MUDAM com a tela.
 *
 * `useCollection` acima existe para coleções pequenas e fixas (planos,
 * cardápio, equipe): as constraints ficam fora do array de dependências, então
 * mudá-las não reassina nada. Para tela com filtro — Financeiro por período,
 * Membros por busca — isso não serve, e baixar a coleção inteira para filtrar
 * em memória serve menos ainda: `payments` cresce a cada conta fechada no salão
 * e nunca para.
 *
 * `chave` é o que decide quando reassinar. Quem chama monta a chave com os
 * valores que entraram no filtro.
 */
export function useCollectionQuery<T>(
  path: string,
  montar: () => QueryConstraint[],
  chave: string,
  teto: number
): { data: T[]; loading: boolean; error: string | null; truncado: boolean } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncado, setTruncado] = useState(false);

  useEffect(() => {
    if (IS_DEMO) {
      setData((demoData[path] as T[]) ?? []);
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      query(collection(db, path), ...montar()),
      (snap) => {
        setData(snap.docs.map((d) => normalize<T>(d.id, d.data())));
        // Bateu no teto: a tela está mostrando um pedaço, e precisa dizer isso.
        setTruncado(snap.size >= teto);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
    // `montar` é recriada a cada render; quem controla a reassinatura é `chave`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, chave, teto]);

  return { data, loading, error, truncado };
}

/** Assina um documento único em tempo real. `path` = "colecao/id". */
export function useDoc<T>(
  path: string
): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (IS_DEMO) {
      setData((demoDocs[path] as T) ?? null);
      setLoading(false);
      return;
    }

    const [col, id] = path.split("/");
    const unsub = onSnapshot(
      doc(db, col, id),
      (snap) => {
        setData(snap.exists() ? normalize<T>(snap.id, snap.data()) : null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [path]);

  return { data, loading, error };
}
