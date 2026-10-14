import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

/** Esc fecha e a página de trás para de rolar. Compartilhado por modal e ficha. */
function useCamada(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Trava a rolagem de trás: no celular o dedo arrastava a página por baixo
    // do formulário em vez de rolar o formulário.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
}

function BotaoFechar({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Fechar"
      className="-mr-1.5 rounded-lg p-1.5 text-tinta-3 transition-colors hover:bg-superficie-2 hover:text-tinta"
    >
      <X size={18} />
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useCamada(open, onClose);

  if (!open) return null;
  return (
    // Celular: folha colada embaixo, ao alcance do polegar. Tablet pra cima:
    // caixa centrada de sempre.
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full flex-col rounded-t-3xl border border-linha bg-superficie sm:max-w-lg sm:rounded-2xl sm:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Cabeçalho fixo: em formulário longo o botão de fechar sumia junto
            com a rolagem. */}
        <div className="flex items-center justify-between border-b border-linha px-5 py-3.5">
          <h2 className="display text-lg">{title}</h2>
          <BotaoFechar onClose={onClose} />
        </div>
        <div className="overflow-y-auto px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-5">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Ficha lateral: detalhe de um item sem sair da lista. No desktop entra pela
 * direita e a lista continua à vista, que é o que permite conferir uma cobrança
 * atrás da outra. No celular vira folha de baixo, igual ao modal.
 */
export function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  useCamada(open, onClose);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-stretch sm:justify-end"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full flex-col rounded-t-3xl border border-linha bg-superficie sm:max-h-none sm:w-[26rem] sm:rounded-none sm:border-y-0 sm:border-r-0 sm:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-3 border-b border-linha px-5 py-4">
          <div className="min-w-0">
            {eyebrow && <div className="rotulo mb-1">{eyebrow}</div>}
            <h2 className="display truncate text-lg">{title}</h2>
          </div>
          <BotaoFechar onClose={onClose} />
        </div>
        <div className="overflow-y-auto px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-5">
          {children}
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirmar",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  /** O verbo do que vai acontecer. "Confirmar" não conta o que some. */
  confirmLabel?: string;
}) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="mb-6 text-sm leading-relaxed text-tinta-2">{message}</p>
      {/* Empilhado no celular, com o destrutivo embaixo do polegar mas em
          vermelho cheio — dá pra ler o que vai acontecer antes de tocar. */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          onClick={onClose}
          className="min-h-11 rounded-xl px-4 py-2.5 text-sm font-semibold text-tinta-2 transition-colors hover:bg-superficie-2"
        >
          Cancelar
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className="min-h-11 rounded-xl bg-erro px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

const inputBase =
  "w-full min-h-11 rounded-xl border border-linha bg-superficie-2 px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-tinta-3/70 focus:border-marca focus:bg-superficie";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Uma linha explicando pra que serve. Só quando o rótulo não basta. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-[13px] font-semibold">{label}</span>
      {hint && <span className="mb-1.5 block text-xs text-tinta-3">{hint}</span>}
      {children}
    </label>
  );
}

export { inputBase };
