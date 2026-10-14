import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { IS_DEMO, demoData } from "./demo";
import type { AppUser } from "./types";

/**
 * Carrega apenas os perfis citados por uma lista, por id.
 *
 * O documento de cobrança guarda só o `userId`; nome e e-mail moram em `users`.
 * As telas resolviam isso assinando a coleção `users` inteira — 5.000 leituras
 * para escrever 50 nomes numa tabela, e crescendo com o clube.
 *
 * Aqui o custo passa a ser proporcional ao que está NA TELA: uma leitura por
 * sócio distinto da página, e nada é relido enquanto o mapa já tiver o id.
 */
export function useUsuariosPorId(uids: string[]): Map<string, AppUser> {
  const [cache, setCache] = useState<Map<string, AppUser>>(new Map());

  // Ordena para a chave não mudar só porque a lista veio em outra ordem.
  const chave = useMemo(() => [...new Set(uids)].filter(Boolean).sort().join(","), [uids]);

  useEffect(() => {
    if (IS_DEMO) {
      const m = new Map<string, AppUser>();
      ((demoData["users"] ?? []) as AppUser[]).forEach((u) => m.set(u.uid, u));
      setCache(m);
      return;
    }

    let cancelado = false;
    const pedir = chave ? chave.split(",") : [];

    (async () => {
      // Só o que ainda não está em mãos.
      const faltando = pedir.filter((uid) => !cache.has(uid));
      if (faltando.length === 0) return;

      const achados: [string, AppUser][] = [];
      // Em pedaços, para não abrir centenas de requisições de uma vez.
      for (let i = 0; i < faltando.length; i += 25) {
        const lote = faltando.slice(i, i + 25);
        const snaps = await Promise.all(
          lote.map((uid) => getDoc(doc(db, "users", uid)).catch(() => null))
        );
        snaps.forEach((s) => {
          if (s && s.exists()) {
            // O id do documento É o uid (users/{uid}); o campo `uid` de dentro
            // é espelho dele. Vale o id, que existe sempre.
            achados.push([s.id, { ...s.data(), uid: s.id } as AppUser]);
          }
        });
        if (cancelado) return;
      }

      if (!cancelado && achados.length) {
        setCache((antigo) => {
          const novo = new Map(antigo);
          achados.forEach(([k, v]) => novo.set(k, v));
          return novo;
        });
      }
    })();

    return () => {
      cancelado = true;
    };
    // `cache` de propósito fora das dependências: ele é escrito aqui dentro, e
    // incluí-lo faria o efeito rodar de novo a cada perfil carregado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return cache;
}
