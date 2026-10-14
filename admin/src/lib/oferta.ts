// Janela de validade das ofertas — mesma regra que o app aplica em
// `Promotion.vigenteEm` (app/lib/core/models/models.dart). Se mudar aqui,
// mude lá.

export type StatusOferta = "inativa" | "agendada" | "no ar" | "encerrada";

export interface JanelaOferta {
  ativa?: boolean;
  validadeInicio?: Date | null;
  validadeFim?: Date | null;
}

/** Em que fase a oferta está agora. */
export function statusOferta(
  o: JanelaOferta,
  agora: Date = new Date()
): StatusOferta {
  if (o.ativa === false) return "inativa";
  if (o.validadeInicio && agora < o.validadeInicio) return "agendada";
  if (o.validadeFim && agora > o.validadeFim) return "encerrada";
  return "no ar";
}

export const corStatus: Record<StatusOferta, "green" | "orange" | "gray" | "red"> = {
  "no ar": "green",
  agendada: "orange",
  encerrada: "gray",
  inativa: "gray",
};

const dataHora = (d: Date) =>
  d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const hora = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Frase curta da janela, pro dono conferir sem abrir o formulário. */
export function janelaTexto(o: JanelaOferta): string {
  if (!o.validadeInicio && !o.validadeFim) return "Sem prazo — fica no ar até você desligar";
  if (o.validadeInicio && o.validadeFim)
    return `${dataHora(o.validadeInicio)} até ${dataHora(o.validadeFim)}`;
  if (o.validadeFim) return `Até ${dataHora(o.validadeFim)}`;
  return `A partir de ${dataHora(o.validadeInicio!)}`;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** Meia-noite do dia da data — pra contar dias de calendário, não de 24h. */
const meiaNoite = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Quando, do jeito que a pessoa fala. "hoje às 22:00" é acionável no salão;
 * "30/07/2026 22:00" obriga a conferir que dia é hoje.
 */
export function quandoTexto(d: Date, agora: Date = new Date()): string {
  const dias = Math.round((meiaNoite(d) - meiaNoite(agora)) / DIA_MS);
  if (dias === 0) return `hoje às ${hora(d)}`;
  if (dias === 1) return `amanhã às ${hora(d)}`;
  if (dias === -1) return `ontem às ${hora(d)}`;
  const rotulo = d.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  return `${rotulo.replace(".", "")} às ${hora(d)}`;
}

/**
 * Quanto falta, na maior unidade que ainda é honesta. Minutos até uma hora,
 * hora+minuto até um dia, e dias daí pra frente — "faltam 47 horas" obriga o
 * leitor a dividir por 24 de cabeça.
 */
export function restanteTexto(fim: Date, agora: Date = new Date()): string {
  const ms = fim.getTime() - agora.getTime();
  if (ms <= 0) return "encerrada";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const resto = min % 60;
    return resto ? `${h}h ${resto}min` : `${h}h`;
  }
  const dias = Math.floor(h / 24);
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

/**
 * Quanto tempo a oferta fica no ar, do começo ao fim. É o número que o dono
 * quer ver antes de salvar: "isso vai rodar 3 dias".
 */
export function duracaoTexto(inicio: Date | null, fim: Date | null): string | null {
  if (!fim) return null;
  const de = inicio ?? new Date();
  const ms = fim.getTime() - de.getTime();
  if (ms <= 0) return null;
  const h = Math.round(ms / 3600000);
  if (h < 24) return h <= 1 ? "menos de 1 hora" : `${h} horas`;
  const dias = Math.round(ms / DIA_MS);
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

/**
 * A frase que o formulário mostra enquanto o dono escolhe as datas. Fecha a
 * pergunta "quanto tempo fica no ar e até que horas" antes de ele salvar.
 */
export function resumoJanela(o: JanelaOferta, agora: Date = new Date()): string {
  const { validadeInicio: ini, validadeFim: fim } = o;
  if (!ini && !fim)
    return "Sem prazo: entra no app assim que você salvar e fica até você desligar.";
  if (ini && fim && ini >= fim) return "O fim precisa ser depois do começo.";

  const duracao = duracaoTexto(ini ?? null, fim ?? null);
  const comeco =
    !ini || ini <= agora ? "Entra no app assim que você salvar" : `Entra ${quandoTexto(ini, agora)}`;
  if (!fim) return `${comeco} e fica até você desligar.`;
  return `${comeco}, sai ${quandoTexto(fim, agora)}${duracao ? ` — ${duracao} no ar` : ""}.`;
}

/** Date -> valor de `<input type="datetime-local">` (fuso local). */
export function toLocalInput(d?: Date | null): string {
  if (!d) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** Valor de `<input type="datetime-local">` -> Date. Vazio vira null. */
export function fromLocalInput(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
