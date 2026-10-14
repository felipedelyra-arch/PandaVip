import { onRequest } from "firebase-functions/v2/https";
import { createHmac, timingSafeEqual } from "crypto";
import { registrarConsumo, type ConsumoInput } from "../lib/consumo";
import { PDV_WEBHOOK_SECRET } from "../lib/segredos";

/**
 * Entrada de consumo do salão vinda do PDV do restaurante — ou do middleware
 * que lê o PDV. Chamado quando a conta da mesa fecha.
 *
 * É o único caminho pra mesa, atendente e itens saírem do zero em produção:
 * a Order API da Teknisa só recebe pedido (app -> PDV), ela não devolve venda
 * de salão. A regra de gravação mora em `lib/consumo.ts`, compartilhada com o
 * lançamento manual do painel.
 *
 * Contrato pensado pro outro lado ser burro: um POST por comanda, mesmo corpo
 * pode chegar várias vezes (reenvio de fila, retry de rede) que não duplica.
 */
export const pdvConsumo = onRequest(
  { invoker: "public", secrets: [PDV_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Use POST.");
      return;
    }

    const secret = PDV_WEBHOOK_SECRET.value();
    if (!secret) {
      res.status(500).send("PDV_WEBHOOK_SECRET não configurada.");
      return;
    }

    // Assinatura HMAC do corpo cru, mesmo esquema do webhook Pix. Sem isso
    // qualquer um lança consumo falso e vira desconto/relatório errado.
    const sig = req.headers["x-pdv-signature"] as string | undefined;
    const raw = (req as unknown as { rawBody: Buffer }).rawBody;
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    if (
      !sig ||
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      res.status(401).send("Assinatura inválida.");
      return;
    }

    try {
      const resultado = await registrarConsumo(req.body as ConsumoInput, "pdv");

      // Corpo malformado é culpa de quem chamou: 400 pra aparecer no log dele.
      // Todo o resto sai 200 de propósito — inclusive "não é sócio" e "repetido"
      // —, porque 4xx faria o PDV reenviar a mesma comanda pra sempre.
      res.status(resultado.ok ? 200 : 400).send(resultado);
    } catch (err) {
      console.error("Erro no consumo do PDV:", err);
      res.status(500).send("Erro interno.");
    }
  });
