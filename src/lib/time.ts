// ─────────────────────────────────────────────────────────────
// Funções puras de cálculo de horas de trabalho
// Regras da empresa: jornada 08:00–17:00, almoço 12:00–13:00,
// base diária de 8h e limite de registro de 10h/dia.
// ─────────────────────────────────────────────────────────────

export type EntryType = "entrada" | "saida";

export interface TimeEntryLike {
  id: number;
  date: string;
  time: string; // HH:MM
  type: EntryType;
  note: string | null;
  source?: "live" | "manual";
  edited?: boolean;
}

export interface WorkSettings {
  workStart: string;
  workEnd: string;
  lunchStart: string;
  lunchEnd: string;
  maxDailyMinutes: number;
  autoDeductLunch: boolean;
}

export interface Segment {
  start: string;
  end: string;
  minutes: number;
}

export type DayStatus = "empty" | "in-progress" | "excess" | "deficit" | "ok";

export interface DayResult {
  date: string;
  entries: TimeEntryLike[];
  workedMinutes: number;
  expectedMinutes: number;
  balanceMinutes: number; // trabalhado - base (positivo = crédito)
  excessMinutes: number; // acima do limite de 10h (não registrável no dia)
  registrableMinutes: number; // quanto registrar no ponto da empresa
  lunchDeductedMinutes: number;
  segments: Segment[];
  open: boolean;
  empty: boolean;
  status: DayStatus;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "08:30" -> 510 */
export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 510 -> "08:30" */
export function fromMinutes(total: number): string {
  const clamped = ((total % 1440) + 1440) % 1440;
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/** 510 -> "8h30" ; 45 -> "45min" ; -30 -> "-30min" ; -90 -> "-1h30" */
export function formatMinutes(m: number): string {
  const sign = m < 0 ? "-" : "";
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const min = abs % 60;
  if (h === 0) return `${sign}${min}min`;
  if (min === 0) return `${sign}${h}h`;
  return `${sign}${h}h${pad(min)}`;
}

/** Date -> "YYYY-MM-DD" (local) */
export function dateToString(d: Date): string {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

export function todayString(): string {
  return dateToString(new Date());
}

/** "YYYY-MM-DD" -> Date (meio-dia local, evita off-by-one de UTC) */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return dateToString(d);
}

export function isWeekend(dateStr: string): boolean {
  const day = parseDate(dateStr).getDay();
  return day === 0 || day === 6;
}

export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(days)}` };
}

export function weekdayLong(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString("pt-BR", { weekday: "long" });
}

export function weekdayShort(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString("pt-BR", { weekday: "short" });
}

export function formatDateBR(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateShortBR(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function nextWorkday(dateStr: string): string {
  let d = addDays(dateStr, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

export function expectedMinutesOf(s: WorkSettings): number {
  return Math.max(0, toMinutes(s.workEnd) - toMinutes(s.workStart) - (toMinutes(s.lunchEnd) - toMinutes(s.lunchStart)));
}

/**
 * Calcula o resumo de um dia a partir das batidas.
 * Batidas são emparelhadas sequencialmente (entrada → saída).
 * Se a última batida for entrada sem saída, o dia fica "em andamento"
 * e o tempo é calculado até `nowMinutes` (opcional).
 */
export function computeDay(
  entries: TimeEntryLike[],
  settings: WorkSettings,
  nowMinutes?: number,
): DayResult {
  const expected = expectedMinutesOf(settings);
  const sorted = [...entries].sort((a, b) => a.time.localeCompare(b.time));

  let worked = 0;
  let open = false;
  let openStart: string | null = null;
  const segments: Segment[] = [];

  for (const e of sorted) {
    if (e.type === "entrada") {
      if (openStart === null) openStart = e.time;
    } else {
      if (openStart !== null) {
        const mins = toMinutes(e.time) - toMinutes(openStart);
        if (mins > 0) {
          worked += mins;
          segments.push({ start: openStart, end: e.time, minutes: mins });
        }
        openStart = null;
      }
    }
  }

  if (openStart !== null) {
    open = true;
    if (nowMinutes !== undefined && nowMinutes > toMinutes(openStart)) {
      worked += nowMinutes - toMinutes(openStart);
    }
  }

  // Desconto automático do almoço quando não há batida no intervalo
  let lunchDeductedMinutes = 0;
  if (settings.autoDeductLunch && entries.length > 0) {
    const ls = toMinutes(settings.lunchStart);
    const le = toMinutes(settings.lunchEnd);
    const hasPunchInLunch = sorted.some((e) => {
      const m = toMinutes(e.time);
      return m >= ls && m <= le;
    });
    const first = toMinutes(sorted[0].time);
    const last = toMinutes(sorted[sorted.length - 1].time);
    if (!hasPunchInLunch && first <= ls && last >= le) {
      lunchDeductedMinutes = le - ls;
      worked = Math.max(0, worked - lunchDeductedMinutes);
    }
  }

  const balance = worked - expected;
  const excess = Math.max(0, worked - settings.maxDailyMinutes);
  const registrable = Math.max(0, Math.min(worked, settings.maxDailyMinutes));

  let status: DayStatus = "ok";
  if (entries.length === 0) status = "empty";
  else if (open) status = "in-progress";
  else if (excess > 0) status = "excess";
  else if (balance < 0) status = "deficit";

  return {
    date: entries[0]?.date ?? "",
    entries: sorted,
    workedMinutes: worked,
    expectedMinutes: expected,
    balanceMinutes: balance,
    excessMinutes: excess,
    registrableMinutes: registrable,
    lunchDeductedMinutes,
    segments,
    open,
    empty: entries.length === 0,
    status,
  };
}

export function nowTimeString(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nowMinutesLocal(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function listDaysInMonth(month: string): string[] {
  const { from, to } = monthBounds(month);
  const days: string[] = [];
  let cur = from;
  while (cur <= to) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

/* ── Assistente de jornada / previsão de saída ────────────── */

const MAX_CLOCK = 23 * 60 + 59;

function clampClock(m: number): string {
  return m > MAX_CLOCK ? fromMinutes(MAX_CLOCK) : fromMinutes(m);
}

function lunchLength(s: WorkSettings): number {
  return Math.max(0, toMinutes(s.lunchEnd) - toMinutes(s.lunchStart));
}

/**
 * Horário PLANEJADO de saída para atingir `targetMinutes` trabalhados.
 *
 * Calculado exclusivamente a partir das batidas do dia (primeira entrada,
 * pares fechados e almoço) — NUNCA a partir da hora atual. Assim, mesmo que
 * o horário planejado já tenha passado, ele permanece o mesmo
 * (ex.: entrada 08:37 + 8h + almoço = 17:37, independentemente de agora serem 22h).
 *
 * Retorna null apenas quando o dia já está encerrado (última batida = saída).
 */
export function plannedExitTime(
  entries: TimeEntryLike[],
  settings: WorkSettings,
  targetMinutes: number,
): string | null {
  const ls = toMinutes(settings.lunchStart);
  const le = toMinutes(settings.lunchEnd);
  const len = lunchLength(settings);

  if (entries.length === 0) {
    // Sem batidas: projeta a partir do início da jornada
    const start = toMinutes(settings.workStart);
    let exit = start + Math.max(0, targetMinutes);
    if (settings.autoDeductLunch && start <= ls && exit > ls && len > 0) exit += len;
    return clampClock(exit);
  }

  const sorted = [...entries].sort((a, b) => a.time.localeCompare(b.time));
  const last = sorted[sorted.length - 1];
  if (last.type !== "entrada") return null; // jornada encerrada

  // Tempo bruto dos pares fechados + início do trecho aberto
  let rawClosed = 0;
  let cur: number | null = null;
  for (const e of sorted) {
    const m = toMinutes(e.time);
    if (e.type === "entrada") {
      if (cur === null) cur = m;
    } else if (cur !== null) {
      rawClosed += Math.max(0, m - cur);
      cur = null;
    }
  }
  const openStart = cur ?? toMinutes(last.time);
  const firstPunch = toMinutes(sorted[0].time);

  const hasLunchPunch = sorted.some((e) => {
    const m = toMinutes(e.time);
    return m >= ls && m <= le;
  });

  let exit = openStart + Math.max(0, targetMinutes - rawClosed);
  // Se o almoço será descontado automaticamente e a saída cruza o intervalo, soma o almoço
  if (settings.autoDeductLunch && !hasLunchPunch && firstPunch <= ls && exit > ls && len > 0) {
    exit += len;
  }
  void le;
  return clampClock(exit);
}

/** Divide as horas de um dia nos 3 blocos usados no gráfico empilhado. */
export function stackedSegments(
  workedMinutes: number,
  expected: number,
  maxDaily: number,
): { base: number; extra: number; excess: number } {
  const cap = Math.max(expected, maxDaily);
  return {
    base: Math.max(0, Math.min(workedMinutes, expected)),
    extra: Math.max(0, Math.min(workedMinutes, cap) - expected),
    excess: Math.max(0, workedMinutes - cap),
  };
}
