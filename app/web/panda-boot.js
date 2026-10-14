// Arranque da versão web do PandaVip: limpa service worker antigo e tira o
// splash quando o Flutter aparece.
//
// ⚠️ Este arquivo existe porque o conteúdo dele era <script> inline dentro do
// index.html. O Firebase Hosting agora serve
// `Content-Security-Policy: script-src 'self'` (ver firebase/firebase.json), e
// script inline não roda sob essa política — o navegador nem avisa o usuário,
// só não executa. Resultado seria splash preso pra sempre na tela.
//
// Regra pra quem mexer aqui depois: **nada de código dentro do index.html**,
// nem em atributo (`onclick=`, `onerror=`). Tudo passa por um arquivo .js
// servido do mesmo domínio.
(function () {
  "use strict";

  // Sempre carregar a versão mais recente: remove service workers e caches de
  // builds anteriores.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (rs) {
      rs.forEach(function (r) {
        r.unregister();
      });
    });
  }
  if (window.caches) {
    caches.keys().then(function (ks) {
      ks.forEach(function (k) {
        caches.delete(k);
      });
    });
  }

  // Logo do splash: se a imagem não carregar, some com ela em vez de mostrar o
  // ícone de imagem quebrada. Era um `onerror=` no <img>; atributo de evento é
  // código inline e cai na mesma proibição do CSP.
  var logo = document.getElementById("panda-splash-logo");
  if (logo) {
    var esconder = function () {
      logo.style.display = "none";
    };
    logo.addEventListener("error", esconder);
    // O erro pode ter acontecido antes deste script rodar: `complete` com
    // largura zero é exatamente esse caso.
    if (logo.complete && logo.naturalWidth === 0) esconder();
  }

  // Remove o splash de forma robusta: no primeiro quadro do Flutter, OU quando
  // a <flutter-view> montar, OU por tempo limite. Assim o usuário nunca fica
  // preso no splash mesmo se o evento não disparar.
  var removido = false;
  var obs = null;
  var poll = null;

  function tirarSplash() {
    if (removido) return;
    removido = true;
    var s = document.getElementById("panda-splash");
    if (s) {
      s.style.opacity = "0";
      setTimeout(function () {
        s.remove();
      }, 400);
    }
    if (obs) obs.disconnect();
    if (poll) clearInterval(poll);
  }

  window.addEventListener("flutter-first-frame", tirarSplash);

  // Observa o DOM: assim que a view do Flutter aparecer, some o splash.
  obs = new MutationObserver(function () {
    if (document.querySelector("flutter-view, flt-glass-pane")) tirarSplash();
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Rede de segurança: sondagem + tempo limite duro (nunca prende o usuário).
  poll = setInterval(function () {
    if (document.querySelector("flutter-view, flt-glass-pane")) tirarSplash();
  }, 300);
  setTimeout(tirarSplash, 8000);
})();
