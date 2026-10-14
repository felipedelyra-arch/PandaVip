import { onRequest } from "firebase-functions/v2/https";
import { timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "../lib/admin";
import { aplicarStatus } from "../pedidos";
import { STARWAY_TOKEN } from "../lib/segredos";
import { ID_VALIDO } from "../lib/guards";

/**
 * Integração com a Starway (PDV do restaurante), do jeito que eles pediram:
 * **eles** chamam a gente de ~20 em 20 segundos.
 *
 * - `starwayPedidos` (GET) devolve os pedidos que ainda não foram aceitos.
 * - `starwayStatus` (POST) é como eles movem o pedido: confirmado, despachado,
 *   finalizado, cancelado. Quem manda no status é o sistema deles.
 *
 * Cardápio **não** entra: eles disseram que não integram menu com ninguém, então
 * o cardápio continua digitado no painel — é de lá que sai o `codigo` de cada
 * prato, que é o `productId` do lado deles.
 *
 * ## Autenticação
 *
 * Um token fixo no header `Authorization: Bearer <token>`, guardado no Secret
 * Manager (`STARWAY_TOKEN`). Não é enfeite: o primeiro endpoint expõe nome,
 * telefone e endereço de cliente, e o segundo deixa qualquer um mover pedido
 * dos outros. Endpoint aberto aqui é vazamento de dado pessoal e sabotagem de
 * operação, nessa ordem.
 *
 * ## O que ainda é chute (some quando a Starway responder)
 *
 * O JSON abaixo copia o exemplo de venda que eles mandaram. O que o exemplo
 * não respondeu está marcado com `ponytail:` no próprio campo — principalmente
 * o `id` numérico, a tabela de bairros (`neighborhoodId`) e o `storeId` de cada
 * unidade. Nada disso impede o primeiro teste: é ligar, ver o que eles
 * reclamam e ajustar o campo.
 */

/** O que muda por unidade/empresa. Fica em `config/starway` pra não precisar
 *  de deploy quando a Starway mandar os números certos. */
interface ConfigStarway {
  storeId?: unknown;
  companyCode?: unknown;
  platformId?: unknown;
  /** `{ tabajaras: 1199, amigao: 1200 }` — storeId por loja de retirada. */
  storeIdPorLoja?: unknown;
}

/** Valores do exemplo que eles mandaram, até virem os de verdade. */
const PADRAO = { storeId: 1199, companyCode: "000001", platformId: 1 };

const FUSO = "America/Sao_Paulo";

/** Reais → centavos inteiros, que é como o PDV deles conta dinheiro. */
export const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** Data e hora locais no formato do exemplo: "22/09/2026" e "19:45". */
export function dataHoraLocal(quando: Date): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: FUSO,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(quando)
      .map((x) => [x.type, x.value])
  );
  return {
    date: `${p.day}/${p.month}/${p.year}`,
    time: `${String(Number(p.hour ?? 0) % 24).padStart(2, "0")}:${p.minute}`,
  };
}

/** Como eles escrevem a forma de pagamento (string livre no exemplo). */
const PAGAMENTO: Record<string, string> = {
  dinheiro: "Dinheiro",
  cartao_entrega: "Cartão Máquina",
  pix_entrega: "Pix",
};

/**
 * Nosso pedido no formato da Starway.
 *
 * Pura de propósito: é o contrato com outra empresa, e contrato se testa sem
 * subir emulador (`npm run test:starway`).
 */
export function pedidoParaStarway(
  id: string,
  p: Record<string, unknown>,
  cfg: ConfigStarway = {}
) {
  const criadoEm =
    (p.criadoEm as { toDate?: () => Date } | undefined)?.toDate?.() ?? new Date();
  const { date, time } = dataHoraLocal(criadoEm);
  const partes = (p.enderecoPartes ?? {}) as Record<string, string>;
  const itens = Array.isArray(p.itens) ? (p.itens as Record<string, unknown>[]) : [];

  const porLoja = (cfg.storeIdPorLoja ?? {}) as Record<string, unknown>;
  const loja = String(p.loja ?? "");
  const storeId = Number(porLoja[loja] ?? cfg.storeId ?? PADRAO.storeId);

  return {
    // ponytail: o exemplo veio com um id numérico deles (746190) e ninguém
    // disse se o nosso pode ser qualquer número. O milissegundo da criação é
    // único e cabe em number; `orderReference` leva o id de verdade.
    id: criadoEm.getTime(),
    storeId,
    companyCode: String(cfg.companyCode ?? PADRAO.companyCode),
    platformId: Number(cfg.platformId ?? PADRAO.platformId),
    orderReference: id,
    orderShortReference: id.slice(-5),

    name: String(p.nome ?? ""),
    phone: String(p.telefone ?? ""),
    doc: "",

    address: String(p.endereco ?? ""),
    streetName: partes.rua ?? "",
    streetNumber: partes.numero ?? "",
    reference: partes.complemento ?? "",
    // ponytail: `neighborhoodId` é tabela deles; sem a tabela vai só o nome, e
    // o bairro que não casar eles resolvem na tela.
    neighborhoodId: 0,
    neighborhoodName: partes.bairro ?? "",
    coordinates: "",

    delivery: p.tipo === "entrega",
    deliveredBy: "SELF",
    orderType: 0,
    paymentMethod: PAGAMENTO[String(p.pagamento ?? "")] ?? "Dinheiro",
    changeFor: centavos(p.troco),

    items: itens.map((i, indice) => ({
      id: indice + 1,
      saleId: criadoEm.getTime(),
      // Sem código cadastrado no painel o prato vai como 0: melhor o pedido
      // chegar com um item pra conferir do que não chegar.
      productId: Number(i.codigo ?? 0),
      fatherItemId: 0,
      amount: Number(i.qtd ?? 0),
      unitPrice: centavos(i.preco),
      value: centavos(i.subtotal),
      notes: String(i.obs ?? ""),
      time,
    })),

    sum: centavos(p.subtotal ?? p.total),
    sumValue: centavos(p.subtotal ?? p.total),
    value: centavos(p.total),
    addition: 0,
    discount: 0,
    taxes: centavos(p.taxaEntrega),

    date,
    time,
    voucher: "",
    msg: String(p.observacao ?? ""),
    paymentId: "",
    // Fora do exemplo deles, e é o que o entregador pede na porta.
    deliveryCode: String(p.codigoEntrega ?? ""),
  };
}

/** Confere o `Authorization: Bearer`. Comparação em tempo constante, igual ao
 *  webhook do PDV: token se descobre por tentativa cronometrada. */
function autorizado(cabecalho: string | undefined, token: string): boolean {
  const enviado = (cabecalho ?? "").replace(/^Bearer\s+/i, "");
  if (!enviado || enviado.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(enviado), Buffer.from(token));
}

/** Pega o token, ou devolve o erro já escrito na resposta. */
function tokenOuErro(
  req: { headers: Record<string, unknown> },
  res: { status: (n: number) => { send: (b: unknown) => void } }
): string | null {
  const token = STARWAY_TOKEN.value();
  if (!token) {
    res.status(500).send({ erro: "STARWAY_TOKEN não configurado." });
    return null;
  }
  if (!autorizado(req.headers.authorization as string | undefined, token)) {
    res.status(401).send({ erro: "Token inválido." });
    return null;
  }
  return token;
}

/** Quantos pedidos por consulta. Eles chamam a cada 20s; se passar disso, a
 *  próxima volta pega o resto. */
const TETO = 50;

/**
 * Pedidos esperando o PDV: tudo que ainda está em "novo".
 *
 * Sai da lista quando eles aceitam pelo outro endpoint — e não quando a gente
 * entrega o JSON. Se marcássemos como enviado, uma resposta perdida no meio do
 * caminho sumiria com o pedido do cliente pra sempre.
 */
export const starwayPedidos = onRequest(
  { invoker: "public", secrets: [STARWAY_TOKEN] },
  async (req, res) => {
    if (req.method !== "GET") {
      res.status(405).send({ erro: "Use GET." });
      return;
    }
    if (!tokenOuErro(req, res)) return;

    try {
      const [snap, cfgSnap] = await Promise.all([
        db
          .collection("pedidos")
          .where("status", "==", "novo")
          .orderBy("criadoEm", "asc")
          .limit(TETO)
          .get(),
        db.doc("config/starway").get(),
      ]);
      const cfg = (cfgSnap.data() ?? {}) as ConfigStarway;

      const pedidos = snap.docs.map((d) => pedidoParaStarway(d.id, d.data(), cfg));

      // Carimbo só pra saber que eles viram o pedido — não filtra nada.
      await Promise.all(
        snap.docs
          .filter((d) => !d.get("exportadoEm"))
          .map((d) => d.ref.update({ exportadoEm: FieldValue.serverTimestamp() }))
      );

      res.status(200).send({ orders: pedidos });
    } catch (err) {
      logger.error("Starway: falha ao listar pedidos pendentes.", { err });
      res.status(500).send({ erro: "Erro interno." });
    }
  }
);

/**
 * O vocabulário que eles podem mandar.
 *
 * Só nome, nunca número: o exemplo veio com `state: 4` e ninguém mandou a
 * tabela de estados. Chutar número aqui é arriscar marcar "entregue" quando o
 * pedido foi cancelado. A resposta de erro lista o que vale, então o próprio
 * 400 documenta o contrato pra quem estiver integrando do outro lado.
 */
const STATUS_STARWAY: Record<string, string> = {
  confirmado: "aceito",
  aceito: "aceito",
  preparando: "preparando",
  producao: "preparando",
  despachado: "saiu",
  saiu: "saiu",
  entregue: "entregue",
  finalizado: "entregue",
  cancelado: "cancelado",
};

/** A Starway move o pedido: confirmado, despachado, finalizado, cancelado. */
export const starwayStatus = onRequest(
  { invoker: "public", secrets: [STARWAY_TOKEN] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send({ erro: "Use POST." });
      return;
    }
    if (!tokenOuErro(req, res)) return;

    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const pedidoId = String(corpo.orderReference ?? corpo.pedidoId ?? "").trim();
    const bruto = String(corpo.status ?? corpo.state ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    const status = STATUS_STARWAY[bruto];

    if (!ID_VALIDO.test(pedidoId)) {
      res.status(400).send({ erro: "Mande orderReference (o id que veio na lista)." });
      return;
    }
    if (!status) {
      res.status(400).send({
        erro: "Status desconhecido.",
        aceitos: Object.keys(STATUS_STARWAY),
      });
      return;
    }

    try {
      const r = await aplicarStatus(pedidoId, status, "starway");
      res.status(200).send(r);
    } catch (err) {
      const codigo = (err as { code?: string }).code ?? "";
      // Pedido inexistente ou já encerrado é erro de quem chamou: 4xx pra
      // aparecer no log deles em vez de virar reenvio eterno.
      const http = codigo.includes("not-found")
        ? 404
        : codigo.includes("failed-precondition") || codigo.includes("invalid-argument")
          ? 400
          : 500;
      if (http === 500) {
        // Mensagem interna fica no nosso log, não na resposta pra outra empresa.
        logger.error("Starway: falha ao mudar status.", { pedidoId, err });
        res.status(500).send({ erro: "Erro interno." });
        return;
      }
      res.status(http).send({ erro: (err as Error).message });
    }
  }
);
