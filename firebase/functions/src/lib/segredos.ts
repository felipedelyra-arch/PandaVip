import { defineSecret } from "firebase-functions/params";

/**
 * Segredos do backend, guardados no Google Secret Manager.
 *
 * ## Por que não é `.env`
 *
 * Antes cada segredo saía de `process.env`, preenchido pelo `.env` da pasta
 * `functions/`. Esse arquivo não está no git (o `.gitignore` cuida disso), mas
 * o deploy **empacota** o conteúdo dele na configuração da função: ele vira
 * texto puro dentro do projeto, e qualquer conta com papel de leitura no
 * Google Cloud — estagiário, integrador do PDV, contador com acesso de
 * billing, um token de CI vazado — lê o segredo vivo sem precisar de
 * permissão nenhuma de escrita. Não existe rotação, nem log de quem leu.
 *
 * `defineSecret` move o valor pro Secret Manager. O que muda na prática:
 *
 * - o valor fica cifrado em repouso e **fora** do código-fonte publicado;
 * - só a função que declara `secrets: [X]` recebe X — menor privilégio;
 * - ler exige `secretmanager.versions.access`, que é papel separado e fica
 *   registrado no Cloud Audit Logs — dá pra responder "quem leu, e quando";
 * - rotação é uma versão nova do segredo, sem tocar no código.
 *
 * ## ⚠️ Todo segredo declarado aqui trava o deploy inteiro
 *
 * O firebase-tools consulta no Secret Manager **todo** `defineSecret` do
 * codebase antes de aplicar o `--only` (`resolveBackend` → `ensureSecret`).
 * Declarar um segredo que ainda não existe no projeto faz o deploy de TODAS as
 * functions abortar, inclusive das que não o usam. Por isso os segredos do
 * gateway só entram aqui junto com a integração que os usa — não antes.
 *
 * ## Como preencher (uma vez por segredo, por projeto)
 *
 *   firebase functions:secrets:set PDV_WEBHOOK_SECRET
 *
 * O comando pede o valor na entrada padrão — ele não fica no histórico do
 * shell. Para trocar depois, rode de novo: cria uma versão nova e o próximo
 * deploy passa a usá-la. `firebase functions:secrets:destroy` revoga a antiga.
 *
 * ## No emulador
 *
 * `.value()` cai de volta no `process.env` quando roda local, então o `.env`
 * continua servindo pro desenvolvimento — sem precisar de Secret Manager na
 * máquina de ninguém.
 */

/** Segredo compartilhado com o PDV do salão (HMAC do corpo cru). */
export const PDV_WEBHOOK_SECRET = defineSecret("PDV_WEBHOOK_SECRET");

/** Access Token de produção da conta Mercado Pago que recebe as assinaturas. */
export const MP_ACCESS_TOKEN = defineSecret("MP_ACCESS_TOKEN");

/** Assinatura secreta dos webhooks (Mercado Pago → Suas integrações → Webhooks). */
export const MP_WEBHOOK_SECRET = defineSecret("MP_WEBHOOK_SECRET");

/**
 * Token fixo que a Starway manda em `Authorization: Bearer` nos dois endpoints
 * de pedido. Gere um aleatório (`openssl rand -hex 24`), cadastre com
 * `firebase functions:secrets:set STARWAY_TOKEN` ANTES do próximo deploy — sem
 * o valor no Secret Manager, o deploy de todas as functions aborta — e mande o
 * mesmo valor pro contato deles por um canal que não seja o grupo do WhatsApp.
 */
export const STARWAY_TOKEN = defineSecret("STARWAY_TOKEN");
