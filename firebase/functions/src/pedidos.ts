import { randomInt } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/admin";
import { avisarSocio } from "./lib/avisos";
import { requireAuth, requireAdmin, requireVerified, idValido, ID_VALIDO, exigirMaiorDeIdade } from "./lib/guards";
import { consumir } from "./lib/rateLimit";
import { abertoAgora, type Expediente } from "./lib/expediente";
import { vigoraAgora } from "./lib/assinaturas";

/**
 * Pedido do app (delivery e retirada).
 *
 * ## Por que é Cloud Function e não escrita direta do cliente
 *
 * O total do pedido é dinheiro. Se o app mandasse o preço junto, qualquer um
 * com o APK descompilado pediria rodízio por R$ 0,01 — e o documento entraria
 * válido, porque as rules não sabem quanto custa um prato. Aqui o preço e o
 * nome saem de `menu/{id}` no servidor: o cliente manda o que quer e quanto,
 * nunca por quanto.
 *
 * ## O que ainda não está aqui
 *
 * Pagamento é na entrega. Cobrar no app exige o Checkout avulso do Mercado
 * Pago, que é outro fluxo do `preapproval` que a assinatura usa — e o dono
 * ainda não decidiu se pedir é de graça ou benefício de assinante.
 *
 * O formato que a Starway consome também não chegou, então nada aqui foi
 * moldado pro PDV: quando o JSON deles vier, o endpoint de leitura nasce em
 * cima desta coleção sem mexer no app.
 */

/**
 * Estados por onde um pedido passa. Sem máquina de estados de propósito: a
 * cozinha às vezes pula etapa, e cancelar pode acontecer em qualquer ponto.
 * O que se valida é que o status EXISTE, não a ordem em que ele veio.
 */
export const STATUS_PEDIDO = [
  "novo",
  "aceito",
  "preparando",
  "saiu",
  "entregue",
  "cancelado",
] as const;

export type StatusPedido = (typeof STATUS_PEDIDO)[number];

/**
 * Move um pedido de status.
 *
 * Mora aqui fora porque vai ter dois chamadores: o painel (a `onCall` abaixo)
 * e, quando a integração existir, o endpoint que a Starway chama pra setar
 * "confirmado"/"despachado" do lado deles.
 */
export async function aplicarStatus(pedidoId: string, status: string, porQuem: string) {
  if (!(STATUS_PEDIDO as readonly string[]).includes(status)) {
    throw new HttpsError("invalid-argument", "Status desconhecido.");
  }
  const ref = db.doc(`pedidos/${pedidoId}`);
  // Transação: o cliente pode cancelar (`cancelarPedido`) no mesmo instante em
  // que a cozinha aceita. Sem ela, o "aceito" sobrescreveria o "cancelado".
  const snap = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "Pedido não existe.");

    // Pedido encerrado não volta: depois de entregue ou cancelado, mudar o
    // status só serviria pra confundir quem está olhando o histórico.
    const atual = s.get("status") as string;
    if (atual === "entregue" || atual === "cancelado") {
      throw new HttpsError("failed-precondition", "Este pedido já foi encerrado.");
    }
    if (atual === status) return null;

    tx.update(ref, {
      status,
      statusEm: FieldValue.serverTimestamp(),
      statusPor: porQuem,
    });
    return s;
  });
  if (!snap) return { ok: true, repetido: true, status };
  const texto = textoAvisoStatus(status, String(snap.get("tipo") ?? ""), String(snap.get("lojaNome") ?? ""));
  // O app abre "Meus pedidos" ao tocar no aviso.
  if (texto) await avisarSocio(snap.get("userId"), texto, "pedido", "/pedidos");
  return { ok: true, repetido: false, status };
}

/**
 * O cliente cancela o próprio pedido pelo app, sem precisar ligar.
 *
 * Só enquanto está "novo": depois que a cozinha aceitou, a comida já pode estar
 * sendo feita, e aí o cancelamento é conversa com o restaurante.
 */
export const cancelarPedido = onCall(async (req) => {
  const uid = requireAuth(req);
  await consumir(uid, "cancelarPedido");
  const pedidoId = idValido((req.data ?? {}).pedidoId, "pedidoId");
  const ref = db.doc(`pedidos/${pedidoId}`);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    // Pedido de outra pessoa responde igual a inexistente: não confirma que o id existe.
    if (!s.exists || s.get("userId") !== uid) {
      throw new HttpsError("not-found", "Pedido não encontrado.");
    }
    const atual = s.get("status");
    if (atual === "cancelado") return;
    // `exportadoEm`: a Starway já levou a comanda pro PDV, e o contrato com
    // eles não tem como avisar cancelamento. Cancelar só aqui deixaria a
    // cozinha fazendo um pedido que o cliente acha que cancelou.
    if (atual !== "novo" || s.get("exportadoEm")) {
      throw new HttpsError(
        "failed-precondition",
        "Este pedido já chegou ao restaurante. Para cancelar, ligue para o restaurante."
      );
    }
    tx.update(ref, {
      status: "cancelado",
      statusEm: FieldValue.serverTimestamp(),
      statusPor: `cliente:${uid}`,
    });
  });
  return { ok: true };
});

/**
 * O que o sócio lê quando o pedido anda. `null` = etapa que não merece
 * tocar o celular ("novo" é o próprio sócio que acabou de mandar).
 */
export function textoAvisoStatus(status: string, tipo: string, lojaNome = "") {
  const retirada = tipo === "retirada";
  switch (status) {
    case "aceito":
      return { titulo: "Pedido aceito", corpo: "O Tio Panda recebeu seu pedido e vai começar o preparo." };
    case "preparando":
      return { titulo: "Pedido em preparo", corpo: "Seu pedido está sendo preparado." };
    case "saiu":
      return retirada
        ? { titulo: "Pronto para retirar", corpo: `Seu pedido está pronto para retirada no balcão${lojaNome ? ` (${lojaNome})` : ""}.` }
        : { titulo: "Saiu para entrega", corpo: "Seu pedido está a caminho." };
    case "entregue":
      return retirada
        ? { titulo: "Pedido retirado", corpo: "Obrigado por pedir no Tio Panda. Bom apetite." }
        : { titulo: "Pedido entregue", corpo: "Obrigado por pedir no Tio Panda. Bom apetite." };
    case "cancelado":
      return { titulo: "Pedido cancelado", corpo: "Seu pedido foi cancelado. Em caso de dúvida, fale com o restaurante." };
    default:
      return null;
  }
}

/** Painel: o dono move o pedido na tela de Pedidos. */
export const mudarStatusPedido = onCall(async (req) => {
  const uid = await requireAdmin(req);
  await consumir(uid, "mudarStatusPedido");
  const { pedidoId, status } = (req.data ?? {}) as { pedidoId?: unknown; status?: unknown };
  return aplicarStatus(idValido(pedidoId, "pedidoId"), String(status ?? ""), `painel:${uid}`);
});

/** O que o app manda por item. Preço não vem daqui de propósito. */
interface ItemEntrada {
  id?: string;
  qtd?: number;
  obs?: string;
  /** Promoção que o sócio tocou na Home. O desconto sai do banco, não daqui. */
  promoId?: string;
}

/** Promoção como está em `promotions/{id}`, já lida do banco. */
export interface PromoDesconto {
  itemId?: unknown;
  descontoPct?: unknown;
  ativa?: unknown;
  apenasAssinantes?: unknown;
  validadeInicio?: unknown;
  validadeFim?: unknown;
}

/** Timestamp do Firestore, Date ou nada → milissegundos (ou null). */
function emMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (v && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

/**
 * Desconto (%) que a promoção dá neste prato, agora, para esta pessoa.
 *
 * Tudo que decide dinheiro é relido aqui, no servidor: o app só diz QUAL
 * promoção tocou. Promoção desligada, fora do prazo, de outro prato ou com
 * desconto absurdo no banco (erro de digitação no painel) é recusada — o
 * pedido não sai com preço que o restaurante não autorizou.
 *
 * ponytail: sem limite de uso por pessoa nem de unidades com desconto (vale
 * o MAX_QTD do pedido). Se o dono quiser "1 por cliente", grava o uso em
 * `promoUsos/{promoId}__{uid}` dentro do `create` do pedido.
 */
function descontoDaPromo(
  promo: PromoDesconto | null | undefined,
  itemId: string,
  nomeItem: string,
  agora: number,
  socio: boolean
): number {
  const pct = Number(promo?.descontoPct);
  const ini = emMs(promo?.validadeInicio);
  const fim = emMs(promo?.validadeFim);
  if (
    !promo ||
    promo.ativa === false ||
    (ini !== null && agora < ini) ||
    (fim !== null && agora > fim) ||
    !Number.isInteger(pct) ||
    pct < 1 ||
    pct > 90
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Esta promoção não está mais valendo. Remova o item da sacola e adicione de novo."
    );
  }
  if (promo.itemId !== itemId) {
    throw new HttpsError("failed-precondition", `A promoção não vale para "${nomeItem}".`);
  }
  if (promo.apenasAssinantes === true && !socio) {
    throw new HttpsError("permission-denied", "Esta promoção é exclusiva para sócios.");
  }
  return pct;
}

const TIPOS = new Set(["entrega", "retirada"]);

/** Onde o cliente pode retirar. Cardápio é único; só o balcão muda. */
export const LOJAS: Record<string, string> = {
  centro: "Rua Exemplo",
  amigao: "Amigão (praça de alimentação)",
};
const PAGAMENTOS = new Set(["dinheiro", "cartao_entrega", "pix_entrega"]);

/** Id de documento do Firestore como o app manda (addDoc gera 20 alfanuméricos). */
const ID_PROMO = /^[A-Za-z0-9_-]{1,64}$/;

/** Teto de itens distintos e de unidades por item — barra o absurdo, não o apetite. */
const MAX_ITENS = 30;
const MAX_QTD = 20;
/** Troco para quanto, em reais. Ninguém paga delivery com nota acima disso. */
const TROCO_MAX = 5000;

/** O que o app manda no corpo da chamada. */
export interface PedidoEntrada {
  pedidoId?: string;
  itens?: ItemEntrada[];
  tipo?: string;
  loja?: string;
  endereco?: string;
  pagamento?: string;
  troco?: number;
  observacao?: string;
}

/** Um prato como ele está no cardápio, já lido do banco. */
export interface ItemCardapio {
  nome?: unknown;
  preco?: unknown;
  disponivel?: unknown;
  /** Número do prato, igual no app, no painel e na Starway. */
  codigo?: unknown;
}

/**
 * Valida o pedido e soma o total, sem tocar em rede.
 *
 * Separada da `onCall` só por um motivo: é a parte que decide dinheiro, e
 * dinheiro merece teste que roda em milissegundos (`npm run test:pedidos`).
 * O `cardapio` chega pronto justamente pra isso.
 */
export function montarPedido(
  dados: PedidoEntrada,
  cardapio: Map<string, ItemCardapio | null>,
  taxaConfig = 0,
  promos: Map<string, PromoDesconto | null> = new Map(),
  ctx: { agora: number; socio: boolean } = { agora: Date.now(), socio: false }
) {
  // Id vindo do cliente + `create()` no fim: o app que perdeu a resposta e
  // tentou de novo cai em ALREADY_EXISTS em vez de mandar dois rodízios pra
  // mesma casa. É a mesma ideia do `mp_${payment.id}` em webhooks/mercadopago.
  const pedidoId = dados.pedidoId;
  if (!pedidoId || !/^[A-Za-z0-9_-]{8,64}$/.test(pedidoId)) {
    throw new HttpsError("invalid-argument", "pedidoId inválido.");
  }

  const entrada = dados.itens;
  if (!Array.isArray(entrada) || entrada.length === 0) {
    throw new HttpsError("invalid-argument", "Pedido sem itens.");
  }
  if (entrada.length > MAX_ITENS) {
    throw new HttpsError("invalid-argument", "O pedido tem itens demais.");
  }

  const tipo = dados.tipo ?? "entrega";
  if (!TIPOS.has(tipo)) throw new HttpsError("invalid-argument", "Tipo de entrega inválido.");

  const loja = tipo === "retirada" ? String(dados.loja ?? "") : "";
  if (tipo === "retirada" && !Object.hasOwn(LOJAS, loja)) {
    throw new HttpsError("invalid-argument", "Escolha a loja para retirar.");
  }

  const pagamento = dados.pagamento ?? "dinheiro";
  if (!PAGAMENTOS.has(pagamento)) {
    throw new HttpsError("invalid-argument", "Forma de pagamento inválida.");
  }

  // `typeof` antes do `.trim()`: número ou objeto vindo direto da API virava
  // TypeError, e o sócio via "erro interno" em vez do motivo.
  const endereco = typeof dados.endereco === "string" ? dados.endereco.trim() : "";
  if (tipo === "entrega" && endereco.length < 10) {
    throw new HttpsError("invalid-argument", "Endereço de entrega obrigatório.");
  }
  if (endereco.length > 300) {
    throw new HttpsError("invalid-argument", "Endereço longo demais.");
  }

  const observacao =
    typeof dados.observacao === "string" ? dados.observacao.trim().slice(0, 300) : "";

  // Quantidade por item, validada antes de ir ao banco: id repetido soma, pra
  // dois toques no "+" não virarem duas linhas do mesmo prato na comanda.
  const quantidades = new Map<string, number>();
  const observacoes = new Map<string, string>();
  const promoDoItem = new Map<string, string>();
  for (const item of entrada) {
    const id = typeof item?.id === "string" && ID_VALIDO.test(item.id) ? item.id : "";
    const qtd = Number(item?.qtd);
    const promoId = item?.promoId;
    if (
      !id ||
      !Number.isInteger(qtd) ||
      qtd < 1 ||
      qtd > MAX_QTD ||
      (promoId !== undefined && promoId !== null && !ID_PROMO.test(String(promoId)))
    ) {
      throw new HttpsError("invalid-argument", "Item inválido no pedido.");
    }
    quantidades.set(id, Math.min((quantidades.get(id) ?? 0) + qtd, MAX_QTD));
    const obs = typeof item?.obs === "string" ? item.obs.trim().slice(0, 200) : "";
    if (obs) observacoes.set(id, obs);
    if (promoId) promoDoItem.set(id, String(promoId));
  }

  // Preço e nome vêm do cardápio no servidor, nunca do app.
  const itens = [...quantidades.entries()].map(([itemId, qtd]) => {
    const m = cardapio.get(itemId);
    if (!m) {
      throw new HttpsError("failed-precondition", "Um item do pedido não está mais no cardápio.");
    }
    if (m.disponivel === false) {
      throw new HttpsError("failed-precondition", `"${String(m.nome ?? "O item")}" acabou por hoje.`);
    }
    const precoCheio = Number(m.preco ?? 0);
    const codigo = Number(m.codigo);
    const nome = String(m.nome ?? "");
    const promoId = promoDoItem.get(itemId);
    const pct = promoId
      ? descontoDaPromo(promos.get(promoId), itemId, nome, ctx.agora, ctx.socio)
      : 0;
    const preco = pct ? Number((precoCheio * (1 - pct / 100)).toFixed(2)) : precoCheio;
    return {
      itemId,
      codigo: Number.isInteger(codigo) && codigo > 0 ? codigo : null,
      nome,
      preco,
      qtd,
      subtotal: Number((preco * qtd).toFixed(2)),
      obs: observacoes.get(itemId) ?? "",
      // Só em linha com promoção: a comanda mostra o de/por e o painel sabe
      // de qual oferta veio o desconto.
      ...(promoId ? { promoId, descontoPct: pct, precoOriginal: precoCheio } : {}),
    };
  });

  const subtotal = Number(itens.reduce((s, i) => s + i.subtotal, 0).toFixed(2));
  if (subtotal <= 0) throw new HttpsError("failed-precondition", "Pedido sem valor.");

  // Taxa só na entrega, e vinda de `config/restaurante` — nunca do app. Quem
  // retira no balcão não paga frete.
  const taxa = Number(taxaConfig);
  const taxaEntrega =
    tipo === "entrega" && Number.isFinite(taxa) && taxa > 0 ? Number(taxa.toFixed(2)) : 0;
  const total = Number((subtotal + taxaEntrega).toFixed(2));

  // Troco só faz sentido pagando em dinheiro, e só se cobrir a conta — com a
  // taxa dentro, que é o que o entregador vai receber na mão.
  const troco = pagamento === "dinheiro" ? Number(dados.troco ?? 0) : 0;
  // NaN e Infinity passavam direto e chegavam à Starway como `null`.
  if (!Number.isFinite(troco) || troco < 0 || troco > TROCO_MAX) {
    throw new HttpsError("invalid-argument", "Valor de troco inválido.");
  }
  if (troco && troco < total) {
    throw new HttpsError("invalid-argument", "O troco precisa cobrir o total do pedido.");
  }

  return {
    pedidoId,
    itens,
    subtotal,
    taxaEntrega,
    total,
    tipo,
    loja,
    endereco,
    pagamento,
    troco,
    observacao,
  };
}

// ponytail: 1 instância sempre quente (~US$4/mês, decisão do dono 06/10/2026)
// tira o cold start de 2-3 s do toque em "Confirmar pedido".
export const criarPedido = onCall({ minInstances: 1 }, async (req) => {
  const uid = requireVerified(req);
  await consumir(uid, "criarPedido");

  const dados = (req.data ?? {}) as PedidoEntrada;

  // Lê o cardápio dos ids pedidos numa ida só, e só então soma.
  const ids = [
    ...new Set(
      (Array.isArray(dados?.itens) ? dados.itens : [])
        .map((i) => (typeof i?.id === "string" ? i.id : ""))
        .filter((id) => ID_VALIDO.test(id))
    ),
  ].slice(0, MAX_ITENS);
  // Ids de promoção malformados não vão ao banco: `montarPedido` recusa o
  // pedido inteiro logo adiante.
  const promoIds = [
    ...new Set(
      (Array.isArray(dados?.itens) ? dados.itens : [])
        .map((i) => (typeof i?.promoId === "string" ? i.promoId : ""))
        .filter((id) => ID_PROMO.test(id))
    ),
  ].slice(0, MAX_ITENS);
  const [cfgSnap, perfilSnap, ...docs] = await db.getAll(
    db.doc("config/restaurante"),
    db.doc(`users/${uid}`),
    ...ids.map((id) => db.doc(`menu/${id}`)),
    ...promoIds.map((id) => db.doc(`promotions/${id}`))
  );
  // Pedir é só para 18+ (decisão do dono, 13/10/2026).
  exigirMaiorDeIdade(perfilSnap.get("nascimento"));
  const docsMenu = docs.slice(0, ids.length);
  const docsPromo = docs.slice(ids.length);
  const cardapio = new Map<string, ItemCardapio | null>(
    docsMenu.map((d) => [d.id, d.exists ? (d.data() as ItemCardapio) : null])
  );
  const promos = new Map<string, PromoDesconto | null>(
    docsPromo.map((d) => [d.id, d.exists ? (d.data() as PromoDesconto) : null])
  );
  // Assinatura só é consultada quando alguma promoção do pedido exige sócio:
  // o pedido comum não paga essa leitura a mais.
  const precisaSocio = [...promos.values()].some((p) => p?.apenasAssinantes === true);
  const socio = precisaSocio
    ? (
        await db
          .collection("subscriptions")
          .where("userId", "==", uid)
          .where("status", "==", "active")
          .get()
      ).docs.some((d) => vigoraAgora(d))
    : false;

  // Fora do expediente não entra pedido: de madrugada não tem ninguém no
  // painel pra ver a comanda. Antes de somar nada, porque a resposta é a
  // mesma independente do que tem na sacola.
  const cfg = (cfgSnap.data() ?? {}) as Expediente & { taxaEntrega?: unknown };
  if (!abertoAgora(cfg)) {
    throw new HttpsError(
      "failed-precondition",
      "Não estamos aceitando pedidos agora. Confira o horário de funcionamento no app."
    );
  }

  const {
    pedidoId,
    itens,
    subtotal,
    taxaEntrega,
    total,
    tipo,
    loja,
    endereco,
    pagamento,
    troco,
    observacao,
  } = montarPedido(dados, cardapio, Number(cfg.taxaEntrega ?? 0), promos, {
    agora: Date.now(),
    socio,
  });

  // Nome e telefone congelados no pedido: quem vai entregar precisa deles na
  // comanda, e o sócio pode trocar o cadastro depois que o motoboy já saiu.
  const perfil = perfilSnap.data() ?? {};

  const pedido = {
    userId: uid,
    nome: String(perfil.nome ?? ""),
    telefone: String(perfil.telefone ?? ""),
    itens,
    subtotal,
    total,
    // ponytail: taxa única, do painel. Vira tabela por bairro quando o dono
    // tiver os valores (e a Starway disser se o frete vem do PDV).
    taxaEntrega,
    tipo,
    loja,
    lojaNome: loja ? LOJAS[loja] : "",
    endereco: tipo === "entrega" ? endereco : "",
    // As partes do endereço, congeladas junto: a Starway quer rua, número e
    // bairro separados, e a linha pronta não dá pra desmontar sem chutar.
    // Vem do cadastro porque é lá que a sacola salva o endereço editado.
    enderecoPartes:
      tipo === "entrega" && perfil.enderecoEntrega ? perfil.enderecoEntrega : null,
    pagamento,
    troco,
    observacao,
    // Quem entrega (ou o balcão, na retirada) pede este código ao cliente.
    codigoEntrega: String(randomInt(1000, 10000)),
    status: "novo",
    // Marca o que o conector da Starway ainda não levou (ver plano do PDV).
    exportadoEm: null,
    criadoEm: FieldValue.serverTimestamp(),
  };

  try {
    await db.doc(`pedidos/${pedidoId}`).create(pedido);
  } catch (err) {
    // 6 = ALREADY_EXISTS. É o retry do próprio app: o pedido já está lá.
    if ((err as { code?: number }).code !== 6) throw err;
    // ...desde que seja DESTE sócio. O id vem do cliente; sem esta conferência,
    // um id repetido de outra pessoa respondia "pedido feito" sem pedido nenhum.
    const existente = await db.doc(`pedidos/${pedidoId}`).get();
    if (existente.get("userId") !== uid) {
      throw new HttpsError("already-exists", "Não foi possível registrar o pedido. Tente de novo.");
    }
    return { ok: true, repetido: true, pedidoId, total };
  }

  return { ok: true, repetido: false, pedidoId, total };
});
