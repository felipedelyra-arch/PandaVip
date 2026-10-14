import { PandaLogo } from "./PandaLogo";

/**
 * Primeira tela do painel, enquanto o Firebase confirma quem entrou.
 *
 * Sem nome ainda, mostra só a marca — inventar uma saudação antes de saber com
 * quem se fala seria pior que ficar quieto. Assim que o login resolve, o nome
 * entra e a saudação repete a do app ("Que bom te ver!"), que é a mesma frase
 * que o cliente lê do outro lado.
 */
export function Splash({ nome }: { nome?: string | null }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-marca p-6 text-sobre-marca">
      <PandaLogo size={120} />

      {nome ? (
        <p
          className="display text-center text-[26px] leading-tight sm:text-[32px]"
          style={{ animation: "panda-surge 420ms ease-out both" }}
        >
          Que bom te ver, {nome}!
        </p>
      ) : (
        // Espaço reservado: sem ele a logo pula pra cima quando o nome chega.
        <div className="h-[34px] sm:h-[42px]" aria-hidden />
      )}

      <div className="h-0.5 w-24 overflow-hidden rounded-full bg-sobre-marca/15">
        <div
          className="h-full w-1/3 rounded-full bg-sobre-marca"
          style={{ animation: "panda-carrega 1.1s ease-in-out infinite" }}
        />
      </div>
      <span className="sr-only" role="status">
        Carregando o painel
      </span>
    </div>
  );
}
