// ─────────────────────────────────────────────────────────────
// FILTRO DE SITUAÇÃO DO DIA — apenas consulta classificações já
// existentes. NÃO cria status, NÃO altera Banco/COMPENSAR/[10+]/saldo.
// ─────────────────────────────────────────────────────────────
import { isMissingExpectedRecord } from "./missing-records";
import { dayCreditView } from "./hour-bank";
import { faltaOnDate, faltaStatusOf } from "./faltas";
import { companyDayContext, type CalendarDayView, type CompanyCalendars } from "./company-calendar";
import type { Absence } from "./absences";
import type { Compensation, ExcessReason, Falta, TimeEntry, WorkSettings } from "./types";

export type DaySituationId =
  | "dia-ok"
  | "abaixo-base"
  | "hora-extra-regular"
  | "excedente-10"
  | "trabalho-folga"
  | "trabalho-feriado"
  | "falta"
  | "falta-prevista"
  | "ferias"
  | "saude"
  | "dispensado"
  | "abono"
  | "abono-parcial"
  | "folga-compensar";

export interface DaySituationOption {
  id: DaySituationId;
  label: string;
  chip: string;
}

export const DAY_SITUATION_GROUPS: { title: string; options: DaySituationOption[] }[] = [
  {
    title: "Resultado da jornada",
    options: [
      { id: "dia-ok", label: "Dia ok", chip: "Dia ok" },
      { id: "abaixo-base", label: "Abaixo da base", chip: "Abaixo da base" },
      { id: "hora-extra-regular", label: "Hora extra regular", chip: "Hora extra regular" },
      { id: "excedente-10", label: "Excedente do limite diário [10+]", chip: "Excedente [10+]" },
    ],
  },
  {
    title: "Situações especiais",
    options: [
      { id: "trabalho-folga", label: "Trabalho em folga", chip: "Trabalho em folga" },
      { id: "trabalho-feriado", label: "Trabalho em feriado", chip: "Trabalho em feriado" },
      { id: "falta", label: "Falta", chip: "Falta" },
      { id: "falta-prevista", label: "Falta prevista", chip: "Falta prevista" },
      { id: "ferias", label: "Férias", chip: "Férias" },
      { id: "saude", label: "Saúde / afastamento", chip: "Saúde / afastamento" },
      { id: "dispensado", label: "Dispensado", chip: "Dispensado" },
      { id: "abono", label: "Abono", chip: "Abono" },
      { id: "abono-parcial", label: "Abono parcial", chip: "Abono parcial" },
      { id: "folga-compensar", label: "Folga a compensar", chip: "Folga a compensar" },
    ],
  },
];

export const DAY_SITUATION_OPTIONS: DaySituationOption[] = DAY_SITUATION_GROUPS.flatMap((g) => g.options);

const KNOWN = new Set<DaySituationId>(DAY_SITUATION_OPTIONS.map((o) => o.id));

export function situationLabel(id: DaySituationId): string {
  return DAY_SITUATION_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

export function situationChip(id: DaySituationId): string {
  return DAY_SITUATION_OPTIONS.find((o) => o.id === id)?.chip ?? id;
}

export function parseSituationParam(raw: string | null | undefined): DaySituationId[] {
  if (!raw) return [];
  const seen = new Set<DaySituationId>();
  const out: DaySituationId[] = [];
  for (const token of raw.split(",")) {
    const id = token.trim() as DaySituationId;
    if (!KNOWN.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function serializeSituationParam(ids: DaySituationId[]): string {
  return parseSituationParam(ids.join(",")).join(",");
}

/**
 * Predicados independentes — um dia pode ter várias situações.
 * Lê somente campos já derivados (companyDayContext, dayCreditView, falta, Sem registro).
 */
export function situationsFromView(p: {
  date: string;
  today: string;
  view: CalendarDayView;
  missingExpected: boolean;
  faltaStatus: "efetiva" | "prevista" | null;
  regularExtra: number;
  excessSpecial: number;
}): DaySituationId[] {
  const { date, today, view, missingExpected, faltaStatus, regularExtra, excessSpecial } = p;
  const day = view.displayDay;
  const absence = view.ctx.absence;
  const ids: DaySituationId[] = [];

  if (day.status === "ok") ids.push("dia-ok");

  const finalized =
    day.canFinalizeFinancialDay &&
    !day.financialPending &&
    !day.open &&
    !missingExpected &&
    date <= today;
  if (finalized && view.adjustedDeficit > 0) ids.push("abaixo-base");

  if (regularExtra > 0) ids.push("hora-extra-regular");
  if (excessSpecial > 0) ids.push("excedente-10");

  if (view.marker === "trabalho-folga" || view.type === "trabalho-folga") ids.push("trabalho-folga");
  if (view.marker === "trabalho-feriado") ids.push("trabalho-feriado");

  if (faltaStatus === "efetiva") ids.push("falta");
  if (faltaStatus === "prevista") ids.push("falta-prevista");

  if (absence?.kind === "ferias") ids.push("ferias");
  if (absence?.kind === "saude") ids.push("saude");
  if (absence && (absence.kind === "outro" || (absence.kind === "acordado" && absence.treatment === "dispensado"))) {
    ids.push("dispensado");
  }

  if (absence?.kind === "abono" || view.marker === "abono") ids.push("abono");
  if (view.marker === "abono-parcial") ids.push("abono-parcial");

  if (
    view.marker === "calendario-compensar" ||
    view.marker === "recesso" ||
    view.calendarEntry?.tratamento === "COMPENSAR"
  ) {
    ids.push("folga-compensar");
  }

  return ids;
}

export function situationsOfDay(
  date: string,
  today: string,
  entries: TimeEntry[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  settings: WorkSettings,
  opts?: {
    compensations?: Compensation[];
    faltas?: Falta[];
    excessReasons?: ExcessReason[];
  },
): DaySituationId[] {
  const view = companyDayContext(date, entries, absences, calendars, settings);
  const credit = dayCreditView(
    date,
    entries,
    opts?.compensations ?? [],
    absences,
    calendars,
    settings,
    opts?.excessReasons,
  );
  const falta = faltaOnDate(opts?.faltas, date);
  return situationsFromView({
    date,
    today,
    view,
    missingExpected: isMissingExpectedRecord(date, today, view, opts?.faltas),
    faltaStatus: falta ? faltaStatusOf(date, today) : null,
    regularExtra: credit.regularExtra,
    excessSpecial: credit.excessSpecial,
  });
}

/** Seleção vazia = todos os dias. Várias situações = OR. */
export function dayMatchesSituations(have: DaySituationId[], selected: DaySituationId[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((id) => have.includes(id));
}

export function filterDatesBySituation(
  dates: string[],
  selected: DaySituationId[],
  classify: (date: string) => DaySituationId[],
): string[] {
  if (selected.length === 0) return dates;
  return dates.filter((date) => dayMatchesSituations(classify(date), selected));
}
