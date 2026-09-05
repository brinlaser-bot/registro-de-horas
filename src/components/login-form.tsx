"use client";

/**
 * ETAPA 4J — Formulário de login por e-mail + código OTP.
 *
 * Fluxo:
 *  1. usuário informa o e-mail → signInWithOtp (shouldCreateUser = true);
 *  2. usuário digita o código de 6 dígitos → verifyOtp type "email";
 *  3. sucesso → router.replace("/") + router.refresh().
 *
 * NÃO toca no localStorage: login nunca apaga/altera os dados locais.
 * NÃO exibe sync: após o login o usuário vê os dados locais do navegador.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SUPABASE_NOT_CONFIGURED_MSG } from "@/lib/supabase/env";

const RESEND_WAIT_SECONDS = 60;
const INVALID_EMAIL_MSG = "Informe um e-mail válido.";
const SEND_ERROR_MSG = "Não foi possível enviar o código agora. Tente novamente.";
const VERIFY_ERROR_MSG = "Código inválido ou expirado. Solicite um novo código.";

function sanitizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toFriendlyError(kind: "send" | "verify", err: unknown): string {
  if (err instanceof Error && err.message === SUPABASE_NOT_CONFIGURED_MSG) {
    return SUPABASE_NOT_CONFIGURED_MSG;
  }
  return kind === "send" ? SEND_ERROR_MSG : VERIFY_ERROR_MSG;
}

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_WAIT_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const sendCode = async (target: string) => {
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: target,
      options: { shouldCreateUser: true },
    });
    if (otpError) throw otpError;
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeEmail(email);
    if (!isValidEmail(clean)) {
      setError(INVALID_EMAIL_MSG);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendCode(clean);
      setSentTo(clean);
      setCode("");
      setStep("code");
      startCooldown();
    } catch (err) {
      setError(toFriendlyError("send", err));
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.trim();
    if (token.length !== 6) {
      setError(VERIFY_ERROR_MSG);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: sentTo,
        token,
        type: "email",
      });
      if (verifyError) throw verifyError;
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(toFriendlyError("verify", err));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendCode(sentTo);
      startCooldown();
    } catch (err) {
      setError(toFriendlyError("send", err));
    } finally {
      setBusy(false);
    }
  };

  const changeEmail = () => {
    setStep("email");
    setEmail(sentTo);
    setCode("");
    setError(null);
    if (timerRef.current) clearInterval(timerRef.current);
    setCooldown(0);
  };

  const codeValid = code.trim().length === 6;

  return (
    <div className="mx-auto w-full max-w-sm px-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-900/30">
            <Clock3 size={24} />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Meu Horário</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Entre para acessar seu controle em seus dispositivos.
          </p>
        </div>

        {step === "email" ? (
          <form onSubmit={handleSend} noValidate>
            <label htmlFor="login-email" className="mb-1.5 block text-sm font-bold text-slate-700">
              E-mail
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="voce@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
            />
            {error && (
              <p role="alert" aria-live="polite" className="mt-2 text-sm font-semibold text-rose-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !isValidEmail(sanitizeEmail(email))}
              className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Enviando…" : "Enviar código"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} noValidate>
            <p className="text-sm font-medium text-slate-600">
              Enviamos um código para <span className="font-extrabold text-slate-900">{sentTo}</span>
            </p>
            <label htmlFor="login-code" className="mb-1.5 mt-4 block text-sm font-bold text-slate-700">
              Código de acesso
            </label>
            <input
              id="login-code"
              name="one-time-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]*"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={busy}
              autoFocus
              className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-center text-xl font-extrabold tracking-[0.35em] text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
            />
            {error && (
              <p role="alert" aria-live="polite" className="mt-2 text-sm font-semibold text-rose-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !codeValid}
              className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Verificando…" : "Entrar"}
            </button>
            <div className="mt-3 flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={handleResend}
                disabled={busy || cooldown > 0}
                className="text-sm font-bold text-emerald-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
              >
                {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
              </button>
              <button
                type="button"
                onClick={changeEmail}
                disabled={busy}
                className="text-xs font-semibold text-slate-500 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-60"
              >
                Usar outro e-mail
              </button>
            </div>
          </form>
        )}
      </div>
      <p className="mt-4 text-center text-xs font-medium text-slate-400">
        O código tem 6 dígitos e chega no seu e-mail.
      </p>
    </div>
  );
}
