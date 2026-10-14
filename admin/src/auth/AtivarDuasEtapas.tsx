import { useEffect, useState } from "react";
import { FirebaseError } from "firebase/app";
import {
  multiFactor,
  sendEmailVerification,
  signOut,
  TotpMultiFactorGenerator,
  type TotpSecret,
  type User,
} from "firebase/auth";
import QRCode from "qrcode";
import { toast } from "sonner";
import { auth } from "../lib/firebase";
import { PandaLogo } from "../components/PandaLogo";
import { Button } from "../components/ui";
import { inputBase } from "../components/Modal";

/**
 * Tela obrigatória para admin sem verificação em duas etapas. O painel não
 * renderiza até isso ser concluído; o servidor também recusa token sem
 * segundo fator. Depois de ativar, a sessão atual não tem a claim do segundo
 * fator, então saímos e a pessoa entra de novo já com o código.
 */
export function AtivarDuasEtapas({ user }: { user: User }) {
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [qr, setQr] = useState("");
  const [codigo, setCodigo] = useState("");
  const [busy, setBusy] = useState(false);

  // Firebase só cadastra TOTP em conta com e-mail verificado.
  async function avisarEmailNaoVerificado() {
    try {
      await sendEmailVerification(user);
    } catch {
      // Sem envio: a mensagem abaixo ainda orienta a tentar de novo.
    }
    toast.error(
      "Confirme seu e-mail pelo link que enviamos (veja o spam) e entre de novo.",
      { duration: 12_000 }
    );
    await signOut(auth);
  }

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const session = await multiFactor(user).getSession();
        const s = await TotpMultiFactorGenerator.generateSecret(session);
        const url = await QRCode.toDataURL(
          s.generateQrCodeUrl(user.email ?? "admin", "PandaVip"),
          { margin: 1, width: 192 }
        );
        if (vivo) {
          setSecret(s);
          setQr(url);
        }
      } catch (err) {
        if (!vivo) return;
        if (err instanceof FirebaseError && err.code === "auth/unverified-email") {
          await avisarEmailNaoVerificado();
        } else if (err instanceof FirebaseError && err.code === "auth/requires-recent-login") {
          toast.error("Por segurança, entre de novo para ativar a verificação em duas etapas.");
          await signOut(auth);
        } else {
          toast.error("Não deu pra gerar o código agora. Recarregue a página e tente de novo.");
        }
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avisarEmailNaoVerificado só depende de user
  }, [user]);

  async function ativar(e: React.FormEvent) {
    e.preventDefault();
    if (!secret) return;
    setBusy(true);
    try {
      await multiFactor(user).enroll(
        TotpMultiFactorGenerator.assertionForEnrollment(secret, codigo.trim()),
        "Autenticador"
      );
      toast.success("Verificação em duas etapas ativada. Entre de novo com o código do app.", {
        duration: 10_000,
      });
      await signOut(auth);
    } catch (err) {
      const c = err instanceof FirebaseError ? err.code : "";
      if (c === "auth/unverified-email") return avisarEmailNaoVerificado();
      toast.error(
        c === "auth/invalid-verification-code"
          ? "Código incorreto. Confira o app autenticador."
          : c === "auth/requires-recent-login"
            ? "Por segurança, entre de novo para ativar a verificação em duas etapas."
            : "Não deu pra ativar agora. Tente de novo."
      );
      if (c === "auth/requires-recent-login") await signOut(auth);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-marca p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center text-sobre-marca">
          <PandaLogo size={104} />
          <div className="rotulo mt-5 text-sobre-marca!">Painel do restaurante</div>
          <h1 className="display mt-2 text-[26px] leading-none">Ative a verificação em duas etapas</h1>
          <p className="mt-2.5 text-sm">
            Obrigatória para quem administra o painel. Leia o QR code com um app
            autenticador (Google Authenticator, Authy, 1Password) e digite o código de 6 dígitos.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-superficie p-6 shadow-xl">
          {qr && secret ? (
            <>
              <img src={qr} alt="QR code para cadastrar o PandaVip no app autenticador" width={192} height={192} className="rounded-xl bg-white" />
              <p className="text-center text-xs text-tinta-3">
                Sem câmera? Digite esta chave no app:
                <br />
                <code className="break-all select-all font-mono text-tinta-2">{secret.secretKey}</code>
              </p>
              <form onSubmit={ativar} className="flex w-full flex-col gap-3">
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="Código de 6 dígitos"
                  aria-label="Código de 6 dígitos"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                  className={inputBase}
                  required
                />
                <Button type="submit" disabled={busy || codigo.length !== 6}>
                  {busy ? "Ativando..." : "Ativar"}
                </Button>
              </form>
            </>
          ) : (
            <p className="text-sm text-tinta-3">Gerando código...</p>
          )}
          <Button variant="outline" className="w-full" onClick={() => signOut(auth)}>
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
