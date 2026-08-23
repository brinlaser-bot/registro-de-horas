import { computeDay, expectedMinutesOf, formatMinutes, parseDate, type WorkSettings } from "./time";
import { absenceLabel, dayContext, regularBalanceContribution, type Absence, type DayBalanceView, type DayContext } from "./absences";
import type { Compensation, DayResult, TimeEntry } from "./types";

/** Tipo consolidado do dia da empresa (apresentação central). */
export type CompanyDayType = "regular" | "folga" | "trabalho-folga" | "evento";

export type CalendarTreatment = "ABONADO" | "COMPENSAR";
export type CalendarCategory =
  | "Feriado Nacional"
  | "Feriado Estadual/Municipal"
  | "Compensação 4 Horas"
  | "Compensação 8 Horas"
  | "Recesso Final de Ano"
  | "Aniversário do SEBRAE/PA"
  | "Abono";

export interface CompanyCalendarEntry {
  id: number;
  date: string;
  descricao: string;
  categoria: CalendarCategory;
  tratamento: CalendarTreatment;
  horasACompensar: number;
  jornadaEsperadaHoras: number;
  horasAbonadas: number;
  observacao: string | null;
}

export interface CompanyCalendar {
  version: number;
  importedAt: string;
  entries: CompanyCalendarEntry[];
}

export interface CalendarImportPreview {
  ok: boolean;
  error?: string;
  entries: CompanyCalendarEntry[];
  stats: {
    count: number;
    abonados: number;
    compensar: number;
    totalCompensar: number;
    totalAbonado: number;
  };
}

export interface CalendarDayView {
  ctx: DayContext;
  calendarEntry?: CompanyCalendarEntry;
  label: string | null;
  marker:
    | "folga"
    | "trabalho-folga"
    | "feriado"
    | "trabalho-feriado"
    | "abono"
    | "calendario-compensar"
    | "recesso"
    | null;
  expectedRegular: number;
  abonadasMinutes: number;
  cargaConsiderada: number;
  calendarioACompensar: number;
  regularBalance: number;
  isWeekend: boolean;
  /* ── Apresentação consolidada (Visão geral / Registro rápido) ──
   * Mesma semântica validada na correção de sábado/domingo:
   * folga → esperado 0, saldo = trabalhado, déficit 0, "Folga hoje". */
  type: CompanyDayType;
  /** Jornada esperada efetiva do dia (0 em folga; jornada do calendário em eventos). */
  effectiveExpected: number;
  /** Saldo ajustado para apresentação. */
  adjustedBalance: number;
  /** Déficit comum para apresentação (0 em folga). */
  adjustedDeficit: number;
  /** DayResult pronto para UI: expected/balance já refletem folga/evento/calendário. */
  displayDay: DayResult;
}

export const CALENDAR_HEADER =
  "data;descricao;categoria;tratamento;horas_a_compensar;jornada_esperada_horas;horas_abonadas;observacao";

const CATEGORIES: CalendarCategory[] = [
  "Feriado Nacional",
  "Feriado Estadual/Municipal",
  "Compensação 4 Horas",
  "Compensação 8 Horas",
  "Recesso Final de Ano",
  "Aniversário do SEBRAE/PA",
  "Abono",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isWeekendDate(date: string): boolean {
  const d = parseDate(date).getDay();
  return d === 0 || d === 6;
}

function validDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function parseNumber(v: string): number | null {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === sep && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function detectSeparator(header: string): ";" | "," {
  const semicolon = header.split(";").length;
  const comma = header.split(",").length;
  return semicolon >= comma ? ";" : ",";
}

function deriveAbonadas(date: string, tratamento: CalendarTreatment, explicit: string | undefined, settings: WorkSettings): number | null {
  if (explicit !== undefined && explicit !== "") return parseNumber(explicit);
  if (tratamento !== "ABONADO") return 0;
  return isWeekendDate(date) ? 0 : expectedMinutesOf(settings) / 60;
}

export function parseCompanyCalendarCsv(text: string, settings: WorkSettings): CalendarImportPreview {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return { ok: false, error: "Arquivo vazio.", entries: [], stats: emptyStats() };
  const lines = clean.split(/\r?\n/).filter(Boolean);
  const sep = detectSeparator(lines[0]);
  const headers = splitCsvLine(lines[0], sep).map((h) => h.trim());
  const idx = (name: string) => headers.indexOf(name);
  const required = ["data", "descricao", "categoria", "tratamento", "horas_a_compensar", "jornada_esperada_horas"];
  for (const h of required) {
    if (idx(h) < 0) return { ok: false, error: `Cabeçalho obrigatório ausente: ${h}.`, entries: [], stats: emptyStats() };
  }

  const seen = new Set<string>();
  const entries: CompanyCalendarEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cols = splitCsvLine(lines[i], sep);
    const date = cols[idx("data")] ?? "";
    if (!validDate(date)) return fail(lineNo, "data inválida. Use YYYY-MM-DD.");
    if (seen.has(date)) return fail(lineNo, `data duplicada (${date}).`);
    seen.add(date);

    const categoria = cols[idx("categoria")] as CalendarCategory;
    if (!CATEGORIES.includes(categoria)) return fail(lineNo, `categoria não reconhecida: ${categoria}.`);

    const tratamento = cols[idx("tratamento")] as CalendarTreatment;
    if (tratamento !== "ABONADO" && tratamento !== "COMPENSAR") return fail(lineNo, `tratamento não reconhecido: ${tratamento}.`);

    const hc = parseNumber(cols[idx("horas_a_compensar")] ?? "");
    if (hc === null) return fail(lineNo, "horas_a_compensar inválido.");
    const je = parseNumber(cols[idx("jornada_esperada_horas")] ?? "");
    if (je === null) return fail(lineNo, "jornada_esperada_horas inválido.");
    const ab = deriveAbonadas(date, tratamento, idx("horas_abonadas") >= 0 ? cols[idx("horas_abonadas")] : undefined, settings);
    if (ab === null) return fail(lineNo, "horas_abonadas inválido.");

    entries.push({
      id: entries.length + 1,
      date,
      descricao: cols[idx("descricao")] ?? "",
      categoria,
      tratamento,
      horasACompensar: hc,
      jornadaEsperadaHoras: je,
      horasAbonadas: ab,
      observacao: (idx("observacao") >= 0 ? cols[idx("observacao")] : "") || null,
    });
  }

  const stats = statsOf(entries);
  return { ok: true, entries, stats };

  function fail(lineNo: number, msg: string): CalendarImportPreview {
    return { ok: false, error: `Linha ${lineNo} — ${msg}`, entries: [], stats: emptyStats() };
  }
}

function emptyStats() {
  return { count: 0, abonados: 0, compensar: 0, totalCompensar: 0, totalAbonado: 0 };
}

export function statsOf(entries: CompanyCalendarEntry[]) {
  return {
    count: entries.length,
    abonados: entries.filter((e) => e.tratamento === "ABONADO").length,
    compensar: entries.filter((e) => e.tratamento === "COMPENSAR").length,
    totalCompensar: entries.reduce((s, e) => s + e.horasACompensar * 60, 0),
    totalAbonado: entries.reduce((s, e) => s + e.horasAbonadas * 60, 0),
  };
}

export function buildCompanyCalendar(entries: CompanyCalendarEntry[]): CompanyCalendar {
  return { version: 1, importedAt: new Date().toISOString(), entries };
}

export function exportCompanyCalendarCsv(calendar: CompanyCalendar | undefined): string {
  const rows = [CALENDAR_HEADER];
  for (const e of calendar?.entries ?? []) {
    rows.push([
      e.date,
      e.descricao,
      e.categoria,
      e.tratamento,
      e.horasACompensar,
      e.jornadaEsperadaHoras,
      e.horasAbonadas,
      e.observacao ?? "",
    ].map(csvCell).join(";"));
  }
  return rows.join("\n");
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[;,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function entryOnDate(calendar: CompanyCalendar | undefined, date: string): CompanyCalendarEntry | undefined {
  return calendar?.entries.find((e) => e.date === date);
}

/**
 * RESOLUÇÃO CENTRAL do dia da empresa (fonte única de verdade).
 * Consolida: calendário empresarial (feriados, abonos, recesso, compensações),
 * férias/afastamentos (via dayContext) e a regra de fim de semana.
 * Visão geral, Registros, Resumo e dívidas devem consumir esta função.
 *
 * Regra obrigatória de sábado/domingo (sem evento explícito):
 *   sem batidas → folga: esperado 0, trabalhado 0, saldo 0, déficit 0;
 *   com batidas → trabalho em folga: esperado 0, saldo = trabalhado.
 */
export function companyDayContext(
  date: string,
  entries: TimeEntry[],
  absences: Absence[],
  calendar: CompanyCalendar | undefined,
  settings: WorkSettings,
  nowMinutes?: number,
): CalendarDayView {
  const calendarEntry = entryOnDate(calendar, date);
  const baseCtx = dayContext(date, entries, absences, settings, nowMinutes);
  const day = baseCtx.day;
  const worked = day.workedMinutes;
  const weekend = isWeekendDate(date);
  const statusOf = (): DayResult["status"] =>
    day.open ? "in-progress" : day.entries.length > 0 ? "ok" : "empty";

  if (calendarEntry) {
    const expectedRegular = Math.max(0, calendarEntry.jornadaEsperadaHoras * 60);
    const abonadasMinutes = Math.max(0, calendarEntry.horasAbonadas * 60);
    const calendarioACompensar = calendarEntry.tratamento === "COMPENSAR" ? Math.max(0, calendarEntry.horasACompensar * 60) : 0;
    const cargaConsiderada = Math.min(worked, expectedRegular) + abonadasMinutes;
    const regularBalance = worked - expectedRegular;
    const isHoliday = calendarEntry.categoria.includes("Feriado") || calendarEntry.categoria.includes("Aniversário") || calendarEntry.descricao.toLowerCase().includes("natal");
    const marker = calendarEntry.tratamento === "COMPENSAR"
      ? calendarEntry.categoria === "Recesso Final de Ano" ? "recesso" : "calendario-compensar"
      : calendarEntry.categoria === "Abono" ? "abono" : worked > 0 && isHoliday ? "trabalho-feriado" : "feriado";
    const label = marker === "trabalho-feriado"
      ? `Trabalho em feriado — ${calendarEntry.descricao}`
      : marker === "feriado"
        ? `Feriado — ${calendarEntry.descricao}`
        : marker === "abono"
          ? `Abono — ${calendarEntry.descricao}`
          : marker === "recesso"
            ? `Recesso de final de ano — ${formatMinutes(calendarioACompensar)} a compensar`
            : `${calendarEntry.jornadaEsperadaHoras > 0 ? "Compensação parcial" : "Folga a compensar"} — Calendário`;
    return {
      ctx: baseCtx,
      calendarEntry,
      label,
      marker,
      expectedRegular,
      abonadasMinutes,
      cargaConsiderada,
      calendarioACompensar,
      regularBalance,
      isWeekend: weekend,
      type: "evento",
      effectiveExpected: expectedRegular,
      adjustedBalance: regularBalance,
      adjustedDeficit: day.open ? 0 : Math.max(0, expectedRegular - worked),
      displayDay: { ...day, expectedMinutes: expectedRegular, balanceMinutes: regularBalance, status: statusOf() },
    };
  }

  if (weekend) {
    const hasPunches = day.entries.length > 0;
    const type: CompanyDayType = hasPunches ? "trabalho-folga" : "folga";
    return {
      ctx: baseCtx,
      label: hasPunches ? "Trabalho em folga" : "Folga",
      marker: hasPunches ? "trabalho-folga" : "folga",
      expectedRegular: 0,
      abonadasMinutes: 0,
      cargaConsiderada: worked,
      calendarioACompensar: 0,
      regularBalance: worked,
      isWeekend: true,
      type,
      effectiveExpected: 0,
      adjustedBalance: worked,
      adjustedDeficit: 0,
      displayDay: { ...day, expectedMinutes: 0, balanceMinutes: worked, status: statusOf() },
    };
  }

  if (baseCtx.absence) {
    return {
      ctx: baseCtx,
      label: absenceLabel(baseCtx.absence),
      marker: null,
      expectedRegular: baseCtx.effectiveExpected,
      abonadasMinutes: 0,
      cargaConsiderada: worked,
      calendarioACompensar: 0,
      regularBalance: baseCtx.adjustedBalance,
      isWeekend: false,
      type: "evento",
      effectiveExpected: baseCtx.effectiveExpected,
      adjustedBalance: baseCtx.adjustedBalance,
      adjustedDeficit: baseCtx.adjustedDeficit,
      displayDay: { ...day, expectedMinutes: baseCtx.effectiveExpected, balanceMinutes: baseCtx.adjustedBalance, status: statusOf() },
    };
  }

  return {
    ctx: baseCtx,
    label: null,
    marker: null,
    expectedRegular: baseCtx.effectiveExpected,
    abonadasMinutes: 0,
    cargaConsiderada: worked,
    calendarioACompensar: 0,
    regularBalance: baseCtx.adjustedBalance,
    isWeekend: false,
    type: "regular",
    effectiveExpected: baseCtx.effectiveExpected,
    adjustedBalance: baseCtx.adjustedBalance,
    adjustedDeficit: baseCtx.adjustedDeficit,
    displayDay: { ...day, expectedMinutes: baseCtx.effectiveExpected, balanceMinutes: baseCtx.adjustedBalance, status: day.status },
  };
}

export function calendarMonthlyTotals(entries: CompanyCalendarEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    const month = e.date.slice(0, 7);
    out[month] = (out[month] ?? 0) + e.horasACompensar * 60;
  }
  return out;
}

/**
 * AGREGADOR CENTRAL do saldo regular do período.
 * Fonte única usada por Resumo e Registros: dias com entrada de calendário ou
 * fim de semana usam o saldo da resolução central (folga não gera déficit);
 * demais dias usam o agregador clássico de dayContext (sem dados/jornada
 * aberta = 0). Não altera a matemática validada de férias/saúde/acordo.
 */
export function companyBalanceContribution(view: CalendarDayView): number {
  if (view.calendarEntry || view.isWeekend) return view.regularBalance;
  return regularBalanceContribution(view.ctx);
}

/**
 * AGREGADOR CENTRAL do déficit comum do período.
 * Feriado, abono, folga a compensar, recesso e fim de semana NÃO geram déficit
 * comum; em "Compensação parcial" (ex.: Cinzas) o déficit só pode incidir
 * sobre a jornada regular reduzida do calendário — nunca sobre as 8h padrão.
 */
export function companyDeficitContribution(view: CalendarDayView): number {
  return view.adjustedDeficit;
}

/**
 * VIEW MODEL CENTRAL para o DayCard: mesmo shape de DayBalanceView, mas com
 * jornada esperada, saldo regular e déficit JÁ ajustados pela resolução
 * central (calendário/folga/evento). O componente apenas apresenta — não
 * recalcula regra de calendário nem usa o saldo bruto de computeDay().
 */
export function companyDayBalanceView(view: CalendarDayView): DayBalanceView {
  return {
    ...view.ctx,
    effectiveExpected: view.effectiveExpected,
    adjustedBalance: view.adjustedBalance,
    adjustedDeficit: view.adjustedDeficit,
  };
}
