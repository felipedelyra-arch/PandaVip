/**
 * PandaVip — Cloud Functions (entry point).
 * Região padrão: southamerica-east1 (São Paulo).
 */
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "southamerica-east1", maxInstances: 10 });

// Auth / admin
export { setAdminRole, novaSenhaAtendimento } from "./admin";
export { onAuthUserCreate, backfillCodigosSocio } from "./users";
export {
  deleteAccount,
  exportarMeusDados,
  exportarDadosDeSocio,
  excluirContaDeSocio,
  finalizarExclusoes,
} from "./account";
export { ensureReferralCode, applyReferral } from "./referral";

// Assinatura pelo Mercado Pago. Ver lib/gateway.ts e PAGAMENTOS.md.
export {
  createCheckoutSession,
  cancelSubscription,
  criarPixAssinatura,
  assinarComCartao,
  desistirAssinatura,
} from "./subscriptions";
export { mercadoPagoWebhook } from "./webhooks/mercadopago";

// Premiações
export { redeemReward, validateRedemption } from "./redemptions";
export { sincronizarCupons, estoqueDoPremio, conferirEstoques } from "./rewards";

// Push (FCM) + central de avisos do app
export {
  sendPush,
  onPromotionCreated,
  publicarPromocoesAgendadas,
  onRewardCreated,
  limparAvisosAntigos,
} from "./push";

// Manutenção interna
export { limparRateLimits, vencerAssinaturasPix, excluirContasIncompletas } from "./manutencao";

// Consumo no salão: automático (PDV) e manual (painel)
export { pdvConsumo } from "./webhooks/pdv";
export { lancarConsumo } from "./consumo";

// Pedidos do app (delivery e retirada).
export { criarPedido, mudarStatusPedido, cancelarPedido } from "./pedidos";

// Starway (PDV): eles consultam os pedidos novos e movem o status.
export { starwayPedidos, starwayStatus } from "./webhooks/starway";
