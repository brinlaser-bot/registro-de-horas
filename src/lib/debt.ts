// Matemática de dívida de horas: abatimento fracionado + sugestões inteligentes.
import { computeDay, expectedMinutesOf, formatDateBR, formatMinutes } from "./time";
import { dayContext, type Absence } from "./absences";
import { companyDayContext, type CompanyCalendar } from "./company-calendar";
import { sameAnnualCycle } from "./periods";
import type {
  CompKind,
  Compensation,
  DebtDay,
  DebtTotals,
  TargetSuggestion,
  TimeEntry,
  WorkSettings,
} from "./types";

export function kindOf(c: Compensation): CompKind {
  return c.kind ?? "excedente";
}

/** Compensações que contam para abatimento (canceladas são ignoradas). */
export function isActive(c: Compensation): boolean {
  return c.status !== "cancelada";
}

function sumMinutes(list: Compensation[]): number {
  return list.reduce((s, c) => s + c.minutes, 0);
}

function bySource(comps: Compensation[], date: string, kind: CompKind): Compensation[] {
  return comps.filter((c) => c.sourceDate === date && kindOf(c) === kind && isActive(c));
}

export function allocatedForSource(comps: Compensation[], date: string, kind: CompKind): number {
  return sumMinutes(bySource(comps, date, kind));
}

export function pendingForSource(comps: Compensation[], date: string, kind: CompKind): number {
  return sumMinutes(bySource(comps, date, kind).filter((c) => c.status === "pendente"));
}

export function concludedForSource(comps: Compensation[], date: string, kind: CompKind): number {
  return sumMinutes(bySource(comps, date, kind).filter((c) => c.status === "concluida"));
}

/** Minutos de compensação aplicados (consumidos) em um dia-destino. */
export function appliedOnDate(comps: Compensation[], date: string): number {
  return sumMinutes(comps.filter((c) => c.targetDate === date && isActive(c)));
}

/** Compensações pendentes que afetam a saída de um dia-destino. */
export function pendingForTarget(comps: Compensation[], date: string): Compensation[] {
  return comps.filter((c) => c.targetDate === date && c.status === "pendente");
}

/**
 * Varre todos os dias com registros (e/ou ausências) e devolve os que geraram
 * dívida — excedente, déficit ou acordo a compensar — já com o abatimento
 * fracionado aplicado (alocado / pendente / concluído / restante).
 * Férias/saúde/dispensado não geram dívida (via dayContext).
 */
export function buildDebtDays(
  entries: TimeEntry[],
  comps: Compensation[],
  settings: WorkSettings,
  range?: { from: string; to: string },
  absences: Absence[] = [],
  companyCalendar?: CompanyCalendar,
): DebtDay[] {
  // Datas relevantes: com batidas OU cobertas por ausência (acordo sem batidas conta)
  const dates = new Set<string>();
  for (const e of entries) {
    if (range && (e.date < range.from || e.date > range.to)) continue;
    dates.add(e.date);
  }
  for (const a of absences) {
    let cur = a.startDate;
    while (cur <= a.endDate) {
      if (!range || (cur >= range.from && cur <= range.to)) dates.add(cur);
      cur = addOneDay(cur);
    }
  }
  for (const e of companyCalendar?.entries ?? []) {
    if (!range || (e.date >= range.from && e.date <= range.to)) dates.add(e.date);
  }

  const out: DebtDay[] = [];

  for (const date of dates) {
    const cctx = companyCalendar
      ? companyDayContext(date, entries, absences, companyCalendar, settings)
      : null;
    const ctx = cctx?.ctx ?? dayContext(date, entries, absences, settings);
    const day = ctx.day;

    const excess = day.excessMinutes;

    // Déficit "justificado": dia foi alvo de compensação por saída antecipada
    const coveredByEarlyExit = sumMinutes(
      comps.filter((c) => c.targetDate === date && kindOf(c) === "excedente" && isActive(c)),
    );
    // Dia com ponto aberto: déficit só é definitivo após a saída final.
    const deficit = day.open
      ? 0
      : Math.max(0, ctx.adjustedDeficit - coveredByEarlyExit);

    const push = (kind: CompKind, debtMinutes: number) => {
      if (debtMinutes <= 0) return;
      const allocated = allocatedForSource(comps, date, kind);
      out.push({
        date,
        kind,
        workedMinutes: day.workedMinutes,
        expectedMinutes: ctx.effectiveExpected,
        debtMinutes,
        allocatedMinutes: Math.min(allocated, debtMinutes),
        pendingMinutes: pendingForSource(comps, date, kind),
        concludedMinutes: concludedForSource(comps, date, kind),
        remainingMinutes: Math.max(0, debtMinutes - allocated),
      });
    };

    push("excedente", excess);
    push("deficit", deficit);
    push("acordo", ctx.acordoMinutes);
    push("calendario", cctx?.calendarioACompensar ?? 0);
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function addOneDay(d: string): string {
  // helper local para varrer o intervalo da ausência sem circular dependências
  const dt = new Date(`${d}T12:00:00`);
  dt.setDate(dt.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function totalsOf(days: DebtDay[]): DebtTotals {
  const acc = days.reduce(
    (a, d) => {
      a.debtTotal += d.debtMinutes;
      a.allocated += d.allocatedMinutes;
      a.concluded += d.concludedMinutes;
      a.pending += d.pendingMinutes;
      a.remaining += d.remainingMinutes;
      return a;
    },
    { debtTotal: 0, allocated: 0, concluded: 0, pending: 0, remaining: 0 },
  );
  return {
    ...acc,
    percent: acc.debtTotal > 0 ? Math.min(100, (acc.concluded / acc.debtTotal) * 100) : 0,
  };
}

/**
 * Sugere dias-destino para receber compensação: dias recentes com saldo
 * negativo (trabalhado abaixo da base), do mais recente para o mais antigo.
 */
export function suggestTargets(
  entries: TimeEntry[],
  comps: Compensation[],
  settings: WorkSettings,
  excludeDate: string,
  today: string,
  limit = 6,
): TargetSuggestion[] {
  const byDate = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  }

  const out: TargetSuggestion[] = [];
  for (const [date, list] of byDate) {
    if (date === excludeDate) continue;
    // Regra 16: nunca sugerir destino de outro ciclo anual
    if (!sameAnnualCycle(date, excludeDate)) continue;
    const day = computeDay(list, settings);
    if (day.empty || day.workedMinutes === 0) continue;
    // Dia em andamento não é candidato: o saldo ainda não está fechado
    if (day.open) continue;

    // Capacidade livre = déficit do dia menos o que já está comprometido
    const deficit = Math.max(0, expectedMinutesOf(settings) - day.workedMinutes);
    const used = appliedOnDate(comps, date);
    const free = deficit - used;
    if (free <= 0) continue;

    out.push({
      date,
      workedMinutes: day.workedMinutes,
      balanceMinutes: day.balanceMinutes,
      isToday: date === today,
    });
  }

  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

/** Dívida ainda em aberto de um dia de origem (para pré-preencher o modal). */
export function openDebtFor(
  entries: TimeEntry[],
  comps: Compensation[],
  settings: WorkSettings,
  date: string,
  kind: CompKind,
): number {
  const days = buildDebtDays(entries, comps, settings);
  const found = days.find((d) => d.date === date && d.kind === kind);
  if (found) return found.remainingMinutes;

  // Dia ainda sem excedente/déficit registrado: cai para o valor bruto
  const day = computeDay(
    entries.filter((e) => e.date === date),
    settings,
  );
  if (day.empty) return 0;
  return kind === "excedente"
    ? day.excessMinutes
    : Math.max(0, day.expectedMinutes - day.workedMinutes);
}

/* ── Capacidade de hora extra por dia (função central) ────── */

export interface ExtraCapacity {
  /** Jornada-base configurada (min). */
  baseMinutes: number;
  /** Limite diário configurado (min). */
  limitMinutes: number;
  /** Minutos de hora extra já vinculados (ativos) à data — exclui `excludeCompId`. */
  alreadyAllocated: number;
  /** Dia encerrado: hora extra REAL existente (trabalhado − base). Null se vazio/aberto. */
  realExtra: number | null;
  /** Máximo disponível para uma nova compensação de hora extra nesta data. */
  available: number;
}

/**
 * FUNÇÃO CENTRAL de capacidade de hora extra para uma data de destino.
 * Todos os locais que criam, editam ou sugerem compensações por hora extra
 * (modal, Dashboard, Compensações, store) devem usar esta função.
 *
 * Regras:
 * - teto diário: base + hora extra ≤ limite (ex.: 8h + 2h = 10h);
 * - soma de compensações do dia ≤ teto (acumulado);
 * - dia encerrado: só pode usar a hora extra REAL existente
 *   (ex.: 8h45 trabalhadas → 45min), descontando o que já está vinculado.
 */
export function extraCapacityForDate(
  date: string,
  entries: TimeEntry[],
  comps: Compensation[],
  settings: WorkSettings,
  opts?: { excludeCompId?: number },
): ExtraCapacity {
  const baseMinutes = expectedMinutesOf(settings);
  const limitMinutes = settings.maxDailyMinutes;
  const headroom = Math.max(0, limitMinutes - baseMinutes);

  // Hora extra do dia é consumida tanto por déficit quanto por acordo a compensar
  const alreadyAllocated = sumMinutes(
    comps.filter(
      (c) =>
        c.targetDate === date &&
        (kindOf(c) === "deficit" || kindOf(c) === "acordo" || kindOf(c) === "calendario") &&
        isActive(c) &&
        c.id !== opts?.excludeCompId,
    ),
  );

  const day = computeDay(
    entries.filter((e) => e.date === date),
    settings,
  );
  const finished = !day.empty && !day.open;
  const realExtra = finished ? Math.max(0, day.workedMinutes - baseMinutes) : null;

  let available = Math.max(0, headroom - alreadyAllocated);
  if (realExtra !== null) {
    available = Math.min(available, Math.max(0, realExtra - alreadyAllocated));
  }

  return { baseMinutes, limitMinutes, alreadyAllocated, realExtra, available };
}

/**
 * Quanto a compensação vinculada a um dia ultrapassa a dívida atual.
 * Usado para avisar quando uma correção de registro reduz o excedente/déficit
 * abaixo do que já está alocado.
 */
export function overflowForSource(
  comps: Compensation[],
  date: string,
  kind: CompKind,
  debtMinutes: number,
): number {
  return Math.max(0, allocatedForSource(comps, date, kind) - Math.max(0, debtMinutes));
}

/** Verifica overflow de excedente e déficit de um dia de origem. */
export function checkSourceOverflow(
  comps: Compensation[],
  date: string,
  excessMinutes: number,
  deficitMinutes: number,
): { excessOverflow: number; deficitOverflow: number } {
  return {
    excessOverflow: overflowForSource(comps, date, "excedente", excessMinutes),
    deficitOverflow: overflowForSource(comps, date, "deficit", deficitMinutes),
  };
}

/* ── Validação central de conclusão de compensação por hora extra ── */

/**
 * Hora extra REAL existente em uma data (mesma lógica central dos dias
 * encerrados): trabalhado − jornada-base. Usa as batidas reais do dia.
 */
export function actualExtraForDate(
  date: string,
  entries: TimeEntry[],
  settings: WorkSettings,
): number {
  const day = computeDay(
    entries.filter((e) => e.date === date),
    settings,
  );
  return Math.max(0, day.workedMinutes - day.expectedMinutes);
}

export interface CompletionCheck {
  ok: boolean;
  reason?: "future-date" | "insufficient-extra";
  error?: string;
  /** Hora extra real no dia de destino. */
  actualExtra?: number;
  /** Já consumido por outras compensações CONCLUÍDAS no mesmo destino. */
  committed?: number;
  /** Disponível para esta compensação. */
  available?: number;
}

/**
 * FUNÇÃO CENTRAL: uma compensação por hora extra (deficit/acordo) só pode ser
 * concluída quando a hora extra realmente existir no dia de destino:
 *  1. today >= targetDate (não concluir antes da data);
 *  2. hora extra real >= minutos da compensação, descontando o que outras
 *     compensações já concluídas no mesmo dia já consumiram.
 * Compensações de excedente (sair mais cedo) mantêm o fluxo manual existente.
 */
export function canCompleteComp(
  comp: Compensation,
  entries: TimeEntry[],
  comps: Compensation[],
  settings: WorkSettings,
  today: string,
): CompletionCheck {
  const kind = kindOf(comp);
  if (kind === "excedente") return { ok: true };

  if (today < comp.targetDate) {
    return {
      ok: false,
      reason: "future-date",
      error: `Aguardando realização da hora extra em ${formatDateBR(comp.targetDate)}.`,
    };
  }

  const actualExtra = actualExtraForDate(comp.targetDate, entries, settings);
  const committed = sumMinutes(
    comps.filter(
      (c) =>
        c.id !== comp.id &&
        c.targetDate === comp.targetDate &&
        c.status === "concluida" &&
        (kindOf(c) === "deficit" || kindOf(c) === "acordo" || kindOf(c) === "calendario"),
    ),
  );
  const available = Math.max(0, actualExtra - committed);

  if (comp.minutes > available) {
    return {
      ok: false,
      reason: "insufficient-extra",
      actualExtra,
      committed,
      available,
      error: `Hora extra realizada: ${formatMinutes(available)} de ${formatMinutes(comp.minutes)}. A compensação ainda não pode ser concluída.`,
    };
  }

  return { ok: true, actualExtra, committed, available };
}

/* ── Visão do "Acordo a compensar" (escopo exclusivo do fluxo de acordo) ── */

export interface AcordoView {
  date: string;
  /** Total gerado pelo afastamento acordado. */
  originalMinutes: number;
  /** Soma SOMENTE das compensações de acordo concluídas. */
  compensatedMinutes: number;
  /** Soma das compensações de acordo apenas planejadas (pendentes). */
  plannedMinutes: number;
  /** Original − Compensado (planejado NÃO abate). */
  remainingMinutes: number;
}

/**
 * Deriva Original / Compensado / Planejado / Restante de um dia de acordo.
 * Regra do acordo: apenas compensações CONCLUÍDAS abatem o restante —
 * uma compensação somente planejada não reduz o saldo devido.
 * Não altera a semântica de excedente/déficit em `buildDebtDays`.
 */
export function acordoViewOf(day: DebtDay): AcordoView {
  return {
    date: day.date,
    originalMinutes: day.debtMinutes,
    compensatedMinutes: day.concludedMinutes,
    plannedMinutes: day.pendingMinutes,
    remainingMinutes: Math.max(0, day.debtMinutes - day.concludedMinutes),
  };
}

/** Acordos ativos (com saldo a compensar) de um intervalo — normalmente o ciclo anual. */
export function activeAcordos(
  entries: TimeEntry[],
  comps: Compensation[],
  settings: WorkSettings,
  range: { from: string; to: string },
  absences: Absence[] = [],
): AcordoView[] {
  return buildDebtDays(entries, comps, settings, range, absences)
    .filter((d) => d.kind === "acordo")
    .map(acordoViewOf)
    .filter((a) => a.remainingMinutes > 0)
    .reverse();
}
