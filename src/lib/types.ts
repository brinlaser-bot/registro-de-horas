// Tipos compartilhados — app 100% client-side (sem banco de dados)
import type { DayResult, DayStatus, EntryType, WorkSettings } from "./time";

export type { DayResult, DayStatus, EntryType, WorkSettings };

export interface User {
  id: number;
  name: string;
  email: string;
  workStart: string;
  workEnd: string;
  lunchStart: string;
  lunchEnd: string;
  maxDailyMinutes: number;
  autoDeductLunch: boolean;
}

export interface TimeEntry {
  id: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  type: EntryType;
  note: string | null;
  /** live = ponto registrado em tempo real · manual = lançado/editado depois */
  source?: "live" | "manual";
  /** true quando o registro foi editado manualmente após o lançamento */
  edited?: boolean;
}

export type CompStatus = "pendente" | "concluida" | "cancelada";

/**
 * excedente: dia passou de 10h → compensa SAINDO MAIS CEDO no dia destino.
 * deficit:   dia ficou abaixo da base → compensa FAZENDO HORA EXTRA no destino.
 * acordo:    horas de afastamento acordado "a compensar" → HORA EXTRA no destino
 *            (sempre dentro do mesmo ciclo anual da origem).
 */
export type CompKind = "excedente" | "deficit" | "acordo";

export interface Compensation {
  id: number;
  sourceDate: string;
  targetDate: string;
  minutes: number;
  status: CompStatus;
  note: string | null;
  createdAt: number;
  kind?: CompKind; // ausente = "excedente" (compatível com dados antigos)
}

/** Resumo de um dia que gerou dívida de horas (excesso ou déficit). */
export interface DebtDay {
  date: string;
  kind: CompKind;
  workedMinutes: number;
  expectedMinutes: number;
  debtMinutes: number; // total original (excedente ou déficit)
  allocatedMinutes: number; // já vinculado a compensações ativas
  pendingMinutes: number; // vinculado e ainda pendente de execução
  concludedMinutes: number; // vinculado e já concluído
  remainingMinutes: number; // ainda falta alocar
}

/** Totais agregados para as barras de progresso. */
export interface DebtTotals {
  debtTotal: number;
  allocated: number;
  concluded: number;
  pending: number;
  remaining: number;
  percent: number; // 0..100 concluído
}

export interface TargetSuggestion {
  date: string;
  workedMinutes: number;
  balanceMinutes: number;
  isToday: boolean;
}

export interface AppData {
  user: User;
  entries: TimeEntry[];
  compensations: Compensation[];
  absences: import("./absences").Absence[];
}

export interface CompWithDays extends Compensation {
  sourceDay: { workedMinutes: number; excessMinutes: number } | null;
  targetDay: { workedMinutes: number; balanceMinutes: number } | null;
}

export interface DaySummary {
  date: string;
  workedMinutes: number;
  expectedMinutes: number;
  balanceMinutes: number;
  excessMinutes: number;
  registrableMinutes: number;
  status: DayStatus;
  open: boolean;
  entryCount: number;
}
