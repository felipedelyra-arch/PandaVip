/**
 * Horário de funcionamento do delivery.
 *
 * Mora em `config/restaurante` (mesmo doc do telefone e do endereço), editado
 * pelo painel: o dono muda o horário e o app obedece na hora, sem versão nova
 * na loja.
 *
 * ## Por que o servidor confere de novo
 *
 * O app já esconde o botão de confirmar fora do horário, mas o app é o cliente:
 * um APK antigo, o relógio do celular errado ou uma tela aberta desde as 23h
 * mandam pedido de madrugada do mesmo jeito. Quem decide é `criarPedido`.
 *
 * ## Formato
 *
 * Um campo por dia da semana, `"18:00-23:30"`. Ausente, em branco ou inválido
 * = fechado naquele dia. Fim menor que início atravessa a meia-noite
 * (`"18:00-01:00"` fecha 1h da manhã do dia seguinte) — é o caso normal de uma
 * temakeria, não exceção.
 *
 * Doc sem nenhum dia preenchido vale como **aberto**: enquanto ninguém
 * configurar, nada muda no que já estava no ar.
 */

/** Índice = `Date#getDay()` no fuso de Tupã. */
export const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

const FUSO = "America/Sao_Paulo";

export interface Expediente {
  /** Interruptor do painel: corta pedido agora sem mexer no horário. */
  pedidosPausados?: unknown;
  /** `{ seg: "18:00-23:30", ... }`. */
  horarios?: unknown;
}

function minutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** `"18:00-23:30"` → `[1080, 1410]`, em minutos desde a meia-noite. */
export function janela(valor: unknown): [number, number] | null {
  if (typeof valor !== "string") return null;
  const partes = valor.split("-");
  if (partes.length !== 2) return null;
  const abre = minutos(partes[0]);
  const fecha = minutos(partes[1]);
  if (abre === null || fecha === null || abre === fecha) return null;
  return [abre, fecha];
}

/**
 * Dia da semana e minuto do dia **em Tupã**, não em UTC.
 *
 * A function roda em UTC: às 22h de sábado lá, `getDay()` já devolve domingo e
 * o pedido de sábado à noite bateria no horário de domingo. `Intl` com fuso
 * resolve sem trazer biblioteca de data.
 */
export function agoraLocal(agora: Date): { dia: number; minuto: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(agora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "");
  // `hour12: false` devolve "24" à meia-noite em algumas versões do ICU.
  const hora = Number(p.hour ?? 0) % 24;
  return { dia: dia < 0 ? 0 : dia, minuto: hora * 60 + Number(p.minute ?? 0) };
}

/** O restaurante aceita pedido neste instante? */
export function abertoAgora(cfg: Expediente | undefined, agora = new Date()): boolean {
  if (!cfg) return true;
  if (cfg.pedidosPausados === true) return false;

  const h = cfg.horarios;
  if (!h || typeof h !== "object") return true;
  const semana = DIAS.map((d) => janela((h as Record<string, unknown>)[d]));
  if (semana.every((j) => j === null)) return true;

  const { dia, minuto } = agoraLocal(agora);

  const hoje = semana[dia];
  if (hoje) {
    const [abre, fecha] = hoje;
    if (fecha > abre ? minuto >= abre && minuto < fecha : minuto >= abre) return true;
  }

  // Madrugada: quem está aberto agora é a janela de ontem que virou o dia.
  const ontem = semana[(dia + 6) % 7];
  return !!ontem && ontem[1] < ontem[0] && minuto < ontem[1];
}
