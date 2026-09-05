// ─────────────────────────────────────────────────────────────
// GUIA DO PONTO (ETAPA 4I / 4I.1) — CAMADA DERIVADA / APRESENTAÇÃO.
//
// 4I.1 (somente view model — NENHUM motor financeiro tocado):
//   · COMPENSAR PASSADO sem trabalho deixa de dizer “Aguardando registro
//     real” — o fato canônico já existe (0min + saldo factual negativo do
//     buildResumoDayRow); futuro e HOJE em andamento preservam a semântica
//     temporal existente (nunca déficit prematuro);
//   · FORA DO CONTROLE + sem registro ganha orientação neutra (nada a
//     aguardar; sem pendência/débito/batida inventados);
//   · PERÍODO FUTURO não exibe “Em andamento” (apresentação do Guia; o
//     motor 4G permanece intocado);
//   · saldo factual/projetado em card [10+] sem batidas reais vêm do
//     espelho canônico (row.balanceMinutes / projection.projectedBalance-
//     Minutes — nada é recalculado aqui).
//
// REGRA-MÃE: o Meu Horário NÃO é o ponto oficial. O Guia é uma visão
// READ-ONLY de leitura para alimentar o sistema oficial; ele NUNCA
// reescreve batidas reais, NUNCA altera saldo factual, NUNCA inventa
// jornada e NUNCA cria um segundo motor financeiro.
//
// FONTES (tudo vem dos motores atuais — nada é recalculado aqui):
//   · FATOS + status do dia  → buildResumoDayRow (fonte única do Resumo);
//   · Calendário/contexto   → companyDayContext (resolução central);
//   · Pendências canônicas  → attention-now (4D.5, mesmo classificador);
//   · [10+] gerado          → buildSpecialExcessBank (3C, por ciclo);
//   · [10+] utilizado       → usedSpecialMinutesByDestination (3B/3D);
//   · [10+] reservado       → SpecialExcessPlan ativos (4A);
//   · PROJEÇÃO OFICIAL      → projectRealizedDayOfficial (3A) — o MESMO
//     motor do store/dia-view (4D.4.2: base = requiredWorkMinutes do
//     dia; evento explícito de calendário é fato suficiente);
//   · Estado do período     → periodConsolidationState (4G).
//
// O unique trabalho DESTA camada é:
//   1) montar o view model do dia (formatação, status visual);
//   2) derivar a SUGESTÃO de batidas (sequência de orientação de
//      lançamento — nunca persistida, nunca tratada como fato);
//   3) derivar os indicadores Pronto / Precisa de atenção.
//
// ALGORITMO DE SUGESTÃO (puro, §11/§14):
//   · Jornada normal / entre 8h e 10h / abaixo da base sem [10+]:
//     as MESMAS batidas reais (o app não decide compensação regular);
//   · [10+] utilizado em dia abaixo da base: estender a ÚLTIMA SAÍDA até
//     "saída máxima sugerida" e, se ainda faltar, antecipar a PRIMEIRA
//     ENTRADA até "entrada mínima sugerida" — preservando TODAS as
//     batidas intermediárias, TODOS os intervalos reais e a ordem;
//   · dia >10h ([10+] gerado): reduzir apenas a ÚLTIMA SAÍDA pelo
//     excedente (os limites de entrada/saída NÃO normalizam batidas
//     reais nesse caso);
//   · sem batidas reais para ancorar ou limites insuficientes:
//     "Ajuste manual necessário" — nunca inventar par/batida/intervalo.
// ─────────────────────────────────────────────────────────────
import {
  buildResumoDayRow,
  type ResumoDayRow,
  type ResumoTableStatus,
} from "./resumo-days";
import {
  companyDayContext,
  type CalendarDayView,
} from "./company-calendar";
import {
  attentionCategoriesForDay,
  attentionDayOf,
  hasArrivedSpecialPlan,
  type AttentionCategory,
} from "./attention-now";
import { resumoPeriodPendencies } from "./resumo-period-view";
import { isHistoricalEmptyDate } from "./missing-records";
import { buildSpecialExcessBank } from "./special-excess-bank";
import {
  activeSpecialPlansForDate,
  specialExcessPlanMinutes,
  type SpecialExcessPlan,
} from "./special-excess-plan";
import { usedSpecialMinutesByDestination, type SpecialExcessUse } from "./special-excess-use";
import {
  isProjectableDayStatus,
  projectRealizedDayOfficial,
  type RealizedDayOfficialProjection,
} from "./official-projection";
import {
  activeConsolidationForPeriod,
  PERIOD_CONSOLIDATION_LABEL,
  periodConsolidationState,
  type PeriodConsolidation,
  type PeriodConsolidationStateId,
} from "./period-consolidation";
import { getAnnualPointCycle, listDaysBetween, type PointPeriod } from "./periods";
import { analyzePunches } from "./punches";
import { absenceLabel } from "./absences";
import {
  formatMinutes,
  fromMinutes,
  isRealizedDate,
  sortedPunchEntries,
  toMinutes,
  weekdayLong,
  type TimeEntryLike,
  type WorkSettings,
} from "./time";
import type { Absence } from "./absences";
import type { CompanyCalendars } from "./company-calendar";
import type { Falta, TimeEntry } from "./types";

/* ═══════════════════════════════════════════════════════════
 * LIMITES CONFIGURÁVEIS DO GUIA (§9/§10) — padrão 08:00 / 17:45.
 * Horários CIVIS locais (HH:MM). NUNCA toISOString(): comparações
 * e aritmética são sempre em minutos locais via toMinutes/fromMinutes.
 * ═══════════════════════════════════════════════════════════ */

export const GUIDE_DEFAULT_MIN_ENTRY = "08:00";
export const GUIDE_DEFAULT_MAX_EXIT = "17:45";

const CIVIL_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidCivilTime(value: unknown): value is string {
  return typeof value === "string" && CIVIL_TIME_RE.test(value);
}

export interface GuideLimits {
  /** "HH:MM" — limite inferior p/ antecipar a primeira entrada. */
  minEntry: string;
  /** "HH:MM" — limite superior p/ estender a última saída. */
  maxExit: string;
}

/** Resolve os limites do Guia a partir do usuário; ausentes/inválidos → defaults. */
export function guideLimitsOf(user: { guideMinEntry?: string | null; guideMaxExit?: string | null } | undefined | null): GuideLimits {
  return {
    minEntry: isValidCivilTime(user?.guideMinEntry) ? user.guideMinEntry : GUIDE_DEFAULT_MIN_ENTRY,
    maxExit: isValidCivilTime(user?.guideMaxExit) ? user.guideMaxExit : GUIDE_DEFAULT_MAX_EXIT,
  };
}

/* ═══════════════════════════════════════════════════════════
 * SUGESTÃO DE BATIDAS (helper puro e derivado).
 * NÃO calcula saldo, necessidade nem [10+]: apenas CONVERTE a
 * projeção oficial canônica em uma sequência de horários sugeridos.
 * ═══════════════════════════════════════════════════════════ */

export type PointGuideSuggestionKind =
  /** Mesmas batidas reais (dia normal, entre 8h e 10h, abaixo da base sem [10+]). */
  | "same"
  /** [10+] representado nas batidas (adição nas pontas). */
  | "addition"
  /** Dia >10h: última saída reduzida pelo excedente. */
  | "origin-reduction"
  /** Não é possível representar com segurança (limites/nada para ancorar). */
  | "manual"
  /** Sem orientação automática (futuro, calendário, sem fato). */
  | "none"
  /** 4I.1-D — COMPENSAR realizado (passado) sem trabalho: fato canônico já
   *  existe (0min + saldo factual negativo); NÃO é "aguardando registro". */
  | "compensar-realized"
  /** 4I.1-E — Fora do controle + sem registro: neutro, nada a aguardar. */
  | "out-of-control"
  /** Dia futuro — nunca criar batidas sugeridas futuras. */
  | "future"
  /** Calendário trata o dia (ABONADO/folga/ausência) — sem batidas inventadas. */
  | "calendar"
  /** Registro real inconsistente/incompleto — orientação suspensa. */
  | "attention";

export interface PointGuideSuggestion {
  kind: PointGuideSuggestionKind;
  /** Sequência sugerida HH:MM (ordem preservada; vazia quando não há orientação segura). */
  punches: string[];
  /** Minutos [10+] efetivamente representáveis nas batidas sugeridas. */
  representableMinutes: number;
  /** Minutos [10+] que não couberam (0 quando tudo coube). */
  remainingMinutes: number;
  /** Minutos [10+] utilizados no destino (total — nunca escondido). */
  usedTotalMinutes: number;
  /** Total considerado no ponto (projeção oficial canônica — nunca recalculada). */
  totalMinutes: number;
  /** Orientação textual (mensagens exatas das situações especiais). */
  message: string | null;
}

/** Pontas da sequência válida (primeira entrada / última saída). */
interface DayEnds {
  firstEntryIndex: number;
  lastExitIndex: number;
  firstEntryMinutes: number;
  lastExitMinutes: number;
}

function endsOf(analysis: ReturnType<typeof analyzePunches>): DayEnds | null {
  if (!analysis.isConsistent || !analysis.isComplete) return null;
  const sorted = analysis.sorted;
  if (sorted.length === 0 || sorted[0]!.type !== "entrada" || sorted[sorted.length - 1]!.type !== "saida") return null;
  return {
    firstEntryIndex: 0,
    lastExitIndex: sorted.length - 1,
    firstEntryMinutes: toMinutes(sorted[0]!.time),
    lastExitMinutes: toMinutes(sorted[sorted.length - 1]!.time),
  };
}

/** Aplica +[10+] nas pontas (§11): 1) última saída até o teto; 2) primeira
 *  entrada até o piso. Retorna os minutos representados e a sequência. */
function applyAddition(
  sorted: TimeEntryLike[],
  ends: DayEnds,
  targetMinutes: number,
  limits: GuideLimits,
): { punches: string[]; representableMinutes: number; remainingMinutes: number } {
  const next = [...sorted];
  let remaining = Math.max(0, targetMinutes);

  // PASSO 1 — última SAÍDA pode avançar até a saída máxima.
  const tailCapacity = Math.max(0, toMinutes(limits.maxExit) - ends.lastExitMinutes);
  const tail = Math.min(tailCapacity, remaining);
  if (tail > 0) {
    next[ends.lastExitIndex] = {
      ...next[ends.lastExitIndex]!,
      time: fromMinutes(ends.lastExitMinutes + tail),
    };
    remaining -= tail;
  }

  // PASSO 2 — primeira ENTRADA pode retroceder até a entrada mínima.
  const headCapacity = Math.max(0, ends.firstEntryMinutes - toMinutes(limits.minEntry));
  const head = Math.min(headCapacity, remaining);
  if (head > 0) {
    next[ends.firstEntryIndex] = {
      ...next[ends.firstEntryIndex]!,
      time: fromMinutes(ends.firstEntryMinutes - head),
    };
    remaining -= head;
  }

  return {
    punches: next.map((e) => e.time),
    representableMinutes: tail + head,
    remainingMinutes: remaining,
  };
}

/** Regras da SUGESTÃO de UM dia. Entrada: fatos + motores canônicos
 *  (row, cctx, projection) e limites configurados — nada é recalculado. */
export function suggestPunchesForDay(args: {
  date: string;
  today: string;
  entries: TimeEntry[];
  row: ResumoDayRow;
  cctx: CalendarDayView;
  projection: RealizedDayOfficialProjection;
  limits: GuideLimits;
  controlStartDate: string | null;
}): PointGuideSuggestion {
  const { date, today, entries, row, cctx, projection, limits, controlStartDate } = args;
  const dayEntries = entries.filter((e) => e.date === date);
  const analysis = analyzePunches(dayEntries);
  const sorted = analysis.sorted;
  const usedTotalMinutes = projection.excessUsedMinutes + projection.appliedSpecialMinutes;
  const totalMinutes = projection.projectedWorkedMinutes;
  const isFutureDay = date > today;
  const manualMsg =
    "Ajuste manual necessário — os limites configurados não comportam todo o tempo [10+] utilizado.";

  // §17 — FUTURO: nunca cria jornada/sugestão realizada.
  if (isFutureDay) {
    return {
      kind: "future",
      punches: [],
      representableMinutes: 0,
      remainingMinutes: 0,
      usedTotalMinutes: 0,
      totalMinutes: 0,
      message: "Futuro não é realizado — aguarde a realização do dia.",
    };
  }

  // §18 — ABONADO integral: sem inventar batidas; orientação de tratamento.
  if (cctx.abonadoIntegral) {
    return {
      kind: "calendar",
      punches: [],
      representableMinutes: 0,
      remainingMinutes: 0,
      usedTotalMinutes,
      totalMinutes,
      message: "Dia abonado pelo calendário — nenhum lançamento de batida é necessário no sistema oficial.",
    };
  }

  // §13 — [10+] utilizado SEM batidas reais para ancorar.
  if (dayEntries.length === 0) {
    if (projection.appliedSpecialMinutes > 0) {
      return {
        kind: "manual",
        punches: [],
        representableMinutes: 0,
        remainingMinutes: projection.appliedSpecialMinutes,
        usedTotalMinutes,
        totalMinutes,
        message: "Há horas [10+] aplicadas, mas não existem batidas reais para ancorar uma sugestão automática.",
      };
    }
    // Sem fato: calendário/folga/ausência orientam tratamento próprio.
    const noLaunch =
      cctx.isWeekend ||
      cctx.marker === "folga" ||
      row.absence !== undefined ||
      row.status === "falta";
    if (noLaunch) {
      return {
        kind: "calendar",
        punches: [],
        representableMinutes: 0,
        remainingMinutes: 0,
        usedTotalMinutes,
        totalMinutes,
        message:
          cctx.isWeekend || cctx.marker === "folga"
            ? "Nenhum lançamento de batida necessário."
            : "Dia sem batidas reais — nenhuma sugestão automática.",
      };
    }
    // 4I.1-D — COMPENSAR JÁ REALIZADO (passado estrito) sem trabalho: a
    // obrigação canônica do calendário é o fato conhecido — o saldo factual
    // negativo JÁ EXISTE (fonte buildResumoDayRow); nunca dizer
    // “aguardando registro real / antes do fato”. Não inventa batidas e
    // não cria déficit: apenas apresenta o resultado canônico. HOJE em
    // andamento (date === today) NÃO cai aqui — segue sem déficit prematuro.
    if (date < today && cctx.calendarEntry?.tratamento === "COMPENSAR") {
      return {
        kind: "compensar-realized",
        punches: [],
        representableMinutes: 0,
        remainingMinutes: 0,
        usedTotalMinutes,
        totalMinutes,
        message: `Folga a compensar realizada sem batidas — trate conforme a obrigação de ${formatMinutes(cctx.requiredWorkMinutes)} do calendário.`,
      };
    }
    // 4I.1-E — FORA DO CONTROLE + SEM REGISTRO (data antes de
    // controlStartDate, já passada): não há nada a “aguardar” nem pendência
    // a cobrar — orientação NEUTRA, sem inventar déficit/obrigação/batidas.
    // Registro histórico real existente continua exibido pelo caminho normal.
    if (isHistoricalEmptyDate(date, today, controlStartDate)) {
      return {
        kind: "out-of-control",
        punches: [],
        representableMinutes: 0,
        remainingMinutes: 0,
        usedTotalMinutes,
        totalMinutes,
        message: "Fora do controle — nenhuma orientação de lançamento necessária.",
      };
    }
    return {
      kind: "none",
      punches: [],
      representableMinutes: 0,
      remainingMinutes: 0,
      usedTotalMinutes,
      totalMinutes,
      message: row.missingExpected
        ? "Sem registro — resolva o fato antes de uma orientação de lançamento."
        : "Aguardando registro real — nenhuma sugestão antes do fato.",
    };
  }

  // §16 — sequência inválida/registro incompleto: nunca inventar batidas.
  if (!analysis.isConsistent) {
    return {
      kind: "attention",
      punches: [],
      representableMinutes: 0,
      remainingMinutes: 0,
      usedTotalMinutes,
      totalMinutes,
      message: "Sequência de batidas inválida — corrija o registro real antes de montar a sugestão.",
    };
  }
  if (!analysis.isComplete || cctx.ctx.day.open || cctx.ctx.day.financialPending) {
    return {
      kind: "attention",
      punches: [],
      representableMinutes: 0,
      remainingMinutes: 0,
      usedTotalMinutes,
      totalMinutes,
      message: "Registro incompleto — encerre a jornada real antes de montar a sugestão.",
    };
  }

  const ends = endsOf(analysis)!;
  const realPunches = sorted.map((e) => e.time);

  // §14 — dia >10h ([10+] gerado): preservar primeira entrada, intervalos e
  // batidas intermediárias; reduzir APENAS a última saída pelo excedente.
  if (row.excessMinutes > 0) {
    const trimmed = fromMinutes(ends.lastExitMinutes - row.excessMinutes);
    const previous = sorted[ends.lastExitIndex - 1]!;
    if (toMinutes(trimmed) > toMinutes(previous.time) && sorted.length >= 2) {
      const next = [...sorted];
      next[ends.lastExitIndex] = { ...next[ends.lastExitIndex]!, time: trimmed };
      return {
        kind: "origin-reduction",
        punches: next.map((e) => e.time),
        representableMinutes: row.excessMinutes,
        remainingMinutes: 0,
        usedTotalMinutes,
        totalMinutes,
        message: "Representar o limite de 10h reduzindo apenas a última saída.",
      };
    }
    return {
      kind: "manual",
      punches: [],
      representableMinutes: 0,
      remainingMinutes: row.excessMinutes,
      usedTotalMinutes,
      totalMinutes,
      message: "Ajuste manual necessário — não é possível reduzir apenas a última saída para representar o limite de 10h.",
    };
  }

  // §11 — [10+] APLICADO pelo motor 3A em dia abaixo da base: representar
  // SOMENTE o aplicado (nunca criar hora extra além da projeção oficial).
  const applied = projection.appliedSpecialMinutes;
  if (applied > 0) {
    const result = applyAddition(sorted, ends, applied, limits);
    if (result.remainingMinutes > 0) {
      return {
        kind: "manual",
        punches: result.punches,
        representableMinutes: result.representableMinutes,
        remainingMinutes: result.remainingMinutes,
        usedTotalMinutes,
        totalMinutes,
        message: manualMsg,
      };
    }
    return {
      kind: "addition",
      punches: result.punches,
      representableMinutes: result.representableMinutes,
      remainingMinutes: 0,
      usedTotalMinutes,
      totalMinutes,
      message: null,
    };
  }

  // Dia normal/abaixo da base sem [10+] / entre 8h e 10h → MESMAS batidas.
  return {
    kind: "same",
    punches: realPunches,
    representableMinutes: 0,
    remainingMinutes: 0,
    usedTotalMinutes,
    totalMinutes,
    message: "Usar as mesmas batidas reais.",
  };
}

/* ═══════════════════════════════════════════════════════════
 * VIEW MODEL DO PERÍODO (um item por data, ordem cronológica).
 * ═══════════════════════════════════════════════════════════ */

export interface PointGuideDayRow {
  date: string;
  /** "segunda-feira" (data civil local — nunca UTC). */
  weekday: string;
  /** date <= today (o dia já aconteceu ou está em curso). */
  realized: boolean;
  /** 4I.1 — date < today (dia encerrado no tempo; HOJE em andamento não é
   *  “passado” — protege exibição de déficit factual prematuro). */
  past: boolean;
  /** Fato suficiente para projeção (batidas OU evento de calendário). */
  factRealized: boolean;
  /** Batidas reais HH:MM em ordem cronológica. */
  realPunches: string[];
  punchCount: number;
  /** Jornada real (fato canônico — nunca alterada pelo Guia). */
  jornadaRealMinutes: number;
  registrableMinutes: number;
  /** Saldo regular factual do dia (fonte canônica — eco de buildResumoDayRow). */
  saldoRegularMinutes: number;
  /** 4I.1 — Saldo PROJETADO do dia (eco de projection.projectedBalanceMinutes
   *  — motor 3A; o Guia NUNCA recalcula saldo). */
  saldoProjetadoMinutes: number;
  /** "−30min" / "+1h" / "0min" — apresentação do saldo do dia. */
  saldoLabel: string;
  /** Rótulo primário da situação. */
  situacao: string;
  /** Classificador canônico de pendências (4D.5) — categorias do dia. */
  attentionCategories: AttentionCategory[];
  /** true quando não há orientação segura (§16). */
  attention: boolean;
  /** true quando o dia está pronto para lançar (§20). */
  ready: boolean;
  /** [10+] ATIVAMENTE utilizado com destino neste dia. */
  specialUsedMinutes: number;
  /** [10+] aplicado pela projeção oficial canônica. */
  specialAppliedMinutes: number;
  /** [10+] gerado neste dia (lote da origem — 3C). */
  specialGeneratedMinutes: number;
  /** [10+] reservado/planejado para este dia (4A ativos). */
  specialReservedMinutes: number;
  /** Projeção oficial canônica do dia (motor 3A — nunca recalculada). */
  projection: RealizedDayOfficialProjection;
  /** Total considerado no ponto = projection.projectedWorkedMinutes. */
  totalNoPontoMinutes: number;
  suggestion: PointGuideSuggestion;
  /** Badge Consolidado (consolidação ATIVA do período). */
  consolidated: boolean;
  /** Status canônico do dia (buildResumoDayRow). */
  status: ResumoTableStatus;
  missingExpected: boolean;
  /** Contexto de calendário canônico (presente apenas quando há evento). */
  calendarEntry: CalendarDayView["calendarEntry"];
  calendarLabel: string | null;
  calendarCreditMinutes: number;
  calendarRequiredWorkMinutes: number;
  calendarAbonadoIntegral: boolean;
  calendarParcial: boolean;
  absenceLabel: string | null;
  faltaStatus: "efetiva" | "prevista" | null;
}

export interface PointGuideView {
  period: PointPeriod;
  today: string;
  limits: GuideLimits;
  days: PointGuideDayRow[];
  /** Estado do período pelo motor 4G (nunca status manual). */
  state: PeriodConsolidationStateId;
  /** 4I.1 — período ainda não começou (period.from > today). O motor 4G é
   *  intocado; esta é SOMENTE a apresentação do Guia: período futuro nunca
   *  exibe “Em andamento” junto de “Período futuro” (estados contraditórios). */
  periodFuture: boolean;
  stateLabel: string;
  /** Consolidação ATIVA do período (snapshot 4G). */
  consolidation: PeriodConsolidation | null;
  summary: {
    totalDays: number;
    readyDays: number;
    attentionDays: number;
    futureDays: number;
    readyDates: string[];
    attentionDates: string[];
  };
}

export interface PointGuideViewInput {
  period: PointPeriod;
  today: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string | null;
  uses: SpecialExcessUse[];
  plans: SpecialExcessPlan[];
  consolidations: PeriodConsolidation[] | undefined;
  limits: GuideLimits;
}

/** Agenda [10+] reservado/planejado por DESTINO (planos ativos — 4A). */
function reservedMinutesByDestination(plans: SpecialExcessPlan[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of plans) {
    if (p.status !== "planned") continue;
    out[p.destinationDate] = (out[p.destinationDate] ?? 0) + specialExcessPlanMinutes(p);
  }
  return out;
}

/** Rótulo primário da situação do dia (apresentação — sem motor paralelo). */
function situacaoOf(args: {
  date: string;
  today: string;
  row: ResumoDayRow;
  cctx: CalendarDayView;
  specialUsedMinutes: number;
  specialReservedMinutes: number;
}): string {
  const { date, today, row, cctx, specialUsedMinutes, specialReservedMinutes } = args;
  if (date > today) {
    return specialReservedMinutes > 0
      ? "Planejado — aguarde a realização do dia."
      : "Futuro";
  }
  if (row.status === "inconsistent") return "Registro inconsistente";
  if (row.status === "incomplete") return "Registro incompleto";
  if (row.status === "idle" || row.status === "in-progress") return "Em andamento";
  if (row.status === "falta") return row.faltaStatus === "prevista" ? "Falta prevista" : "Falta";
  if (row.absence) {
    const label = row.eventLabel ?? absenceLabel(row.absence);
    return row.absence.kind === "ferias" ? "Férias" : label;
  }
  if (cctx.abonadoIntegral) return "Abonado — Calendário";
  if (cctx.isWeekend) return row.entryCount > 0 ? "Trabalho em folga" : "Folga";
  if (cctx.calendarEntry?.tratamento === "COMPENSAR") {
    const parcial =
      cctx.calendarCreditMinutes > 0 &&
      cctx.requiredWorkMinutes > 0 &&
      cctx.requiredWorkMinutes < cctx.referenceBaseMinutes;
    return parcial ? "Calendário — parcial" : "Folga a compensar";
  }
  if (cctx.calendarEntry?.tratamento === "ABONADO_PARCIAL") return "Abono parcial — Calendário";
  if (row.status === "excess") return "Acima do limite [10+]";
  if (row.status === "deficit") return specialUsedMinutes > 0 ? "[10+] utilizado" : "Abaixo da base";
  if (row.status === "ok") return "Normal";
  if (row.status === "empty") return row.missingExpected ? "Sem registro" : "Fora do controle";
  return "Sem registro";
}

export function buildPointGuideView(input: PointGuideViewInput): PointGuideView {
  const { period, today, entries, absences, calendars, settings, faltas, controlStartDate, uses, plans, consolidations, limits } = input;
  const allDates = listDaysBetween(period.from, period.to);

  // 1) Pendências bloqueantes do período — MESMO classificador do Resumo (4G).
  const pend = resumoPeriodPendencies({
    today,
    period,
    entries,
    absences,
    calendars,
    settings,
    faltas,
    controlStartDate,
    plans,
  });

  // 2) Estado do período — motor 4G (Em andamento/…/Consolidado).
  const state = periodConsolidationState({
    today,
    periodStart: period.from,
    periodEnd: period.to,
    consolidations,
    blockedCount: pend.total,
  });
  const consolidation = activeConsolidationForPeriod(consolidations, period.from, period.to);
  const consolidated = consolidation !== null;
  // 4I.1 — APRESENTAÇÃO do Guia: período futuro (ainda não começou) nunca
  // recebe “Em andamento”. O motor 4G (periodConsolidationState) permanece
  // intocado — state continua o id canônico; apenas o rótulo exibido muda.
  const periodFuture = period.from > today;

  // 3) [10+] utilizado (3B/3D) e reservado (4A) — insumos do motor 3A.
  const usedByDate = usedSpecialMinutesByDestination(uses);
  const reservedByDate = reservedMinutesByDestination(plans);

  // 4) [10+] GERADO por origem (3C) — um banco por ciclo (regra do fechamento anual).
  const cycles = [...new Set(allDates.map(getAnnualPointCycle))].sort();
  const generatedByDate = new Map<string, number>();
  for (const cycle of cycles) {
    const bank = buildSpecialExcessBank({
      cycle,
      asOfDate: today,
      entries,
      absences,
      calendars,
      settings,
      faltas,
      controlStartDate: controlStartDate ?? "",
      uses,
      plans,
    });
    for (const lot of bank.lots) {
      if (lot.generatedMinutes > 0) generatedByDate.set(lot.originDate, lot.generatedMinutes);
    }
  }

  const days: PointGuideDayRow[] = allDates.map((date) => {
    const row = buildResumoDayRow({
      date,
      today,
      entries,
      absences,
      calendars,
      settings,
      faltas,
      controlStartDate,
    });
    const cctx = companyDayContext(date, entries, absences, calendars, settings);
    const dayEntries = entries.filter((e) => e.date === date);
    const used = usedByDate[date] ?? 0;
    const reserved = reservedByDate[date] ?? 0;

    // PROJEÇÃO OFICIAL do dia — motor 3A com os insumos canônicos do
    // store/dia-view (4D.4.2): base = requiredWorkMinutes; evento explícito
    // do calendário é fato suficiente (COMPENSAR passado sem batidas).
    const realizedFacts = (row.entryCount > 0 || row.calendarEventDay) && date <= today;
    const projection = projectRealizedDayOfficial({
      date,
      factualWorkedMinutes: row.workedMinutes,
      factualRegistrableMinutes: row.registrableMinutes,
      factualRegularBalanceMinutes: row.balanceMinutes,
      effectiveBaseMinutes: row.requiredWorkMinutes,
      financialValid: isProjectableDayStatus(row.status) && !row.calendarEventPendingToday,
      realized: realizedFacts,
      usedSpecialMinutes: used,
    });

    const suggestion = suggestPunchesForDay({
      date,
      today,
      entries,
      row,
      cctx,
      projection,
      limits,
      controlStartDate,
    });

    const attentionCategories = attentionCategoriesForDay({
      date,
      today,
      day: attentionDayOf(cctx),
      missingExpected: row.missingExpected,
      hasArrivedPlan: hasArrivedSpecialPlan(plans, date, today),
    });
    const attention =
      attentionCategories.length > 0 ||
      suggestion.kind === "manual" ||
      suggestion.kind === "attention" ||
      (used > 0 && projection.needsReview);

    const situacao = situacaoOf({
      date,
      today,
      row,
      cctx,
      specialUsedMinutes: used,
      specialReservedMinutes: reserved,
    });
    // §13 — [10+] aplicado sem batidas reais para ancorar: o STATUS primário
    // do Guia é “Requer orientação manual” (o contexto de calendário segue
    // exibido no bloco de calendário; nada é inventado).
    const situacaoFinal =
      suggestion.kind === "manual" && suggestion.representableMinutes === 0 && row.entryCount === 0 && used > 0
        ? "Requer orientação manual"
        : situacao;

    const calendarioParcial =
      !!cctx.calendarEntry &&
      (cctx.calendarEntry.tratamento === "ABONADO_PARCIAL" ||
        (cctx.calendarCreditMinutes > 0 && cctx.requiredWorkMinutes > 0 && cctx.requiredWorkMinutes < cctx.referenceBaseMinutes));

    // §20 — “Pronto” = dia realizado sem pendência estrutural e com
    // orientação segura (ou tratamento determinístico de calendário).
    const ready =
      date <= today &&
      !attention &&
      (row.entryCount > 0 ||
        row.calendarEventDay ||
        cctx.isWeekend ||
        cctx.abonadoIntegral ||
        row.absence !== undefined ||
        row.status === "falta" ||
        row.missingExpected === false);

    return {
      date,
      weekday: weekdayLong(date),
      realized: date <= today,
      past: date < today,
      factRealized: realizedFacts,
      realPunches: sortedPunchEntries(dayEntries).map((e) => e.time),
      punchCount: dayEntries.length,
      jornadaRealMinutes: row.workedMinutes,
      registrableMinutes: row.registrableMinutes,
      saldoRegularMinutes: row.balanceMinutes,
      saldoProjetadoMinutes: projection.projectedBalanceMinutes,
      saldoLabel: formatMinutes(row.balanceMinutes),
      situacao: situacaoFinal,
      attentionCategories,
      attention,
      ready,
      specialUsedMinutes: used,
      specialAppliedMinutes: projection.appliedSpecialMinutes,
      specialGeneratedMinutes: generatedByDate.get(date) ?? 0,
      specialReservedMinutes: reserved,
      projection,
      totalNoPontoMinutes: projection.projectedWorkedMinutes,
      suggestion,
      consolidated,
      status: row.status,
      missingExpected: row.missingExpected,
      calendarEntry: cctx.calendarEntry,
      calendarLabel: cctx.label,
      calendarCreditMinutes: cctx.calendarCreditMinutes,
      calendarRequiredWorkMinutes: cctx.requiredWorkMinutes,
      calendarAbonadoIntegral: cctx.abonadoIntegral,
      calendarParcial: calendarioParcial,
      absenceLabel: row.absence ? row.eventLabel ?? absenceLabel(row.absence) : null,
      faltaStatus: row.faltaStatus,
    };
  });

  const readyDays = days.filter((d) => d.realized && d.ready);
  const attentionDays = days.filter((d) => d.realized && d.attention);
  const futureDays = days.filter((d) => !d.realized);

  return {
    period,
    today,
    limits,
    days,
    state,
    periodFuture,
    stateLabel: periodFuture ? "Período futuro" : PERIOD_CONSOLIDATION_LABEL[state],
    consolidation,
    summary: {
      totalDays: days.length,
      readyDays: readyDays.length,
      attentionDays: attentionDays.length,
      futureDays: futureDays.length,
      readyDates: readyDays.map((d) => d.date),
      attentionDates: attentionDays.map((d) => d.date),
    },
  };
}

export function isReadyPointGuideDay(d: PointGuideDayRow): boolean {
  return d.realized && d.ready;
}

export function isAttentionPointGuideDay(d: PointGuideDayRow): boolean {
  return d.realized && d.attention;
}
