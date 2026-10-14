import { useEffect, useState } from "react";
import {
  collection,
  query,
  getCountFromServer,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "./firebase";
import { IS_DEMO, demoData } from "./demo";
import { useRecarregarAoVivo } from "./aoVivo";

/**
 * Quantos documentos casam com o filtro — contando NO SERVIDOR.
 *
 * Existe porque várias telas baixavam uma coleção inteira para exibir um único
 * número: "3 resgates esperando validação", "este aviso vai para 2.500
 * pessoas". `count()` cobra 1 leitura a cada 1.000 entradas de índice, em vez
 * de 1 por documento.
 *
 * `chave` decide quando recontar; monte-a com o que entra no filtro.
 *
 * Contagem não tem listener no Firestore, então o número é refeito na hora
 * quando o painel avisa que mexeu em `path` (`avisarMudanca`), ao voltar para a
 * aba e a cada 30 s com a aba visível. Enquanto a recontagem não chega, fica o
 * número anterior — a tela não pisca.
 *
 * Em modo demo conta em memória, para o painel de demonstração continuar
 * funcionando sem tocar a rede.
 */
export function useContagem(
  path: string,
  montar: () => QueryConstraint[],
  chave: string,
  filtroDemo?: (doc: Record<string, unknown>) => boolean
): number | null {
  const [n, setN] = useState<number | null>(null);
  const [versao, setVersao] = useState(0);

  useRecarregarAoVivo(() => setVersao((v) => v + 1), [path]);

  useEffect(() => {
    if (IS_DEMO) {
      const todos = (demoData[path] ?? []) as Record<string, unknown>[];
      setN(filtroDemo ? todos.filter(filtroDemo).length : todos.length);
      return;
    }

    let cancelado = false;
    (async () => {
      try {
        const snap = await getCountFromServer(query(collection(db, path), ...montar()));
        if (!cancelado) setN(snap.data().count);
      } catch {
        // Contagem é informação de apoio: falhar aqui não pode derrubar a tela.
        // Numa recontagem, mantém o último número bom em vez de apagá-lo.
      }
    })();

    return () => {
      cancelado = true;
    };
    // `montar` e `filtroDemo` são recriados a cada render; quem manda é `chave`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, chave, versao]);

  return n;
}
