// ─────────────────────────────────────────────────────────────
// BANCO DE HORAS — visão consolidada (camada de derivação pura).
//
// Três camadas conceituais (NUNCA misturar):
//  1. REALIZADO — fatos: batidas, faltas efetivas, calendário, jornadas
//     encerradas. É a única fonte do SALDO REALIZADO.
//  2. UTILIZADO/DESTINADO — contabilidade interna das compensações: qual
//     hora foi usada, qual dívida foi atendida, quanto continua livre.
//     NUNCA altera o saldo realizado (esse já nasceu das batidas).
//  3. PLANEJADO — compensações futuras: NÃO criam hora positiva, NÃO
//     reduzem déficit realizado e NÃO alteram o Saldo do período.
//
// PLANEJADO ≠ REALIZADO ≠ COMPENSADO.
// ─────────────────────────────────────────────────────────────
import { computeDay, formatMinutes } from "./time";
import { annualCycleBounds, getAnnualPointCycle, sameAnnualCycle } from "./periods";
import { companyDayContext, type CompanyCalendars } from "./company-calendar";
import { dayBalanceContribution } from "./faltas";
import {
  actualExtraForDate,
  allocatedForSource,
  appliedOnDate,
  buildDebtDays,
  kindOf,
  usesHourExtra,
} from "./debt";
import { effectiveFaltas } from "./faltas";
import type { Absence } from "./absences";
import type {
  CompKind,
  Compensation,
  DayResult,
  ExcessReason,
  ExcessReasonCode,
  Falta,
  TimeEntry,
  WorkSettings,
} from "./types";

/* ── Regra temporal central (§2) ───────────────────────────── */

/**
 * REALIZADO = somente dados com date <= hoje (fatos efetivamente ocorridos).
 * Batidas cadastradas em data futura podem existir no dataset, mas antes da
 * data: não entram no banco, não viram crédito livre, não servem à quitação
 * imediata e não alteram o saldo realizado. A contribuição diária usa a mesma
 * guarda na fonte compartilhada (dayBalanceContribution — Visão/Resumo/
 * Registros/Banco); créditos/planos filtram as datas por este predicado.
 */
export function isRealizedDate(date: string, today: string): boolean {
  return date <= today;
}

/* ── Motivo do excedente >10h (§10) ────────────────────────── */

export const EXCESS_REASON_OPTIONS: { code: ExcessReasonCode; label: string }[] = [
  { code: "demanda-urgente", label: "Demanda urgente de trabalho" },
  { code: "reuniao-prolongada", label: "Reunião/atividade prolongada" },
  { code: "viagem-deslocamento", label: "Viagem/deslocamento" },
  { code: "atendimento-evento", label: "Atendimento/evento" },
  { code: "necessidade-operacional", label: "Necessidade operacional" },
  { code: "outro", label: "Outro" },
];

export function excessReasonLabel(r: ExcessReason): string {
  if (r.reason === "outro") return r.customReason?.trim() ? `Outro — ${r.customReason.trim()}` : "Outro";
  return EXCESS_REASON_OPTIONS.find((o) => o.code === r.reason)?.label ?? "Outro";
}

/** Motivo registrado para a data, se houver. */
export function excessReasonOnDate(reasons: ExcessReason[] | undefined, date: string): ExcessReason | undefined {
  return reasons?.find((r) => r.date === date);
}

export interface ExcessReasonGate {
  ok: boolean;
  error?: string;
}

export const EXCESS_REASON_MISSING_MSG =
  "Motivo não informado — registre o motivo do excedente acima de 10h antes de realocá-lo.";

/**
 * GATE CENTRAL do motivo (§10.1): destinar a reserva especial de um dia
 * (qualquer realocação do excedente acima de 10h) exige motivo registrado.
 * Dia sem excedente (>10h = 0) não precisa de motivo.
 */
export function canAllocateExcess(
  date: string,
  entries: TimeEntry[],
  settings: WorkSettings,
  reasons: ExcessReason[] | undefined,
): ExcessReasonGate {
  const day = computeDay(
    entries.filter((e) => e.date === date),
    settings,
  );
  if (day.excessMinutes <= 0) return { ok: true };
  const r = excessReasonOnDate(reasons, date);
  if (!r) {
    return { ok: false, error: `⚠ ${EXCESS_REASON_MISSING_MSG}` };
  }
  return { ok: true };
}

/**
 * Disparo AUTOMÁTICO do modal de motivo: só após uma MUTATION que FECHA o
 * dia acima de 10h sem motivo. Não dispara em render/abertura da página
 * (excedente antigo mostra ⚠ + [Registrar motivo]) e não reabre se o dia
 * já estava encerrado com excedente (usuário postergou).
 */
export function shouldPromptExcessReason(opts: {
  beforeExcessMinutes: number;
  beforeOpen: boolean;
  after: Pick<DayResult, "open" | "excessMinutes">;
  hasReason: boolean;
}): boolean {
  if (opts.after.open || opts.after.excessMinutes <= 0 || opts.hasReason) return false;
  return opts.beforeExcessMinutes <= 0 || opts.beforeOpen;
}

/* ── Camada de CRÉDITO por dia (realizado x destinado) ─────── */

export interface DayCreditView {
  date: string;
  day: DayResult;
  /** Jornada-base efetiva pela resolução central (0 em folga/abonado). */
  effectiveBase: number;
  /** Hora positiva realizada total (trabalhado − base; 0 em dia aberto/vazio). */
  realizedPositive: number;
  /** Parte REGULAR do crédito: até o limite diário (10h) — hora positiva normal. */
  regularExtra: number;
  /** EXCEDENTE ESPECIAL acima de 10h — reserva própria, NÃO é crédito livre comum. */
  excessSpecial: number;
  /** Destinado via compensações cujo DESTINO/realização é este dia (ativas). */
  usedViaTarget: number;
  /** Parte do usedViaTarget que consome o crédito regular (as primeiras horas até 10h). */
  usedRegular: number;
  /** Parte do usedViaTarget que consome a reserva especial (acima do regular). */
  usedSpecialViaTarget: number;
  /** Destinado via compensações de excedente (sair mais cedo) com ORIGEM neste dia. */
  usedSpecialViaSource: number;
  /** Crédito regular ainda livre. */
  freeRegular: number;
  /** Reserva especial ainda livre (exige motivo para destinar). */
  freeSpecial: number;
  /** Motivo do excedente do dia (se houver reserva: ausente = ⚠ não informado). */
  reason: ExcessReason | undefined;
}

/**
 * Decomposição de UM dia: separa as três situações diárias (§3):
 * crédito regular (até o limite), déficit (via buildDebtDays) e o excedente
 * ESPECIAL acima de 10h, já com a contabilidade de destinação (anti-reuso):
 * parcelas com portion="especial" consomem a RESERVA; as demais via dia-destino
 * gastam primeiro o crédito regular e só depois a reserva (regra legada);
 * compensações de excedente (sair mais cedo) consomem a reserva pela origem.
 */
export function dayCreditView(
  date: string,
  entries: TimeEntry[],
  comps: Compensation[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  settings: WorkSettings,
  reasons: ExcessReason[] | undefined,
): DayCreditView {
  const day = computeDay(
    entries.filter((e) => e.date === date),
    settings,
  );
  const cctx = companyDayContext(date, entries, absences, calendars ?? [], settings);
  const base = cctx.effectiveExpected;
  const finished = !day.empty && !day.open;
  const realizedPositive = finished ? Math.max(0, day.workedMinutes - base) : 0;
  const regularExtra = Math.min(realizedPositive, Math.max(0, settings.maxDailyMinutes - base));
  const excessSpecial = day.excessMinutes;

  // §5/§8 atribuição POR PORÇÃO: parcelas explicitamente marcadas consomem a
  // reserva especial; as demais (portion ausente — legado) gastam primeiro o
  // crédito regular e só o que exceder vai para a reserva.
  const targetComps = comps.filter(
    (c) => c.targetDate === date && usesHourExtra(kindOf(c)) && c.status !== "cancelada",
  );
  const markedSpecial = targetComps
    .filter((c) => c.portion === "especial")
    .reduce((s, c) => s + c.minutes, 0);
  const unmarkedUsed = targetComps
    .filter((c) => c.portion !== "especial")
    .reduce((s, c) => s + c.minutes, 0);
  const usedViaTarget = markedSpecial + unmarkedUsed;
  const usedRegular = Math.min(unmarkedUsed, regularExtra);
  const usedSpecialViaTarget = markedSpecial + Math.max(0, unmarkedUsed - regularExtra);
  const usedSpecialViaSource = allocatedForSource(comps, date, "excedente");

  return {
    date,
    day,
    effectiveBase: base,
    realizedPositive,
    regularExtra,
    excessSpecial,
    usedViaTarget,
    usedRegular,
    usedSpecialViaTarget,
    usedSpecialViaSource,
    freeRegular: Math.max(0, regularExtra - usedRegular),
    freeSpecial: Math.max(0, excessSpecial - usedSpecialViaTarget - usedSpecialViaSource),
    reason: excessReasonOnDate(reasons, date),
  };
}

/* ── Resumo do banco (§2/§4) ───────────────────────────────── */

export interface HourBankSummary {
  /** Saldo realizado: fatos do período pela fonte central (batidas + faltas efetivas). */
  realizedBalance: number;
  /** Horas positivas REGULARES (até 10h) realizadas e ainda não destinadas. */
  freeRegularTotal: number;
  /** Déficits em aberto: original − CONCLUÍDO (planejado NÃO conta). */
  openDeficitTotal: number;
  /** Reserva especial livre: excedente acima de 10h a realocar. */
  excessSpecialFreeTotal: number;
  /** Total de excedente especial cuja destinação está bloqueada por falta de motivo. */
  excessWithoutReason: number;
  /** Planejado (informativo): parcelas pendentes — NÃO altera o saldo realizado. */
  plannedTotal: number;
}

/** RESUMO DO BANCO de um intervalo (período de ponto ou ciclo anual). */
export function hourBankSummary(
  entries: TimeEntry[],
  comps: Compensation[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  faltas: Falta[] | undefined,
  reasons: ExcessReason[] | undefined,
  settings: WorkSettings,
  range: { from: string; to: string },
  today: string,
): HourBankSummary {
  const debts = buildDebtDays(
    entries,
    comps,
    settings,
    range,
    absences,
    calendars,
    effectiveFaltas(faltas, today),
  );

  // Saldo realizado: soma da contribuição central por dia (FATOS — faltas
  // previstas e planejamentos ficam de fora por construção). §2: o loop para
  // em `today` — dias futuros NÃO são realizados (a guarda central de
  // dayBalanceContribution zera qualquer contribuição futura de qualquer forma).
  let realizedBalance = 0;
  {
    let cur = range.from;
    while (cur <= range.to && isRealizedDate(cur, today)) {
      const cctx = companyDayContext(cur, entries, absences, calendars ?? [], settings);
      realizedBalance += dayBalanceContribution(cctx, faltas, cur, today);
      cur = nextDay(cur);
    }
  }

  let freeRegularTotal = 0;
  let excessSpecialFreeTotal = 0;
  let excessWithoutReason = 0;
  const creditDates = new Set<string>();
  for (const e of entries) {
    // §2: crédito realizado/livre só de datas JÁ OCORRIDAS — batida futura
    // fica no dataset, mas não vira crédito antes do dia chegar.
    if (isRealizedDate(e.date, today) && e.date >= range.from && e.date <= range.to) {
      creditDates.add(e.date);
    }
  }
  for (const date of creditDates) {
    const v = dayCreditView(date, entries, comps, absences, calendars, settings, reasons);
    freeRegularTotal += v.freeRegular;
    excessSpecialFreeTotal += v.freeSpecial;
    if (v.excessSpecial > 0 && !v.reason) excessWithoutReason += v.freeSpecial;
  }

  const openDeficitTotal = debts
    .filter((d) => d.kind === "deficit")
    .reduce((s, d) => s + d.openMinutes, 0);
  const plannedTotal = comps
    .filter((c) => c.status === "pendente" && c.targetDate >= range.from && c.targetDate <= range.to)
    .reduce((s, c) => s + c.minutes, 0);

  return {
    realizedBalance,
    freeRegularTotal,
    openDeficitTotal,
    excessSpecialFreeTotal,
    excessWithoutReason,
    plannedTotal,
  };
}

function nextDay(d: string): string {
  const dt = new Date(`${d}T12:00:00`);
  dt.setDate(dt.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/* ── STATUS FUTURO de uma parcela (§15 — sempre derivado) ──── */

export type FutureCompStatus = "pendente" | "parcial" | "atrasada" | "meta-atingida" | "concluida" | "cancelada";

export interface FutureCompView {
  status: FutureCompStatus;
  /** Quanto da obrigação já está REALIZADO no dia de destino. */
  realizedMinutes: number;
  /** Obrigação − realizado (nunca negativo). */
  remainingMinutes: number;
}

/**
 * Status derivado de uma parcela (§15 — PLANEJADO não equivale a Concluído):
 *  - concluída/cancelada: persistido;
 *  - pendente com destino FUTURO: Pendente;
 *  - pendente com destino HOJE: realizado parcial → Parcial; realizado que
 *    cobre a obrigação → Meta atingida (aguardando confirmação); nada → Pendente;
 *  - pendente com destino PASSADO: sem realização → Atrasada; com realização
 *    insuficiente → também Atrasada (saldo não realizado — §15).
 */
export function futureCompStatus(
  comp: Compensation,
  entries: TimeEntry[],
  comps: Compensation[],
  settings: WorkSettings,
  today: string,
  opts?: { companyCalendars?: CompanyCalendars },
): FutureCompView {
  if (comp.status === "cancelada") return { status: "cancelada", realizedMinutes: comp.minutes, remainingMinutes: 0 };
  if (comp.status === "concluida")
    return { status: "concluida", realizedMinutes: comp.minutes, remainingMinutes: 0 };

  // Compensação de excedente (sair mais cedo) não tem "realização de hora extra":
  // só vira Parcial/Atrasada por data: passou e segue pendente → Atrasada.
  if (!usesHourExtra(kindOf(comp))) {
    const late = comp.targetDate < today;
    return {
      status: late ? "atrasada" : "pendente",
      realizedMinutes: 0,
      remainingMinutes: comp.minutes,
    };
  }

  const actual = actualExtraForDate(comp.targetDate, entries, settings, opts);
  const committed = comps
    .filter(
      (c) =>
        c.id !== comp.id &&
        c.targetDate === comp.targetDate &&
        c.status === "concluida" &&
        usesHourExtra(kindOf(c)),
    )
    .reduce((s, c) => s + c.minutes, 0);
  const available = Math.max(0, actual - committed);
  const realized = Math.min(available, comp.minutes);

  if (comp.targetDate > today) {
    return { status: "pendente", realizedMinutes: 0, remainingMinutes: comp.minutes };
  }
  if (comp.targetDate === today) {
    if (realized >= comp.minutes) return { status: "meta-atingida", realizedMinutes: realized, remainingMinutes: 0 };
    if (realized > 0) {
      return { status: "parcial", realizedMinutes: realized, remainingMinutes: comp.minutes - realized };
    }
    return { status: "pendente", realizedMinutes: 0, remainingMinutes: comp.minutes };
  }
  // destino já passou
  if (realized > 0) {
    return { status: "atrasada", realizedMinutes: realized, remainingMinutes: comp.minutes - realized };
  }
  return { status: "atrasada", realizedMinutes: 0, remainingMinutes: comp.minutes };
}

/* ── DÉFICIT consolidado (§5/§19) ──────────────────────────── */

export interface DeficitParcelView {
  comp: Compensation;
  future: FutureCompView;
}

export interface DeficitView {
  date: string;
  /** Déficit original do dia. */
  originalMinutes: number;
  /** Soma das parcelas CONCLUÍDAS. */
  compensatedMinutes: number;
  /** Soma das parcelas apenas PLANEJADAS (pendentes). */
  plannedMinutes: number;
  /** Original − destinado (planejado+concluído): ainda SEM PROGRAMAÇÃO. */
  unplannedMinutes: number;
  /** Original − CONCLUÍDO: ainda EM ABERTO (planejado não quita — §20). */
  openMinutes: number;
  /** Quitada | Parcial | Pendente (da OBRIGAÇÃO consolidada). */
  status: "quitada" | "parcial" | "pendente";
  parcels: DeficitParcelView[];
}

/** Visões consolidadas dos déficits de um intervalo (com parcelas para expandir). */
export function deficitViews(
  entries: TimeEntry[],
  comps: Compensation[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  faltas: Falta[] | undefined,
  settings: WorkSettings,
  range: { from: string; to: string },
  today: string,
): DeficitView[] {
  const debts = buildDebtDays(
    entries,
    comps,
    settings,
    range,
    absences,
    calendars,
    effectiveFaltas(faltas, today),
  ).filter((d) => d.kind === "deficit");

  return debts.map((d) => {
    const parcels = comps
      .filter((c) => c.sourceDate === d.date && kindOf(c) === "deficit" && c.status !== "cancelada")
      .map((comp) => ({ comp, future: futureCompStatus(comp, entries, comps, settings, today, { companyCalendars: calendars }) }))
      .sort((a, b) => a.comp.targetDate.localeCompare(b.comp.targetDate));
    const compensado = d.concludedMinutes;
    const open = d.openMinutes;
    return {
      date: d.date,
      originalMinutes: d.debtMinutes,
      compensatedMinutes: compensado,
      plannedMinutes: d.pendingMinutes,
      unplannedMinutes: d.remainingMinutes,
      openMinutes: open,
      status: open <= 0 ? "quitada" : compensado > 0 ? "parcial" : "pendente",
      parcels,
    };
  });
}

/* ── Fontes de crédito para quitação imediata (§6–§8) ──────── */

export interface CreditSource {
  date: string;
  /** Minutos a usar desta fonte. */
  minutes: number;
  /** "especial" quando a parcela consome a reserva acima de 10h (exige motivo). */
  portion: "regular" | "especial";
}

export interface CreditUsePlan {
  ok: boolean;
  error?: string;
  needsReason?: string[];
  /** Parcelas a criar (kind hour-extra; destino = dia do crédito). */
  parcels: { sourceDate: string; targetDate: string; minutes: number; portion: "regular" | "especial" }[];
  /** Quanto do pedido foi atendido pelo plano. */
  appliedMinutes: number;
}

/**
 * PLANO DE USO DE CRÉDITO REALIZADO para uma dívida (§6–§8):
 * distribui `minutes` entre dias JÁ ENCERRADOS com crédito livre, criando
 * parcelas concluídas-imediatas — NUNCA altera batidas nem o saldo realizado.
 *
 * PRIORIDADE (§8): primeiro a RESERVA ESPECIAL (>10h) dos dias — somente com
 * motivo registrado — do mais antigo para o mais novo; depois o crédito
 * REGULAR livre, do dia mais recente para o mais antigo. Se algum dia tiver
 * reserva especial SEM motivo, ela é ignorada e sinalizada em needsReason.
 */
export function planRealizedCreditUse(
  sourceDate: string,
  minutes: number,
  entries: TimeEntry[],
  comps: Compensation[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  settings: WorkSettings,
  reasons: ExcessReason[] | undefined,
  today: string,
): CreditUsePlan {
  if (minutes <= 0) return { ok: false, error: "Quantidade de minutos inválida.", parcels: [], appliedMinutes: 0 };

  const views = [...new Set(entries.filter((e) => isRealizedDate(e.date, today)).map((e) => e.date))]
    .map((date) => dayCreditView(date, entries, comps, absences, calendars, settings, reasons))
    .sort((a, b) => a.date.localeCompare(b.date));

  const parcels: CreditUsePlan["parcels"] = [];
  const needsReason: string[] = [];
  let rest = minutes;

  // 1) RESERVA ESPECIAL primeiro (mais antiga → mais nova), somente com motivo.
  for (const v of views) {
    if (rest <= 0) break;
    if (v.excessSpecial > 0 && !v.reason) {
      if (v.freeSpecial > 0) needsReason.push(v.date);
      continue; // §10.1: sem motivo, a reserva especial NÃO pode ser destinada
    }
    if (v.freeSpecial <= 0) continue;
    const use = Math.min(rest, v.freeSpecial);
    if (use <= 0) continue;
    parcels.push({ sourceDate, targetDate: v.date, minutes: use, portion: "especial" });
    rest -= use;
  }

  // 2) Crédito REGULAR livre (mais recente → mais antigo).
  for (const v of [...views].sort((a, b) => b.date.localeCompare(a.date))) {
    if (rest <= 0) break;
    if (v.freeRegular <= 0) continue;
    const use = Math.min(rest, v.freeRegular);
    if (use <= 0) continue;
    parcels.push({ sourceDate, targetDate: v.date, minutes: use, portion: "regular" });
    rest -= use;
  }

  const applied = minutes - rest;
  if (applied <= 0) {
    const needs = needsReason.length > 0;
    return {
      ok: false,
      needsReason: needs ? needsReason : undefined,
      error: needs
        ? "Existe excedente acima de 10h a realocar, mas o motivo ainda não foi informado. Registre o motivo para usar essa reserva."
        : "Não há horas positivas realizadas livres para usar nesta data.",
      parcels: [],
      appliedMinutes: 0,
    };
  }
  return { ok: true, needsReason: needsReason.length > 0 ? needsReason : undefined, parcels, appliedMinutes: applied };
}

/** Texto curto do resultado de uma quitação imediata (toast). */
export function creditUseSummary(parcels: CreditUsePlan["parcels"]): string {
  const total = parcels.reduce((s, p) => s + p.minutes, 0);
  const targets = [...new Set(parcels.map((p) => p.targetDate))];
  return `${formatMinutes(total)} usados de ${targets.length === 1 ? "1 dia" : `${targets.length} dias`}`;
}

/* ── Alocação do EXCEDENTE ESPECIAL já realizado ─────────── */

export const ALLOCATE_NO_REASON_MSG = "Registre o motivo do excedente antes de alocá-lo.";
export const ALLOCATE_CROSS_CYCLE_MSG = "Origem e déficit precisam pertencer ao mesmo ciclo anual.";

/**
 * Déficits FACTUAIS elegíveis para alocar o excedente especial de `excessDate`:
 * mesmo CICLO ANUAL da origem (01/05→30/04 — helper central), em aberto
 * (original − concluído; planejado NÃO quita) e na MESMA ordem de
 * Visão geral → Dias com saldo negativo (mais recente primeiro).
 */
export function eligibleDeficitsForSpecialAllocation(
  excessDate: string,
  entries: TimeEntry[],
  comps: Compensation[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  faltas: Falta[] | undefined,
  settings: WorkSettings,
  today: string,
): DeficitView[] {
  const bounds = annualCycleBounds(getAnnualPointCycle(excessDate));
  const to = bounds.to < today ? bounds.to : today;
  return deficitViews(
    entries, comps, absences, calendars, faltas, settings,
    { from: bounds.from, to }, today,
  )
    .filter((d) => d.openMinutes > 0 && d.date !== excessDate && sameAnnualCycle(d.date, excessDate))
    .reverse();
}

export interface AllocateSpecialPreview {
  ok: boolean;
  error?: string;
  /** Minutos que SERÃO alocados (já limitado ao máximo). */
  minutes: number;
  /** teto = min(especial livre, déficit factual restante). */
  maxMinutes: number;
  freeSpecial: number;
  openDeficit: number;
  originalDeficit: number;
  compensatedNow: number;
  plannedNow: number;
  /** Planejado que será liberado/cancelado para evitar sobrecompensação. */
  plannedToRelease: number;
  plannedAfter: number;
  remainingDeficitAfter: number;
  remainingSpecialAfter: number;
  compensatedAfter: number;
}

/**
 * Teto da alocação originada no card de excedente >10h:
 * min(reserva especial LIVRE da origem, déficit FACTUAL restante do destino).
 * Déficit factual = original − CONCLUÍDO (planejado NÃO reduz o restante).
 */
export function maxAllocatableSpecial(
  excessDate: string,
  deficitDate: string,
  entries: TimeEntry[],
  comps: Compensation[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  faltas: Falta[] | undefined,
  settings: WorkSettings,
  reasons: ExcessReason[] | undefined,
  today: string,
): { max: number; freeSpecial: number; openDeficit: number; credit: DayCreditView; deficit: DeficitView | undefined } {
  const credit = dayCreditView(excessDate, entries, comps, absences, calendars, settings, reasons);
  const views = deficitViews(entries, comps, absences, calendars, faltas, settings, { from: deficitDate, to: deficitDate }, today);
  const deficit = views.find((d) => d.date === deficitDate);
  const openDeficit = deficit?.openMinutes ?? 0;
  const max = Math.max(0, Math.min(credit.freeSpecial, openDeficit));
  return { max, freeSpecial: credit.freeSpecial, openDeficit, credit, deficit };
}

/**
 * Libera/cancela parcelas PENDENTES de déficit (nunca concluídas) para que o
 * planejado ativo não ultrapasse `remainingNeeded` (original − concluído).
 * Libera as mais recentes primeiro. Histórico: cancela (não apaga) ou reduz
 * minutos. Nunca toca parcelas concluídas nem déficits de outras datas.
 */
export function releaseOverlappingPlanned(
  comps: Compensation[],
  deficitDate: string,
  remainingNeeded: number,
): { comps: Compensation[]; released: number } {
  const pending = comps
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => c.sourceDate === deficitDate && kindOf(c) === "deficit" && c.status === "pendente")
    .sort((a, b) => b.c.createdAt - a.c.createdAt || b.c.id - a.c.id);
  const totalPending = pending.reduce((s, p) => s + p.c.minutes, 0);
  let toRelease = Math.max(0, totalPending - Math.max(0, remainingNeeded));
  let released = 0;
  const next = [...comps];
  for (const { c, idx } of pending) {
    if (toRelease <= 0) break;
    if (c.minutes <= toRelease) {
      next[idx] = { ...c, status: "cancelada" };
      released += c.minutes;
      toRelease -= c.minutes;
    } else {
      next[idx] = { ...c, minutes: c.minutes - toRelease };
      released += toRelease;
      toRelease = 0;
    }
  }
  return { comps: next, released };
}

/** Prévia pura da alocação (modal + testes). NÃO altera estado. */
export function previewAllocateSpecialExcess(
  excessDate: string,
  deficitDate: string,
  requestedMinutes: number,
  entries: TimeEntry[],
  comps: Compensation[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  faltas: Falta[] | undefined,
  settings: WorkSettings,
  reasons: ExcessReason[] | undefined,
  today: string,
): AllocateSpecialPreview {
  const { max, freeSpecial, openDeficit, credit, deficit } = maxAllocatableSpecial(
    excessDate, deficitDate, entries, comps, absences, calendars, faltas, settings, reasons, today,
  );
  const original = deficit?.originalMinutes ?? 0;
  const compensatedNow = deficit?.compensatedMinutes ?? 0;
  const plannedNow = deficit?.plannedMinutes ?? 0;
  if (!sameAnnualCycle(excessDate, deficitDate)) {
    return {
      ok: false, error: ALLOCATE_CROSS_CYCLE_MSG, minutes: 0, maxMinutes: 0,
      freeSpecial, openDeficit: 0, originalDeficit: original, compensatedNow, plannedNow,
      plannedToRelease: 0, plannedAfter: plannedNow, remainingDeficitAfter: openDeficit,
      remainingSpecialAfter: freeSpecial, compensatedAfter: compensatedNow,
    };
  }
  if (!credit.reason && credit.excessSpecial > 0) {
    return {
      ok: false, error: ALLOCATE_NO_REASON_MSG, minutes: 0, maxMinutes: max,
      freeSpecial, openDeficit, originalDeficit: original, compensatedNow, plannedNow,
      plannedToRelease: 0, plannedAfter: plannedNow, remainingDeficitAfter: openDeficit,
      remainingSpecialAfter: freeSpecial, compensatedAfter: compensatedNow,
    };
  }
  if (!Number.isFinite(requestedMinutes) || requestedMinutes <= 0) {
    return {
      ok: false, error: "Quantidade de minutos inválida.", minutes: 0, maxMinutes: max,
      freeSpecial, openDeficit, originalDeficit: original, compensatedNow, plannedNow,
      plannedToRelease: 0, plannedAfter: plannedNow, remainingDeficitAfter: openDeficit,
      remainingSpecialAfter: freeSpecial, compensatedAfter: compensatedNow,
    };
  }
  if (requestedMinutes > max) {
    return {
      ok: false,
      error: `Só é possível alocar ${formatMinutes(max)} neste déficit (excedente livre ${formatMinutes(freeSpecial)} · restante factual ${formatMinutes(openDeficit)}).`,
      minutes: 0, maxMinutes: max, freeSpecial, openDeficit, originalDeficit: original,
      compensatedNow, plannedNow, plannedToRelease: 0, plannedAfter: plannedNow,
      remainingDeficitAfter: openDeficit, remainingSpecialAfter: freeSpecial, compensatedAfter: compensatedNow,
    };
  }
  const compensatedAfter = compensatedNow + requestedMinutes;
  const remainingDeficitAfter = Math.max(0, original - compensatedAfter);
  const plannedAfter = Math.min(plannedNow, remainingDeficitAfter);
  return {
    ok: true,
    minutes: requestedMinutes,
    maxMinutes: max,
    freeSpecial,
    openDeficit,
    originalDeficit: original,
    compensatedNow,
    plannedNow,
    plannedToRelease: plannedNow - plannedAfter,
    plannedAfter,
    remainingDeficitAfter,
    remainingSpecialAfter: freeSpecial - requestedMinutes,
    compensatedAfter,
  };
}

/* ── Contabilidade do excedente ESPECIAL (realizado × programado) ─ */

export type SpecialExcessStatus = "livre" | "programado" | "parcial" | "tratado";

export interface SpecialExcessLedger {
  original: number;
  /** Parcelas CONCLUÍDAS que consomem a reserva (não inclui planejado). */ 
  realized: number;
  /** Destinação futura ainda pendente. */
  planned: number;
  /** Livre para nova alocação (original − realizado − planejado). */
  free: number;
  status: SpecialExcessStatus;
  /** Destinos CONCLUÍDOS: déficit ← este dia. */
  realizedTo: { date: string; minutes: number; portion: "especial" | "regular" }[];
  /** Destinos apenas PLANEJADOS. */
  plannedTo: { date: string; minutes: number }[];
}

function consumesSpecialFrom(date: string, c: Compensation): boolean {
  if (c.status === "cancelada") return false;
  if (c.targetDate === date && c.portion === "especial") return true;
  if (c.sourceDate === date && kindOf(c) === "excedente") return true;
  return false;
}

/** Status derivado: planejado NUNCA conta como realocado/tratado. */
export function specialExcessStatusOf(original: number, realized: number, planned: number): SpecialExcessStatus {
  if (original <= 0) return "livre";
  if (realized >= original) return "tratado";
  if (realized > 0) return "parcial";
  if (planned > 0) return "programado";
  return "livre";
}

/** Livro-caixa do excedente >10h de UM dia — fonte da Gestão/Compensações. */
export function specialExcessLedger(date: string, comps: Compensation[], original: number): SpecialExcessLedger {
  const related = comps.filter((c) => consumesSpecialFrom(date, c));
  const realizedTo: SpecialExcessLedger["realizedTo"] = [];
  const plannedTo: SpecialExcessLedger["plannedTo"] = [];
  let realized = 0;
  let planned = 0;
  for (const c of related) {
    if (c.status === "concluida") {
      realized += c.minutes;
      realizedTo.push({
        date: kindOf(c) === "excedente" ? c.targetDate : c.sourceDate,
        minutes: c.minutes,
        portion: c.portion === "especial" ? "especial" : "regular",
      });
    } else if (c.status === "pendente") {
      planned += c.minutes;
      plannedTo.push({ date: kindOf(c) === "excedente" ? c.targetDate : c.sourceDate, minutes: c.minutes });
    }
  }
  return {
    original,
    realized,
    planned,
    free: Math.max(0, original - realized - planned),
    status: specialExcessStatusOf(original, realized, planned),
    realizedTo,
    plannedTo,
  };
}
