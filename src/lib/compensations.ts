import { computeDay, regularBalanceMinutes, type WorkSettings } from "@/lib/time";
import type { CompStatus, Compensation, CompWithDays, TimeEntry } from "@/lib/types";

function normalizeStatus(status: Compensation["status"]): CompStatus {
  if (status === "pendente" || status === "concluida" || status === "cancelada") {
    return status;
  }
  return "pendente";
}

/**
 * Enriquece compensações com o resumo dos dias de origem/destino.
 * Mantido apenas para compatibilidade de tipagem e builds antigos.
 */
export function enrichCompensations(
  comps: Compensation[],
  entries: TimeEntry[],
  settings: WorkSettings,
): CompWithDays[] {
  const dayFor = (date: string) => {
    const list = entries.filter((entry) => entry.date === date);
    return list.length > 0 ? computeDay(list, settings) : null;
  };

  return comps.map((c) => {
    const sourceDay = dayFor(c.sourceDate);
    const targetDay = dayFor(c.targetDate);

    return {
      ...c,
      status: normalizeStatus(c.status),
      sourceDay: sourceDay
        ? {
            workedMinutes: sourceDay.workedMinutes,
            excessMinutes: sourceDay.excessMinutes,
          }
        : null,
      targetDay: targetDay
        ? {
            workedMinutes: targetDay.workedMinutes,
            // Saldo regular pelo PONTO OFICIAL (min(worked, limite) − base);
            // o [10+] não entra no saldo do dia de destino.
            balanceMinutes: regularBalanceMinutes(targetDay.workedMinutes, targetDay.expectedMinutes, settings.maxDailyMinutes),
          }
        : null,
    } satisfies CompWithDays;
  });
}
