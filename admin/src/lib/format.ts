// Formatação pt-BR compartilhada pelas telas.

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Data curta; nulo vira travessão. */
export const dia = (d?: Date | null) =>
  d ? d.toLocaleDateString("pt-BR") : "—";

/** Data com hora — pra quando "quando exatamente" importa (uma cobrança). */
export const diaHora = (d?: Date | null) =>
  d
    ? d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/** Primeiro nome, com a inicial em maiúscula. Vazio devolve nulo. */
export const primeiroNome = (bruto?: string | null): string | null => {
  const primeiro = (bruto ?? "").trim().split(/\s+/)[0];
  if (!primeiro) return null;
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1);
};

/** O Firestore guarda "cartao" sem acento; a tela mostra com. */
export const metodoLabel = (m?: string | null) =>
  m === "cartao"
    ? "Cartão"
    : m === "pix"
      ? "Pix"
      : m === "dinheiro"
        ? "Dinheiro"
        : m || "—";
