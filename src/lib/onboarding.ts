/**
 * ETAPA 4L — Primeiro uso / onboarding.
 *
 * REGRA-MÃE: nenhum schema novo e nenhuma versão nova de backup. O estado de
 * "onboarding concluído" é DERIVADO dos próprios dados canônicos já existentes
 * (perfil + jornada + início do controle). BACKUP_VERSION continua 3 e
 * payload_version continua 1.
 *
 * Um novo usuário nunca recebe nome/e-mail/nascimento fictícios: a jornada
 * padrão (08:00–17:00, almoço 12:00–13:00, base 8h, teto 10h) existe apenas
 * como CONFIGURAÇÃO INICIAL EDITÁVEL, não como dado pessoal.
 */
import type { AppData, User } from "./types";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Campos mínimos do onboarding (todos já existem no estado canônico). */
export interface OnboardingDraft {
  name: string;
  email: string;
  workStart: string;
  workEnd: string;
  lunchStart: string;
  lunchEnd: string;
  controlStartDate: string;
}

/**
 * `true` quando o perfil já tem identidade informada pelo usuário. É o único
 * sinal necessário: nome vazio = instalação nova que ainda não foi configurada.
 */
export function hasProfileIdentity(user: User): boolean {
  return (user.name ?? "").trim().length >= 2;
}

/**
 * `true` quando a configuração inicial já foi concluída — derivado dos dados
 * canônicos, sem campo novo persistido.
 */
export function isOnboardingComplete(data: AppData): boolean {
  const user = data.user;
  if (!hasProfileIdentity(user)) return false;
  if (!TIME_RE.test(user.workStart) || !TIME_RE.test(user.workEnd)) return false;
  if (!DATE_RE.test(user.controlStartDate ?? "")) return false;
  return true;
}

/**
 * `true` quando o onboarding deve ser apresentado: conta realmente nova (nenhum
 * fato operacional registrado) e configuração inicial ainda não concluída.
 * Com dados operacionais presentes, NUNCA interrompe o uso.
 */
export function shouldShowOnboarding(data: AppData): boolean {
  if (isOnboardingComplete(data)) return false;
  const collections: ReadonlyArray<ReadonlyArray<unknown> | undefined> = [
    data.entries,
    data.compensations,
    data.absences,
    data.companyCalendars,
    data.faltas,
    data.excessReasons,
    data.specialExcessUses,
    data.specialExcessPlans,
    data.periodConsolidations,
    data.annualCycleClosures,
  ];
  return !collections.some((c) => (c ?? []).length > 0);
}

/** Erro de validação do rascunho (null = pronto para salvar). */
export function validateOnboardingDraft(draft: OnboardingDraft): string | null {
  if (draft.name.trim().length < 2) return "Informe seu nome.";
  for (const value of [draft.workStart, draft.workEnd, draft.lunchStart, draft.lunchEnd]) {
    if (!TIME_RE.test(value)) return "Informe horários válidos (HH:MM).";
  }
  if (!DATE_RE.test(draft.controlStartDate)) return "Informe a data de início do controle.";
  return null;
}

/**
 * Converte o rascunho no patch do perfil canônico. Data de nascimento NÃO é
 * inventada aqui — continua opcional e definida depois em Configurações.
 */
export function onboardingUserPatch(draft: OnboardingDraft): Partial<User> {
  return {
    name: draft.name.trim(),
    email: draft.email.trim().toLowerCase(),
    workStart: draft.workStart,
    workEnd: draft.workEnd,
    lunchStart: draft.lunchStart,
    lunchEnd: draft.lunchEnd,
    controlStartDate: draft.controlStartDate,
  };
}
