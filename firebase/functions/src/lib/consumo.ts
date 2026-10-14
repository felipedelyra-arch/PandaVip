import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { ID_VALIDO } from "./guards";
import { vigoraAgora } from "./assinaturas";

/**
 * Registro de conta fechada no salão (`payments` com `tipo: "consumo"`).
 *
 * Mora aqui, e não no webhook, porque entra por duas portas: o PDV chamando
 * `pdvConsumo` e o dono lançando à mão pelo painel (`lancarConsumo`). As duas
 * gravam exatamente o mesmo documento — o que muda é só quem provou que pode.
 */

export interface ItemConsumo {
  nome?: string;
  quantidade?: number | string;
  preco?: number | string;
}

export interface ConsumoInput {
  /** Identificador da comanda. Vira a chave de idempotência. */
  comandaId?: string;

  // ---- identificação do sócio: basta UM destes ----
  codigoSocio?: string;
  cpf?: string;
  uid?: string;

  // ---- a conta ----
  valor?: number | string;
  descontoClube?: number | string;
  mesa?: string | number;
  atendente?: string;
  metodo?: string;
  itens?: ItemConsumo[];
  /** ISO 8601 ou o formato da Teknisa (`DD/MM/YYYY HH:MI:SS`). Ausente = agora. */
  data?: string;
  /** Conta estornada/cancelada depois de enviada. */
  cancelado?: boolean;
}

export type ResultadoConsumo =
  | { ok: true; paymentId: string; userId: string }
  | { ok: true; duplicado: true; paymentId: string }
  | { ok: true; cancelado: true }
  | { ok: true; ignorado: "comanda_desconhecida" | "socio_nao_identificado" }
  | { ok: false; erro: string };

/**
 * Tetos do que entra num documento de consumo.
 *
 * As duas portas daqui são autenticadas (HMAC no PDV, admin no painel), então
 * isto não é a defesa principal — é o limite que impede um erro do outro lado
 * de virar problema nosso. Sem teto, uma comanda com dez mil itens ou um nome
 * de prato gigante estoura o limite de 1 MB por documento do Firestore: a
 * gravação falha, o PDV recebe erro e fica reenviando a mesma conta pra sempre.
 *
 * Cortar o excesso é melhor que recusar: a conta em si — valor, sócio, mesa —
 * continua registrada, que é o que decide desconto e extrato.
 */
const MAX_ITENS = 200;
const MAX_TEXTO = 120;

/** Corta [v] em [max] caracteres. `null` quando não sobra nada. */
function texto(v: unknown, max = MAX_TEXTO): string | null {
  const s = (v ?? "").toString().trim().slice(0, max);
  return s || null;
}

/** Aceita 143.82, "143.82" e "143,82" — PDV manda dos três jeitos. */
export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  // Ponto só é milhar quando há vírgula decimal: "1.234,56". Sem vírgula,
  // "143.82" já é decimal.
  const t = v.trim();
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tipo de recebimento do PDV -> os três valores que o painel entende
 * (`Payment.metodo`). O código externo varia por instalação, então casa por
 * palavra-chave em vez de tabela fixa.
 */
function normalizarMetodo(v: string | undefined): "cartao" | "pix" | "dinheiro" {
  const s = (v ?? "").toLowerCase();
  if (s.includes("pix")) return "pix";
  if (s.includes("dinheiro") || s.includes("especie") || s.includes("espécie")) {
    return "dinheiro";
  }
  if (s.includes("cart") || s.includes("credito") || s.includes("debito")) return "cartao";
  // Sem match: cai em cartão, que é a maioria das contas, mas registra pra
  // alguém corrigir o mapeamento em vez de o relatório mentir em silêncio.
  if (s) console.warn(`[consumo] tipo de recebimento desconhecido: "${v}" -> cartao`);
  return "cartao";
}

/** `DD/MM/YYYY HH:MI:SS` (Teknisa) ou ISO. Data inválida vira `null` = agora. */
function parseData(v: string | undefined): Date | null {
  if (!v) return null;
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (br) {
    const [, d, m, a, h, min, s] = br;
    // -03:00 fixo: o PDV fica no salão, não em UTC.
    const iso = `${a}-${m}-${d}T${h}:${min}:${s ?? "00"}-03:00`;
    const dt = new Date(iso);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(v);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Doc id determinístico por comanda — é o que trava a duplicata. */
function idDaComanda(comandaId: string): string {
  return `pdv_${comandaId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100)}`;
}

/** Acha o sócio por código de carteirinha, CPF ou uid. `null` se não achou. */
async function acharUsuario(input: ConsumoInput): Promise<string | null> {
  // Só id simples vira caminho: `"x/notifications/y"` resolvia OUTRO documento
  // e lançava a conta num `userId` que nem é sócio.
  if (typeof input.uid === "string" && ID_VALIDO.test(input.uid)) {
    const snap = await db.doc(`users/${input.uid}`).get();
    if (snap.exists) return snap.id;
  }

  // Carteirinha: leitura direta pelo doc id em `socioCodes` (ver
  // lib/codigoSocio.ts). Sem query, sem índice, sem chance de duplicata.
  const codigo = typeof input.codigoSocio === "string" ? input.codigoSocio.trim().toUpperCase() : "";
  if (ID_VALIDO.test(codigo)) {
    const snap = await db.doc(`socioCodes/${codigo}`).get();
    const uid = snap.get("uid") as string | undefined;
    if (uid) return uid;
  }

  if (input.cpf) {
    const cpf = input.cpf.replace(/\D/g, "");
    if (cpf.length === 11) {
      const snap = await db.collection("users").where("cpf", "==", cpf).limit(1).get();
      if (!snap.empty) return snap.docs[0].id;
    }
  }

  return null;
}

/**
 * Desconto quando não vem informado: percentual do plano ativo do sócio
 * (`plans.descontoPercentual`), aplicado sobre a conta.
 *
 * O valor informado sempre ganha — é onde a conta foi realmente fechada. Isto
 * aqui só evita registrar zero quando o desconto foi dado na mão e ninguém
 * teve como dizer quanto foi.
 */
async function descontoDoPlano(userId: string, valor: number): Promise<number> {
  const subs = await db
    .collection("subscriptions")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();
  const vigente = subs.docs.find((d) => vigoraAgora(d));
  if (!vigente) return 0;

  const planId = vigente.get("planId") as string | undefined;
  if (!planId) return 0;

  const plano = await db.doc(`plans/${planId}`).get();
  const pct = Number(plano.get("descontoPercentual") ?? 0);
  if (!Number.isFinite(pct) || pct <= 0) return 0;

  return Math.round(valor * (pct / 100) * 100) / 100;
}

/**
 * Grava (ou cancela) uma conta de salão.
 *
 * `origem` só serve pro painel distinguir o que veio do PDV do que foi digitado
 * à mão — número conferido por máquina e número conferido por gente merecem
 * peso diferente na hora de fechar o mês.
 */
export async function registrarConsumo(
  input: ConsumoInput,
  origem: "pdv" | "manual"
): Promise<ResultadoConsumo> {
  // Cortado no mesmo tamanho que `idDaComanda` usa: assim o `gatewayRef`
  // gravado é sempre o mesmo pedaço que virou a chave de idempotência, e não
  // uma versão maior que dá a impressão de identificar outra comanda.
  const comandaId = (input.comandaId ?? "").toString().trim().slice(0, 100);
  if (!comandaId) return { ok: false, erro: "comandaId obrigatório." };

  const ref = db.doc(`payments/${idDaComanda(comandaId)}`);

  // Estorno: a conta já entrou e depois foi cancelada no caixa.
  if (input.cancelado) {
    const atual = await ref.get();
    if (!atual.exists) return { ok: true, ignorado: "comanda_desconhecida" };
    await ref.update({ status: "cancelado", canceladoEm: FieldValue.serverTimestamp() });
    return { ok: true, cancelado: true };
  }

  const userId = await acharUsuario(input);
  if (!userId) return { ok: true, ignorado: "socio_nao_identificado" };

  const itens = (Array.isArray(input.itens) ? input.itens : [])
    .filter((i) => i && i.nome)
    .slice(0, MAX_ITENS)
    .map((i) => ({
      nome: texto(i.nome) ?? "",
      quantidade: Math.max(1, Math.round(num(i.quantidade) || 1)),
      preco: num(i.preco),
    }));

  const valor = num(input.valor);
  if (valor <= 0) return { ok: false, erro: "valor deve ser maior que zero." };

  const descontoClube =
    input.descontoClube != null
      ? num(input.descontoClube)
      : await descontoDoPlano(userId, valor);

  const data = parseData(input.data);

  const doc = {
    userId,
    valor,
    metodo: normalizarMetodo(input.metodo),
    status: "aprovado",
    tipo: "consumo" as const,
    mesa: texto(input.mesa, 40),
    atendente: texto(input.atendente),
    itens: itens.length ? itens : null,
    descontoClube,
    origem,
    gatewayRef: comandaId,
    data: data ?? FieldValue.serverTimestamp(),
    criadoEm: FieldValue.serverTimestamp(),
  };

  // `create` (e não `set`) é o ponto da idempotência: reenvio da mesma comanda
  // estoura ALREADY_EXISTS e é respondido como sucesso.
  try {
    await ref.create(doc);
  } catch (err) {
    if ((err as { code?: number }).code === 6) {
      return { ok: true, duplicado: true, paymentId: ref.id };
    }
    throw err;
  }

  return { ok: true, paymentId: ref.id, userId };
}
