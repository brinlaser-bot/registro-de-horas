// ─────────────────────────────────────────────────────────────
// FUNÇÕES CENTRAIS de domínio: Período do Ponto e Ciclo Anual.
// Regras:
//  - Período normal: dia 21 de um mês até dia 20 do mês seguinte.
//  - Fechamento anual em 30/04 → períodos especiais 21/04–30/04 e 01/05–20/05.
//  - Ciclo anual: 01/05 de um ano até 30/04 do ano seguinte ("2025/2026").
// Nenhum componente deve espalhar essas datas — usar sempre estas funções.
// ─────────────────────────────────────────────────────────────
import { addDays, formatDateBR, parseDate } from "./time";

export interface PointPeriod {
  from: string; // YYYY-MM-DD (21, 01/05 ou 21/04)
  to: string; // YYYY-MM-DD (20, 30/04 ou 20/05)
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Ciclo anual do ponto ao qual a data pertence. Ex.: "2025/2026". */
export function getAnnualPointCycle(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m >= 5 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

/** Limites (from/to) de um ciclo anual. Ex.: 2025/2026 → 01/05/2025–30/04/2026. */
export function annualCycleBounds(cycle: string): { from: string; to: string } {
  const startY = Number(cycle.split("/")[0]);
  return { from: ymd(startY, 5, 1), to: ymd(startY + 1, 4, 30) };
}

/** Última data do ciclo (barreira absoluta do fechamento anual). */
export function annualCycleClose(cycle: string): string {
  return annualCycleBounds(cycle).to;
}

/** Primeira data do ciclo seguinte. */
export function nextCycleStart(cycle: string): string {
  return ymd(Number(cycle.split("/")[0]) + 1, 5, 1);
}

/** As duas datas pertencem ao mesmo ciclo anual? */
export function sameAnnualCycle(dateA: string, dateB: string): boolean {
  return getAnnualPointCycle(dateA) === getAnnualPointCycle(dateB);
}

/**
 * Período oficial do ponto ao qual a data pertence.
 * Sequência: … 21/03–20/04 → 21/04–30/04 → 01/05–20/05 → 21/05–20/06 …
 */
export function getPointPeriod(date: string): PointPeriod {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));

  // Períodos especiais do fechamento anual
  if (m === 4 && d >= 21) return { from: ymd(y, 4, 21), to: ymd(y, 4, 30) };
  if (m === 5 && d <= 20) return { from: ymd(y, 5, 1), to: ymd(y, 5, 20) };

  if (d >= 21) {
    // 21 deste mês até 20 do próximo (com transição de ano)
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return { from: ymd(y, m, 21), to: ymd(ny, nm, 20) };
  }
  // Dia 1–20: período começou no dia 21 do mês anterior
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return { from: ymd(py, pm, 21), to: ymd(y, m, 20) };
}

/** Próximo período oficial a partir do fim do período atual. */
export function getNextPointPeriod(period: PointPeriod): PointPeriod {
  const from = addDays(period.to, 1);
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  if (m === 4 && from.endsWith("-21")) return { from, to: ymd(y, 4, 30) };
  if (m === 5 && from.endsWith("-01")) return { from, to: ymd(y, 5, 20) };
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { from, to: ymd(ny, nm, 20) };
}

/** Período oficial anterior ao início do período atual. */
export function getPreviousPointPeriod(period: PointPeriod): PointPeriod {
  const to = addDays(period.from, -1);
  const y = Number(to.slice(0, 4));
  const m = Number(to.slice(5, 7));
  if (to.endsWith("-04-30")) return { from: ymd(y, 4, 21), to };
  if (to.endsWith("-05-20")) return { from: ymd(y, 5, 1), to };
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return { from: ymd(py, pm, 21), to };
}

export function periodLabel(p: PointPeriod): string {
  return `${formatDateBR(p.from)} → ${formatDateBR(p.to)}`;
}

export function samePointPeriod(a: PointPeriod, b: PointPeriod): boolean {
  return a.from === b.from && a.to === b.to;
}

/** Todas as datas (YYYY-MM-DD) entre from e to, inclusive. */
export function listDaysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  let cur = from;
  while (cur <= to) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

/** Dias úteis (seg–sex) do intervalo — usado em contagens de férias. */
export function countWeekdays(from: string, to: string): number {
  return listDaysBetween(from, to).filter((d) => {
    const wd = parseDate(d).getDay();
    return wd !== 0 && wd !== 6;
  }).length;
}
