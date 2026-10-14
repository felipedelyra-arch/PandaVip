import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

// App Check: prova ao Firebase que a chamada veio DESTE painel, no domínio
// dele, e não de um script com a chave de API copiada do bundle — que é
// pública por construção, já que o Vite a embute no JS servido ao navegador.
//
// ⚠️ Enquanto o painel não mandava token, a imposição do App Check não podia
// ser ligada no console: ligá-la derrubaria justamente o painel do dono. Era o
// painel, e não o app, que segurava o controle desligado para todo mundo.
//
// O ID da chave do reCAPTCHA Enterprise é público (o Google o valida contra o
// domínio de origem), então vive no `.env` do Vite junto com o resto da
// config — não é segredo. Enterprise, e não v3, porque o Google descontinuou o
// reCAPTCHA clássico: o console de administração já recusa criar chave nova.
// Enterprise emite uma chave só, sem par secreto. Ausente, o painel roda como
// antes, sem App Check:
// um `initializeAppCheck` com chave vazia estoura e deixaria a tela branca.
const chaveRecaptcha = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (chaveRecaptcha) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(chaveRecaptcha),
    // Renova o token sozinho antes de expirar; sem isto a sessão longa do dono
    // no painel começaria a levar recusa depois de algumas horas.
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
// E-mails do Firebase Auth (redefinir senha) e a janela do Google em português;
// sem isto saem no idioma padrão do projeto, que é inglês.
auth.languageCode = "pt-BR";
export const db = getFirestore(app);
// Mesma região das Cloud Functions do backend.
export const functions = getFunctions(app, "southamerica-east1");
export const storage = getStorage(app);
