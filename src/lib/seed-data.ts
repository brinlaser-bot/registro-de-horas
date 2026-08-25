// Seed determinístico 2.0 — cenários manuais coerentes com as regras novas.
// Datas fixas (não relativas a "hoje"): Restaurar dados de exemplo reproduz o mesmo conjunto.
import type { Absence } from "./absences";
import type { AppData, Compensation, ExcessReason, Falta, TimeEntry, User } from "./types";

export const DEFAULT_USER: User = {
  id: 1,
  name: "Alex Santos",
  email: "voce@exemplo.com",
  workStart: "08:00",
  workEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  maxDailyMinutes: 600,
  autoDeductLunch: true,
  birthDate: "1990-08-10",
};

function e(id: number, date: string, time: string, type: "entrada" | "saida", note: string | null = null): TimeEntry {
  return { id, date, time, type, note };
}
function day(id0: number, date: string, end: string, note: string | null = null): TimeEntry[] {
  return [
    e(id0, date, "08:00", "entrada"),
    e(id0 + 1, date, "12:00", "saida"),
    e(id0 + 2, date, "13:00", "entrada"),
    e(id0 + 3, date, end, "saida", note),
  ];
}

export function buildSeedData(): AppData {
  const now = Date.parse("2026-08-25T12:00:00");
  const entries: TimeEntry[] = [
    // 29/04 ciclo anterior — déficit 1h (NÃO elegível para 24/08)
    ...day(1, "2026-04-29", "16:00"),
    // 06/08 acordo a compensar + 07/08 9h (hora extra que quita o acordo)
    ...day(10, "2026-08-07", "19:00"),
    // 11/08 10h15 — especial 15min SEM motivo
    ...day(20, "2026-08-11", "19:15"),
    // 16/08 7h30 — déficit 30min, quitado pelo especial de 17/08
    ...day(30, "2026-08-16", "16:30"),
    // 17/08 10h30 — especial 30min tratado ✓
    ...day(40, "2026-08-17", "19:30", "Demanda urgente"),
    // 18/08 10h45 — especial 45min PROGRAMADO (não realizado)
    ...day(50, "2026-08-18", "19:45", "Atendimento/evento"),
    // 19/08 7h30 — déficit 30, 10 concluídos + 10 planejados, 20 em aberto
    ...day(60, "2026-08-19", "16:30"),
    // 20/08 7h45 — déficit 15 em aberto
    ...day(70, "2026-08-20", "16:45"),
    // 21/08 7h45 — déficit 15 quitado (5 regular + 10 especial de 24/08)
    ...day(80, "2026-08-21", "16:45"),
    // 22/08 sábado +2h
    e(90, "2026-08-22", "10:00", "entrada"),
    e(91, "2026-08-22", "12:00", "saida"),
    // 23/08 domingo +1h
    e(92, "2026-08-23", "09:00", "entrada"),
    e(93, "2026-08-23", "10:00", "saida"),
    // 24/08 11h — regular +2h, especial 1h, 10min alocados a 21/08
    ...day(100, "2026-08-24", "20:00", "Demanda urgente de trabalho"),
    // 07/09 futuro +2h — NÃO entra no realizado antes da data
    e(110, "2026-09-07", "08:00", "entrada"),
    e(111, "2026-09-07", "10:00", "saida"),
  ];

  const compensations: Compensation[] = [
    {
      id: 1, sourceDate: "2026-08-06", targetDate: "2026-08-07", minutes: 120,
      status: "concluida", note: "Quitação parcial do acordo de 06/08 (hora extra de 07/08)", kind: "acordo", createdAt: now - 18 * 86_400_000,
    },
    {
      id: 2, sourceDate: "2026-08-16", targetDate: "2026-08-17", minutes: 30,
      status: "concluida", note: "Alocado excedente acima de 10h (realizado)", kind: "deficit", portion: "especial", createdAt: now - 8 * 86_400_000,
    },
    {
      id: 3, sourceDate: "2026-08-18", targetDate: "2026-08-26", minutes: 45,
      status: "pendente", note: "Planejo sair mais cedo para compensar.", kind: "excedente", createdAt: now - 7 * 86_400_000,
    },
    {
      id: 4, sourceDate: "2026-08-19", targetDate: "2026-08-22", minutes: 10,
      status: "concluida", note: "Usadas horas positivas realizadas", kind: "deficit", portion: "regular", createdAt: now - 5 * 86_400_000,
    },
    {
      id: 5, sourceDate: "2026-08-19", targetDate: "2026-08-28", minutes: 10,
      status: "pendente", note: "Hora extra planejada", kind: "deficit", createdAt: now - 5 * 86_400_000,
    },
    {
      id: 6, sourceDate: "2026-08-21", targetDate: "2026-08-24", minutes: 5,
      status: "concluida", note: "Usadas horas positivas realizadas", kind: "deficit", portion: "regular", createdAt: now - 1 * 86_400_000,
    },
    {
      id: 7, sourceDate: "2026-08-21", targetDate: "2026-08-24", minutes: 10,
      status: "concluida", note: "Alocado excedente acima de 10h (realizado)", kind: "deficit", portion: "especial", createdAt: now - 1 * 86_400_000,
    },
  ];

  const absences: Absence[] = [
    {
      id: 1, kind: "acordado", startDate: "2026-08-06", endDate: "2026-08-06",
      duration: "integral", treatment: "compensar", note: "Folga acordada", createdAt: now - 20 * 86_400_000,
    },
    {
      id: 2, kind: "abono", startDate: "2026-08-10", endDate: "2026-08-10",
      duration: "integral", note: "Abono de aniversário", createdAt: now - 15 * 86_400_000,
    },
  ];

  const faltas: Falta[] = [
    { id: 1, date: "2026-08-31", createdAt: now },
  ];

  const excessReasons: ExcessReason[] = [
    { id: 1, date: "2026-08-17", reason: "demanda-urgente", customReason: null, observation: null, createdAt: now - 8 * 86_400_000, updatedAt: now - 8 * 86_400_000 },
    { id: 2, date: "2026-08-18", reason: "atendimento-evento", customReason: null, observation: null, createdAt: now - 7 * 86_400_000, updatedAt: now - 7 * 86_400_000 },
    { id: 3, date: "2026-08-24", reason: "demanda-urgente", customReason: null, observation: "Demanda urgente de trabalho", createdAt: now - 1 * 86_400_000, updatedAt: now - 1 * 86_400_000 },
  ];

  return {
    user: { ...DEFAULT_USER },
    entries,
    compensations,
    absences,
    companyCalendars: undefined,
    faltas,
    excessReasons,
  };
}
