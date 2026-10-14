import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Peças do painel. A regra visual: a página é papel (fundo quente), o conteúdo
 * são fichas brancas separadas por fio de cabelo. Sombra quase não existe —
 * quem separa é a linha, não o relevo. Uma cor de destaque só, o laranja da
 * marca, reservada pro que exige ação ou está valendo agora.
 */

export function Card({
  children,
  className = "",
  plano = false,
}: {
  children: ReactNode;
  className?: string;
  /** Sem respiro interno — pra tabela, que já traz o próprio. */
  plano?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-linha bg-superficie ${
        plano ? "" : "p-4 sm:p-5"
      } ${className}`}
      style={{ boxShadow: "var(--p-sombra)" }}
    >
      {children}
    </div>
  );
}

/**
 * Cabeçalho de página. O título vai em Fraunces — é o único lugar do painel com
 * serifada, o que dá identidade sem atrapalhar a leitura de número nenhum.
 * No celular o título já está na barra de cima, então some daqui.
 */
export function PageHeader({
  titulo,
  eyebrow,
  descricao,
  acao,
}: {
  titulo: string;
  /** Rótulo acima do título. Contexto, não repetição do título. */
  eyebrow?: string;
  descricao?: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="rotulo mb-2">{eyebrow}</div>}
        <h1 className="display hidden text-[26px] leading-none sm:block lg:text-[30px]">
          {titulo}
        </h1>
        {descricao && (
          <p className="text-sm text-tinta-2 sm:mt-2">{descricao}</p>
        )}
      </div>
      {acao && (
        <div className="shrink-0 [&>button]:w-full sm:[&>button]:w-auto">{acao}</div>
      )}
    </div>
  );
}

/**
 * Título de seção com a régua laranja. A régua marca onde um assunto começa —
 * é o mesmo gesto do cabeçalho de uma comanda. Não usar como enfeite solto.
 */
export function SectionTitle({
  children,
  acao,
  className = "",
}: {
  children: ReactNode;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`}>
      <h2 className="flex items-center gap-2.5">
        <span aria-hidden className="h-3.5 w-[3px] shrink-0 rounded-full bg-marca" />
        <span className="rotulo">{children}</span>
      </h2>
      {acao}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "danger" | "ghost";
  size?: "md" | "sm";
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100";
  const sizes = {
    md: "min-h-11 px-4 py-2.5 text-sm",
    sm: "min-h-9 px-3 py-1.5 text-[13px]",
  };
  const variants = {
    primary: "bg-marca text-white hover:bg-marca-escura",
    outline:
      "border border-linha-forte text-tinta hover:border-marca hover:text-marca-tinta",
    danger: "bg-erro text-white hover:opacity-90",
    ghost: "text-tinta-2 hover:bg-superficie-2 hover:text-tinta",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />
  );
}

/**
 * Selo de estado. O texto usa a versão escura da cor — a versão cheia só
 * pinta o fundo. Com o tom cheio no texto o contraste caía pra 2,3:1.
 */
export function Badge({
  children,
  color = "gray",
}: {
  children: ReactNode;
  color?: "green" | "orange" | "red" | "gray";
}) {
  const colors = {
    green: "bg-ok/12 text-ok-tinta",
    orange: "bg-marca/12 text-marca-tinta",
    red: "bg-erro/12 text-erro-tinta",
    gray: "bg-superficie-2 text-tinta-3",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${colors[color]}`}
    >
      {children}
    </span>
  );
}

/**
 * Ponto de "no ar". Só aparece no que está valendo neste minuto — promoção
 * dentro da janela, plano ativo. É o único elemento animado do painel; se
 * espalhar por outros estados, para de querer dizer alguma coisa.
 */
export function LiveDot() {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full bg-current"
      style={{ animation: "panda-pulso 2s ease-in-out infinite" }}
    />
  );
}

/**
 * Um número com o nome dele. Rótulo em cima, valor grande embaixo, dica
 * opcional. Sem ícone colorido em caixinha: cinco caixinhas coloridas lado a
 * lado disputam atenção e nenhuma ganha.
 */
export function Stat({
  rotulo,
  valor,
  dica,
  destaque = false,
}: {
  rotulo: string;
  valor: string;
  dica?: ReactNode;
  /** Um por régua, no máximo — o número que a pessoa veio ver. */
  destaque?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-r border-linha px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="rotulo truncate">{rotulo}</div>
      <div
        className={`numero mt-1.5 truncate ${
          destaque ? "text-[26px] text-marca-tinta sm:text-[30px]" : "text-[22px] sm:text-[26px]"
        }`}
      >
        {valor}
      </div>
      {/* A dica pode quebrar em duas linhas: no celular, com duas colunas,
          "economia dada aos membros" cortava no meio da palavra. */}
      {dica && <div className="mt-1 line-clamp-2 text-xs text-tinta-3">{dica}</div>}
    </div>
  );
}

/**
 * Régua de números: uma ficha só, dividida por fio.
 *
 * As linhas vêm das bordas dos filhos (direita e baixo) e o contêiner fecha só
 * em cima e à esquerda. Assim não há fio dobrado nas quatro bordas e, quando o
 * número de cartões não fecha a última linha da grade, a sobra fica branca em
 * vez de virar um retângulo cinza sem nada dentro.
 */
export function StatRail({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid grid-cols-2 overflow-hidden rounded-2xl border-l border-t border-linha bg-superficie sm:grid-cols-3 lg:grid-cols-5"
      style={{ boxShadow: "var(--p-sombra)" }}
    >
      {children}
    </div>
  );
}

/** Interruptor. Substitui o botão-ícone ambíguo de ligar/desligar. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-tinta-3">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-marca" : "bg-linha-forte"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-[left] ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

/** Filtro de poucas opções, sempre todas à vista. Melhor que select quando
 *  cabe: o dono vê o que existe sem abrir nada. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { valor: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-xl border border-linha bg-superficie-2 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.valor}
          role="tab"
          aria-selected={value === o.valor}
          onClick={() => onChange(o.valor)}
          className={`min-h-9 rounded-[10px] px-3 text-[13px] font-semibold transition-colors ${
            value === o.valor
              ? "bg-superficie text-tinta shadow-sm"
              : "text-tinta-3 hover:text-tinta"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Inicial do nome num círculo. Dá cara de gente à linha de uma tabela.
 *
 * Aceita nome ausente de propósito: perfil em `users` pode existir só com
 * `role` (é o que `scripts/set-first-admin.js` grava quando o doc não existe), e
 * um `nome.trim()` sobre `undefined` derrubava a tela inteira de Configurações
 * — o painel não tinha nada que segurasse erro de renderização.
 */
export function Avatar({ nome, size = 32 }: { nome?: string | null; size?: number }) {
  const inicial = ((nome ?? "").trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-marca/12 font-semibold text-marca-tinta"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {inicial}
    </span>
  );
}

export function EmptyState({ mensagem, acao }: { mensagem: string; acao?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-linha-forte px-6 py-14 text-center">
      <p className="mx-auto max-w-sm text-sm text-tinta-2">{mensagem}</p>
      {acao && <div className="mt-5 flex justify-center">{acao}</div>}
    </div>
  );
}

/**
 * Falha ao ler o Firestore (permissão, rede, índice faltando). Sem isso a tela
 * fica vazia e parece "não tem nada cadastrado", que é diagnóstico errado.
 */
export function ErrorState({ mensagem }: { mensagem: string }) {
  return (
    <div className="rounded-2xl border border-erro/30 bg-erro/8 p-5">
      <div className="font-semibold text-erro-tinta">Não consegui carregar os dados</div>
      <p className="mt-1 text-sm text-tinta-2">{mensagem}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-3 text-sm font-semibold text-marca-tinta hover:underline"
      >
        Tentar de novo
      </button>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-marca border-t-transparent" />
    </div>
  );
}

/** Linha rótulo/valor das fichas que substituem tabela no celular. */
export function LinhaDado({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="shrink-0 text-tinta-3">{rotulo}</span>
      <span className="tabular text-right font-medium">{valor}</span>
    </div>
  );
}
