# PandaVip — Painel do Admin (React)

Painel web onde o dono do Tio Panda administra o clube. Mesmo backend Firebase do app.

## Stack

- React 19 + TypeScript + Vite
- **UI:** Tailwind CSS v4 (paleta Tio Panda, dark mode)
- **Rotas:** react-router-dom (guarda de admin)
- **Gráficos:** Recharts · **Toasts:** sonner · **Ícones:** lucide-react
- **Backend:** Firebase (Auth, Firestore, Functions `southamerica-east1`, Storage)

## Setup

```bash
npm install
cp .env.example .env    # preencha com as chaves do SEU projeto Firebase (Web app)
npm run dev             # http://localhost:5173
```

Login exige conta com custom claim `role:admin`. Crie o primeiro admin pelo
script em `firebase/scripts/set-first-admin.js`; depois gerencie em Configurações.

## Telas

| Rota | Tela | Função |
|---|---|---|
| `/login` | Login | e-mail/senha; bloqueia não-admin ("Acesso negado"); recuperar senha |
| `/` | Dashboard | membros ativos, novos/mês, MRR, cancelamentos, resgates + gráficos dos últimos 6 meses |
| `/promocoes` | Promoções | CRUD + upload de imagem (Storage) + ativa/só-assinantes |
| `/premiacoes` | Premiações | CRUD + estoque + prazo de resgate + validar resgates (código) |
| `/planos` | Planos | CRUD. O preço do plano é o que vai pro Mercado Pago na hora de assinar (`PAGAMENTOS.md`) |
| `/membros` | Membros | tabela + busca; clicar na linha abre a ficha (assinatura, pagamentos, resgates) |
| `/pagamentos` | Financeiro | transações com nome do cliente, filtro por método, exportar CSV, total |
| `/notificacoes` | Notificações | enviar push (todos ou só assinantes) via Cloud Function |
| `/configuracoes` | Config | dados do restaurante (`config/restaurante`) + conceder/revogar admin |

O doc `config/restaurante` espelha `app/lib/core/restaurante.dart` (telefone,
WhatsApp, endereço, política, termos, links das lojas). O painel avisa quantos
campos ainda estão com valor de exemplo. **O app ainda lê as constantes
compiladas** — passar a ler do Firestore é trabalho pendente no lado do app.

## Tempo real

Todas as telas assinam o Firestore (`onSnapshot`). Promoção criada aqui aparece
**na hora** no app do cliente — mesmo banco.

## Segurança

- Guarda de rota: sem sessão **ou** sem claim `admin` → redireciona pro login.
- Ações sensíveis (push, validar resgate, conceder admin) chamam Cloud Functions,
  nunca escrevem direto. Segredos de pagamento ficam só no backend (Secret Manager).
- Exclusões pedem confirmação em modal.
- Admin precisa de verificação em duas etapas (TOTP). Perdeu o celular? Rode
  `node scripts/remover-2fa.js <email>` em `firebase/` (precisa da service account
  key); no próximo login a pessoa cadastra o autenticador de novo.

## Deploy

```bash
npm run build
firebase deploy --only hosting     # ou: vercel deploy
```
