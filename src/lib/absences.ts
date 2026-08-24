// ─────────────────────────────────────────────────────────────
// FUNÇÕES CENTRAIS de Férias e Afastamentos.
// Efeitos sobre a jornada:
//  - férias / saúde / acordado-dispensado / outro → horas justificadas
//    NÃO geram déficit (jornada esperada efetiva reduzida).
//  - acordado-compensar → horas viram pendência "Acordo a compensar"
//    (não são déficit comum), compensáveis com hora extra no mesmo ciclo.
// ─────────────────────────────────────────────────────────────
import { computeDay, expectedMinutesOf, toMinutes } from "./time";
import { annualCycleClose, annualCycleBounds, getAnnualPointCycle, nextCycleStart, sameAnnualCycle } from "./periods";
import type { DayResult, Falta, TimeEntry, WorkSettings } from "./types";

export type AbsenceKind = "ferias" | "saude" | "acordado" | "abono" | "outro";
export type AbsenceDuration = "integral" | "parcial";
export type AbsenceTreatment = "dispensado" | "compensar";

export interface Absence {
  id: number;
  kind: AbsenceKind;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (mesmo ciclo anual de startDate)
  duration: AbsenceDuration;
  /** HH:MM — apenas quando duration = "parcial" */
  partialStart?: string;
  partialEnd?: string;
  /** Afastamento por saúde: atestado apresentado */
  medicalCert?: boolean;
  /** Apenas afastamento acordado: dispensado | compensar */
  treatment?: AbsenceTreatment;
  note?: string | null;
  createdAt: number;
}

export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  ferias: "Férias",
  saude: "Afastamento por saúde",
  acordado: "Afastamento acordado",
  abono: "Abono de aniversário",
  outro: "Outro afastamento justificado",
};

export function absenceLabel(a: Absence): string {
  if (a.kind === "acordado") {
    return a.treatment === "compensar"
      ? "Afastamento acordado — compensar posteriormente"
      : "Afastamento acordado — horas dispensadas";
  }
  return ABSENCE_LABELS[a.kind];
}

/** Janelas de trabalho esperado do dia (sem almoço), em minutos. */
export function workWindows(s: WorkSettings): Array<[number, number]> {
  return [
    [toMinutes(s.workStart), toMinutes(s.lunchStart)],
    [toMinutes(s.lunchEnd), toMinutes(s.workEnd)],
  ];
}

function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/** Ausência que cobre a data (se houver). */
export function absenceOnDate(absences: Absence[], date: string): Absence | undefined {
  return absences.find((a) => date >= a.startDate && date <= a.endDate);
}

/**
 * Minutos de jornada esperada cobertos pela ausência no dia.
 * Parcial: apenas a interseção com as janelas de trabalho (almoço não conta).
 */
export function absenceJustifiedMinutes(a: Absence, s: WorkSettings): number {
  const windows = workWindows(s);
  if (a.duration === "integral") {
    return windows.reduce((sum, [w1, w2]) => sum + Math.max(0, w2 - w1), 0);
  }
  const p1 = toMinutes(a.partialStart ?? "");
  const p2 = toMinutes(a.partialEnd ?? "");
  if (p2 <= p1) return 0;
  return windows.reduce((sum, [w1, w2]) => sum + overlap(p1, p2, w1, w2), 0);
}

/** Minutos efetivamente trabalhados DENTRO da janela da ausência. */
export function workedWithinAbsence(day: DayResult, a: Absence, s: WorkSettings): number {
  if (a.duration !== "parcial") {
    // Integral: todo trabalho do dia fica dentro da ausência e é histórico,
    // mas não vira saldo regular positivo automaticamente.
    return day.workedMinutes;
  }
  const p1 = toMinutes(a.partialStart ?? "");
  const p2 = toMinutes(a.partialEnd ?? "");
  if (p2 <= p1) return 0;
  // Parcial: considera somente a interseção da ausência com as janelas reais de trabalho.
  // Assim, almoço e períodos fora da jornada não contam como dispensa/abatimento.
  const windows = workWindows(s);
  return day.segments.reduce((sum, seg) => {
    const s1 = toMinutes(seg.start);
    const s2 = toMinutes(seg.end);
    const insideWorkWindows = windows.reduce(
      (acc, [w1, w2]) => acc + overlap(s1, s2, Math.max(p1, w1), Math.min(p2, w2)),
      0,
    );
    return sum + insideWorkWindows;
  }, 0);
}

export interface DayContext {
  day: DayResult;
  absence?: Absence;
  /** Jornada esperada efetiva (base − horas dispensadas). */
  effectiveExpected: number;
  /** Saldo considerando a jornada efetiva. */
  adjustedBalance: number;
  /** Déficit comum (0 em dia aberto ou com horas justificadas/acordo). */
  adjustedDeficit: number;
  /** Horas "Acordo a compensar" geradas no dia (acordado/compensar). */
  acordoMinutes: number;
  /** Horas justificadas (férias/saúde/dispensado/outro). */
  justifiedMinutes: number;
  isVacation: boolean;
}

/**
 * FUNÇÃO CENTRAL: contexto de jornada de um dia, já considerando ausências.
 * Todos os relatórios (Dashboard, Registros, Resumo, Consulta, dívidas)
 * devem usar esta função — nunca calcular déficit diretamente do computeDay.
 */
export function dayContext(
  date: string,
  entries: TimeEntry[],
  absences: Absence[],
  settings: WorkSettings,
  nowMinutes?: number,
): DayContext {
  const day = computeDay(
    entries.filter((e) => e.date === date),
    settings,
    nowMinutes,
  );
  if (!day.date) day.date = date;

  const absence = absenceOnDate(absences, date);
  const expected = day.expectedMinutes || expectedMinutesOf(settings);

  if (!absence) {
    return {
      day,
      effectiveExpected: expected,
      adjustedBalance: day.workedMinutes - expected,
      adjustedDeficit: day.open ? 0 : Math.max(0, expected - day.workedMinutes),
      acordoMinutes: 0,
      justifiedMinutes: 0,
      isVacation: false,
    };
  }

  const justified = absenceJustifiedMinutes(absence, settings);
  const workedInsideAbsence = workedWithinAbsence(day, absence, settings);
  const regularWorked = Math.max(0, day.workedMinutes - workedInsideAbsence);
  const regularExpected = Math.max(0, expected - justified);

  if (absence.kind === "acordado" && absence.treatment === "compensar") {
    // Horas do acordo NÃO são déficit comum. O que não foi trabalhado dentro da janela
    // do acordo vira obrigação própria: "Acordo a compensar".
    const acordo = Math.max(0, justified - workedInsideAbsence);
    return {
      day,
      absence,
      effectiveExpected: regularExpected,
      adjustedBalance: regularWorked - regularExpected,
      adjustedDeficit: day.open ? 0 : Math.max(0, regularExpected - regularWorked),
      acordoMinutes: acordo,
      justifiedMinutes: justified,
      isVacation: false,
    };
  }

  // Férias / saúde / acordado-dispensado / outro: horas justificadas são neutras
  // para o saldo regular. Batidas existentes continuam históricas (worked/no ponto),
  // mas trabalho dentro do período justificado não vira crédito automático.
  return {
    day,
    absence,
    effectiveExpected: regularExpected,
    adjustedBalance: regularWorked - regularExpected,
    adjustedDeficit: day.open ? 0 : Math.max(0, regularExpected - regularWorked),
    acordoMinutes: 0,
    justifiedMinutes: justified,
    isVacation: absence.kind === "ferias" && justified >= expected,
  };
}

export type DayBalanceView = DayContext;

/**
 * FUNÇÃO CENTRAL para apresentação do saldo do dia.
 * É um alias semântico de dayContext para deixar claro que DayCard/Resumo/Dashboard
 * devem consumir a mesma visão de saldo regular, déficit comum e acordo a compensar.
 */
export function getDayBalanceView(
  date: string,
  entries: TimeEntry[],
  absences: Absence[],
  settings: WorkSettings,
  nowMinutes?: number,
): DayBalanceView {
  return dayContext(date, entries, absences, settings, nowMinutes);
}

/**
 * Contribuição de um dia ao Saldo do período.
 * Usa exclusivamente o saldo regular já calculado por dayContext/getDayBalanceView.
 *
 * - sem batidas e sem evento = sem informação → não entra (0);
 * - jornada aberta = saldo ainda não é definitivo → não entra (0);
 * - dia encerrado ou evento real = entra com adjustedBalance.
 */
export function regularBalanceContribution(view: DayBalanceView): number {
  const hasRelevantData = view.day.entries.length > 0 || view.absence !== undefined;
  if (!hasRelevantData || view.day.open) return 0;
  return view.adjustedBalance;
}

/* ── Visão central de dia da empresa ─────────────────────────
 * A resolução consolidada do dia (fim de semana/folga/evento/calendário)
 * vive em ./company-calendar.ts (companyDayContext) — fonte única de verdade.
 * Este módulo mantém apenas a matemática de férias/afastamentos (dayContext).
 */

/* ── Validação central de férias/afastamentos ────────────── */

export interface AbsenceSplit {
  first: { startDate: string; endDate: string };
  second: { startDate: string; endDate: string };
}

export interface AbsenceValidation {
  ok: boolean;
  error?: string;
  code?: "invalid" | "cross-cycle" | "overlap";
  /** Evento atravessa o fechamento anual: sugestão de divisão em 2 registros. */
  split?: AbsenceSplit;
  /** Evento salvo, mas há batidas no período (informativo, nunca silencia). */
  warning?: string;
}

export function validateAbsence(
  draft: Omit<Absence, "id" | "createdAt">,
  allAbsences: Absence[],
  entries: TimeEntry[],
  excludeId?: number,
  faltas: Falta[] = [],
): AbsenceValidation {
  const { startDate, endDate } = draft;
  if (!startDate || !endDate) return { ok: false, code: "invalid", error: "Informe as datas." };
  if (endDate < startDate) {
    return { ok: false, code: "invalid", error: "A data final não pode ser anterior à data inicial." };
  }
  if (draft.duration === "parcial") {
    if (!draft.partialStart || !draft.partialEnd) {
      return { ok: false, code: "invalid", error: "Informe o horário inicial e final do período parcial." };
    }
    if (toMinutes(draft.partialEnd) <= toMinutes(draft.partialStart)) {
      return { ok: false, code: "invalid", error: "O horário final deve ser depois do inicial." };
    }
  }
  if (draft.kind === "acordado" && !draft.treatment) {
    return { ok: false, code: "invalid", error: "Informe como tratar as horas do afastamento acordado." };
  }

  // Regra do ABONO DE ANIVERSÁRIO: sempre dia inteiro (não existe parcial).
  if (draft.kind === "abono" && draft.duration !== "integral") {
    return {
      ok: false,
      code: "invalid",
      error: "O Abono de aniversário é sempre um dia inteiro.",
    };
  }
  // O Abono é um benefício de UM único dia (nunca abrange 2+ dias).
  if (draft.kind === "abono" && startDate !== endDate) {
    return {
      ok: false,
      code: "invalid",
      error: "O Abono de aniversário é de um único dia — mantenha as datas inicial e final iguais.",
    };
  }

  // Parte A: FÉRIAS nunca atravessam o fechamento anual (30/04 → 01/05).
  // Diferente de saúde/acordado/outro, NÃO se oferece divisão: ajuste das datas.
  if (draft.kind === "ferias" && !sameAnnualCycle(startDate, endDate)) {
    return {
      ok: false,
      code: "cross-cycle",
      error:
        "As férias não podem ultrapassar o fechamento do ciclo anual em 30/04. Ajuste a data final para até 30/04. A partir de 01/05 inicia-se um novo ciclo anual.",
    };
  }

  // Barreira do fechamento anual: saúde/acordado/outro podem ser divididos.
  if (!sameAnnualCycle(startDate, endDate)) {
    const cycle = getAnnualPointCycle(startDate);
    return {
      ok: false,
      code: "cross-cycle",
      error:
        "O fechamento anual ocorre em 30/04. Este período precisa ser dividido em dois registros independentes.",
      split: {
        first: { startDate, endDate: annualCycleClose(cycle) },
        second: { startDate: nextCycleStart(cycle), endDate },
      },
    };
  }

  // Regra do ABONO: um benefício por ciclo anual (resolução central do ciclo,
  // nunca ano-calendário). Mostra a data já cadastrada para orientar a edição.
  if (draft.kind === "abono") {
    const existing = allAbsences.find(
      (a) => a.kind === "abono" && a.id !== excludeId && sameAnnualCycle(a.startDate, startDate),
    );
    if (existing) {
      return {
        ok: false,
        code: "overlap",
        error: `Já existe um Abono de aniversário neste ciclo anual, em ${existing.startDate.slice(8, 10)}/${existing.startDate.slice(5, 7)}/${existing.startDate.slice(0, 4)}. Altere o evento existente ou exclua-o para cadastrar outra data.`,
      };
    }
    // K6: dia com Falta/Falta prevista — conflito explícito, nunca converte em silêncio
    const faltaNoDia = faltas.some((f) => f.date >= startDate && f.date <= endDate);
    if (faltaNoDia) {
      return {
        ok: false,
        code: "overlap",
        error:
          "Esta data possui uma falta registrada. Exclua a falta (ou a falta prevista) antes de usar o dia para o Abono de aniversário.",
      };
    }
    // K7: dia com batidas — exigir resolução explícita (nunca abono sobre dia trabalhado)
    const punchNoDia = entries.some((e) => e.date >= startDate && e.date <= endDate);
    if (punchNoDia) {
      return {
        ok: false,
        code: "overlap",
        error:
          "Esta data possui registros de ponto. Exclua os registros ou escolha outra data para o Abono de aniversário.",
      };
    }
  }

  // Sobreposição com outro evento existente → bloqueio
  const conflict = allAbsences.find(
    (a) => a.id !== excludeId && startDate <= a.endDate && endDate >= a.startDate,
  );
  if (conflict) {
    return {
      ok: false,
      code: "overlap",
      error: `Já existe "${absenceLabel(conflict)}" entre ${conflict.startDate} e ${conflict.endDate}. Ajuste as datas.`,
    };
  }

  // Aviso (não bloqueia): existem batidas no período
  const punches = entries.filter((e) => e.date >= startDate && e.date <= endDate);
  const warning =
    punches.length > 0
      ? `Existem ${punches.length} registro(s) de ponto neste período. Eles foram preservados integralmente — nenhuma alteração foi feita nos registros.`
      : undefined;

  return { ok: true, warning };
}

/* ── ABONO DE ANIVERSÁRIO & DATA DE NASCIMENTO ─────────────
 * O Abono é um benefício próprio da empresa: dia inteiro, jornada efetiva 0h,
 * saldo 0, déficit 0, sem obrigação de compensação, NO MÁXIMO um por ciclo.
 */

/** Verdadeiro se hoje (data local) é o aniversário (dia+mês) do nascimento. */
export function isBirthdayToday(birthDate: string | null | undefined, today: string): boolean {
  if (!birthDate) return false;
  // Compara somente mês e dia — data LOCAL (strings YYYY-MM-DD), nunca UTC.
  return birthDate.slice(5, 10) === today.slice(5, 10);
}

/**
 * Data SUGERIDA do Abono: o aniversário que cai dentro do ciclo anual da data
 * de referência (01/05 → 30/04). Ex.: nascimento 15/08 + ciclo 2026/2027 →
 * 15/08/2026; nascimento 10/01 + mesmo ciclo → 10/01/2027.
 * 29/02 em ciclo sem 29/02 → 01/03. É só sugestão — a escolha final é LIVRE.
 */
export function suggestedAbonoDate(birthDate: string | null | undefined, referenceDate: string): string | null {
  if (!birthDate) return null;
  const bounds = annualCycleBounds(getAnnualPointCycle(referenceDate));
  const startYear = Number(bounds.from.slice(0, 4));
  const mm = birthDate.slice(5, 7);
  const dd = birthDate.slice(8, 10);
  // mm-dd >= "05-01" → mesmo ano do início do ciclo; senão, ano de término
  const year = `${mm}-${dd}` >= "05-01" ? startYear : startYear + 1;
  // Edge 29/02: se o ano alvo não é bissexto, sugerir 01/03
  if (mm === "02" && dd === "29") {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? `${year}-02-29` : `${year}-03-01`;
  }
  return `${year}-${mm}-${dd}`;
}

/** Abono já cadastrado no mesmo ciclo anual da data (para UI de atalho). */
export function abonoInCycle(absences: Absence[], referenceDate: string): Absence | undefined {
  return absences.find(
    (a) => a.kind === "abono" && sameAnnualCycle(a.startDate, referenceDate),
  );
}
