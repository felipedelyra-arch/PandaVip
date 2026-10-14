import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomUUID } from "crypto";
import { requireAdmin } from "./lib/guards";
import { consumir } from "./lib/rateLimit";
import { registrarConsumo, type ConsumoInput } from "./lib/consumo";

/**
 * Lançamento manual de conta de salão pelo painel.
 *
 * A ponte enquanto o PDV não envia sozinho: sem isto, mesa/atendente/itens
 * ficam vazios em produção e o sócio não vê onde gastou. Grava exatamente o
 * mesmo documento que o webhook do PDV, então o dia em que a integração
 * entrar, nada muda de lugar.
 *
 * Passa por Cloud Function porque `payments` é fechado pra escrita nas rules —
 * e continua fechado, mesmo pro admin.
 */
export const lancarConsumo = onCall(async (req) => {
  const chamador = await requireAdmin(req);
  await consumir(chamador, "lancarConsumo");

  const dados = req.data as ConsumoInput;

  // Sem número de comanda o lançamento continua válido: quem digita nem sempre
  // tem a nota na mão. Só perde a proteção contra lançar a mesma conta duas
  // vezes — por isso o id aleatório em vez de recusar.
  const input: ConsumoInput = {
    ...dados,
    comandaId: (dados.comandaId ?? "").trim() || `manual_${randomUUID().slice(0, 8)}`,
  };

  const resultado = await registrarConsumo(input, "manual");

  // No painel, ao contrário do PDV, erro tem que aparecer na cara de quem
  // digitou — não adianta responder "ok" pra tela e perder o lançamento.
  if (!resultado.ok) {
    throw new HttpsError("invalid-argument", resultado.erro);
  }
  if ("ignorado" in resultado && resultado.ignorado === "socio_nao_identificado") {
    throw new HttpsError(
      "not-found",
      "Sócio não encontrado. Confira o código da carteirinha ou o CPF."
    );
  }
  if ("duplicado" in resultado) {
    throw new HttpsError(
      "already-exists",
      "Essa comanda já foi lançada. Confira na lista antes de repetir."
    );
  }

  return resultado;
});
