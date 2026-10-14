/// Chave de site do reCAPTCHA v3, usada pelo App Check no build **web**.
///
/// ## Não é segredo, e é por isso que mora aqui
///
/// A chave de site do reCAPTCHA é pública por construção: ela vai no HTML de
/// qualquer página que use reCAPTCHA, e o Google a valida junto com o domínio
/// que fez a chamada. Quem copiar esta string não ganha nada — de outro
/// domínio ela não resolve. O par secreto dela fica no Google, nunca aqui.
///
/// Isto é diferente das quatro chaves do backend (`firebase/functions/src/lib/
/// segredos.ts`), que valem dinheiro e vivem no Secret Manager. A regra "nenhum
/// segredo no binário" continua valendo inteira; esta constante não é um.
///
/// ## Por que existe
///
/// O App Check já rodava no Android (Play Integrity) e no iOS (App Attest),
/// mas o build web ficava de fora — e enquanto UM cliente legítimo não manda
/// token, a imposição no console não pode ser ligada, porque ligá-la derruba
/// esse cliente. Ou seja: a web faltando mantinha desligado o controle que
/// protege *todas* as plataformas, inclusive as duas que já estavam prontas.
///
/// ## Como preencher
///
/// 1. Google Cloud Console → Segurança → reCAPTCHA Enterprise → criar chave do
///    tipo **Site**, listando os domínios de hosting;
/// 2. Firebase Console → App Check → registrar o app **Web** com reCAPTCHA
///    Enterprise, colando o ID dessa chave;
/// 3. passar no build:
///
/// ```bash
/// flutter build web --dart-define=RECAPTCHA_SITE_KEY=6Lxxxxxxxxxxxxx
/// ```
///
/// Vazia (o padrão), o web se comporta exatamente como antes: sem App Check,
/// sem erro na abertura.
const String kChaveRecaptcha = String.fromEnvironment('RECAPTCHA_SITE_KEY');
