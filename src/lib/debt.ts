// Matemática de dívida de horas: abatimento fracionado + sugestões inteligentes.
import { computeDay, expectedMinutesOf, formatDateBR, formatMinutes, isRealizedDate, nowMinutesLocal, todayString } from "./time";
import { type Absence } from "./absences";
import { calendarCycleOf, companyDayContext, type CompanyCalendars } from "./company-calendar";
import { compensarObligationOnDate } from "./compensar";
import { sameAnnualCycle } from "./periods";
import type {
  CompKind,
  Compensation,
  DebtDay,
  DebtTotals,
  Falta,
  TargetSuggestion,
  TimeEntry,
  WorkSettings,
} from "./types";

export function kindOf(c: Compensation): CompKind {
  return c.kind ?? "excedente";
}

/**
 * Kinds quitados com HORA EXTRA no dia de destino (capacidade real + teto).
 * "excedente" é o único que vai no sentido oposto (sair mais cedo), por isso
 * fica fora das validações de capacidade/conclusão por hora extra.
 */
export function usesHourExtra(kind: CompKind): boolean {
  return kind === "deficit" || kind === "acordo" || kind === "calendario";
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

export const OVERPLAN_MSG =
  "O planejamento ativo não pode ultrapassar o restante em aberto. Reduza os minutos ou cancele uma programação existente.";

/**
 * Teto de NOVA programação (pendente) sobre uma dívida:
 * unplanned = max(0, (original − concluído) − planejado ativo).
 * Planejado NÃO reduz o déficit factual (open = original − concluído).
 */
export function sourcePlanningHeadroom(
  comps: Compensation[],
  sourceDate: string,
  kind: CompKind,
  originalMinutes: number,
  excludeCompId?: number,
): { openMinutes: number; plannedMinutes: number; unplannedMinutes: number } {
  const linked = bySource(comps, sourceDate, kind).filter((c) => c.id !== excludeCompId);
  const concluded = sumMinutes(linked.filter((c) => c.status === "concluida"));
  const planned = sumMinutes(linked.filter((c) => c.status === "pendente"));
  const openMinutes = Math.max(0, originalMinutes - concluded);
  const unplannedMinutes = Math.max(0, openMinutes - planned);
  return { openMinutes, plannedMinutes: planned, unplannedMinutes };
}

/** Teto de UMA operação nova: min(ainda sem programação, capacidade do dia). */
export function maxOperationMinutes(unplannedMinutes: number, dayCapacity: number): number {
  return Math.max(0, Math.min(unplannedMinutes, dayCapacity));
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
  companyCalendars?: CompanyCalendars,
  /** Faltas EFETIVAS (date <= hoje) — falta futura/prevista NÃO gera déficit. */
  faltas: Falta[] = [],
  today?: string,
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
  for (const cal of companyCalendars ?? []) {
    for (const e of cal.entries) {
      if (!range || (e.date >= range.from && e.date <= range.to)) dates.add(e.date);
    }
  }
  // Falta EFETIVA: o déficit nasce da resolução central (jornada efetiva do dia,
  // nunca 8h fixas). Falta prevista (futura) não entra aqui — já foi filtrada.
  for (const f of faltas) {
    if (!range || (f.date >= range.from && f.date <= range.to)) dates.add(f.date);
  }

  const out: DebtDay[] = [];

  for (const date of dates) {
    // FONTE ÚNICA: a resolução central é SEMPRE usada — com ou sem calendário
    // (coleção vazia ainda resolve sábado/domingo como folga). Nunca cair no
    // dayContext bruto de jornada fixa 8h.
    const cctx = companyDayContext(date, entries, absences, companyCalendars ?? [], settings);
    const ctx = cctx.ctx;
    const day = ctx.day;

    const excess = day.excessMinutes;

    // Déficit "justificado": dia foi alvo de compensação por saída antecipada
    const coveredByEarlyExit = sumMinutes(
      comps.filter((c) => c.targetDate === date && kindOf(c) === "excedente" && isActive(c)),
    );
    // Dia com ponto aberto: déficit só é definitivo após a saída final.
    // O déficit comum vem SEMPRE da RESOLUÇÃO CENTRAL (folga/abonado/recesso/
    // compensar com jornada 0 e fins de semana não geram déficit comum).
    const deficit = day.open || day.financialPending
      ? 0
      : Math.max(0, cctx.adjustedDeficit - coveredByEarlyExit);

    const push = (kind: CompKind, debtMinutes: number) => {
      if (debtMinutes <= 0) return;
      const allocated = allocatedForSource(comps, date, kind);
      const concluded = concludedForSource(comps, date, kind);
      out.push({
        date,
        kind,
        workedMinutes: day.workedMinutes,
        expectedMinutes: cctx.effectiveExpected,
        debtMinutes,
        allocatedMinutes: Math.min(allocated, debtMinutes),
        pendingMinutes: pendingForSource(comps, date, kind),
        concludedMinutes: concluded,
        remainingMinutes: Math.max(0, debtMinutes - allocated),
        // EM ABERTO real: planejado NÃO quita — só o concluído abate.
        openMinutes: Math.max(0, debtMinutes - concluded),
      });
    };

    // Cutoff temporal central: batidas futuras não geram déficit/excedente.
    if ((today === undefined || isRealizedDate(date, today)) && !day.financialPending) {
      push("excedente", excess);
      push("deficit", deficit);
    }
    // COMPENSAR: original IMUTÁVEL; open = efetiva − concluído (trabalho no
    // próprio dia reduz a efetiva, não o original). Aparece mesmo no futuro
    // para planejamento; o gating realizado fica no banco/hour-bank.
    const todayRef = today ?? date;
    const obl = compensarObligationOnDate(
      date, entries, comps, absences, companyCalendars, settings, todayRef,
    );
    if (obl && obl.originalMinutes > 0) {
      const allocated = allocatedForSource(comps, date, obl.compKind);
      out.push({
        date,
        kind: obl.compKind,
        workedMinutes: obl.workedOnOriginDateMinutes,
        expectedMinutes: cctx.effectiveExpected,
        debtMinutes: obl.originalMinutes,
        allocatedMinutes: Math.min(allocated, obl.effectiveObligationMinutes),
        pendingMinutes: obl.plannedMinutes,
        concludedMinutes: obl.completedMinutes,
        remainingMinutes: obl.unplannedMinutes,
        openMinutes: obl.openMinutes,
      });
    }
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
  companyCalendars?: CompanyCalendars,
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
    // Dia em andamento ou pendente não é candidato: o saldo ainda não está fechado
    if (day.open || day.financialPending) continue;

    // Capacidade livre = déficit do dia pela RESOLUÇÃO CENTRAL menos o que já
    // está comprometido. Folga/abonado/fim de semana têm déficit 0 e nunca
    // entram como sugestão de destino (sem "8h − trabalhado").
    const deficit = companyDayContext(date, entries, [], companyCalendars ?? [], settings).adjustedDeficit;
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
  companyCalendars?: CompanyCalendars,
  absences: Absence[] = [],
): number {
  const days = buildDebtDays(entries, comps, settings, undefined, absences, companyCalendars);
  const found = days.find((d) => d.date === date && d.kind === kind);
  if (found) return found.remainingMinutes;

  // Dia ainda sem excedente/déficit registrado: fallback — quando há calendário,
  // usa a RESOLUÇÃO CENTRAL (folga/abonado → déficit 0, nunca 8h fixas).
  const day = computeDay(
    entries.filter((e) => e.date === date),
    settings,
  );
  if (day.empty) return 0;
  if (kind === "excedente") return day.excessMinutes;
  // Resolução central: folga/abonado/fim de semana → déficit 0 (nunca 8h fixas)
  return companyDayContext(date, entries, [], companyCalendars ?? [], settings).adjustedDeficit;
}

/* ── Capacidade de hora extra por dia (função central) ────── */

/** Opções de resolução central (Calendário da empresa) compartilhadas. */
export interface CentralDayOpts {
  /**
   * Coleção de calendários da empresa. Quando presente, a jornada-base usada
   * nos cálculos de capacidade/extra vem da RESOLUÇÃO CENTRAL
   * (companyDayContext.effectiveExpected): 0 em folga/abonado/recesso/folga a
   * compensar e jornada do calendário em eventos — nunca 8h fixas.
   */
  companyCalendars?: CompanyCalendars;
}

/**
 * Jornada esperada EFETIVA de uma data pela resolução central (fonte única):
 * folga/fins de semana/abonado/recesso => 0; Cinzas => jornada do evento;
 * dia útil normal => base configurada. Funciona mesmo sem calendário
 * importado (coleção vazia ainda resolve sábado/domingo como folga).
 */
function effectiveBaseForDate(
  date: string,
  entries: TimeEntry[],
  settings: WorkSettings,
  companyCalendars?: CompanyCalendars,
): number {
  return companyDayContext(date, entries, [], companyCalendars ?? [], settings).effectiveExpected;
}

export interface ExtraCapacity {
  /** Jornada-base configurada (min). */
  baseMinutes: number;
  /** Jornada-base EFETIVA da data pela resolução central (0 em folga/abonado). */
  effectiveBaseMinutes?: number;
  /** Limite diário configurado (min). */
  limitMinutes: number;
  /** Minutos de hora extra já vinculados (ativos) à data — exclui `excludeCompId`. */
  alreadyAllocated: number;
  /** Dia encerrado: hora extra REAL existente (trabalhado − base efetiva). Null se vazio/aberto. */
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
  opts?: { excludeCompId?: number } & CentralDayOpts,
): ExtraCapacity {
  const baseMinutes = expectedMinutesOf(settings);
  /** Jornada-base EFETIVA pela resolução central — sábado/domingo, feriados
   * abonados, recessos e folgas a compensar têm base 0: as horas realmente
   * trabalhadas nesses dias são integralmente hora positiva utilizável. */
  const effectiveBase = effectiveBaseForDate(date, entries, settings, opts?.companyCalendars);
  const limitMinutes = settings.maxDailyMinutes;
  const headroom = Math.max(0, limitMinutes - effectiveBase);

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
  if (day.financialPending) {
    return {
      baseMinutes,
      effectiveBaseMinutes: effectiveBase,
      limitMinutes,
      alreadyAllocated,
      realExtra: null,
      available: 0,
    };
  }
  const finished = !day.empty && !day.open;
  const realExtra = finished
    ? actualExtraForDate(date, entries, settings, { companyCalendars: opts?.companyCalendars })
    : null;

  let available = Math.max(0, headroom - alreadyAllocated);
  if (realExtra !== null) {
    available = Math.min(available, Math.max(0, realExtra - alreadyAllocated));
  }

  return {
    baseMinutes,
    effectiveBaseMinutes: effectiveBase,
    limitMinutes,
    alreadyAllocated,
    realExtra,
    available,
  };
}

/** Dívida original (minutos) de uma origem para kinds quitados com hora extra. */
export function originalHourExtraDebt(
  date: string,
  kind: CompKind,
  entries: TimeEntry[],
  comps: Compensation[],
  absences: Absence[],
  companyCalendars: CompanyCalendars | undefined,
  settings: WorkSettings,
): number {
  const cctx = companyDayContext(date, entries, absences, companyCalendars, settings);
  if (kind === "acordo" || kind === "calendario") {
    const obl = compensarObligationOnDate(
      date, entries, comps, absences, companyCalendars, settings, date,
    );
    return obl?.effectiveObligationMinutes ?? 0;
  }
  if (kind === "deficit") {
    const coveredByEarly = sumMinutes(
      comps.filter((c) => c.targetDate === date && kindOf(c) === "excedente" && isActive(c)),
    );
    return cctx.ctx.day.open || cctx.ctx.day.financialPending
      ? 0
      : Math.max(0, cctx.adjustedDeficit - coveredByEarly);
  }
  return 0;
}

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
 * encerrados): trabalhado − jornada-base EFETIVA (resolução central quando
 * há calendário — folga/abonado têm base 0, então tudo que foi trabalhado no
 * dia conta como hora positiva). Usa as batidas reais do dia.
 */
export function actualExtraForDate(
  date: string,
  entries: TimeEntry[],
  settings: WorkSettings,
  opts?: CentralDayOpts,
): number {
  const day = computeDay(
    entries.filter((e) => e.date === date),
    settings,
  );
  const obl = compensarObligationOnDate(
    date, entries, [], [], opts?.companyCalendars, settings, date,
  );
  if (obl) return day.empty || day.open ? 0 : obl.surplusMinutes;
  const base = effectiveBaseForDate(date, entries, settings, opts?.companyCalendars);
  return Math.max(0, day.workedMinutes - base);
}

export interface CompletionCheck {
  ok: boolean;
  reason?: "future-date" | "insufficient-extra" | "day-open";
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
  opts?: CentralDayOpts,
): CompletionCheck {
  const kind = kindOf(comp);
  if (today < comp.targetDate) {
    return {
      ok: false,
      reason: "future-date",
      error: `Aguardando realização da hora extra em ${formatDateBR(comp.targetDate)}.`,
    };
  }

  const targetDay = computeDay(
    entries.filter((e) => e.date === comp.targetDate),
    settings,
    undefined,
    { date: today, minutes: today === todayString() ? nowMinutesLocal() : 23 * 60 + 59 },
  );
  if (targetDay.entries.length > 0 && (!targetDay.canFinalizeFinancialDay || targetDay.open || targetDay.financialPending)) {
    const needsCorrection = !targetDay.consistent || targetDay.financialPending;
    return {
      ok: false,
      reason: "day-open",
      error: needsCorrection
        ? "Corrija os registros deste dia para verificar e concluir a compensação."
        : "A jornada do dia ainda está em andamento — registre a saída para confirmar a quitação.",
    };
  }
  if (kind === "excedente") return { ok: true };

  const actualExtra = actualExtraForDate(comp.targetDate, entries, settings, opts);
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
  /** Total gerado pelo afastamento acordado (IMUTÁVEL). */
  originalMinutes: number;
  workedOnOriginDateMinutes: number;
  effectiveObligationMinutes: number;
  /** Soma SOMENTE das compensações de acordo concluídas. */
  compensatedMinutes: number;
  /** Soma das compensações de acordo apenas planejadas (pendentes). */
  plannedMinutes: number;
  /** Efetiva − Compensado (planejado NÃO abate). */
  remainingMinutes: number;
  /** Restante factual − planejado ativo: ainda SEM PROGRAMAÇÃO. */
  unplannedMinutes: number;
}

/**
 * Deriva Original / Compensado / Planejado / Restante de um dia de acordo.
 * Regra do acordo: apenas compensações CONCLUÍDAS abatem o restante —
 * uma compensação somente planejada não reduz o saldo devido.
 * Não altera a semântica de excedente/déficit em `buildDebtDays`.
 */
export function acordoViewOf(day: DebtDay): AcordoView {
  const remainingMinutes = day.openMinutes;
  const planned = Math.min(day.pendingMinutes, remainingMinutes);
  return {
    date: day.date,
    originalMinutes: day.debtMinutes,
    workedOnOriginDateMinutes: day.workedMinutes,
    effectiveObligationMinutes: Math.max(0, remainingMinutes + day.concludedMinutes),
    compensatedMinutes: day.concludedMinutes,
    plannedMinutes: day.pendingMinutes,
    remainingMinutes,
    unplannedMinutes: Math.max(0, remainingMinutes - planned),
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

/* ── Visão do "Calendário a compensar" (obrigações derivadas — nunca persistidas) ── */

export interface CalendarioView {
  /** Data de origem da obrigação (evento do calendário com tratamento COMPENSAR). */
  date: string;
  /** Ciclo anual da data de origem, ex.: "2026–2027". */
  cycleLabel: string;
  /** Horas a compensar do evento — IMUTÁVEL. */
  originalMinutes: number;
  workedOnOriginDateMinutes: number;
  effectiveObligationMinutes: number;
  /** Soma SOMENTE das compensações de calendário concluídas vinculadas à origem. */
  compensatedMinutes: number;
  /** Soma das compensações de calendário ainda pendentes (planejadas). */
  plannedMinutes: number;
  /** Efetiva − Compensado (planejado NÃO abate o restante). Nunca negativo. */
  remainingMinutes: number;
  unplannedMinutes: number;
  /** True quando a data de origem ainda não chegou (visível para planejamento). */
  future: boolean;
}

/**
 * Obrigações DERIVADAS do Calendário da empresa (tratamento COMPENSAR) dentro
 * de um intervalo — normalmente o ciclo anual atual, para que ciclos encerrados
 * não apareçam como obrigação ativa.
 *
 * A fonte da obrigação é SEMPRE o calendário: nenhuma Compensation é criada
 * automaticamente ao importar/substituir calendários; compensações persistidas
 * representam apenas planejamento, execução e quitação (kind "calendario"
 * vinculado à data de origem). A derivação é idempotente por natureza.
 *
 * Semântica idêntica à aprovada para Acordo a compensar: só compensações
 * CONCLUÍDAS abatem o Restante; Planejado é informativo.
 */
export function activeCalendarObligations(
  entries: TimeEntry[],
  comps: Compensation[],
  settings: WorkSettings,
  range: { from: string; to: string },
  companyCalendars: CompanyCalendars | undefined,
  today: string,
): CalendarioView[] {
  return buildDebtDays(entries, comps, settings, range, [], companyCalendars)
    .filter((d) => d.kind === "calendario")
    .map((d) => {
      const remainingMinutes = d.openMinutes;
      const planned = Math.min(d.pendingMinutes, remainingMinutes);
      return {
        date: d.date,
        cycleLabel: calendarCycleOf(d.date).label,
        originalMinutes: d.debtMinutes,
        workedOnOriginDateMinutes: d.workedMinutes,
        effectiveObligationMinutes: Math.max(0, remainingMinutes + d.concludedMinutes),
        compensatedMinutes: d.concludedMinutes,
        plannedMinutes: d.pendingMinutes,
        remainingMinutes,
        unplannedMinutes: Math.max(0, remainingMinutes - planned),
        future: d.date > today,
      };
    })
    .filter((v) => v.remainingMinutes > 0)
    .sort((a, b) => a.date.localeCompare(b.date)); // mais próxima primeiro
}

/**
 * Compensações VINCULADAS a um afastamento acordado (kind "acordo" cuja
 * origem cai dentro do período do evento). Usado pela regra especial de
 * substituição pelo Abono de aniversário: somente estas podem ser
 * canceladas junto com o acordo — nunca tocar em compensações de déficit
 * comum, calendário ou outros acordos.
 */
export function acordoLinkedComps(compensations: Compensation[], acordo: Absence): Compensation[] {
  return compensations.filter(
    (c) =>
      kindOf(c) === "acordo" &&
      c.sourceDate >= acordo.startDate &&
      c.sourceDate <= acordo.endDate,
  );
}
