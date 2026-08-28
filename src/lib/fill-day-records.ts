// ─────────────────────────────────────────────────────────────
// PREENCHER REGISTROS DO DIA — montagem local da jornada completa.
//
// Usado pelo card SEM REGISTRO. Os horários ficam só no formulário até
// a sequência estar completa e válida. Só então o store recebe TODAS as
// batidas de uma vez (addEntries). Nunca persiste Entrada isolada.
// Reusa stayAndNetMinutes (intervalo automático) e analyzePunches.
// ─────────────────────────────────────────────────────────────
import { stayAndNetMinutes } from "./breaks";
import { analyzePunches } from "./punches";
import { toMinutes, type EntryType, type TimeEntryLike, type WorkSettings } from "./time";

export interface FillPeriod {
  entrada: string;
  saida: string;
}

export interface FillDayPunch {
  date: string;
  time: string;
  type: EntryType;
  note: string | null;
  source: "manual";
}

export const FILL_INCOMPLETE_MSG = "Complete os horários deste dia antes de salvar.";
export const FILL_ORDER_MSG = "A hora de saída deve ser depois da entrada.";
export const FILL_OVERLAP_MSG = "Os períodos informados se sobrepõem. Ajuste os horários.";

function overlapMinutes(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/** Prévia de permanência / intervalo automático / trabalhado (mesma matemática do lançamento manual). */
export function fillDayPreview(
  periods: FillPeriod[],
  settings: WorkSettings,
): { stay: number; autoBreak: number; net: number } {
  return stayAndNetMinutes(periods, settings, "periodo");
}

export function fillDayPunches(date: string, periods: FillPeriod[]): FillDayPunch[] {
  const sorted = [...periods].sort(
    (a, b) => a.entrada.localeCompare(b.entrada) || a.saida.localeCompare(b.saida),
  );
  const out: FillDayPunch[] = [];
  for (const p of sorted) {
    out.push({ date, time: p.entrada, type: "entrada", note: null, source: "manual" });
    out.push({ date, time: p.saida, type: "saida", note: null, source: "manual" });
  }
  return out;
}

/**
 * Valida o formulário SEM tocar no store.
 * Exige jornada completa (todos os pares fechados, sem sobreposição).
 */
export function validateFillDayPeriods(periods: FillPeriod[]): { ok: boolean; error?: string } {
  if (periods.length === 0) return { ok: false, error: FILL_INCOMPLETE_MSG };
  for (const p of periods) {
    if (!p.entrada || !p.saida) return { ok: false, error: FILL_INCOMPLETE_MSG };
    if (toMinutes(p.saida) <= toMinutes(p.entrada)) return { ok: false, error: FILL_ORDER_MSG };
  }
  const sorted = [...periods].sort((a, b) => toMinutes(a.entrada) - toMinutes(b.entrada));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a1 = toMinutes(sorted[i].entrada);
      const a2 = toMinutes(sorted[i].saida);
      const b1 = toMinutes(sorted[j].entrada);
      const b2 = toMinutes(sorted[j].saida);
      if (overlapMinutes(a1, a2, b1, b2) > 0) {
        return { ok: false, error: FILL_OVERLAP_MSG };
      }
    }
  }
  const times = periods.flatMap((p) => [p.entrada, p.saida]);
  if (new Set(times).size !== times.length) {
    return { ok: false, error: FILL_OVERLAP_MSG };
  }
  return { ok: true };
}

export function validateFillDaySave(
  date: string,
  periods: FillPeriod[],
): { ok: boolean; error?: string; punches?: FillDayPunch[] } {
  const base = validateFillDayPeriods(periods);
  if (!base.ok) return base;
  const punches = fillDayPunches(date, periods);
  const asEntries: TimeEntryLike[] = punches.map((p, i) => ({
    id: i + 1,
    date: p.date,
    time: p.time,
    type: p.type,
    note: p.note,
    source: p.source,
  }));
  const analysis = analyzePunches(asEntries);
  if (!analysis.isConsistent || !analysis.isComplete) {
    return { ok: false, error: FILL_INCOMPLETE_MSG };
  }
  return { ok: true, punches };
}
