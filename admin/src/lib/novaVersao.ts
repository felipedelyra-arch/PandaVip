import { useEffect, useState } from "react";

/**
 * Detecta que um painel mais novo foi publicado enquanto esta aba estava aberta.
 *
 * O painel é uma SPA: trocar de tela não recarrega o HTML, então uma aba aberta
 * antes do deploy segue rodando o JavaScript antigo indefinidamente — foi assim
 * que a correção da tela de Configurações "não chegou" até um Ctrl+Shift+R.
 *
 * Compara o bundle que esta aba carregou com o que o `/index.html` publicado
 * aponta agora. `/index.html` sai com `no-cache` do Hosting, e o
 * `cache: "no-store"` garante que o fetch não pegue cópia guardada.
 */

const INTERVALO = 5 * 60_000;
const BUNDLE = /\/assets\/index-[\w-]+\.js/;

function bundleDestaAba(): string | null {
  const s = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/index-"]'
  );
  return s?.getAttribute("src")?.match(BUNDLE)?.[0] ?? null;
}

/** `true` quando existe versão publicada mais nova que a desta aba. */
export function useNovaVersao(): boolean {
  const [nova, setNova] = useState(false);

  useEffect(() => {
    const atual = bundleDestaAba();
    // `vite dev` não serve bundle com hash: não há o que comparar.
    if (!atual) return;

    let vivo = true;
    let ultimo = 0;
    const conferir = async () => {
      if (document.visibilityState !== "visible" || Date.now() - ultimo < 10_000) return;
      ultimo = Date.now();
      try {
        const html = await (await fetch("/index.html", { cache: "no-store" })).text();
        const publicado = html.match(BUNDLE)?.[0];
        if (vivo && publicado && publicado !== atual) setNova(true);
      } catch {
        // Sem rede: confere de novo na próxima volta.
      }
    };

    const timer = window.setInterval(conferir, INTERVALO);
    document.addEventListener("visibilitychange", conferir);
    window.addEventListener("focus", conferir);
    return () => {
      vivo = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", conferir);
      window.removeEventListener("focus", conferir);
    };
  }, []);

  return nova;
}
