// Dias cujo registro NÃO pode ser finalizado financeiramente:
// inconsistente OU passado incompleto (entrada sem saída).
import { computeDay, type TimeEntryLike, type WorkSettings } from "./time";
import { annualCycleBounds, getAnnualPointCycle } from "./periods";

export function isPunchDayPending(opts: {
  consistent: boolean;
  open: boolean;
  empty: boolean;
  date: string;
  today: string;
}): boolean {
  if (opts.empty) return false;
  if (!opts.consistent) return true;
  if (opts.open && opts.date < opts.today) return true;
  return false;
}

/** Datas únicas com registro pendente (conta DIAS, não batidas). */
export function pendingPunchDates(
  entries: TimeEntryLike[],
  settings: WorkSettings,
  today: string,
  range?: { from: string; to: string },
): string[] {
  const dates = [...new Set(entries.map((e) => e.date))]
    .filter((d) => !range || (d >= range.from && d <= range.to))
    .sort();
  return dates.filter((date) => {
    const day = computeDay(
      entries.filter((e) => e.date === date),
      settings,
    );
    return isPunchDayPending({
      consistent: day.consistent,
      open: day.open,
      empty: day.empty,
      date,
      today,
    });
  });
}

/** Pendências do ciclo anual atual (alerta da Visão geral). */
export function pendingPunchDatesInCycle(
  entries: TimeEntryLike[],
  settings: WorkSettings,
  today: string,
): string[] {
  const bounds = annualCycleBounds(getAnnualPointCycle(today));
  return pendingPunchDates(entries, settings, today, bounds);
}
