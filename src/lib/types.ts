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
}

export type CompStatus = "pendente" | "concluida" | "cancelada";

export interface Compensation {
  id: number;
  sourceDate: string;
  targetDate: string;
  minutes: number;
  status: CompStatus;
  note: string | null;
  createdAt: number;
}

export interface AppData {
  user: User;
  entries: TimeEntry[];
  compensations: Compensation[];
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
