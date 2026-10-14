import { useEffect, useRef } from "react";

/**
 * Atualização "ao vivo" para o que o Firestore não entrega por listener.
 *
 * Lista e documento já chegam em tempo real (`onSnapshot`, em useCollection.ts).
 * Contagem e soma não: são consultas de agregação, pontuais — o Firestore não
 * tem listener de agregação. Sem nada além disso, o número só mudava
 * recarregando a página: o dono gerava os códigos da carteirinha e a tela
 * continuava dizendo "3 sócios ainda estão sem código".
 *
 * O que refaz a consulta:
 *   - **na hora**, quando uma ação do próprio painel avisa que mexeu na coleção
 *     ([avisarMudanca]);
 *   - ao voltar para a aba, para quem estava em outra janela ver o número atual;
 *   - de tempos em tempos, só com a aba visível — cobre o que muda por fora do
 *     painel, como um sócio se cadastrando pelo app.
 */

const EVENTO = "panda:dados-mudaram";

/** Avisa as telas abertas que o painel acabou de mexer em [colecao]. */
export function avisarMudanca(colecao: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENTO, { detail: colecao }));
}

/** Chama [recarregar] nos três momentos descritos acima. */
export function useRecarregarAoVivo(
  recarregar: () => void,
  colecoes: string[],
  intervaloMs = 30_000
) {
  // Ref: quem chama recria a função a cada render, e reassinar os eventos a
  // cada render seria desperdício.
  const fn = useRef(recarregar);
  useEffect(() => {
    fn.current = recarregar;
  });

  const chave = colecoes.join("|");

  useEffect(() => {
    const alvos = chave.split("|");
    let ultimo = Date.now();

    // Trocar de aba dispara `visibilitychange` e às vezes o timer no mesmo
    // instante; a trava evita refazer a mesma consulta duas vezes seguidas.
    const talvez = () => {
      if (document.visibilityState !== "visible" || Date.now() - ultimo < 2_000) return;
      ultimo = Date.now();
      fn.current();
    };
    const aoMudar = (e: Event) => {
      if (alvos.includes((e as CustomEvent<string>).detail)) {
        ultimo = Date.now();
        fn.current();
      }
    };

    const timer = window.setInterval(talvez, intervaloMs);
    window.addEventListener(EVENTO, aoMudar);
    document.addEventListener("visibilitychange", talvez);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(EVENTO, aoMudar);
      document.removeEventListener("visibilitychange", talvez);
    };
  }, [chave, intervaloMs]);
}
