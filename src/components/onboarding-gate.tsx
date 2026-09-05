"use client";

/**
 * ETAPA 4L — Configuração inicial (primeiro uso).
 *
 * Só aparece para uma conta REALMENTE nova e vazia: sem nenhum fato
 * operacional registrado e sem identidade de perfil informada. Nenhum dado
 * pessoal fictício é sugerido — apenas a jornada padrão editável.
 *
 * Não cria schema novo: todos os campos já existem no estado canônico
 * (perfil + jornada + início do controle). BACKUP_VERSION continua 3.
 */
import { useState, type ReactNode } from "react";
import { Clock3 } from "lucide-react";
import { actions, useAppData, useIsClient } from "@/lib/store";
import { todayString } from "@/lib/time";
import {
  onboardingUserPatch,
  shouldShowOnboarding,
  validateOnboardingDraft,
  type OnboardingDraft,
} from "@/lib/onboarding";
import { Button, Input } from "@/components/ui";
import { useCloudSyncOptional } from "@/components/cloud-sync-provider";

export const ONBOARDING_CTA = "Começar a usar o Meu Horário";

export function OnboardingGate({ children }: { children: ReactNode }) {
  const mounted = useIsClient();
  const data = useAppData();
  const ctx = useCloudSyncOptional();
  const accountEmail = ctx?.email ?? null;

  /**
   * Só os campos que o usuário realmente editou ficam em estado; o restante é
   * DERIVADO do estado canônico e da conta autenticada a cada render (sem
   * efeito de sincronização e sem renders em cascata).
   */
  const [edited, setEdited] = useState<Partial<OnboardingDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft: OnboardingDraft = {
    name: edited.name ?? data.user.name ?? "",
    // E-mail do perfil DERIVADO da conta autenticada (nunca inventado).
    email: edited.email ?? accountEmail ?? data.user.email ?? "",
    workStart: edited.workStart ?? data.user.workStart ?? "08:00",
    workEnd: edited.workEnd ?? data.user.workEnd ?? "17:00",
    lunchStart: edited.lunchStart ?? data.user.lunchStart ?? "12:00",
    lunchEnd: edited.lunchEnd ?? data.user.lunchEnd ?? "13:00",
    controlStartDate:
      edited.controlStartDate ?? data.user.controlStartDate ?? (mounted ? todayString() : ""),
    birthDate: edited.birthDate ?? data.user.birthDate ?? "",
  };
  const setDraft = (patch: Partial<OnboardingDraft>) => setEdited({ ...edited, ...patch });

  if (!mounted) return <>{children}</>;
  if (!shouldShowOnboarding(data)) return <>{children}</>;

  const submit = () => {
    const invalid = validateOnboardingDraft(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    actions.updateUser(onboardingUserPatch(draft));
  };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
            <Clock3 size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-base font-extrabold text-slate-900">Bem-vindo ao Meu Horário</p>
            <p className="text-xs text-slate-500">
              Vamos configurar o básico. Você pode mudar tudo depois em Configurações.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <Input
            label="Seu nome"
            value={draft.name}
            onChange={(e) => setDraft({ name: e.target.value })}
          />
          <Input
            label="E-mail da conta"
            type="email"
            value={draft.email}
            readOnly={Boolean(accountEmail)}
            hint="Este é o e-mail com que você entrou."
            onChange={(e) => setDraft({ email: e.target.value })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Início da jornada"
              type="time"
              value={draft.workStart}
              onChange={(e) => setDraft({ workStart: e.target.value })}
            />
            <Input
              label="Fim da jornada"
              type="time"
              value={draft.workEnd}
              onChange={(e) => setDraft({ workEnd: e.target.value })}
            />
            <Input
              label="Início do almoço"
              type="time"
              value={draft.lunchStart}
              onChange={(e) => setDraft({ lunchStart: e.target.value })}
            />
            <Input
              label="Fim do almoço"
              type="time"
              value={draft.lunchEnd}
              onChange={(e) => setDraft({ lunchEnd: e.target.value })}
            />
          </div>
          <Input
            label="Data de início do controle"
            type="date"
            value={draft.controlStartDate}
            hint="A partir desta data o app acompanha os dias de jornada."
            onChange={(e) => setDraft({ controlStartDate: e.target.value })}
          />
          <Input
            label="Data de nascimento (opcional)"
            type="date"
            value={draft.birthDate}
            hint="Pode ficar em branco e ser preenchida depois, em Configurações."
            onChange={(e) => setDraft({ birthDate: e.target.value })}
          />
        </div>

        {error && (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-5">
          <Button className="w-full justify-center" onClick={submit} loading={busy}>
            {ONBOARDING_CTA}
          </Button>
        </div>
      </div>
    </div>
  );
}
