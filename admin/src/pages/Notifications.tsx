import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { where, orderBy, limit } from "firebase/firestore";
import { Send, Megaphone, Gift, Info, Bell } from "lucide-react";
import { toast } from "sonner";
import { functions } from "../lib/firebase";
import { useCollectionQuery } from "../lib/useCollection";
import { useContagem } from "../lib/useContagem";
import type { PushLog } from "../lib/types";
import {
  Card,
  Button,
  Badge,
  PageHeader,
  SectionTitle,
  Segmented,
  EmptyState,
} from "../components/ui";
import { Field, inputBase } from "../components/Modal";
import { demoBlock } from "../lib/demo";
import { quandoTexto } from "../lib/oferta";
import logoUrl from "../assets/logo.png";

/** Limites do que cabe na notificação antes do sistema cortar com reticências. */
const LIMITE_TITULO = 45;
const LIMITE_CORPO = 130;

const modelos = [
  {
    id: "promo",
    icone: Megaphone,
    label: "Promoção nova",
    titulo: "Promoção nova no Clube",
    corpo: "Passa aqui hoje: tem oferta liberada pra quem é do PandaVip.",
  },
  {
    id: "premio",
    icone: Gift,
    label: "Prêmio novo",
    titulo: "Tem prêmio pra resgatar",
    corpo: "Entrou prêmio novo no app. Resgate pelo celular e retire no salão.",
  },
  {
    id: "aviso",
    icone: Info,
    label: "Aviso do dia",
    titulo: "Recado do Tio Panda",
    corpo: "Hoje o salão abre às 18h. Te esperamos!",
  },
] as const;

export function Notifications() {
  const [titulo, setTitulo] = useState("");
  const [corpo, setCorpo] = useState("");
  const [publico, setPublico] = useState<"todos" | "assinantes">("todos");
  const [enviando, setEnviando] = useState(false);

  // Estimativa de alcance pelo cadastro. Não é o número exato de entregas: só
  // quem tem o app instalado e o aviso ligado tem token pra receber.
  //
  // Contado no servidor: esta tela baixava `users` e `subscriptions` inteiras
  // para exibir um número de duas casas.
  const assinantes = useContagem(
    "subscriptions",
    () => [where("status", "==", "active")],
    "ativos",
    (s) => s.status === "active"
  );
  const totalPerfis = useContagem("users", () => [], "todos");
  const admins = useContagem(
    "users",
    () => [where("role", "==", "admin")],
    "admins",
    (u) => u.role === "admin"
  );
  // Total menos admins, e não `role != 'admin'`: perfil criado pelo app não tem
  // o campo `role`, e consulta de desigualdade descarta documento sem o campo.
  const alcance =
    publico === "assinantes"
      ? assinantes
      : totalPerfis == null || admins == null
        ? null
        : Math.max(0, totalPerfis - admins);

  // O histórico de disparos é curto por natureza (um por aviso enviado), mas
  // tem teto porque nada o apaga.
  const { data: logs } = useCollectionQuery<PushLog>(
    "notificationLogs",
    () => [orderBy("criadoEm", "desc"), limit(100)],
    "historico",
    100
  );
  const historico = logs;

  const podeEnviar = titulo.trim().length > 0 && corpo.trim().length > 0 && !enviando;

  async function enviar() {
    if (!podeEnviar) return toast.error("Escreva o título e a mensagem.");
    if (demoBlock("Aviso não enviado")) {
      setTitulo("");
      setCorpo("");
      return;
    }
    setEnviando(true);
    try {
      const res = await httpsCallable(functions, "sendPush")({
        titulo: titulo.trim(),
        corpo: corpo.trim(),
        onlySubscribers: publico === "assinantes",
      });
      const n = (res.data as { enviados: number }).enviados;
      toast.success(
        n === 0
          ? "Ninguém tinha o app aberto pra receber. O aviso ficou na central do app."
          : `Aviso entregue em ${n} aparelho(s).`
      );
      setTitulo("");
      setCorpo("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Notificações"
        eyebrow="Falar com quem tem o app"
        descricao="O aviso aparece na tela do celular e fica guardado na Central de avisos do app."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ---- escrever ---- */}
        <div>
          <SectionTitle>Escrever o aviso</SectionTitle>
          <Card>
            <div className="mb-5">
              <div className="rotulo mb-2">Começar de um modelo</div>
              <div className="flex flex-wrap gap-2">
                {modelos.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setTitulo(m.titulo);
                      setCorpo(m.corpo);
                    }}
                    className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-linha px-3 text-[13px] font-semibold text-tinta-2 transition-colors hover:border-marca hover:text-marca-tinta"
                  >
                    <m.icone size={15} />
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Título">
              <input
                className={inputBase}
                value={titulo}
                maxLength={80}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Promoção nova no Clube"
              />
              <Contador valor={titulo.length} limite={LIMITE_TITULO} />
            </Field>

            <Field label="Mensagem">
              <textarea
                className={inputBase}
                rows={3}
                maxLength={220}
                value={corpo}
                onChange={(e) => setCorpo(e.target.value)}
                placeholder="Rodízio com 20% off nesta semana!"
              />
              <Contador valor={corpo.length} limite={LIMITE_CORPO} />
            </Field>

            <div className="mb-5">
              <div className="rotulo mb-2">Quem recebe</div>
              <Segmented
                ariaLabel="Quem recebe o aviso"
                value={publico}
                onChange={setPublico}
                options={[
                  { valor: "todos", label: "Todo mundo" },
                  { valor: "assinantes", label: "Só assinantes" },
                ]}
              />
              <p className="mt-2 text-xs text-tinta-3">
                {alcance == null
                  ? "Contando…"
                  : alcance === 1
                    ? "1 pessoa"
                    : `${alcance} pessoas`}{" "}
                no cadastro.
                Recebem de fato os que têm o app instalado e o aviso ligado.
              </p>
            </div>

            <Button onClick={enviar} disabled={!podeEnviar} className="w-full">
              <Send size={17} /> {enviando ? "Enviando..." : "Enviar agora"}
            </Button>
          </Card>
        </div>

        {/* ---- prévia ---- */}
        <div>
          <SectionTitle>Como chega no celular</SectionTitle>
          <PreviaPush titulo={titulo} corpo={corpo} />
          <p className="mt-3 text-xs leading-relaxed text-tinta-3">
            Título e mensagem longos são cortados pelo celular no meio da frase.
            Os contadores avisam antes disso acontecer.
          </p>
        </div>
      </div>

      {/* ---- histórico ---- */}
      <section className="mt-8">
        <SectionTitle>Últimos avisos enviados</SectionTitle>
        {historico.length === 0 ? (
          <EmptyState mensagem="Nenhum aviso enviado ainda. Os disparos daqui e os automáticos de promoção e prêmio novo ficam registrados nesta lista." />
        ) : (
          <Card plano>
            <ul className="divide-y divide-linha">
              {historico.map((l) => (
                <li key={l.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-superficie-2 text-tinta-3">
                    {l.origem === "promocao" ? (
                      <Megaphone size={15} />
                    ) : l.origem === "premio" ? (
                      <Gift size={15} />
                    ) : (
                      <Bell size={15} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{l.titulo}</div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-tinta-2">{l.corpo}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-tinta-3">
                      <span>{l.criadoEm ? quandoTexto(l.criadoEm) : "—"}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {l.publico === "assinantes" ? "só assinantes" : "todo mundo"}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="tabular">{l.enviados} aparelho(s)</span>
                    </div>
                  </div>
                  {l.origem !== "manual" && <Badge color="gray">automático</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function Contador({ valor, limite }: { valor: number; limite: number }) {
  const passou = valor > limite;
  return (
    <span
      className={`tabular mt-1.5 block text-right text-xs ${
        passou ? "font-semibold text-marca-tinta" : "text-tinta-3"
      }`}
    >
      {passou ? `${valor}/${limite} — o celular vai cortar` : `${valor}/${limite}`}
    </span>
  );
}

/**
 * A notificação como o cliente vai ver, com o mesmo corte de linha do sistema.
 * É a peça que evita o erro mais caro desta tela: mandar pra todo mundo um
 * texto que chega pela metade — e push não tem desfazer.
 */
function PreviaPush({ titulo, corpo }: { titulo: string; corpo: string }) {
  const vazio = !titulo.trim() && !corpo.trim();
  return (
    <div className="rounded-3xl border border-linha bg-superficie-2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="tabular text-xs font-medium text-tinta-3">
          {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="rotulo">Prévia</span>
      </div>

      <div className="rounded-2xl border border-linha bg-superficie p-3 shadow-sm">
        <div className="mb-1.5 flex items-center gap-2">
          <img src={logoUrl} alt="" width={18} height={18} className="rounded" />
          <span className="text-xs font-semibold text-tinta-3">PandaVip</span>
          <span className="text-xs text-tinta-3">· agora</span>
        </div>
        <div className={`line-clamp-1 text-sm font-semibold ${vazio ? "text-tinta-3" : ""}`}>
          {titulo.trim() || "Título do aviso"}
        </div>
        <p className={`mt-0.5 line-clamp-2 text-sm ${vazio ? "text-tinta-3" : "text-tinta-2"}`}>
          {corpo.trim() || "A mensagem aparece aqui, em duas linhas."}
        </p>
      </div>
    </div>
  );
}
