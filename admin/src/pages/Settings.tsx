import { useEffect, useMemo, useState } from "react";
import { doc, setDoc, where, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  UserPlus,
  UserMinus,
  AlertTriangle,
  Check,
  Phone,
  MessageCircle,
  MapPin,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { db, functions } from "../lib/firebase";
import { useCollectionQuery, useDoc } from "../lib/useCollection";
import { useContagem } from "../lib/useContagem";
import { avisarMudanca } from "../lib/aoVivo";
import type { AppUser, Restaurante } from "../lib/types";
import {
  Card,
  Button,
  Badge,
  Avatar,
  Spinner,
  PageHeader,
  SectionTitle,
} from "../components/ui";
import { Field, inputBase, ConfirmDialog } from "../components/Modal";
import { demoBlock } from "../lib/demo";

const vazio: Restaurante = {
  nome: "",
  telefone: "",
  whatsapp: "",
  endereco: "",
  cidade: "",
  politicaPrivacidadeUrl: "",
  termosUrl: "",
  playStoreUrl: "",
  appStoreUrl: "",
};

type Chave = keyof Restaurante;

interface CampoCfg {
  chave: Chave;
  label: string;
  hint: string;
  placeholder: string;
  /** Valor de exemplo herdado de `app/lib/core/restaurante.dart`. Enquanto o
   *  campo estiver assim, o botão do app abre um número/endereço fictício. */
  exemplo?: string;
  numerico?: boolean;
}

const contato: CampoCfg[] = [
  {
    chave: "nome",
    label: "Nome do restaurante",
    hint: "Aparece no topo do app e nos avisos.",
    placeholder: "Tio Panda",
  },
  {
    chave: "telefone",
    label: "Telefone",
    hint: "Botão Ligar. DDI + DDD + número, só dígitos.",
    placeholder: "551430000000",
    exemplo: "551430000000",
    numerico: true,
  },
  {
    chave: "whatsapp",
    label: "WhatsApp",
    hint: "Botão Falar no WhatsApp. DDI + DDD + número, só dígitos.",
    placeholder: "5514990000000",
    exemplo: "5514990000000",
    numerico: true,
  },
  {
    chave: "endereco",
    label: "Endereço",
    hint: "Botão Como chegar — é o texto que vai pra busca do Google Maps.",
    placeholder: "Rua X, 123 — Bauru/SP",
    exemplo: "Tio Panda restaurante",
  },
  {
    chave: "cidade",
    label: "Cidade",
    hint: "Vai no código Pix da gorjeta — o padrão do Banco Central exige, e corta em 15 letras sem acento.",
    placeholder: "Bauru",
    exemplo: "Bauru",
  },
];

const documentos: CampoCfg[] = [
  {
    chave: "politicaPrivacidadeUrl",
    label: "Política de privacidade",
    hint: "Exigida pela Play Store e pela App Store.",
    placeholder: "https://…",
    exemplo: "https://exemplo.com.br/privacidade",
  },
  {
    chave: "termosUrl",
    label: "Termos de uso",
    hint: "Link aberto pelo rodapé das configurações do app.",
    placeholder: "https://…",
    exemplo: "https://exemplo.com.br/termos",
  },
  {
    chave: "playStoreUrl",
    label: "Link na Play Store",
    hint: 'Usado no "Indique um amigo" para quem tem Android.',
    placeholder: "https://play.google.com/…",
    exemplo: "https://play.google.com/store/apps/details?id=com.tiopanda.clube",
  },
  {
    chave: "appStoreUrl",
    label: "Link na App Store",
    hint: 'Usado no "Indique um amigo" para quem tem iPhone.',
    placeholder: "https://apps.apple.com/…",
    exemplo: "https://apps.apple.com/app/id000000000",
  },
];

const todosCampos = [...contato, ...documentos];

const soDigitos = (s: string) => s.replace(/\D/g, "");

/** +55 (14) 99911-0001 — pra conferir de bate-pronto se o número está certo. */
function telefoneBonito(v: string): string | null {
  const s = soDigitos(v);
  if (s.length < 12) return null;
  const [ddi, ddd, resto] = [s.slice(0, 2), s.slice(2, 4), s.slice(4)];
  const corte = resto.length > 8 ? 5 : 4;
  return `+${ddi} (${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

export function Settings() {
  // Só os administradores, não o clube inteiro. São poucos por definição, e a
  // tela não usa mais nada de `users`.
  const { data: adminsBrutos } = useCollectionQuery<AppUser & { id: string }>(
    "users",
    () => [where("role", "==", "admin"), limit(50)],
    "admins",
    50
  );
  // Perfil de admin pode estar incompleto: o set-first-admin.js (e qualquer
  // concessão feita fora do app) grava só `role` quando o doc não existe. Sem
  // `uid`, a lista ficava sem chave e o "tirar acesso" chamava a função com
  // `undefined`; sem `nome`/`email`, o Avatar quebrava a página. O id do
  // documento É o uid, então ele cobre os dois buracos.
  const admins = useMemo(
    () =>
      adminsBrutos.map((a) => {
        const uid = a.uid || a.id;
        return { ...a, uid, nome: a.nome || a.email || uid };
      }),
    [adminsBrutos]
  );
  const { data: salvo, loading } = useDoc<Restaurante>("config/restaurante");
  const [form, setForm] = useState<Restaurante>(vazio);
  const [salvando, setSalvando] = useState(false);
  const [uidAlvo, setUidAlvo] = useState("");
  const [revogar, setRevogar] = useState<AppUser | null>(null);

  // Preenche o formulário quando o doc chega (e a cada mudança no Firestore).
  useEffect(() => {
    if (salvo) setForm({ ...vazio, ...salvo });
  }, [salvo]);

  const pendentes = useMemo(
    () =>
      todosCampos.filter((c) => {
        const v = String(form[c.chave] ?? "").trim();
        return !v || (c.exemplo && v === c.exemplo);
      }),
    [form]
  );

  const alterados = useMemo(() => {
    const base = { ...vazio, ...(salvo ?? {}) };
    return todosCampos.filter(
      (c) => String(form[c.chave] ?? "") !== String(base[c.chave] ?? "")
    );
  }, [form, salvo]);

  const set = (campo: Chave) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function salvarRestaurante() {
    if (!form.nome.trim()) return toast.error("Informe o nome do restaurante.");
    if (form.telefone && soDigitos(form.telefone).length < 12)
      return toast.error("Telefone precisa do DDI + DDD + número (ex.: 551430000000).");
    if (form.whatsapp && soDigitos(form.whatsapp).length < 12)
      return toast.error("WhatsApp precisa do DDI + DDD + número (ex.: 5514990000000).");

    if (demoBlock("Dados não salvos")) return;
    setSalvando(true);
    try {
      // Só os campos desta tela: o mesmo doc guarda horário e taxa, editados
      // logo abaixo, e mandar o `form` inteiro devolveria o valor velho deles
      // por cima de uma mudança feita enquanto este formulário estava aberto.
      const payload = Object.fromEntries(
        todosCampos.map((c) => [c.chave, form[c.chave] ?? ""])
      );
      await setDoc(
        doc(db, "config", "restaurante"),
        { ...payload, telefone: soDigitos(form.telefone), whatsapp: soDigitos(form.whatsapp) },
        { merge: true }
      );
      toast.success("Dados salvos. O app pega a mudança na hora.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function alterarAdmin(targetUid: string, makeAdmin: boolean) {
    if (demoBlock(makeAdmin ? "Acesso não concedido" : "Acesso não revogado")) return setUidAlvo("");
    try {
      await httpsCallable(functions, "setAdminRole")({ targetUid, makeAdmin });
      toast.success(makeAdmin ? "Acesso concedido." : "Acesso revogado.");
      setUidAlvo("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) return <Spinner />;

  return (
    // pb extra: a barra de "não salvo" flutua sobre o fim da página.
    <div className="max-w-3xl pb-24">
      <PageHeader
        titulo="Configurações"
        eyebrow="Dados do restaurante"
        descricao="É daqui que o app tira o telefone, o endereço e os links que ele mostra pro cliente."
      />

      {/* Checklist: em vez de "3 campos com valor de exemplo", diz quais. Sem o
          nome do campo, o aviso não indica o que fazer. */}
      {pendentes.length > 0 ? (
        <div className="mb-6 rounded-2xl border border-marca/30 bg-marca/8 p-4">
          <div className="flex items-center gap-2 font-semibold text-marca-tinta">
            <AlertTriangle size={17} className="shrink-0" />
            {pendentes.length === 1
              ? "1 campo ainda não é o de verdade"
              : `${pendentes.length} campos ainda não são os de verdade`}
          </div>
          <p className="mt-1 text-sm text-tinta-2">
            Enquanto estiverem assim, os botões do app levam o cliente a um
            número, endereço ou link fictício.
          </p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {pendentes.map((c) => (
              <li key={c.chave}>
                <Badge color="orange">{c.label}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mb-6 flex items-center gap-2 rounded-2xl border border-ok/30 bg-ok/8 p-4 text-sm font-semibold text-ok-tinta">
          <Check size={17} className="shrink-0" />
          Tudo preenchido com dados reais.
        </div>
      )}

      <section className="mb-6">
        <SectionTitle>Contato e localização</SectionTitle>
        <Card>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {contato.map((c) => (
              <div key={c.chave} className={c.chave === "endereco" ? "sm:col-span-2" : ""}>
                <Field label={c.label} hint={c.hint}>
                  <input
                    className={inputBase}
                    value={String(form[c.chave] ?? "")}
                    onChange={set(c.chave)}
                    placeholder={c.placeholder}
                    inputMode={c.numerico ? "numeric" : undefined}
                  />
                  <Confere campo={c} valor={String(form[c.chave] ?? "")} />
                </Field>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mb-6">
        <SectionTitle>Documentos e lojas</SectionTitle>
        <Card>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {documentos.map((c) => (
              <Field key={c.chave} label={c.label} hint={c.hint}>
                <input
                  className={inputBase}
                  value={String(form[c.chave] ?? "")}
                  onChange={set(c.chave)}
                  placeholder={c.placeholder}
                />
                <Confere campo={c} valor={String(form[c.chave] ?? "")} />
              </Field>
            ))}
          </div>
        </Card>
      </section>

      <section className="mb-6">
        <SectionTitle>Horário do delivery e taxa de entrega</SectionTitle>
        <Expediente />
      </section>

      <section className="mb-6">
        <SectionTitle>Pagamento com cartão no app</SectionTitle>
        <ChavePublicaMP />
      </section>

      <section className="mb-6">
        <SectionTitle>Versão mínima do app</SectionTitle>
        <VersaoMinima />
      </section>

      <section>
        <SectionTitle>Quem entra no painel</SectionTitle>
        <Card>
          <p className="mb-4 text-sm text-tinta-2">
            Só quem está nesta lista consegue abrir o painel. O primeiro admin é
            criado por script (ver <code className="font-mono text-xs">firebase/README.md</code>);
            daí em diante é por aqui.
          </p>

          <ul className="mb-4 divide-y divide-linha rounded-2xl border border-linha">
            {admins.map((a) => (
              <li key={a.uid} className="flex items-center gap-3 px-3.5 py-3">
                <Avatar nome={a.nome || a.email} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{a.nome || a.email}</div>
                  <div className="truncate font-mono text-xs text-tinta-3">{a.uid}</div>
                </div>
                <Badge color="orange">admin</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Revogar acesso de ${a.nome || a.email}`}
                  onClick={() => setRevogar(a)}
                >
                  <UserMinus size={16} />
                </Button>
              </li>
            ))}
            {admins.length === 0 && (
              <li className="px-3.5 py-4 text-sm text-tinta-3">
                Nenhum administrador no cadastro.
              </li>
            )}
          </ul>

          <Field
            label="Dar acesso a mais alguém"
            hint="Cole o identificador (UID) da conta. Ele aparece na ficha do membro."
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className={inputBase}
                placeholder="Ex.: 8fK2p…"
                value={uidAlvo}
                onChange={(e) => setUidAlvo(e.target.value)}
              />
              <Button onClick={() => alterarAdmin(uidAlvo.trim(), true)} disabled={!uidAlvo.trim()}>
                <UserPlus size={17} /> Conceder
              </Button>
            </div>
          </Field>
        </Card>
      </section>

      <ContaAtendimento />

      <section>
        <SectionTitle>Carteirinhas dos sócios</SectionTitle>
        <CodigosSocio />
      </section>

      {/* Barra de não salvo: aparece só quando há o que salvar, e conta quantos
          campos mudaram. Sem ela, o botão de salvar ficava perdido no meio da
          página e dava pra sair sem gravar. */}
      {alterados.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-linha bg-superficie/95 px-4 py-3 backdrop-blur md:left-[15.5rem]">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-tinta-2">
              {alterados.length === 1
                ? "1 campo alterado e ainda não salvo."
                : `${alterados.length} campos alterados e ainda não salvos.`}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setForm({ ...vazio, ...(salvo ?? {}) })}>
                Descartar
              </Button>
              <Button onClick={salvarRestaurante} disabled={salvando}>
                {salvando ? "Salvando..." : "Salvar alterações"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!revogar}
        onClose={() => setRevogar(null)}
        onConfirm={() => revogar && alterarAdmin(revogar.uid, false)}
        title="Tirar o acesso ao painel?"
        message={`${revogar?.nome || revogar?.email} deixa de conseguir abrir o painel. A conta no app continua normal.`}
        confirmLabel="Tirar acesso"
      />
    </div>
  );
}

/**
 * Celular dos garçons: uma conta da casa (`novaSenhaAtendimento`) que só abre
 * a tela /garcom. Garçom não tem cadastro de acesso — escolhe o nome na lista
 * da Equipe. Trocar a senha derruba todos os celulares: é o que se faz quando
 * alguém sai. A senha aparece uma vez só e não fica guardada em lugar nenhum.
 */
function ContaAtendimento() {
  const { data: estado } = useDoc<{ senhaTrocadaEm?: Date }>("config/atendimento");
  const [acesso, setAcesso] = useState<{ email: string; senha: string } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const existe = !!estado?.senhaTrocadaEm;
  const endereco = `${window.location.host}/garcom`;

  async function gerar() {
    if (demoBlock("Senha não gerada")) return;
    setBusy(true);
    try {
      const res = await httpsCallable<void, { email: string; senha: string }>(
        functions,
        "novaSenhaAtendimento"
      )();
      setAcesso(res.data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6">
      <SectionTitle>Celular dos garçons</SectionTitle>
      <Card>
        <p className="mb-4 text-sm text-tinta-2">
          Os garçons validam o prêmio na mesa pelo próprio celular: abrem{" "}
          <strong>{endereco}</strong>, entram uma vez com o acesso abaixo (o mesmo para todos), tocam no
          próprio nome e digitam o código do cliente. Os nomes vêm da página <strong>Equipe</strong>:
          entrou alguém, cadastre lá; saiu, desligue lá. Esse acesso só abre a tela de validar — não vê
          sócios, pagamentos nem o resto do painel.
        </p>
        {acesso ? (
          <div className="mb-4 rounded-2xl border border-ok/30 bg-ok/8 p-4 text-sm">
            <p className="mb-2 font-semibold">Passe isto aos garçons (aparece só agora):</p>
            <p>
              Endereço: <strong className="font-mono">{endereco}</strong>
            </p>
            <p>
              E-mail: <strong className="font-mono break-all">{acesso.email}</strong>
            </p>
            <p>
              Senha: <strong className="font-mono">{acesso.senha}</strong>
            </p>
            <p className="mt-2 text-tinta-2">
              No celular, entre em "Sou garçom" e digite só a senha. Depois, no menu do navegador, use
              "Adicionar à tela inicial" para abrir como app.
            </p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() =>
                navigator.clipboard
                  .writeText(`PandaVip — validar prêmio\n${endereco}\nToque em "Sou garçom" e use a senha: ${acesso.senha}`)
                  .then(() => toast.success("Copiado. Cole no grupo da equipe."))
                  .catch(() => toast.error("Não deu pra copiar. Anote a senha."))
              }
            >
              Copiar para mandar no WhatsApp
            </Button>
          </div>
        ) : (
          existe && (
            <p className="mb-4 text-sm text-tinta-3">
              Acesso criado. Senha trocada pela última vez em{" "}
              {estado!.senhaTrocadaEm!.toLocaleString("pt-BR")}.
            </p>
          )
        )}
        <Button onClick={() => (existe ? setConfirmar(true) : gerar())} disabled={busy}>
          {busy ? "Gerando..." : existe ? "Trocar senha e desconectar todos" : "Criar acesso dos garçons"}
        </Button>
      </Card>
      <ConfirmDialog
        open={confirmar}
        onClose={() => setConfirmar(false)}
        onConfirm={() => {
          setConfirmar(false);
          void gerar();
        }}
        title="Trocar a senha dos garçons?"
        message="Todos os celulares logados saem na hora, inclusive de quem saiu da equipe. Quem continua entra de novo com a senha nova."
        confirmLabel="Trocar senha"
      />
    </section>
  );
}

/**
 * Gera o código de carteirinha de quem se cadastrou antes dele existir.
 *
 * Conta nova já nasce com código (`functions/src/users.ts`). Quem entrou antes
 * fica sem, e a carteirinha cai no identificador longo — que o atendente não
 * digita quando o leitor de QR falha. Este botão é o conserto, e some da tela
 * quando não há mais ninguém pendente.
 */
function CodigosSocio() {
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState(0);

  // Quantos ainda estão sem código, contado no servidor.
  //
  // Não dá para consultar campo AUSENTE, e é assim que `codigoSocio` fica em
  // quem se cadastrou antes. O contorno: `codigoSocio >= ''` casa com qualquer
  // texto, e documento sem o campo não entra no índice desse campo — então
  // sobra exatamente quem tem código. Os pendentes são o total menos isso.
  const total = useContagem("users", () => [], "todos");
  const comCodigo = useContagem(
    "users",
    () => [where("codigoSocio", ">=", "")],
    "com-codigo",
    (u) => Boolean(u.codigoSocio)
  );
  const loading = total == null || comCodigo == null;
  const pendentes = loading ? 0 : Math.max(0, total - comCodigo);

  /**
   * A função processa um pedaço por chamada e devolve `continua` + `cursor`
   * (ver functions/src/users.ts). Antes ela tentava o clube inteiro numa
   * chamada só e morria no timeout de 60s com alguns milhares de pendentes.
   * Aqui o laço vai até acabar, mostrando o andamento — que num backfill
   * demorado é a diferença entre "está trabalhando" e "travou".
   */
  async function gerar() {
    if (demoBlock("Códigos não gerados")) return;
    setRodando(true);
    setProgresso(0);

    let cursor: string | null = null;
    let gerados = 0;
    const falhas: string[] = [];
    // Teto de voltas: o cursor sempre avança, mas um laço infinito no painel do
    // dono seria pior que um backfill incompleto.
    const MAX_VOLTAS = 200;

    try {
      for (let volta = 0; volta < MAX_VOLTAS; volta++) {
        const res = await httpsCallable(
          functions,
          "backfillCodigosSocio"
        )(cursor ? { cursor } : {});
        const d = res.data as {
          gerados: number;
          falhas: string[];
          continua: boolean;
          cursor: string | null;
        };
        gerados += d.gerados;
        falhas.push(...d.falhas);
        setProgresso(gerados);
        if (!d.continua) break;
        cursor = d.cursor;
      }

      if (falhas.length) {
        toast.warning(`${gerados} código(s) gerado(s), ${falhas.length} falhou/falharam.`);
      } else {
        toast.success(
          gerados === 0 ? "Todo mundo já tinha código." : `${gerados} carteirinha(s) prontas.`
        );
      }
    } catch (e) {
      // Parcial não se perde: o que já foi gravado está gravado, e clicar de
      // novo retoma — `garantirCodigoSocio` pula quem já tem código.
      toast.error(
        gerados > 0
          ? `${gerados} gerado(s) antes de falhar: ${(e as Error).message}`
          : (e as Error).message
      );
    } finally {
      setRodando(false);
      // Recontagem na hora: sem isto a tela seguia dizendo "3 sócios sem
      // código" depois de gerar, até alguém recarregar a página.
      avisarMudanca("users");
    }
  }

  if (loading) return <Spinner />;

  return (
    <Card>
      <p className="mb-4 text-sm text-tinta-2">
        O código curto da carteirinha é o que o atendente lê (ou digita) pra
        identificar o sócio no salão. Conta nova já nasce com ele.
        {pendentes > 0 ? (
          <>
            {" "}
            <strong className="font-semibold text-tinta">
              {pendentes === 1
                ? "1 sócio ainda está sem código"
                : `${pendentes} sócios ainda estão sem código`}
            </strong>{" "}
            — são os que se cadastraram antes.
          </>
        ) : (
          " Ninguém está pendente."
        )}
      </p>

      <Button onClick={gerar} disabled={rodando || pendentes === 0}>
        {rodando
          ? progresso > 0
            ? `Gerando… ${progresso} de ${pendentes}`
            : "Gerando…"
          : "Gerar códigos que faltam"}
      </Button>
    </Card>
  );
}

/** A semana como o dono pensa nela — segunda primeiro, não domingo. */
const DIAS_SEMANA = [
  { chave: "seg", label: "Segunda" },
  { chave: "ter", label: "Terça" },
  { chave: "qua", label: "Quarta" },
  { chave: "qui", label: "Quinta" },
  { chave: "sex", label: "Sexta" },
  { chave: "sab", label: "Sábado" },
  { chave: "dom", label: "Domingo" },
];

interface Faixa {
  abre: string;
  fecha: string;
}

/**
 * Horário do delivery e taxa de entrega (`config/restaurante`).
 *
 * Sem isto, pedido entrava às 3h da manhã e ficava na tela até alguém abrir o
 * painel de manhã. O servidor recusa fora do horário
 * (`functions/src/lib/expediente.ts`), e o app esconde o botão antes disso.
 *
 * Horário de todos os dias em branco vale como **sem restrição** — é o estado
 * de antes desta tela existir, e ele não pode fechar o restaurante sozinho.
 */
function Expediente() {
  const { data, loading } = useDoc<Restaurante>("config/restaurante");
  const [faixas, setFaixas] = useState<Record<string, Faixa>>({});
  const [taxa, setTaxa] = useState("");
  const [pausado, setPausado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const h = data?.horarios ?? {};
    setFaixas(
      Object.fromEntries(
        DIAS_SEMANA.map((d) => {
          const [abre = "", fecha = ""] = String(h[d.chave] ?? "").split("-");
          return [d.chave, { abre: abre.trim(), fecha: fecha.trim() }];
        })
      )
    );
    setTaxa(data?.taxaEntrega ? String(data.taxaEntrega).replace(".", ",") : "");
    setPausado(Boolean(data?.pedidosPausados));
  }, [data]);

  const trocar = (dia: string, campo: keyof Faixa, valor: string) =>
    setFaixas((f) => ({ ...f, [dia]: { ...(f[dia] ?? { abre: "", fecha: "" }), [campo]: valor } }));

  async function salvar() {
    const horarios: Record<string, string> = {};
    for (const d of DIAS_SEMANA) {
      const { abre, fecha } = faixas[d.chave] ?? { abre: "", fecha: "" };
      if (!abre && !fecha) {
        horarios[d.chave] = "";
        continue;
      }
      if (!abre || !fecha)
        return toast.error(
          `${d.label}: preencha as duas horas — ou apague as duas, que aí o dia fica fechado.`
        );
      if (abre === fecha)
        return toast.error(`${d.label}: abrir e fechar na mesma hora não diz nada.`);
      horarios[d.chave] = `${abre}-${fecha}`;
    }

    const valorTaxa = Number(taxa.trim().replace(",", "."));
    if (taxa.trim() && (!Number.isFinite(valorTaxa) || valorTaxa < 0))
      return toast.error("Taxa de entrega inválida.");

    if (demoBlock("Horário não salvo")) return;
    setSalvando(true);
    try {
      await setDoc(
        doc(db, "config", "restaurante"),
        {
          horarios,
          taxaEntrega: taxa.trim() ? Number(valorTaxa.toFixed(2)) : 0,
          pedidosPausados: pausado,
        },
        { merge: true }
      );
      toast.success("Salvo. O app já está obedecendo.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (loading) return <Spinner />;

  const semHorario = DIAS_SEMANA.every((d) => !faixas[d.chave]?.abre);

  return (
    <Card>
      <p className="mb-4 text-sm text-tinta-2">
        Fora do horário o app mostra "fechado agora" e o pedido é recusado no
        servidor. Deixe um dia em branco pra fechar nele. Se a madrugada entra
        no expediente, ponha o fim menor que o começo (18:00 → 01:00).
      </p>

      <div className="mb-5 divide-y divide-linha rounded-2xl border border-linha">
        {DIAS_SEMANA.map((d) => {
          const f = faixas[d.chave] ?? { abre: "", fecha: "" };
          const fechado = !f.abre && !f.fecha;
          return (
            <div key={d.chave} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              <span className="w-24 text-sm font-semibold">{d.label}</span>
              <input
                type="time"
                className={`${inputBase} w-32`}
                value={f.abre}
                onChange={(e) => trocar(d.chave, "abre", e.target.value)}
                aria-label={`${d.label}: abre`}
              />
              <span className="text-tinta-3">até</span>
              <input
                type="time"
                className={`${inputBase} w-32`}
                value={f.fecha}
                onChange={(e) => trocar(d.chave, "fecha", e.target.value)}
                aria-label={`${d.label}: fecha`}
              />
              {fechado ? (
                <Badge color="gray">Fechado</Badge>
              ) : (
                <button
                  type="button"
                  className="text-xs text-tinta-3 underline"
                  onClick={() => {
                    trocar(d.chave, "abre", "");
                    trocar(d.chave, "fecha", "");
                  }}
                >
                  fechar neste dia
                </button>
              )}
            </div>
          );
        })}
      </div>

      {semHorario && (
        <div className="mb-5 rounded-xl border border-marca/40 bg-marca/10 px-4 py-3 text-sm text-tinta">
          Nenhum dia preenchido: o app aceita pedido a qualquer hora.
        </div>
      )}

      <div className="mb-5 grid gap-x-4 sm:grid-cols-2">
        <Field
          label="Taxa de entrega (R$)"
          hint="Vai no total de todo pedido de entrega. Deixe em branco ou 0 pra entrega grátis. Quem retira no balcão não paga."
        >
          <input
            className={inputBase}
            value={taxa}
            onChange={(e) => setTaxa(e.target.value)}
            placeholder="0,00"
            inputMode="decimal"
          />
        </Field>
      </div>

      {/* Pausar é o botão de noite atípica: cozinha lotada, entregador que
          sumiu, fim de estoque. Volta sozinho? Não — quem pausou religa. */}
      <label className="mb-5 flex items-start gap-3 rounded-2xl border border-linha p-3.5">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={pausado}
          onChange={(e) => setPausado(e.target.checked)}
        />
        <span className="text-sm">
          <strong className="font-semibold">Pausar pedidos agora</strong>
          <span className="block text-tinta-2">
            Corta na hora, mesmo dentro do horário. Lembre de desmarcar depois —
            ninguém desmarca sozinho.
          </span>
        </span>
      </label>

      {pausado && (
        <div className="mb-5 rounded-xl border border-erro/40 bg-erro/10 px-4 py-3 text-sm text-erro-tinta">
          Com isto salvo, o app não aceita nenhum pedido.
        </div>
      )}

      <Button onClick={salvar} disabled={salvando}>
        {salvando ? "Salvando…" : "Salvar horário e taxa"}
      </Button>
    </Card>
  );
}

/**
 * Trava de versão (`config/app` → `minBuild`). O app lê esse número no boot e
 * bloqueia quem está abaixo dele com a tela de "atualização necessária"
 * (`app/lib/core/version_gate.dart`). É o botão de emergência pra quando uma
 * versão antiga quebra — por isso fica separado do resto, com confirmação.
 */
/**
 * Chave PÚBLICA do Mercado Pago (`config/restaurante.mercadoPagoPublicKey`).
 * O app usa para transformar o cartão em token direto no Mercado Pago. É
 * pública por natureza: o Access Token, que é o segredo, fica no servidor.
 */
function ChavePublicaMP() {
  const { data, loading } = useDoc<Restaurante>("config/restaurante");
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setChave(data?.mercadoPagoPublicKey ?? ""), [data]);

  async function salvar() {
    const v = chave.trim();
    // Só o formato da Public Key (APP_USR- + UUID). O Access Token também começa
    // com APP_USR-, e colado aqui iria parar num documento de leitura pública.
    if (v && !/^(APP_USR|TEST)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
      return toast.error("Isso não é a Public Key. Copie o campo \"Public Key\" (APP_USR- seguido de um código com hífens), nunca o Access Token.");
    if (demoBlock("Chave não salva")) return;
    setSalvando(true);
    try {
      await setDoc(doc(db, "config", "restaurante"), { mercadoPagoPublicKey: v }, { merge: true });
      toast.success(v ? "Salvo. A aba Cartão do app já funciona." : "Removida. O app aceita só Pix.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (loading) return <Spinner />;
  return (
    <Card>
      <Field
        label="Public Key do Mercado Pago"
        hint="Mercado Pago → Suas integrações → Credenciais de produção → Public Key. Nunca cole aqui o Access Token."
      >
        <input
          className={inputBase}
          value={chave}
          onChange={(e) => setChave(e.target.value)}
          placeholder="APP_USR-..."
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <div className="mt-4">
        <Button onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </Card>
  );
}

function VersaoMinima() {
  const { data, loading } = useDoc<{ minBuild?: number }>("config/app");
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const atual = data?.minBuild ?? null;

  useEffect(() => {
    setValor(atual == null ? "" : String(atual));
  }, [atual]);

  const numero = Number(valor);
  const valido = valor.trim() !== "" && Number.isInteger(numero) && numero >= 0;
  const mudou = valido && numero !== (atual ?? -1);

  async function salvar() {
    if (demoBlock("Versão mínima não alterada")) return;
    setSalvando(true);
    try {
      await setDoc(doc(db, "config", "app"), { minBuild: numero }, { merge: true });
      toast.success(
        numero === 0
          ? "Trava desligada. Todo mundo consegue usar o app."
          : `Trava em ${numero}. Quem está abaixo disso vê a tela de atualizar.`
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <Card>
      <p className="mb-4 text-sm text-tinta-2">
        Número da versão (build) mais antiga que ainda pode usar o app. Quem
        estiver abaixo dele fica preso na tela de atualizar até baixar a nova.
        Use <strong className="font-semibold text-tinta">0</strong> pra não
        exigir nada.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Build mínima exigida" hint="Só número inteiro. Ex.: 12.">
          <input
            className={inputBase}
            value={valor}
            onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="0"
          />
        </Field>
        <div className="mb-4">
          <Button onClick={() => setConfirmar(true)} disabled={!mudou || salvando}>
            {salvando ? "Salvando..." : "Aplicar"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-tinta-3">
        {atual == null || atual === 0
          ? "Hoje: sem exigência — nenhuma versão é bloqueada."
          : `Hoje: build ${atual}. Quem tem uma anterior já está bloqueado.`}
      </p>

      <ConfirmDialog
        open={confirmar}
        onClose={() => setConfirmar(false)}
        onConfirm={salvar}
        title={numero === 0 ? "Desligar a trava?" : `Exigir a build ${numero}?`}
        message={
          numero === 0
            ? "Nenhuma versão do app fica bloqueada."
            : `Todo cliente com build anterior a ${numero} para de usar o app na hora e só volta depois de atualizar na loja. Confira que a versão nova já está publicada.`
        }
        confirmLabel={numero === 0 ? "Desligar" : "Bloquear versões antigas"}
      />
    </Card>
  );
}

/**
 * Linha de conferência abaixo do campo. Telefone vira número formatado, link
 * vira link clicável, valor de exemplo é apontado pelo nome.
 */
function Confere({ campo, valor }: { campo: CampoCfg; valor: string }) {
  const v = valor.trim();
  if (!v) return null;

  if (campo.exemplo && v === campo.exemplo) {
    return (
      <span className="mt-1.5 block text-xs font-semibold text-marca-tinta">
        Ainda é o valor de exemplo.
      </span>
    );
  }

  if (campo.numerico) {
    const bonito = telefoneBonito(v);
    const Icone = campo.chave === "whatsapp" ? MessageCircle : Phone;
    return (
      <span className="mt-1.5 flex items-center gap-1.5 text-xs text-tinta-3">
        <Icone size={12} />
        {bonito ?? "Faltam dígitos — precisa de DDI + DDD + número."}
      </span>
    );
  }

  if (v.startsWith("http")) {
    return (
      <a
        href={v}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 flex items-center gap-1.5 text-xs text-tinta-3 hover:text-marca-tinta hover:underline"
      >
        <FileText size={12} /> Abrir e conferir
      </a>
    );
  }

  if (campo.chave === "endereco") {
    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 flex items-center gap-1.5 text-xs text-tinta-3 hover:text-marca-tinta hover:underline"
      >
        <MapPin size={12} /> Ver no mapa como o cliente vê
      </a>
    );
  }

  return null;
}
