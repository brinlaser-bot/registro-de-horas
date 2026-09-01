"use client";

// Store client-side com persistência em localStorage.
// Uso pessoal: todos os dados ficam apenas no navegador.
import { useEffect, useState, useSyncExternalStore } from "react";
import { computeDay, formatMinutes, FUTURE_DATE_ERROR, insertPunchError, isFutureDate, regularBalanceMinutes, todayString, type EntryType } from "./time";
import { applyControlStartMigration } from "./control-start";
import { applyDemoIdentityMigration, buildSeedData, createEmptyState, withPreservedIdentity } from "./seed-data";
import { absencesEqual, compsEqual, entriesEqual, excessReasonsEqual, mergeByIdAndContent } from "./backup";
import { actualExtraForDate, allocatedForSource, canCompleteComp, concludedForSource, extraCapacityForDate, kindOf, usesHourExtra, acordoLinkedComps, originalHourExtraDebt, sourcePlanningHeadroom, OVERPLAN_MSG } from "./debt";
import { compensarObligationOnDate, reconcileCompensarComps } from "./compensar";
import {
  ALLOCATE_CROSS_CYCLE_MSG,
  ALLOCATE_NO_REASON_MSG,
  canAllocateExcess,
  eligibleDeficitsForSpecialAllocation,
  planRealizedCreditUse,
  previewAllocateSpecialExcess,
  releaseOverlappingPlanned,
} from "./hour-bank";
import { abonoDayDecision, abonoInCycle, validateAbsence, type Absence, type AbsenceSplit } from "./absences";
import { canRegisterFalta } from "./faltas";
import { getAnnualPointCycle, sameAnnualCycle } from "./periods";
import { companyDayContext, normalizeCompanyCalendars, type CompanyCalendar, type CompanyCalendars } from "./company-calendar";
import { buildResumoDayRow } from "./resumo-days";
import { isProjectableDayStatus, projectRealizedDayOfficial } from "./official-projection";
import {
  allocateSpecialExcessFifo,
  allocateSpecialExcessManual,
  buildSpecialExcessBank,
  type SpecialExcessBankSummary,
} from "./special-excess-bank";
import {
  specialExcessUseMinutes,
  validateSpecialExcessUse,
  activeSpecialExcessUses,
  usedSpecialMinutesByOrigin,
  type SpecialExcessAllocation,
  type SpecialExcessAllocationStrategy,
  type SpecialExcessUse,
} from "./special-excess-use";
import {
  specialExcessPlanMinutes,
  validateSpecialExcessPlan,
  type SpecialExcessPlan,
} from "./special-excess-plan";
import {
  planSpecialExcessReconciliation,
  type SpecialReconciliationPlan,
} from "./special-excess-reconciliation";

/** Resultado estruturado de operações que podem ser rejeitadas por validação. */
export interface ActionResult {
  ok: boolean;
  /** Mensagem pronta para exibição na interface. */
  error?: string;
  code?:
    | "over-capacity"
    | "invalid"
    | "not-found"
    | "cross-cycle"
    | "overlap"
    | "linked-compensations"
    | "falta"
    | "punches"
    | "confirm-replace"
    | "concluded-history"
    | "sequence"
    | "destination-not-eligible"
    | "destination-no-remaining-need"
    | "requested-exceeds-destination-need"
    | "insufficient-special-balance"
    | "invalid-manual-allocation"
    | "origin-not-found"
    | "origin-outside-cycle"
    | "origin-not-realized"
    | "use-not-found"
    | "use-already-cancelled"
    | "period-closed"
    | "invalid-use"
    | "special-release-required"
    | "special-release-cancelled"
    | "destination-not-future"
    | "destination-not-realized"
    | "plan-not-found"
    | "plan-already-cancelled"
    | "plan-already-concluded"
    | "invalid-plan"
    | "destination-no-planning-capacity"
    | "requested-exceeds-planning-capacity";
  /** Capacidade disponível no dia de destino (quando code = over-capacity). */
  available?: number;
  limitMinutes?: number;
  /** Evento atravessa o fechamento anual: sugestão de divisão em 2 registros. */
  split?: AbsenceSplit;
  /**
   * 3G: plano(s) de reconciliação do [10+] exigido(s) pela alteração
   * factual prospectiva (quando code = special-release-required). NADA é
   * persistido junto — a operação só é concluída quando o caller re-invoca
   * o MESMO action com `specialReleaseConfirmed: true`.
   */
  specialReleases?: SpecialReconciliationPlan[];
  /** Operação salva, com aviso informativo (ex.: batidas existentes no período). */
  warning?: string;
}

export const DUPLICATE_SUBMIT_MSG = "Compensação já está sendo registrada.";
const CREATE_DEDUP_MS = 600;
let lastCreateKey = "";
let lastCreateAt = 0;

function isDuplicateCreate(key: string): boolean {
  return key === lastCreateKey && Date.now() - lastCreateAt < CREATE_DEDUP_MS;
}
function rememberCreate(key: string) {
  lastCreateKey = key;
  lastCreateAt = Date.now();
}
function resetCreateGuard() {
  lastCreateKey = "";
  lastCreateAt = 0;
}

const OK: ActionResult = { ok: true };
/** 3G.4: anexa avisos curtos (§10) ao resultado bem-sucedido de uma edição. */
const withWarnings = (res: ActionResult, warnings: string[]): ActionResult =>
  res.ok && warnings.length > 0 ? { ...res, warning: warnings.join(" ") } : res;

const CROSS_CYCLE_MSG =
  "Esta compensação não pode ser realizada porque a origem e o destino pertencem a ciclos anuais diferentes. As compensações devem ocorrer dentro do mesmo ciclo anual.";

/** Regra 14: compensação nunca atravessa o fechamento anual (30/04). */
export function validateCompCycle(sourceDate: string, targetDate: string): ActionResult {
  if (!sameAnnualCycle(sourceDate, targetDate)) {
    return { ok: false, code: "cross-cycle", error: CROSS_CYCLE_MSG };
  }
  return OK;
}
import type {
  AppData,
  CompKind,
  CompStatus,
  Compensation,
  CompWithDays,
  DayResult,
  ExcessReason,
  ExcessReasonCode,
  Falta,
  TimeEntry,
  User,
  WorkSettings,
} from "./types";

const STORAGE_KEY = "meu-horario:data:v1";

const pristine: AppData = createEmptyState();

/** Interpreta o JSON do localStorage. Inválido → null (não apaga o valor persistido). */
export function parseStoredAppData(raw: string): AppData | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AppData> & AppData;
    if (
      !parsed ||
      !parsed.user ||
      !Array.isArray(parsed.entries) ||
      !Array.isArray(parsed.compensations)
    ) {
      return null;
    }
    const absences = Array.isArray(parsed.absences) ? parsed.absences : [];
    const legacy = parsed as unknown as { companyCalendar?: unknown; companyCalendars?: unknown };
    const companyCalendars =
      normalizeCompanyCalendars(legacy.companyCalendars) ??
      normalizeCompanyCalendars(legacy.companyCalendar);
    const faltas = Array.isArray(parsed.faltas) ? parsed.faltas : [];
    const excessReasons = Array.isArray(parsed.excessReasons) ? parsed.excessReasons : [];
    // Dados antigos sem a coleção → [] (nada antigo é apagado ou reinterpretado).
    const specialExcessUses = Array.isArray(parsed.specialExcessUses) ? parsed.specialExcessUses : [];
    // 4A: dados antigos sem planos → [] (retrocompatível; nada é reinterpretado).
    const specialExcessPlans = Array.isArray(parsed.specialExcessPlans) ? parsed.specialExcessPlans : [];
    return {
      user: parsed.user,
      entries: parsed.entries,
      compensations: parsed.compensations,
      absences,
      companyCalendars,
      faltas,
      excessReasons,
      specialExcessUses,
      specialExcessPlans,
    };
  } catch {
    return null;
  }
}

/**
 * Hidrata o estado a partir do storage.
 * - raw existente e válido → preserva (nunca substitui por seed);
 * - storage vazio/ausente → createEmptyState() (produção limpa);
 * - raw inválido → vazio em memória (o caller NÃO deve persistir por cima).
 */
export function hydrateAppData(raw: string | null, today: string = todayString()): AppData {
  if (raw) {
    const parsed = parseStoredAppData(raw);
    if (parsed) return applyDemoIdentityMigration(applyControlStartMigration(parsed, today));
  }
  return createEmptyState(today);
}

let data: AppData = pristine;
let ready = false;
let pendingPersist = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage indisponível (modo privado, cota cheia) — segue apenas em memória
  }
}

/**
 * Hidrata o estado do storage SEM emitir (seguro durante getSnapshot/render).
 * Sem isso, o primeiro getSnapshot devolve `pristine` (controlStartDate = hoje)
 * e Registros calcula −8h em dia vazio antes de ler a data persistida.
 */
function ensureLoaded() {
  if (ready || typeof window === "undefined") return;
  ready = true;
  pendingPersist = false;
  try {
    const today = todayString();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = parseStoredAppData(raw);
      if (parsed) {
        data = applyDemoIdentityMigration(applyControlStartMigration(parsed, today));
        pendingPersist =
          (parsed.user.controlStartDate ?? null) !== (data.user.controlStartDate ?? null) ||
          parsed.user.name !== data.user.name ||
          parsed.user.email !== data.user.email ||
          (parsed.user.birthDate ?? null) !== (data.user.birthDate ?? null);
        return;
      }
      // Storage presente mas ilegível: não sobrescreve o valor persistido.
      data = createEmptyState(today);
      return;
    }
    // Primeiro acesso: estado transacional vazio (seed só via reseed explícito).
    data = createEmptyState(today);
    pendingPersist = true;
  } catch {
    data = createEmptyState();
  }
}

function flushPersist() {
  if (!pendingPersist) return;
  pendingPersist = false;
  persist();
}

function load() {
  const wasReady = ready;
  ensureLoaded();
  flushPersist();
  if (!wasReady) emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  load();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  ensureLoaded();
  return data;
}

function getServerSnapshot() {
  return pristine;
}

function mutate(updater: (d: AppData) => AppData) {
  load();
  data = updater(data);
  persist();
  emit();
}

const nextId = (rows: { id: number }[]) =>
  rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;

/* ─────────────────────────────────────────────────────────────
   NOVO MEU HORÁRIO — BANCO PARALELO [10+] (Etapa 3D)
   Conecta 3A (projeção/elegibilidade) + 3B (SpecialExcessUse) +
   3C (banco/FIFO/manual) à persistência. Sem UI nesta etapa.

   - periodClosed = CONTEXTO DO CALLER: o app ainda NÃO possui estado
     persistido de fechamento oficial; a etapa futura será a fonte.
   - asOfDate = data de corte civil (default todayString()); origem
     futura (após o corte) nunca entra — a fonte factual mascara futuro.
   - now = timestamp injetável (testes determinísticos).
   - Criação/edição são ATÔMICAS: qualquer rejeição devolve o estado
     intacto; nada é persistido parcialmente.
   ───────────────────────────────────────────────────────────── */

const SPECIAL_PERIOD_CLOSED_MSG =
  "O período já está fechado: não é possível criar, editar ou cancelar usos de [10+].";

/** id string do novo modelo: "seu-<n>" (n = maior sufixo numérico + 1, sem colisão). */
const nextSpecialUseId = (rows: SpecialExcessUse[]) =>
  `seu-${rows.reduce((m, u) => Math.max(m, Number(u.id.replace(/\D+/g, "")) || 0), 0) + 1}`;

/* ── ETAPA 4A — PLANOS DE RESERVA FUTURA [10+] (mensagens humanas) ── */

const SPECIAL_PLAN_PERIOD_CLOSED_MSG =
  "O período já está fechado: não é possível criar ou alterar reservas de [10+].";
const SPECIAL_PLAN_FUTURE_MSG =
  "A reserva de [10+] é um planejamento para um dia futuro: não é possível reservar para hoje ou para um dia passado.";
const SPECIAL_PLAN_NOT_FOUND_MSG = "Reserva de [10+] não encontrada.";
const SPECIAL_PLAN_ALREADY_CANCELLED_MSG =
  "Esta reserva de [10+] já foi cancelada; o histórico não pode ser alterado.";
const SPECIAL_PLAN_ALREADY_CONCLUDED_MSG =
  "Esta reserva de [10+] já foi concluída; o histórico não pode ser alterado.";
const SPECIAL_PLAN_CROSS_CYCLE_MSG =
  "A reserva não pode atravessar o fechamento anual (30/04): origem e destino devem pertencer ao mesmo ciclo anual.";

/** id string dos planos: "sep-<n>" (n = maior sufixo numérico + 1, sem colisão). */
const nextSpecialPlanId = (rows: SpecialExcessPlan[]) =>
  `sep-${rows.reduce((m, p) => Math.max(m, Number(p.id.replace(/\D+/g, "")) || 0), 0) + 1}`;

/** Banco [10+] do ciclo do destino, com o uso em edição fora (libera suas allocations).
 *  4A: planos ATIVOS entram como RESERVADO — a disponibilidade por origem é
 *  GERADO − UTILIZADO − RESERVADO (§10/§11): um uso novo/editado nunca rouba
 *  minuto já reservado por um plano ativo. */
function specialBankOf(
  d: AppData,
  destinationDate: string,
  asOf: string,
  excludeUseId: string | null,
): SpecialExcessBankSummary {
  return buildSpecialExcessBank({
    cycle: getAnnualPointCycle(destinationDate),
    asOfDate: asOf,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate ?? "",
    uses: (d.specialExcessUses ?? []).filter((u) => u.id !== excludeUseId),
    plans: (d.specialExcessPlans ?? []).filter((p) => p.status === "planned"),
  });
}

interface SpecialDestinationCheck {
  error: ActionResult | null;
  neededMinutes: number;
  remainingMinutes: number;
}

/**
 * GATE DO DESTINO — a Etapa 3A é a FONTE da regra ("jornada factual válida
 * terminada abaixo da base"); nada é reescrito aqui. O dia só aceita uso
 * se o status do Resumo for projetável E a necessidade restante (base
 * efetiva − registrável − usos ativos no dia) cobrir o pedido; o motor 3A
 * com "uso existente + candidato" confirma (needsReview/excesso → rejeita).
 */
function checkSpecialDestination(
  d: AppData,
  destinationDate: string,
  asOf: string,
  excludeUseId: string | null,
  requestedMinutes: number,
): SpecialDestinationCheck {
  const row = buildResumoDayRow({
    date: destinationDate,
    today: asOf,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate,
  });
  if (!isProjectableDayStatus(row.status)) {
    return {
      error: {
        ok: false,
        code: "destination-not-eligible",
        error:
          "A jornada de " +
          destinationDate +
          " não está elegível para uso de [10+]: só uma jornada factual válida que terminou abaixo da base pode ser completada.",
      },
      neededMinutes: 0,
      remainingMinutes: 0,
    };
  }
  const neededMinutes = Math.max(row.expectedMinutes - row.registrableMinutes, 0);
  const usedHere = (d.specialExcessUses ?? [])
    .filter((u) => u.status === "utilizado" && u.destinationDate === destinationDate && u.id !== excludeUseId)
    .reduce((s, u) => s + specialExcessUseMinutes(u), 0);
  const remainingMinutes = Math.max(neededMinutes - usedHere, 0);
  // Motor 3A: uso existente + novo candidato. Excesso/needsReview → rejeitar.
  const projected = projectRealizedDayOfficial({
    date: destinationDate,
    factualWorkedMinutes: row.workedMinutes,
    factualRegistrableMinutes: row.registrableMinutes,
    factualRegularBalanceMinutes: row.balanceMinutes,
    effectiveBaseMinutes: row.expectedMinutes,
    financialValid: isProjectableDayStatus(row.status),
    realized: row.entryCount > 0 && destinationDate <= asOf,
    usedSpecialMinutes: usedHere + requestedMinutes,
  });
  if (!projected.projectable || projected.needsReview) {
    return {
      error: {
        ok: false,
        code: remainingMinutes <= 0 ? "destination-no-remaining-need" : "requested-exceeds-destination-need",
        error:
          remainingMinutes <= 0
            ? "A jornada de " + destinationDate + " já foi totalmente completada pelos usos ativos de [10+]."
            : "A jornada de " +
              destinationDate +
              " só aceita mais " +
              formatMinutes(remainingMinutes) +
              " de [10+] (pedido: " +
              formatMinutes(requestedMinutes) +
              ").",
        limitMinutes: remainingMinutes,
      },
      neededMinutes,
      remainingMinutes,
    };
  }
  return { error: null, neededMinutes, remainingMinutes };
}

/**
 * Validação da seleção MANUAL (reutiliza a 3C para disponibilidade), com
 * erros mais específicos: origem futura vs. inexistente vs. outro ciclo.
 * Devolve as allocations normalizadas (uma por origem, ordem do usuário).
 */
function validateManualSelection(
  bank: SpecialExcessBankSummary,
  destinationDate: string,
  asOf: string,
  requested: SpecialExcessAllocation[],
): { error: ActionResult | null; allocations: SpecialExcessAllocation[] } {
  if (requested.length === 0) {
    return { error: { ok: false, code: "invalid-manual-allocation", error: "Informe ao menos uma origem na seleção manual." }, allocations: [] };
  }
  const totals = new Map<string, number>();
  for (const a of requested) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.originDate) || !Number.isInteger(a.minutes) || a.minutes <= 0) {
      return {
        error: { ok: false, code: "invalid-manual-allocation", error: `Seleção manual inválida: ${a.originDate} = ${a.minutes}min.` },
        allocations: [],
      };
    }
    totals.set(a.originDate, (totals.get(a.originDate) ?? 0) + a.minutes);
  }
  const lotByDate = new Map(bank.lots.map((l) => [l.originDate, l]));
  for (const originDate of totals.keys()) {
    if (originDate > asOf) {
      return {
        error: {
          ok: false,
          code: "origin-not-realized",
          error: `A origem ${originDate} ainda não é um dia realizado (corte ${asOf}); o [10+] só pode vir de jornadas já realizadas.`,
        },
        allocations: [],
      };
    }
    if (getAnnualPointCycle(originDate) !== bank.cycle) {
      return {
        error: {
          ok: false,
          code: "origin-outside-cycle",
          error: `A origem ${originDate} pertence a outro ciclo anual (${getAnnualPointCycle(originDate)}); o [10+] não atravessa o fechamento em 30/04.`,
        },
        allocations: [],
      };
    }
    if (!lotByDate.has(originDate)) {
      return {
        error: {
          ok: false,
          code: "origin-not-found",
          error: `A origem ${originDate} não existe no banco [10+] do ciclo ${bank.cycle} (sem geração ou uso registrado naquela data).`,
        },
        allocations: [],
      };
    }
  }
  // Disponibilidade por origem (3C) — sem clamping, sem substituição.
  const manual = allocateSpecialExcessManual({ bank, destinationDate, requestedAllocations: requested });
  if (!manual.ok) {
    if (manual.error === "disponibilidade-insuficiente") {
      const detalhe = (manual.insufficient ?? [])
        .map((x) => `${x.originDate}: pedido ${x.requested}min, disponível ${x.available}min`)
        .join(", ");
      const primeira = (manual.insufficient ?? [])[0];
      return {
        error: {
          ok: false,
          code: "insufficient-special-balance",
          error: `Disponibilidade insuficiente no banco [10+] do ciclo ${bank.cycle}: ${detalhe}.`,
          available: primeira?.available,
          limitMinutes: primeira?.available,
        },
        allocations: [],
      };
    }
    return { error: { ok: false, code: "invalid-manual-allocation", error: `Seleção manual inválida: ${manual.error}.` }, allocations: [] };
  }
  return { error: null, allocations: manual.allocations };
}

const insufficientFifoMsg = (bank: SpecialExcessBankSummary, requested: number, allocated: number, unfulfilled: number) =>
  `O banco [10+] do ciclo ${bank.cycle} tem apenas ${formatMinutes(allocated)} disponíveis; solicitados ${formatMinutes(requested)} (faltam ${formatMinutes(unfulfilled)}).`;

const CONCLUDED_COMP_MSG =
  "Este horário já sustenta uma compensação concluída. A alteração reduziria as horas utilizadas e não pode ser aplicada automaticamente.";

const CONCLUDED_TARGET_MSG =
  "Este registro sustenta compensações já concluídas. A alteração reduziria as horas utilizadas e não pode ser aplicada.";

/**
 * GUARDA DE HISTÓRICO CONCLUÍDO — LADO DA ORIGEM: o dia `date` pode ser
 * ORIGEM de compensações já CONCLUÍDAS, sustentadas pelas horas do dia. Se a
 * edição reduzir a dívida do dia (excedente/déficit/acordo pela resolução
 * central) abaixo do total já utilizado por compensações concluídas, a
 * alteração é BLOQUEADA — nunca cancela/reabre histórico automaticamente.
 * Recebe o estado JÁ com a edição simulada (entries finais).
 */
function concludedCompGuard(d: AppData, date: string): ActionResult | null {
  const cctx = companyDayContext(date, d.entries, d.absences, d.companyCalendars, settingsOf(d.user));
  // acordo/calendário COMPENSAR: a batida pode reduzir a obrigação efetiva
  // abaixo do já concluído — reconciliação libera o excedente (não bloqueia).
  const debts: [CompKind, number][] = [
    ["excedente", cctx.ctx.day.excessMinutes],
    ["deficit", cctx.adjustedDeficit],
  ];
  for (const [kind, debt] of debts) {
    if (concludedForSource(d.compensations, date, kind) > Math.max(0, debt)) {
      return { ok: false, code: "concluded-history", error: CONCLUDED_COMP_MSG };
    }
  }
  return null;
}

/**
 * GUARDA CENTRAL DE CAPACIDADE CONSUMIDA — LADO DO DESTINO (§23/§24): o dia
 * `date` pode ser o DESTINO onde compensações CONCLUÍDAS realizaram hora
 * extra. Antes de editar/excluir batidas, simula-se o resultado final do dia:
 * se a NOVA capacidade real (hora extra existente: trabalhado − base efetiva)
 * ficar abaixo do total já CONSUMIDO por concluídas nesse dia, BLOQUEIA.
 * É quantitativa — edições seguras (que mantêm ou aumentam a capacidade)
 * continuam permitidas (§26).
 */
function concludedTargetGuard(d: AppData, date: string): ActionResult | null {
  const consumed = d.compensations
    .filter((c) => c.targetDate === date && c.status === "concluida" && usesHourExtra(kindOf(c)))
    .reduce((s, c) => s + c.minutes, 0);
  if (consumed <= 0) return null;
  const capacity = actualExtraForDate(date, d.entries, settingsOf(d.user), {
    companyCalendars: d.companyCalendars,
  });
  if (consumed > capacity) {
    return { ok: false, code: "concluded-history", error: CONCLUDED_TARGET_MSG };
  }
  return null;
}

/** Roda as duas guardas (origem + destino) para um dia, no estado simulado. */
function concludedGuardsFor(d: AppData, date: string): ActionResult | null {
  return concludedCompGuard(d, date) ?? concludedTargetGuard(d, date);
}

function withCompensarReconcile(d: AppData, date: string): AppData {
  const settings = settingsOf(d.user);
  const view = compensarObligationOnDate(
    date, d.entries, d.compensations, d.absences, d.companyCalendars, settings, todayString(),
  );
  if (!view) return d;
  const comps = reconcileCompensarComps(d.compensations, view);
  return comps === d.compensations ? d : { ...d, compensations: comps };
}

/* ─────────────────────────────────────────────────────────────
   ETAPA 3G — RECONCILIAÇÃO DO [10+] APÓS ALTERAÇÃO DA JORNADA
   FACTUAL (gate central de liberação).

   Mesma arquitetura das guardas de compensação concluída: o action
   simula o resultado final das batidas e avalia o IMPACTO
   PROSPECTIVO no [10+] do dia (regra-mãe: uso ativo ≤ necessidade 3A
   do dia prospectivo). A liberação NUNCA é silenciosa (§6):

   - 1ª chamada (sem confirmação): NADA persiste; o action devolve
     code "special-release-required" + plano(s) para a UI confirmar;
   - "Voltar": nada mudou (a 1ª chamada já não alterou estado);
   - 2ª chamada (specialReleaseConfirmed): o MESMO action revalida
     tudo e aplica batidas + reconciliação num ÚNICO mutate (§8) —
     não existe frame persistido com factual novo e uso antigo (§40/W).
   ───────────────────────────────────────────────────────────── */

const SPECIAL_RELEASE_REQUIRED_MSG =
  "Esta alteração reduz a necessidade de [10+] deste dia e exige confirmação.";

/**
 * Planos de reconciliação exigidos pela alteração prospectiva — UM por
 * data afetada que possua usos ativos cujo uso exceda a nova necessidade.
 * Fonte factual prospectiva: buildResumoDayRow (a MESMA fonte central do
 * Resumo/3A) sobre as entries simuladas — nenhum cálculo paralelo.
 */
function specialReleasePlansFor(
  d: AppData,
  affected: Array<{ date: string; entries: TimeEntry[] }>,
): SpecialReconciliationPlan[] {
  const active = activeSpecialExcessUses(d.specialExcessUses ?? []);
  if (active.length === 0) return [];
  const today = todayString();
  const settings = settingsOf(d.user);
  const plans: SpecialReconciliationPlan[] = [];
  for (const { date, entries } of affected) {
    const usesOfDate = active.filter((u) => u.destinationDate === date); // §26: só o próprio destino
    if (usesOfDate.length === 0) continue;
    const row = buildResumoDayRow({
      date,
      today,
      entries,
      absences: d.absences,
      calendars: d.companyCalendars,
      settings,
      faltas: d.faltas,
      controlStartDate: d.user.controlStartDate ?? null,
    });
    const plan = planSpecialExcessReconciliation({
      destinationDate: date,
      prospectiveStatus: row.status,
      prospectiveWorkedMinutes: row.workedMinutes,
      prospectiveBaseMinutes: row.expectedMinutes,
      prospectiveRegistrableMinutes: row.registrableMinutes,
      uses: usesOfDate,
    });
    if (plan.needsReconciliation) plans.push(plan);
  }
  return plans;
}

/**
 * Aplica as decisões do plano no MESMO mutate da alteração factual.
 * Histórico NUNCA é apagado (§13/§14/§19):
 *  - "cancel"  → status "cancelado" (+ cancelledAt/updatedAt);
 *  - "reduce"  → o original é cancelado (id/allocations/strategy/createdAt/
 *                nota preservados) e uma versão ATIVA reconciliada é criada
 *                com o PREFIXO das allocations históricas, na MESMA
 *                estratégia e SEM origens novas (fifo continua fifo, manual
 *                continua manual).
 */
function applySpecialReconciliationPlans(
  d: AppData,
  plans: SpecialReconciliationPlan[],
  nowTs: number,
): AppData {
  if (plans.length === 0) return d;
  let uses = d.specialExcessUses ?? [];
  for (const plan of plans) {
    for (const dec of plan.decisions) {
      if (dec.action === "keep") continue;
      const original = uses.find((u) => u.id === dec.useId && u.status === "utilizado");
      if (!original) continue; // idempotência defensiva (nunca esperado)
      uses = uses.map((u) =>
        u.id === dec.useId
          ? { ...u, status: "cancelado" as const, cancelledAt: nowTs, updatedAt: nowTs }
          : u,
      );
      if (dec.action === "reduce") {
        const keptTotal = dec.keepAllocations.reduce((s, a) => s + a.minutes, 0);
        const reconciled: SpecialExcessUse = {
          id: nextSpecialUseId(uses),
          destinationDate: original.destinationDate,
          allocations: dec.keepAllocations,
          allocationStrategy: original.allocationStrategy,
          status: "utilizado",
          createdAt: nowTs,
          note: `Uso reconciliado após alteração da jornada (original ${original.id}: ${specialExcessUseMinutes(original)}min → ${keptTotal}min).`,
        };
        const v = validateSpecialExcessUse(reconciled);
        if (!v.ok) {
          // Defensivo: prefixo do próprio uso preserva origens, ciclo e
          // estratégia — nunca deve ocorrer. Neste caso mantém só o
          // cancelamento (nunca um uso inválido no estado).
          uses = [...uses];
        } else {
          uses = [...uses, reconciled];
        }
      }
    }
  }
  return { ...d, specialExcessUses: uses };
}

/* ─────────────────────────────────────────────────────────────
   ETAPA 3G.4 — ORIGEM [10+] REDUZIDA/ELIMINADA ENQUANTO EM USO.

   Estende o fluxo 3G (sem segundo motor): após editar batidas de um
   dia ORIGEM, a geração [10+] daquele dia pode diminuir. Usos ATIVOS
   com allocation dessa origem precisam de lastro real:

   - MANUAL: a escolha do usuário é intocável — mantém apenas a parcela
     com lastro (trim), NUNCA troca de origem; redução parcial segue o
     padrão 3G (original cancelado + versão ativa reconciliada);
   - AUTOMÁTICO (fifo): preserva o TOTAL decidido redistribuindo as
     allocations pelo motor FIFO existente (3C) sobre origens ainda
     válidas — nunca aumenta o total; sem lastro suficiente, reduz
     (mesmo padrão de histórico da 3G).

   Determinismo: usos mais ANTIGOS primeiro (createdAt asc — o mesmo
   critério da reconciliação de destino da 3G). Tudo acontece no MESMO
   mutate da edição (atomicidade) e devolve avisos curtos para a UI.
   Histórico NUNCA é apagado; motivo registrado na nota (append).
   ───────────────────────────────────────────────────────────── */

const ORIGIN_RECONCILE_NOTE = "Reconciliado: a geração [10+] da origem diminuiu após edição da jornada.";

/**
 * Reconcilia usos ativos cujas allocations partem de origens afetadas
 * pela edição (3G.4). Função PURA sobre o estado simulado: devolve o
 * MESMO objeto quando nada precisa mudar; `warnings` recebe feedback
 * curto para a interface (§10). Sem persistência, sem fatos alterados.
 */
function reconcileSpecialOrigins(
  d: AppData,
  affectedDates: string[],
  nowTs: number,
  warnings: string[],
): AppData {
  const affectedOrigins = new Set(affectedDates);
  const active = (d.specialExcessUses ?? []).filter(
    (u) => u.status === "utilizado" && u.allocations.some((a) => affectedOrigins.has(a.originDate)),
  );
  if (active.length === 0) return d;

  const asOf = todayString();
  const settings = settingsOf(d.user);
  // Geração ATUAL por origem (mesma fonte 3C do banco — estado simulado).
  // CLASSE B (4A.1): aqui o banco é consultado SOMENTE pela geração factual
  // (lotes), por isso uses/plans vazios — não representa disponibilidade.
  const genByOrigin = new Map<string, number>();
  const cycles = new Set<string>([...affectedOrigins].map(getAnnualPointCycle));
  for (const cycle of cycles) {
    const bank = buildSpecialExcessBank({
      cycle,
      asOfDate: asOf,
      entries: d.entries,
      absences: d.absences,
      calendars: d.companyCalendars,
      settings,
      faltas: d.faltas,
      controlStartDate: d.user.controlStartDate ?? "",
      uses: [],
      plans: [],
    });
    for (const lot of bank.lots) genByOrigin.set(lot.originDate, lot.generatedMinutes);
  }
  // Capacidade restante por origem afetada (default 0: origem sem lote).
  const remaining = new Map<string, number>();
  for (const o of affectedOrigins) remaining.set(o, genByOrigin.get(o) ?? 0);

  // Critério determinístico existente (3G): usos mais antigos primeiro.
  const ordered = [...active].sort((a, b) => a.createdAt - b.createdAt);

  const cancelledOriginalIds = new Set<string>();
  const inPlaceUpdates = new Map<string, SpecialExcessAllocation[]>();
  const reconciledCreates: Array<Pick<SpecialExcessUse, "destinationDate" | "allocations" | "allocationStrategy" | "note">> = [];
  const processedFinals: SpecialExcessUse[] = []; // reservas p/ FIFO dos próximos usos

  for (const use of ordered) {
    let changed = false;
    const trimmed: SpecialExcessAllocation[] = [];
    for (const a of use.allocations) {
      if (!affectedOrigins.has(a.originDate)) {
        trimmed.push(a);
        continue;
      }
      const cap = remaining.get(a.originDate) ?? 0;
      const keep = Math.min(a.minutes, cap);
      remaining.set(a.originDate, cap - keep);
      if (keep < a.minutes) changed = true;
      if (keep > 0) trimmed.push({ originDate: a.originDate, minutes: keep });
    }
    let finalAllocs = trimmed;
    const originalTotal = use.allocations.reduce((s, x) => s + x.minutes, 0);
    // AUTOMÁTICO: tentar preservar o TOTAL pelo FIFO (3C) — nunca aumentar.
    if (use.allocationStrategy === "fifo" && changed) {
      const trimmedTotal = trimmed.reduce((s, x) => s + x.minutes, 0);
      if (trimmedTotal < originalTotal) {
        const bank = buildSpecialExcessBank({
          cycle: getAnnualPointCycle(use.destinationDate),
          asOfDate: asOf,
          entries: d.entries,
          absences: d.absences,
          calendars: d.companyCalendars,
          settings,
          faltas: d.faltas,
          controlStartDate: d.user.controlStartDate ?? "",
          uses: processedFinals,
          // 4A.1 (classe A): a recomposição FIFO é CAPACIDADE para o uso —
          // minuto reservado por plano ativo não pode ser consumido aqui.
          plans: (d.specialExcessPlans ?? []).filter((pl) => pl.status === "planned"),
        });
        const fifo = allocateSpecialExcessFifo({ bank, destinationDate: use.destinationDate, requestedMinutes: originalTotal });
        if (!fifo.error && fifo.allocatedMinutes > trimmedTotal) finalAllocs = fifo.allocations;
      }
    }
    if (finalAllocs.length > 0) processedFinals.push({ ...use, allocations: finalAllocs });
    if (!changed) continue;

    const finalTotal = finalAllocs.reduce((s, x) => s + x.minutes, 0);
    if (finalTotal === originalTotal && use.allocationStrategy === "fifo") {
      // Total preservado: redistribuição in-place do uso automático.
      inPlaceUpdates.set(use.id, finalAllocs);
      warnings.push(
        `As origens automáticas de ${formatMinutes(originalTotal)} de [10+] foram redistribuídas após a alteração da jornada.`,
      );
    } else if (finalTotal > 0) {
      // Redução parcial: original fica no histórico; versão ativa reconciliada.
      cancelledOriginalIds.add(use.id);
      reconciledCreates.push({
        destinationDate: use.destinationDate,
        allocations: finalAllocs,
        allocationStrategy: use.allocationStrategy,
        note: `Uso reconciliado após redução da geração [10+] na origem (original ${use.id}: ${formatMinutes(originalTotal)} → ${formatMinutes(finalTotal)}).`,
      });
      warnings.push(
        `A origem de [10+] foi reduzida. ${formatMinutes(finalTotal)} permanecem utilizados e ${formatMinutes(originalTotal - finalTotal)} deixaram de ser aplicados.`,
      );
    } else {
      cancelledOriginalIds.add(use.id);
      warnings.push(
        `${formatMinutes(originalTotal)} de [10+] deixaram de estar disponíveis após a alteração da jornada e o uso vinculado foi ajustado.`,
      );
    }
  }

  if (cancelledOriginalIds.size === 0 && inPlaceUpdates.size === 0) return d;

  let uses = d.specialExcessUses ?? [];
  // 1) Cancelamento histórico com motivo anexado (não destrutivo).
  uses = uses.map((u) =>
    cancelledOriginalIds.has(u.id)
      ? {
          ...u,
          status: "cancelado" as const,
          cancelledAt: nowTs,
          updatedAt: nowTs,
          note: u.note ? `${u.note} · ${ORIGIN_RECONCILE_NOTE}` : ORIGIN_RECONCILE_NOTE,
        }
      : u,
  );
  // 2) Redistribuição in-place (uso automático com total preservado).
  uses = uses.map((u) =>
    inPlaceUpdates.has(u.id) ? { ...u, allocations: inPlaceUpdates.get(u.id)!, updatedAt: nowTs } : u,
  );
  // 3) Versões ativas reconciliadas (validadas; defensivo: nunca inválida).
  for (const rc of reconciledCreates) {
    const candidate: SpecialExcessUse = {
      id: nextSpecialUseId(uses),
      destinationDate: rc.destinationDate,
      allocations: rc.allocations,
      allocationStrategy: rc.allocationStrategy,
      status: "utilizado",
      createdAt: nowTs,
      note: rc.note,
    };
    if (!validateSpecialExcessUse(candidate).ok) continue;
    uses = [...uses, candidate];
  }
  return { ...d, specialExcessUses: uses };
}

/* ─────────────────────────────────────────────────────────────
   ETAPA 4A — ORIGEM [10+] REDUZIDA/ELIMINADA ENQUANTO RESERVADA.

   Estende o MESMO fluxo 3G.4 (sem segundo motor) aos PLANOS de
   reserva. Prioridade canônica (§19): USO REALIZADO > PLANO FUTURO —
   esta função roda DEPOIS de reconcileSpecialOrigins no MESMO mutate,
   então a capacidade restante para planos é sempre:

     geração factual atual da origem − minutos em USOS ativos

   ou seja: o uso realizado é lastreado primeiro; só o remanescente
   sustenta reservas futuras. Nunca se invalida um uso para preservar
   uma reserva.

   - MANUAL (§17): a origem escolhida NUNCA é substituída — mantém
     somente a parcela com lastro (trim na mesma origem); redução
     parcial segue o padrão 3G/3G.4 (original cancelado + versão ativa
     reconciliada, histórico/auditabilidade preservados); zerada →
     plano cancelado explicitamente (nunca migram origem);
   - AUTOMÁTICO (§18): tenta preservar o TOTAL recompondo pelo FIFO
     canônico (3C) sobre origens válidas do MESMO ciclo, respeitando
     usos ativos e os DEMAIS planos ativos; nunca aumenta o total do
     plano; sem lastro suficiente, reduz (nunca inventa saldo); total
     preservado → redistribuição in-place (mesmo id).
   Determinismo (§21): planos mais ANTIGOS primeiro (createdAt ASC — o
   mesmo critério da 3G/3G.4). Avisos curtos (§10) para a UI. Histórico
   NUNCA é apagado; motivo registrado na nota (append).
   ───────────────────────────────────────────────────────────── */

function reconcileSpecialPlanOrigins(
  d: AppData,
  affectedDates: string[],
  nowTs: number,
  warnings: string[],
): AppData {
  const affectedOrigins = new Set(affectedDates);
  const allPlans = d.specialExcessPlans ?? [];
  const active = allPlans.filter(
    (p) => p.status === "planned" && p.allocations.some((a) => affectedOrigins.has(a.originDate)),
  );
  if (active.length === 0) return d;

  const asOf = todayString();
  const settings = settingsOf(d.user);
  // Geração ATUAL por origem (mesma fonte 3C do banco — estado simulado).
  // CLASSE B (4A.1): consulta SOMENTE a geração factual (lotes) — o lastro
  // real de planos é composto abaixo com usos ativos (§19); disponibilidade
  // não é representada aqui.
  const genByOrigin = new Map<string, number>();
  const cycles = new Set<string>([...affectedOrigins].map(getAnnualPointCycle));
  for (const cycle of cycles) {
    const bank = buildSpecialExcessBank({
      cycle,
      asOfDate: asOf,
      entries: d.entries,
      absences: d.absences,
      calendars: d.companyCalendars,
      settings,
      faltas: d.faltas,
      controlStartDate: d.user.controlStartDate ?? "",
      uses: [],
      plans: [],
    });
    for (const lot of bank.lots) genByOrigin.set(lot.originDate, lot.generatedMinutes);
  }
  // §19 PRIORIDADE: usos ativos (JÁ reconciliados neste mutate pelo 3G.4)
  // consomem a capacidade primeiro; o remanescente sustenta as reservas.
  const usedActive = usedSpecialMinutesByOrigin(d.specialExcessUses ?? []);
  const remaining = new Map<string, number>();
  for (const o of affectedOrigins) {
    remaining.set(o, Math.max(0, (genByOrigin.get(o) ?? 0) - (usedActive[o] ?? 0)));
  }

  // Planos ativos fora do conjunto de trabalho (outras origens) — entram
  // como verdade no banco do FIFO (nunca recompor sobre reserva alheia).
  const worksetIds = new Set(active.map((p) => p.id));
  const untouchedPlans = allPlans.filter((p) => p.status === "planned" && !worksetIds.has(p.id));

  // Critério determinístico existente (3G/3G.4): mais antigos primeiro.
  const ordered = [...active].sort((a, b) => a.createdAt - b.createdAt);

  const cancelledIds = new Set<string>();
  const inPlaceUpdates = new Map<string, SpecialExcessAllocation[]>();
  const reconciledCreates: Array<Pick<SpecialExcessPlan, "destinationDate" | "allocations" | "selectionMode" | "note">> = [];
  const processedFinals: SpecialExcessPlan[] = []; // reservas finais p/ FIFO dos próximos planos

  for (const plan of ordered) {
    let changed = false;
    const trimmed: SpecialExcessAllocation[] = [];
    for (const a of plan.allocations) {
      if (!affectedOrigins.has(a.originDate)) {
        trimmed.push(a);
        continue;
      }
      const cap = remaining.get(a.originDate) ?? 0;
      const keep = Math.min(a.minutes, cap);
      remaining.set(a.originDate, cap - keep);
      if (keep < a.minutes) changed = true;
      if (keep > 0) trimmed.push({ originDate: a.originDate, minutes: keep });
    }
    let finalAllocs = trimmed;
    const originalTotal = plan.allocations.reduce((s, x) => s + x.minutes, 0);
    // AUTOMÁTICO: tentar preservar o TOTAL pelo FIFO (3C) — nunca aumentar.
    if (plan.selectionMode === "automatic" && changed) {
      const trimmedTotal = trimmed.reduce((s, x) => s + x.minutes, 0);
      if (trimmedTotal < originalTotal) {
        const bank = buildSpecialExcessBank({
          cycle: getAnnualPointCycle(plan.destinationDate),
          asOfDate: asOf,
          entries: d.entries,
          absences: d.absences,
          calendars: d.companyCalendars,
          settings,
          faltas: d.faltas,
          controlStartDate: d.user.controlStartDate ?? "",
          uses: d.specialExcessUses ?? [], // §19: usos primeiro (pós-3G.4)
          plans: [...untouchedPlans, ...processedFinals], // o próprio plano fica fora
        });
        const fifo = allocateSpecialExcessFifo({ bank, destinationDate: plan.destinationDate, requestedMinutes: originalTotal });
        if (!fifo.error && fifo.allocatedMinutes > trimmedTotal) finalAllocs = fifo.allocations;
      }
    }
    if (finalAllocs.length > 0) processedFinals.push({ ...plan, allocations: finalAllocs });
    if (!changed) continue;

    const finalTotal = finalAllocs.reduce((s, x) => s + x.minutes, 0);
    if (finalTotal === originalTotal && plan.selectionMode === "automatic") {
      // Total preservado: redistribuição in-place do plano automático.
      inPlaceUpdates.set(plan.id, finalAllocs);
      warnings.push(
        `As origens da reserva de ${formatMinutes(originalTotal)} de [10+] foram redistribuídas após a alteração da jornada.`,
      );
    } else if (finalTotal > 0) {
      // Redução parcial: original fica no histórico; versão ativa reconciliada.
      cancelledIds.add(plan.id);
      reconciledCreates.push({
        destinationDate: plan.destinationDate,
        allocations: finalAllocs,
        selectionMode: plan.selectionMode,
        note: `Plano reconciliado após redução da geração [10+] na origem (original ${plan.id}: ${formatMinutes(originalTotal)} → ${formatMinutes(finalTotal)}).`,
      });
      warnings.push(
        `A origem de [10+] foi reduzida. ${formatMinutes(finalTotal)} permanecem reservados e ${formatMinutes(originalTotal - finalTotal)} deixaram de estar reservados.`,
      );
    } else {
      cancelledIds.add(plan.id);
      warnings.push(
        `${formatMinutes(originalTotal)} de [10+] deixaram de estar disponíveis após a alteração da jornada e a reserva vinculada foi cancelada.`,
      );
    }
  }

  if (cancelledIds.size === 0 && inPlaceUpdates.size === 0) return d;

  let plans = allPlans;
  // 1) Cancelamento histórico com motivo anexado (não destrutivo).
  plans = plans.map((p) =>
    cancelledIds.has(p.id)
      ? {
          ...p,
          status: "cancelled" as const,
          cancelledAt: nowTs,
          updatedAt: nowTs,
          note: p.note ? `${p.note} · ${ORIGIN_RECONCILE_NOTE}` : ORIGIN_RECONCILE_NOTE,
        }
      : p,
  );
  // 2) Redistribuição in-place (plano automático com total preservado).
  plans = plans.map((p) =>
    inPlaceUpdates.has(p.id) ? { ...p, allocations: inPlaceUpdates.get(p.id)!, updatedAt: nowTs } : p,
  );
  // 3) Versões ativas reconciliadas (validadas; defensivo: nunca inválida).
  for (const rc of reconciledCreates) {
    const candidate: SpecialExcessPlan = {
      id: nextSpecialPlanId(plans),
      destinationDate: rc.destinationDate,
      allocations: rc.allocations,
      selectionMode: rc.selectionMode,
      status: "planned",
      createdAt: nowTs,
      note: rc.note,
    };
    if (!validateSpecialExcessPlan(candidate).ok) continue;
    plans = [...plans, candidate];
  }
  return { ...d, specialExcessPlans: plans };
}

/** Opções 3G dos actions que alteram batidas. */
interface PunchMutationOpts {
  /** Confirmação humana da liberação de [10+] (2ª chamada, §6/§8). */
  specialReleaseConfirmed?: boolean;
  /** Timestamp injetável (testes). */
  now?: number;
}

export const actions = {
  /**
   * Cria uma batida. REGRA ABSOLUTA: somente em data <= hoje — batida em
   * data futura é rejeitada aqui (não apenas na UI), qualquer que seja a
   * origem (lançamento manual, atalho, QuickPunch, Smart Exit, etc.).
   * Falta prevista futura continua permitida — a regra é só de ponto.
   *
   * VALIDAÇÃO CENTRAL DE SEQUÊNCIA: o RESULTADO FINAL do dia (ordenado
   * cronologicamente, com a nova batida incluída) deve alternar
   * Entrada/Saída — inserções históricas válidas no meio do dia passam;
   * batidas que criariam duas entradas (ou duas saídas) seguidas são
   * rejeitadas com a mensagem central (validatePunchSequence).
   */
  addEntry(p: {
    date: string;
    time: string;
    type: EntryType;
    note: string | null;
    source?: "live" | "manual";
  }, opts?: PunchMutationOpts): ActionResult {
    let result: ActionResult = OK;
    const warnings: string[] = [];
    mutate((d) => {
      if (isFutureDate(p.date)) {
        result = { ok: false, code: "invalid", error: FUTURE_DATE_ERROR };
        return d;
      }
      const created: TimeEntry = { id: nextId(d.entries), ...p, source: p.source ?? "live" };
      // §28: erro CONTEXTUAL — alternância clássica no fim do dia; mensagem
      // específica para horário cronologicamente inválido NO MEIO da sequência.
      const seqError = insertPunchError(
        d.entries.filter((e) => e.date === p.date),
        created,
      );
      if (seqError) {
        result = { ok: false, code: "sequence", error: seqError };
        return d;
      }
      // 3G: impacto PROSPECTIVO no [10+] do dia — liberação nunca é
      // silenciosa; exige confirmação e, quando confirmada, é aplicada
      // no MESMO mutate (batidas + reconciliação coesas, §8).
      const nextEntries = [...d.entries, created];
      const releasePlans = specialReleasePlansFor(d, [{ date: p.date, entries: nextEntries }]);
      if (releasePlans.length > 0 && !opts?.specialReleaseConfirmed) {
        result = { ok: false, code: "special-release-required", error: SPECIAL_RELEASE_REQUIRED_MSG, specialReleases: releasePlans };
        return d; // NADA persiste (§7)
      }
      const ts = opts?.now ?? Date.now();
      let next: AppData = { ...d, entries: nextEntries };
      if (releasePlans.length > 0) next = applySpecialReconciliationPlans(next, releasePlans, ts);
      // 3G.4: origem [10+] com geração reduzida → reconcilia usos dependentes.
      next = reconcileSpecialOrigins(next, [p.date], ts, warnings);
      // 4A: mesma redução de origem → reconcilia reservas (planos) dependentes;
      // roda DEPOIS dos usos: USO REALIZADO > PLANO FUTURO (§19).
      next = reconcileSpecialPlanOrigins(next, [p.date], ts, warnings);
      return withCompensarReconcile(next, p.date);
    });
    return withWarnings(result, warnings);
  },

  /**
   * Cria várias batidas de uma vez (lançamento manual de 1+ períodos).
   * Valida o conjunto RESULTANTE de cada data — a ordem de cadastro não importa.
   */
  addEntries(
    list: Array<{ date: string; time: string; type: EntryType; note: string | null; source?: "live" | "manual" }>,
    opts?: PunchMutationOpts,
  ): ActionResult {
    let result: ActionResult = OK;
    const warnings: string[] = [];
    mutate((d) => {
      if (list.length === 0) {
        result = { ok: false, code: "invalid", error: "Informe ao menos um registro." };
        return d;
      }
      for (const p of list) {
        if (isFutureDate(p.date)) {
          result = { ok: false, code: "invalid", error: FUTURE_DATE_ERROR };
          return d;
        }
      }
      let id = nextId(d.entries);
      const created: TimeEntry[] = list.map((p) => ({
        id: id++,
        date: p.date,
        time: p.time,
        type: p.type,
        note: p.note,
        source: p.source ?? "manual",
      }));
      const byDate = new Map<string, TimeEntry[]>();
      for (const e of created) {
        byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
      }
      for (const [date, extra] of byDate) {
        const seqError = insertPunchError(
          d.entries.filter((e) => e.date === date),
          extra,
        );
        if (seqError) {
          result = { ok: false, code: "sequence", error: seqError };
          return d;
        }
      }
      let next: AppData = { ...d, entries: [...d.entries, ...created] };
      // 3G: gate prospectivo por data afetada (mesmo contrato do addEntry).
      const releasePlans = specialReleasePlansFor(
        d,
        Array.from(byDate.keys()).map((date) => ({ date, entries: next.entries })),
      );
      if (releasePlans.length > 0 && !opts?.specialReleaseConfirmed) {
        result = { ok: false, code: "special-release-required", error: SPECIAL_RELEASE_REQUIRED_MSG, specialReleases: releasePlans };
        return d; // NADA persiste (§7)
      }
      const ts = opts?.now ?? Date.now();
      if (releasePlans.length > 0) next = applySpecialReconciliationPlans(next, releasePlans, ts);
      // 3G.4: origens afetadas pelo conjunto de batidas adicionadas.
      next = reconcileSpecialOrigins(next, Array.from(byDate.keys()), ts, warnings);
      // 4A: reconcilia reservas (planos) nas mesmas origens, após os usos (§19).
      next = reconcileSpecialPlanOrigins(next, Array.from(byDate.keys()), ts, warnings);
      for (const date of byDate.keys()) next = withCompensarReconcile(next, date);
      return next;
    });
    return withWarnings(result, warnings);
  },

  /**
   * Edita uma batida existente. Registros históricos seguem editáveis
   * (hora/tipo/observação, e data quando informada) — mas NUNCA se move um
   * registro para data futura: a mesma regra absoluta se aplica à edição.
   *
   * A edição valida a SEQUÊNCIA CRONOLÓGICA FINAL de cada dia afetado
   * (origem e destino, se a data mudar): o resultado inválido é rejeitado
   * integralmente preservando o registro original. E, se o dia sustentar
   * compensação CONCLUÍDA cujas horas utilizadas a edição reduziria, a
   * alteração é bloqueada pela guarda de histórico (concludedCompGuard).
   */
  updateEntry(id: number, patch: Partial<Pick<TimeEntry, "time" | "type" | "note" | "date">>, opts?: PunchMutationOpts): ActionResult {
    let result: ActionResult = OK;
    const warnings: string[] = [];
    mutate((d) => {
      if (patch.date && isFutureDate(patch.date)) {
        result = { ok: false, code: "invalid", error: FUTURE_DATE_ERROR };
        return d;
      }
      const target = d.entries.find((e) => e.id === id);
      if (!target) {
        result = { ok: false, code: "not-found", error: "Registro não encontrado." };
        return d;
      }
      const next = { ...target, ...patch, edited: true as const };
      // Sequência cronológica final válida em TODOS os dias afetados (§28:
      // mensagem contextual para edição que retrocede na linha do tempo)
      const affectedDates = Array.from(new Set([target.date, next.date]));
      for (const date of affectedDates) {
        const others = d.entries.filter((e) => e.date === date && e.id !== id);
        const seqError = next.date === date ? insertPunchError(others, next) : null;
        if (seqError) {
          result = { ok: false, code: "sequence", error: seqError };
          return d;
        }
      }
      // Guardas de histórico concluído: ORIGEM (dívida sustentada pelo dia) e
      // DESTINO (§23/24 — capacidade real consumida por concluídas no dia)
      const sim = { ...d, entries: d.entries.map((e) => (e.id === id ? next : e)) };
      for (const date of affectedDates) {
        const guard = concludedGuardsFor(sim, date);
        if (guard) {
          result = guard;
          return d;
        }
      }
      let reconciled: AppData = { ...d, entries: sim.entries };
      // 3G: gate prospectivo em TODAS as datas afetadas (origem e destino).
      const releasePlans = specialReleasePlansFor(
        d,
        affectedDates.map((date) => ({ date, entries: sim.entries })),
      );
      if (releasePlans.length > 0 && !opts?.specialReleaseConfirmed) {
        result = { ok: false, code: "special-release-required", error: SPECIAL_RELEASE_REQUIRED_MSG, specialReleases: releasePlans };
        return d; // NADA persiste (§7)
      }
      const ts = opts?.now ?? Date.now();
      if (releasePlans.length > 0) reconciled = applySpecialReconciliationPlans(reconciled, releasePlans, ts);
      // 3G.4: origem [10+] com geração reduzida → reconcilia usos dependentes.
      reconciled = reconcileSpecialOrigins(reconciled, affectedDates, ts, warnings);
      // 4A: reconcilia reservas (planos) nas mesmas origens, após os usos (§19).
      reconciled = reconcileSpecialPlanOrigins(reconciled, affectedDates, ts, warnings);
      for (const date of affectedDates) reconciled = withCompensarReconcile(reconciled, date);
      return reconciled;
    });
    return withWarnings(result, warnings);
  },

  /**
   * Exclui uma batida. §25 MESMA GUARDA CENTRAL do updateEntry (não duplica
   * regra): simula a exclusão e bloqueia quando o dia sustenta compensação
   * concluída — pela ORIGEM (dívida) ou pelo DESTINO (capacidade consumida).
   */
  deleteEntry(id: number, opts?: PunchMutationOpts): ActionResult {
    let result: ActionResult = OK;
    const warnings: string[] = [];
    mutate((d) => {
      const target = d.entries.find((e) => e.id === id);
      if (!target) {
        result = { ok: false, code: "not-found", error: "Registro não encontrado." };
        return d;
      }
      const sim = { ...d, entries: d.entries.filter((e) => e.id !== id) };
      const guard = concludedGuardsFor(sim, target.date);
      if (guard) {
        result = guard;
        return d; // bloqueia: batida sustenta compensação concluída
      }
      // 3G: gate prospectivo — excluir batida também pode reduzir a
      // necessidade do [10+] do dia (mesmo contrato de updateEntry).
      const releasePlans = specialReleasePlansFor(d, [{ date: target.date, entries: sim.entries }]);
      if (releasePlans.length > 0 && !opts?.specialReleaseConfirmed) {
        result = { ok: false, code: "special-release-required", error: SPECIAL_RELEASE_REQUIRED_MSG, specialReleases: releasePlans };
        return d; // NADA persiste (§7)
      }
      const ts = opts?.now ?? Date.now();
      let next: AppData = sim;
      if (releasePlans.length > 0) next = applySpecialReconciliationPlans(next, releasePlans, ts);
      // 3G.4: excluir batida também pode reduzir a geração da origem.
      next = reconcileSpecialOrigins(next, [target.date], ts, warnings);
      // 4A: reconcilia reservas (planos) na mesma origem, após os usos (§19).
      next = reconcileSpecialPlanOrigins(next, [target.date], ts, warnings);
      return withCompensarReconcile(next, target.date);
    });
    return withWarnings(result, warnings);
  },

  /**
   * Cria uma compensação. Para hora extra (deficit), a quantidade NÃO é
   * ajustada silenciosamente: se ultrapassar a capacidade do dia de destino,
   * a operação inteira é REJEITADA (nenhum dado é modificado) e um resultado
   * estruturado é retornado para a interface informar o usuário.
   */
  addComp(p: {
    sourceDate: string;
    targetDate: string;
    minutes: number;
    note: string | null;
    status?: CompStatus;
    kind?: CompKind;
  }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const kind = p.kind ?? "excedente";
      const createKey = `add:${kind}|${p.sourceDate}|${p.targetDate}|${p.minutes}|${p.status ?? "pendente"}`;
      if (isDuplicateCreate(createKey)) {
        result = { ok: false, code: "invalid", error: DUPLICATE_SUBMIT_MSG };
        return d;
      }
      if (!Number.isFinite(p.minutes) || p.minutes <= 0) {
        result = { ok: false, code: "invalid", error: "Quantidade de minutos inválida." };
        return d;
      }
      // Regra 14: barreira absoluta do fechamento anual
      const cycleCheck = validateCompCycle(p.sourceDate, p.targetDate);
      if (!cycleCheck.ok) {
        result = cycleCheck;
        return d;
      }
      // §10.1: destinar a reserva especial (>10h) exige MOTIVO registrado.
      if (kind === "excedente" && p.status !== "cancelada") {
        const gate = canAllocateExcess(p.sourceDate, d.entries, settingsOf(d.user), d.excessReasons);
        if (!gate.ok) {
          result = { ok: false, code: "invalid", error: gate.error };
          return d;
        }
      }
      // Sobreplanejamento: concluído + planejado ativo nunca ultrapassa o original.
      if (usesHourExtra(kind) && (p.status ?? "pendente") === "pendente") {
        const original = originalHourExtraDebt(
          p.sourceDate, kind, d.entries, d.compensations, d.absences, d.companyCalendars, settingsOf(d.user),
        );
        const { unplannedMinutes } = sourcePlanningHeadroom(d.compensations, p.sourceDate, kind, original);
        if (p.minutes > unplannedMinutes) {
          result = {
            ok: false,
            code: "invalid",
            error:
              unplannedMinutes <= 0
                ? OVERPLAN_MSG
                : `Só é possível programar ${formatMinutes(unplannedMinutes)} (ainda sem programação). ${OVERPLAN_MSG}`,
          };
          return d;
        }
      }
      // Regra central: hora extra nunca ultrapassa a capacidade real do dia de destino
      // (déficit, acordo E calendário disputam a mesma hora extra — anti dupla quitação)
      if (usesHourExtra(kind) && p.status !== "cancelada") {
        const cap = extraCapacityForDate(
          p.targetDate,
          d.entries,
          d.compensations,
          settingsOf(d.user),
          { companyCalendars: d.companyCalendars },
        );
        if (p.minutes > cap.available) {
          result = {
            ok: false,
            code: "over-capacity",
            available: cap.available,
            limitMinutes: cap.limitMinutes,
            error: `Não foi possível criar esta compensação. Neste dia existem apenas ${formatMinutes(cap.available)} disponíveis até o limite diário de ${formatMinutes(cap.limitMinutes)}.`,
          };
          return d; // rejeita sem modificar nada
        }
      }
      rememberCreate(createKey);
      return {
        ...d,
        compensations: [
          ...d.compensations,
          {
            id: nextId(d.compensations),
            sourceDate: p.sourceDate,
            targetDate: p.targetDate,
            minutes: p.minutes,
            status: p.status ?? "pendente",
            note: p.note,
            kind,
            createdAt: Date.now(),
          },
        ],
      };
    });
    return result;
  },

  /**
   * Atualiza uma compensação. Quando a alteração toca minutos/destino/tipo
   * (ou reativa uma cancelada) e é hora extra, valida contra a capacidade do
   * dia de destino — rejeitando a operação inteira em vez de ajustar o valor.
   */
  updateComp(id: number, patch: Partial<Omit<Compensation, "id">>): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const target = d.compensations.find((c) => c.id === id);
      if (!target) {
        result = { ok: false, code: "not-found", error: "Compensação não encontrada." };
        return d;
      }
      const next = { ...target, ...patch };
      // Regra 14/17: nunca mover origem/destino para ciclos anuais diferentes
      const cycleCheck = validateCompCycle(next.sourceDate, next.targetDate);
      if (!cycleCheck.ok) {
        result = cycleCheck;
        return d;
      }
      // §10.1: compensação de excedente ativa exige o MOTIVO da reserva especial.
      if ((next.kind ?? "excedente") === "excedente" && next.status !== "cancelada") {
        const gate = canAllocateExcess(next.sourceDate, d.entries, settingsOf(d.user), d.excessReasons);
        if (!gate.ok) {
          result = { ok: false, code: "invalid", error: gate.error };
          return d;
        }
      }
      const kindChanged = (next.kind ?? "excedente") !== (target.kind ?? "excedente");
      const reactivated =
        patch.status !== undefined && patch.status !== "cancelada" && target.status === "cancelada";
      const touchesCapacity =
        (patch.minutes !== undefined && patch.minutes !== target.minutes) ||
        (patch.targetDate !== undefined && patch.targetDate !== target.targetDate) ||
        kindChanged ||
        reactivated;

      // Sobreplanejamento na edição: concluído + planejado ativo nunca ultrapassa o original.
      if (usesHourExtra(next.kind ?? "excedente") && next.status === "pendente") {
        const kind = next.kind ?? "excedente";
        const original = originalHourExtraDebt(
          next.sourceDate, kind, d.entries, d.compensations, d.absences, d.companyCalendars, settingsOf(d.user),
        );
        const { unplannedMinutes } = sourcePlanningHeadroom(
          d.compensations, next.sourceDate, kind, original, id,
        );
        if (next.minutes > unplannedMinutes) {
          result = {
            ok: false,
            code: "invalid",
            error:
              unplannedMinutes <= 0
                ? OVERPLAN_MSG
                : `Só é possível programar ${formatMinutes(unplannedMinutes)} (ainda sem programação). ${OVERPLAN_MSG}`,
          };
          return d;
        }
      }

      if (
        touchesCapacity &&
        usesHourExtra(next.kind ?? "excedente") &&
        next.status !== "cancelada"
      ) {
        const cap = extraCapacityForDate(
          next.targetDate,
          d.entries,
          d.compensations,
          settingsOf(d.user),
          { excludeCompId: id, companyCalendars: d.companyCalendars },
        );
        if (next.minutes > cap.available) {
          result = {
            ok: false,
            code: "over-capacity",
            available: cap.available,
            limitMinutes: cap.limitMinutes,
            error: `Não foi possível atualizar esta compensação. Neste dia existem apenas ${formatMinutes(cap.available)} disponíveis até o limite diário de ${formatMinutes(cap.limitMinutes)}.`,
          };
          return d; // rejeita preservando o valor original
        }
      }
      return {
        ...d,
        compensations: d.compensations.map((c) => (c.id === id ? next : c)),
      };
    });
    return result;
  },

  /**
   * Conclui uma compensação (sempre manualmente). Para hora extra
   * (deficit/acordo) valida novamente pela função central: data de destino
   * alcançada + hora extra REAL existente (descontando outras concluídas no
   * mesmo dia). Se inválido: rejeita integralmente, sem clamp e sem alterar.
   */
  completeComp(id: number): ActionResult {
    load();
    const comp = data.compensations.find((c) => c.id === id);
    if (!comp) {
      return { ok: false, code: "not-found", error: "Compensação não encontrada." };
    }
    const check = canCompleteComp(
      comp,
      data.entries,
      data.compensations,
      settingsOf(data.user),
      todayString(),
      { companyCalendars: data.companyCalendars },
    );
    if (!check.ok) {
      return { ok: false, code: "invalid", error: check.error };
    }
    return actions.updateComp(id, { status: "concluida" });
  },

  deleteComp(id: number) {
    mutate((d) => ({ ...d, compensations: d.compensations.filter((c) => c.id !== id) }));
  },

  /**
   * Registra uma FALTA INTEGRAL (ocorrência de ponto — nunca automática).
   * A validação é o gate central (canRegisterFalta): só datas com jornada
   * efetiva > 0 pela resolução central (folga/abonado/obrigação de calendário/
   * cobertura integral ⇒ bloqueadas), sem batidas e sem falta já registrada.
   * O déficit correspondente é DERIVADO (jornada efetiva do dia, nunca 8h
   * fixas) — falta futura vira "Falta prevista" e não gera déficit até a data.
   */
  addFalta(date: string): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const gate = canRegisterFalta(
        date,
        d.entries,
        d.absences,
        d.companyCalendars,
        settingsOf(d.user),
        d.faltas,
      );
      if (!gate.ok) {
        result = { ok: false, code: "invalid", error: gate.error };
        return d;
      }
      return {
        ...d,
        faltas: [...d.faltas, { id: nextId(d.faltas), date, createdAt: Date.now() }],
      };
    });
    return result;
  },

  /**
   * Remove/cancela uma falta. O déficit derivado dela desaparece junto.
   * NUNCA deixa compensação órfã: se houver compensação ATIVA (pendente ou
   * concluída) de déficit vinculada à data da falta, bloqueia a exclusão —
   * o usuário deve cancelar/ajustar essas compensações primeiro.
   */
  removeFalta(id: number): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const target = d.faltas.find((f) => f.id === id);
      if (!target) {
        result = { ok: false, code: "not-found", error: "Falta não encontrada." };
        return d;
      }
      const linked = d.compensations.some(
        (c) =>
          c.sourceDate === target.date &&
          (c.kind ?? "excedente") === "deficit" &&
          c.status !== "cancelada",
      );
      if (linked) {
        result = {
          ok: false,
          code: "linked-compensations",
          error:
            "Existem compensações vinculadas ao déficit desta falta. Cancele-as primeiro para poder excluir a falta.",
        };
        return d;
      }
      return { ...d, faltas: d.faltas.filter((f) => f.id !== id) };
    });
    return result;
  },

  /**
   * Cria um evento de férias/afastamento. Valida: datas, período parcial,
   * tratamento do acordo, sobreposição com outros eventos e a barreira do
   * fechamento anual (não salva evento único atravessando 30/04 — devolve
   * sugestão de divisão em dois registros independentes).
   */
  addAbsence(
    draft: Omit<Absence, "id" | "createdAt">,
  ): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const v = validateAbsence(draft, d.absences, d.entries, undefined, d.faltas);
      if (!v.ok) {
        result = { ok: false, code: v.code, error: v.error, split: v.split };
        return d;
      }
      const created: Absence = { ...draft, id: nextId(d.absences), createdAt: Date.now() };
      result = v.warning ? { ok: true, warning: v.warning } : OK;
      return { ...d, absences: [...d.absences, created] };
    });
    return result;
  },

  updateAbsence(id: number, patch: Partial<Omit<Absence, "id" | "createdAt">>): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const target = d.absences.find((a) => a.id === id);
      if (!target) {
        result = { ok: false, code: "not-found", error: "Evento não encontrado." };
        return d;
      }
      const next = { ...target, ...patch };
      const v = validateAbsence(next, d.absences, d.entries, id, d.faltas);
      if (!v.ok) {
        result = { ok: false, code: v.code, error: v.error, split: v.split };
        return d;
      }
      result = v.warning ? { ok: true, warning: v.warning } : OK;
      return { ...d, absences: d.absences.map((a) => (a.id === id ? next : a)) };
    });
    return result;
  },

  deleteAbsence(id: number): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const target = d.absences.find((a) => a.id === id);
      if (!target) {
        result = { ok: false, code: "not-found", error: "Evento não encontrado." };
        return d;
      }
      // Preserva histórico: avisa se houver compensações ligadas ao período,
      // mas não apaga nada silenciosamente.
      const linked = d.compensations.filter(
        (c) => c.sourceDate >= target.startDate && c.sourceDate <= target.endDate,
      );
      result =
        linked.length > 0
          ? {
              ok: true,
              warning: `Existem ${linked.length} compensação(ões) ligadas a este período. Elas foram preservadas no histórico.`,
            }
          : OK;
      return { ...d, absences: d.absences.filter((a) => a.id !== id) };
    });
    return result;
  },

  /**
   * ABONO DE ANIVERSÁRIO — único ponto de Definir/Alterar (Configurações).
   * - 1 por ciclo anual: se já existe no ciclo da data, ALTERA o mesmo evento
   *   (mesmo id) — nunca cria segundo;
   * - validação pela MESMA verdade central do modal (abonoDayDecision) +
   *   regras duras de validateAbsence;
   * - regra especial: pode prevalecer sobre "Afastamento acordado —
   *   compensar posteriormente", mas NUNCA silenciosamente: exige
   *   `replaceAcordo: true`; compensações vinculadas CONCLUÍDAS bloqueiam
   *   (histórico preservado); vinculadas ainda ativas são CANCELADAS junto
   *   com o acordo; o dia passa a jornada 0 / saldo 0 / sem obrigação.
   */
  setAbono(p: { date: string; note: string | null; replaceAcordo?: boolean }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
        result = { ok: false, code: "invalid", error: "Informe a data do Abono." };
        return d;
      }
      // Ao ALTERAR, o próprio Abono não pode ser contado como conflito da data
      const existingAbonoId = abonoInCycle(d.absences, p.date)?.id;
      const decision = abonoDayDecision(p.date, {
        absences: d.absences,
        entries: d.entries,
        faltas: d.faltas,
        excludeAbsenceId: existingAbonoId,
      });
      if (decision.status === "blocked") {
        result = { ok: false, code: decision.code, error: decision.error };
        return d;
      }
      let absences = d.absences;
      let compensations = d.compensations;
      if (decision.status === "replace-acordo") {
        const linked = acordoLinkedComps(d.compensations, decision.acordo);
        const actives = linked.filter((c) => c.status !== "cancelada");
        // CASO C: já existe compensação CONCLUÍDA → nunca substituir automaticamente
        if (actives.some((c) => c.status === "concluida")) {
          result = {
            ok: false,
            code: "concluded-history",
            error:
              "Este afastamento já possui horas compensadas concluídas. O Abono não pode substituir automaticamente esse acordo porque existe histórico de compensação realizado.",
          };
          return d;
        }
        if (!p.replaceAcordo) {
          result = {
            ok: false,
            code: "confirm-replace",
            error:
              "Esta data possui um Afastamento acordado — compensar posteriormente. É necessário confirmar explicitamente a substituição pelo Abono de aniversário.",
          };
          return d;
        }
        // CASO B: cancela SOMENTE as compensações pendentes vinculadas a este
        // acordo (déficit comum/calendário/outros acordos permanecem). Então
        // remove o evento acordado — a obrigação correspondente deixa de existir.
        const activeIds = new Set(actives.map((c) => c.id));
        compensations = d.compensations.map((c) =>
          activeIds.has(c.id) ? { ...c, status: "cancelada" as const } : c,
        );
        absences = d.absences.filter((a) => a.id !== decision.acordo.id);
      }
      const existing = abonoInCycle(absences, p.date);
      const draft: Omit<Absence, "id" | "createdAt"> = {
        kind: "abono",
        startDate: p.date,
        endDate: p.date, // sempre um único dia
        duration: "integral",
        note: p.note,
      };
      const v = validateAbsence(draft, absences, d.entries, existing?.id, d.faltas);
      if (!v.ok) {
        result = { ok: false, code: v.code, error: v.error, split: v.split };
        return d;
      }
      if (existing) {
        // Alterar: atualiza o MESMO evento (id preservado) — nunca duplica
        absences = absences.map((a) => (a.id === existing.id ? { ...a, ...draft } : a));
      } else {
        absences = [...absences, { ...draft, id: nextId(absences), createdAt: Date.now() }];
      }
      return { ...d, absences, compensations };
    });
    return result;
  },

  /**
   * Ajusta as compensações de um dia de origem para caberem na nova dívida
   * (após uma correção de registro). Preserva o histórico: reduz os minutos
   * (da mais recente para a mais antiga) e, quando sobra vinculação, cancela
   * em vez de apagar.
   */
  capCompensationsForSource(sourceDate: string, kind: CompKind, maxMinutes: number) {
    mutate((d) => {
      const linked = d.compensations
        .map((c, idx) => ({ c, idx }))
        .filter(
          ({ c }) =>
            c.sourceDate === sourceDate &&
            (c.kind ?? "excedente") === kind &&
            c.status !== "cancelada",
        )
        .sort((a, b) => b.c.createdAt - a.c.createdAt);

      let budget = Math.max(0, maxMinutes);
      const comps = [...d.compensations];

      for (const { c, idx } of linked) {
        if (budget <= 0) {
          comps[idx] = { ...c, status: "cancelada" };
          continue;
        }
        const keep = Math.min(c.minutes, budget);
        comps[idx] = keep > 0 ? { ...c, minutes: keep } : { ...c, status: "cancelada" };
        budget -= keep;
      }

      return { ...d, compensations: comps };
    });
  },

  /**
   * MOTIVO DO EXCEDENTE >10h (§10/§11): um registro por data (upsert).
   * Obrigatório escolher o motivo; "Outro" exige o texto. Observação opcional.
   * Persistir o motivo NUNCA altera batidas nem valores — é só o registro
   * histórico que habilita a destinação da reserva especial.
   */
  setExcessReason(p: {
    date: string;
    reason: ExcessReasonCode;
    customReason?: string | null;
    observation?: string | null;
  }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
        result = { ok: false, code: "invalid", error: "Data inválida." };
        return d;
      }
      const custom = (p.customReason ?? "").trim();
      if (p.reason === "outro" && !custom) {
        result = { ok: false, code: "invalid", error: "Informe o motivo." };
        return d;
      }
      const list = d.excessReasons ?? [];
      const existing = list.find((r) => r.date === p.date);
      const observation = (p.observation ?? "").trim() || null;
      const excessReasons = existing
        ? list.map((r) =>
            r.date === p.date
              ? { ...r, reason: p.reason, customReason: custom || null, observation, updatedAt: Date.now() }
              : r,
          )
        : [
            ...list,
            {
              id: nextId(list),
              date: p.date,
              reason: p.reason,
              customReason: custom || null,
              observation,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ];
      return { ...d, excessReasons };
    });
    return result;
  },

  /**
   * COMPENSAÇÃO IMEDIATA COM CRÉDITO JÁ REALIZADO (§6/§31): vincula minutos
   * de uma dívida (origem) a um dia JÁ ENCERRADO com crédito livre (destino).
   * A compensação nasce CONCLUÍDA — sem etapa artificial Pendente→Meta→Confirmar.
   * NUNCA altera batidas nem o saldo realizado: é só o VÍNCULO contábil.
   * Validado: anti-sobre-destinação da dívida, ciclo anual, destino encerrado,
   * capacidade livre (crédito regular + reserva especial) e MOTIVO quando a
   * parcela consome o excedente acima de 10h.
   */
  useRealizedCredit(p: {
    sourceDate: string;
    targetDate: string;
    minutes: number;
    kind?: CompKind;
    note?: string | null;
  }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const kind = p.kind ?? "deficit";
      if (!usesHourExtra(kind)) {
        result = { ok: false, code: "invalid", error: "Tipo de dívida inválido para quitação por crédito realizado." };
        return d;
      }
      if (!Number.isFinite(p.minutes) || p.minutes <= 0) {
        result = { ok: false, code: "invalid", error: "Quantidade de minutos inválida." };
        return d;
      }
      const cycleCheck = validateCompCycle(p.sourceDate, p.targetDate);
      if (!cycleCheck.ok) {
        result = cycleCheck;
        return d;
      }
      if (p.targetDate > todayString()) {
        result = { ok: false, code: "invalid", error: "Só é possível usar crédito de dias já realizados." };
        return d;
      }
      // Anti-sobre-destinação: a dívida de origem não pode receber além do total
      const debt = d.compensations
        .filter((c) => c.sourceDate === p.sourceDate && kindOf(c) === kind && c.status !== "cancelada")
        .reduce((s, c) => s + c.minutes, 0);
      const totalDebt = originalHourExtraDebt(
        p.sourceDate, kind, d.entries, d.compensations, d.absences, d.companyCalendars, settingsOf(d.user),
      );
      if (debt + p.minutes > totalDebt) {
        result = {
          ok: false,
          code: "invalid",
          error: `Esta dívida já está destinada em ${formatMinutes(debt)} de ${formatMinutes(totalDebt)} — não é possível vincular mais ${formatMinutes(p.minutes)}.`,
        };
        return d;
      }
      // Destino: dia REALIZADO e encerrado (crédito consolidado — §30)
      const targetDay = computeDay(
        d.entries.filter((e) => e.date === p.targetDate),
        settingsOf(d.user),
      );
      if (targetDay.empty || targetDay.open) {
        result = { ok: false, code: "invalid", error: "O dia de origem do crédito precisa estar encerrado." };
        return d;
      }
      // Capacidade livre = crédito regular livre + reserva especial livre (anti-reuso).
      // §5/§8 atribuição POR PORÇÃO: parcelas marcadas "especial" consomem a
      // RESERVA; as demais gastam primeiro o regular e só o excedente vai à reserva.
      const targetComps = d.compensations.filter(
        (c) => c.targetDate === p.targetDate && usesHourExtra(kindOf(c)) && c.status !== "cancelada",
      );
      const markedSpecial = targetComps
        .filter((c) => c.portion === "especial")
        .reduce((s, c) => s + c.minutes, 0);
      const unmarkedUsed = targetComps
        .filter((c) => c.portion !== "especial")
        .reduce((s, c) => s + c.minutes, 0);
      // capacityTotal = hora extra REGULAR do dia (trabalhado até o teto − base),
      // sem o [10+]. A reserva especial (>10h) é somada separadamente na
      // capacidade livre — o [10+] NÃO entra no crédito regular.
      const capacityTotal = actualExtraForDate(p.targetDate, d.entries, settingsOf(d.user), {
        companyCalendars: d.companyCalendars,
      });
      const targetBase = companyDayContext(p.targetDate, d.entries, d.absences, d.companyCalendars, settingsOf(d.user)).effectiveExpected;
      const regularExtra = Math.min(capacityTotal, Math.max(0, settingsOf(d.user).maxDailyMinutes - targetBase));
      const freeRegular = Math.max(0, regularExtra - Math.min(unmarkedUsed, regularExtra));
      const usedSpecialViaSource = allocatedForSource(d.compensations, p.targetDate, "excedente");
      const freeSpecial = Math.max(
        0,
        targetDay.excessMinutes - markedSpecial - Math.max(0, unmarkedUsed - regularExtra) - usedSpecialViaSource,
      );
      if (p.minutes > freeRegular + freeSpecial) {
        result = {
          ok: false,
          code: "over-capacity",
          error: `Este dia tem apenas ${formatMinutes(freeRegular + freeSpecial)} de crédito livre.`,
        };
        return d;
      }
      // Divisão exata: a parte até o crédito regular livre é "regular"; o que
      // passar consome a RESERVA ESPECIAL (>10h) — §10.1 exige MOTIVO.
      const regularPart = Math.min(p.minutes, freeRegular);
      const especialPart = p.minutes - regularPart;
      if (especialPart > 0) {
        const gate = canAllocateExcess(p.targetDate, d.entries, settingsOf(d.user), d.excessReasons);
        if (!gate.ok) {
          result = { ok: false, code: "invalid", error: gate.error };
          return d;
        }
        if (especialPart > freeSpecial) {
          result = {
            ok: false,
            code: "over-capacity",
            error: `Este dia tem apenas ${formatMinutes(freeSpecial)} de reserva acima de 10h livre.`,
          };
          return d;
        }
      }
      // Parcela pode se dividir em duas (regular + especial) — ambas CONCLUÍDAS.
      const base = nextId(d.compensations);
      const mk = (minutes: number, portion: "regular" | "especial", i: number): Compensation => ({
        id: base + i,
        sourceDate: p.sourceDate,
        targetDate: p.targetDate,
        minutes,
        status: "concluida", // imediata — sem etapa artificial (§31)
        note:
          p.note ??
          (portion === "especial" ? "Usado excedente acima de 10h (prioritário)" : "Usadas horas positivas realizadas"),
        kind,
        portion,
        createdAt: Date.now() + i,
      });
      const created: Compensation[] = [];
      if (regularPart > 0) created.push(mk(regularPart, "regular", 0));
      if (especialPart > 0) created.push(mk(especialPart, "especial", created.length));
      return { ...d, compensations: [...d.compensations, ...created] };
    });
    return result;
  },

  /**
   * AÇÃO AUTOMÁTICA/PRIORITÁRIA (§8): aplica o crédito realizado disponível
   * no déficit de `sourceDate`, PRIORIZANDO a reserva especial (>10h) com
   * motivo e depois o crédito regular — via o plano central (planRealizedCreditUse).
   * Pode aplicar PARCIAL (§7): não exige programar o restante.
   */
  useRealizedCreditForDeficit(sourceDate: string): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const settings = settingsOf(d.user);
      const cctxSrc = companyDayContext(sourceDate, d.entries, d.absences, d.companyCalendars, settings);
      const coveredByEarly = d.compensations
        .filter((c) => c.targetDate === sourceDate && kindOf(c) === "excedente" && c.status !== "cancelada")
        .reduce((s, c) => s + c.minutes, 0);
      const debtTotal = cctxSrc.ctx.day.open ? 0 : Math.max(0, cctxSrc.adjustedDeficit - coveredByEarly);
      if (debtTotal <= 0) {
        result = { ok: false, code: "invalid", error: "Este dia não possui déficit em aberto." };
        return d;
      }
      const allocated = d.compensations
        .filter((c) => c.sourceDate === sourceDate && kindOf(c) === "deficit" && c.status !== "cancelada")
        .reduce((s, c) => s + c.minutes, 0);
      const toUse = Math.max(0, debtTotal - allocated);
      if (toUse <= 0) {
        result = {
          ok: false,
          code: "invalid",
          error: "Este déficit já está integralmente destinado (concluído ou planejado).",
        };
        return d;
      }
      const plan = planRealizedCreditUse(
        sourceDate,
        toUse,
        d.entries,
        d.compensations,
        d.absences,
        d.companyCalendars,
        settings,
        d.excessReasons,
        todayString(),
      );
      if (!plan.ok) {
        result = { ok: false, code: "invalid", error: plan.error };
        return d;
      }
      const base = nextId(d.compensations);
      const created: Compensation[] = plan.parcels.map((p, i) => ({
        id: base + i,
        sourceDate: p.sourceDate,
        targetDate: p.targetDate,
        minutes: p.minutes,
        status: "concluida",
        note: p.portion === "especial" ? "Usado excedente acima de 10h (prioritário)" : "Usadas horas positivas realizadas",
        kind: "deficit",
        portion: p.portion, // atribuição exata da reserva especial (§5/§8)
        createdAt: Date.now() + i,
      }));
      const usedTotal = plan.appliedMinutes;
      result = {
        ok: true,
        warning:
          usedTotal >= toUse
            ? `Déficit quitado: ${formatMinutes(usedTotal)} vinculados de crédito já realizado.`
            : `Aplicação parcial: ${formatMinutes(usedTotal)} vinculados; restam ${formatMinutes(toUse - usedTotal)} sem programação.`,
      };
      return { ...d, compensations: [...d.compensations, ...created] };
    });
    return result;
  },

  /**
   * ALOCAÇÃO DO EXCEDENTE ESPECIAL JÁ REALIZADO: vincula minutos da reserva
   * >10h de `excessDate` a um déficit FACTUAL de `deficitDate`. Nasce
   * CONCLUÍDA, consome SOMENTE a porção especial (nunca o crédito regular)
   * e libera o planejado futuro sobreposto na mesma proporção.
   * NÃO altera batidas nem o Saldo realizado.
   */
  allocateSpecialExcess(p: { excessDate: string; deficitDate: string; minutes: number; kind?: CompKind }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const createKey = `alloc:${p.excessDate}|${p.deficitDate}|${p.minutes}`;
      if (isDuplicateCreate(createKey)) {
        result = { ok: false, code: "invalid", error: DUPLICATE_SUBMIT_MSG };
        return d;
      }
      if (!sameAnnualCycle(p.excessDate, p.deficitDate)) {
        result = { ok: false, code: "cross-cycle", error: ALLOCATE_CROSS_CYCLE_MSG };
        return d;
      }
      const settings = settingsOf(d.user);
      const today = todayString();
      const preview = previewAllocateSpecialExcess(
        p.excessDate, p.deficitDate, p.minutes,
        d.entries, d.compensations, d.absences, d.companyCalendars, d.faltas,
        settings, d.excessReasons, today, p.kind,
      );
      if (!preview.ok) {
        result = { ok: false, code: "invalid", error: preview.error ?? ALLOCATE_NO_REASON_MSG };
        return d;
      }
      const cycleCheck = validateCompCycle(p.deficitDate, p.excessDate);
      if (!cycleCheck.ok) {
        result = cycleCheck;
        return d;
      }
      const gate = canAllocateExcess(p.excessDate, d.entries, settings, d.excessReasons);
      if (!gate.ok) {
        result = { ok: false, code: "invalid", error: ALLOCATE_NO_REASON_MSG };
        return d;
      }
      const debtKind: CompKind =
        p.kind ??
        eligibleDeficitsForSpecialAllocation(
          p.excessDate, d.entries, d.compensations, d.absences, d.companyCalendars, d.faltas, settings, today,
        ).find((x) => x.date === p.deficitDate)?.kind ??
        "deficit";
      const created: Compensation = {
        id: nextId(d.compensations),
        sourceDate: p.deficitDate,
        targetDate: p.excessDate,
        minutes: preview.minutes,
        status: "concluida",
        note: "Alocado EXCEDENTE DO LIMITE DIÁRIO [10+] (realizado)",
        kind: debtKind,
        portion: "especial",
        createdAt: Date.now(),
      };
      const withNew = [...d.compensations, created];
      const { comps, released } = releaseOverlappingPlanned(
        withNew,
        p.deficitDate,
        preview.remainingDeficitAfter,
        debtKind,
      );
      result = {
        ok: true,
        warning:
          released > 0
            ? `${formatMinutes(preview.minutes)} alocados do excedente. ${formatMinutes(released)} de planejamento futuro foram liberados para evitar dupla compensação.`
            : `${formatMinutes(preview.minutes)} alocados do excedente já realizado.`,
      };
      rememberCreate(createKey);
      return { ...d, compensations: comps };
    });
    return result;
  },

  /**
   * REGISTRAR PARCIAL (§16): confirma SOMENTE a parte já realizada de uma
   * parcela futura por hora extra (dia de destino hoje ou passado). A parte
   * realizada vira uma parcela CONCLUÍDA; a original permanece pendente com o
   * RESTANTE — o estado consolidado da obrigação é Parcial (nunca "Concluir
   * parcial"). Sem realização, nada é alterado.
   */
  registerPartialComp(id: number): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const target = d.compensations.find((c) => c.id === id);
      if (!target) {
        result = { ok: false, code: "not-found", error: "Compensação não encontrada." };
        return d;
      }
      const kind = kindOf(target);
      if (target.status !== "pendente" || !usesHourExtra(kind)) {
        result = { ok: false, code: "invalid", error: "Somente parcelas pendentes de hora extra aceitam registrar parcial." };
        return d;
      }
      if (target.targetDate > todayString()) {
        result = { ok: false, code: "invalid", error: "A data da compensação ainda não chegou." };
        return d;
      }
      const actual = actualExtraForDate(target.targetDate, d.entries, settingsOf(d.user), {
        companyCalendars: d.companyCalendars,
      });
      const committed = d.compensations
        .filter(
          (c) =>
            c.id !== id &&
            c.targetDate === target.targetDate &&
            c.status === "concluida" &&
            usesHourExtra(kindOf(c)),
        )
        .reduce((s, c) => s + c.minutes, 0);
      const realized = Math.min(Math.max(0, actual - committed), target.minutes);
      if (realized <= 0) {
        result = { ok: false, code: "invalid", error: "Ainda não há realização parcial a registrar nesta data." };
        return d;
      }
      const completed: Compensation = {
        id: nextId(d.compensations),
        sourceDate: target.sourceDate,
        targetDate: target.targetDate,
        minutes: realized,
        status: "concluida",
        note: target.note,
        kind,
        createdAt: Date.now(),
      };
      return {
        ...d,
        compensations: [
          ...d.compensations.map((c) => (c.id === id ? { ...c, minutes: c.minutes - realized } : c)),
          completed,
        ],
      };
    });
    return result;
  },

  updateUser(patch: Partial<User>) {
    mutate((d) => ({ ...d, user: { ...d.user, ...patch } }));
  },

  /**
   * Restaura o seed operacional de demonstração (batidas, faltas, compensações,
   * [10+], calendário). Preserva nome, e-mail e data de nascimento atuais.
   * Somente por ação explícita — nunca no bootstrap.
   */
  reseed() {
    resetCreateGuard();
    mutate((d) => {
      const seed = buildSeedData();
      return { ...seed, user: withPreservedIdentity(seed.user, d.user) };
    });
  },

  /**
   * Apaga TODOS os dados operacionais deste navegador (batidas, faltas,
   * ausências, calendários, compensações e motivos). Preserva perfil e jornada.
   * Não esvazia o storage do domínio inteiro — só regrava a chave do Meu Horário.
   */
  clearAll() {
    resetCreateGuard();
    mutate((d) => ({
      user: d.user,
      entries: [],
      compensations: [],
      absences: [],
      companyCalendars: undefined,
      faltas: [],
      excessReasons: [],
      specialExcessUses: [],
      specialExcessPlans: [],
    }));
  },

  /** Substitui integralmente os dados pelos do backup. */
  replaceAll(p: {
    user: User;
    entries: TimeEntry[];
    compensations: Compensation[];
    absences?: Absence[];
    companyCalendars?: CompanyCalendars;
    faltas?: Falta[];
    excessReasons?: ExcessReason[];
    specialExcessUses?: SpecialExcessUse[];
    specialExcessPlans?: SpecialExcessPlan[];
  }) {
    resetCreateGuard();
    mutate(() => ({
      user: p.user,
      entries: p.entries,
      compensations: p.compensations,
      absences: p.absences ?? [],
      companyCalendars: p.companyCalendars,
      faltas: p.faltas ?? [],
      excessReasons: p.excessReasons ?? [],
      specialExcessUses: p.specialExcessUses ?? [],
      specialExcessPlans: p.specialExcessPlans ?? [],
    }));
  },

  /**
   * Mescla o backup com os dados atuais, preservando eventos distintos.
   * Deduplicação segura via ID + conteúdo completo (nunca apenas dias/minutos).
   */
  mergeBackup(p: { entries: TimeEntry[]; compensations: Compensation[]; absences?: Absence[]; companyCalendars?: CompanyCalendars; faltas?: Falta[]; excessReasons?: ExcessReason[]; specialExcessUses?: SpecialExcessUse[]; specialExcessPlans?: SpecialExcessPlan[] }) {
    mutate((d) => {
      const entryMerge = mergeByIdAndContent(d.entries, p.entries, entriesEqual);
      const compMerge = mergeByIdAndContent(d.compensations, p.compensations, compsEqual);
      // Motivos de excedente: mesclagem por ID + conteúdo completo (seguro).
      const reasonMerge = mergeByIdAndContent(
        d.excessReasons ?? [],
        p.excessReasons ?? [],
        excessReasonsEqual,
      );
      // Eventos divididos no fechamento anual permanecem independentes (sem recombinar)
      const absenceMerge = mergeByIdAndContent(
        d.absences,
        p.absences ?? [],
        absencesEqual,
      );
      // Faltas: união por DATA (uma falta por dia; nunca duplica na mesclagem).
      // Em colisão de data — ex.: mesmo dia faltado registrado em dois
      // dispositivos — a falta local já registrada prevalece.
      const faltaMerge = [...d.faltas];
      const faltaDates = new Set(faltaMerge.map((f) => f.date));
      for (const f of p.faltas ?? []) {
        if (faltaDates.has(f.date)) continue;
        faltaDates.add(f.date);
        const id = faltaMerge.some((x) => x.id === f.id) ? nextId(faltaMerge) : f.id;
        faltaMerge.push({ ...f, id });
      }
      // Calendários: união POR CICLO — nunca apaga ciclos existentes;
      // em conflito de ciclo, o calendário local já importado prevalece.
      const current = d.companyCalendars ?? [];
      const mergedCalendars = [...current];
      for (const c of p.companyCalendars ?? []) {
        if (!mergedCalendars.some((m) => m.cycleStart === c.cycleStart)) mergedCalendars.push(c);
      }
      // Usos do [10+]: união por id (string); em colisão de id, o uso local
      // prevalece (histórico local é a verdade deste dispositivo).
      const useMerge = [...(d.specialExcessUses ?? [])];
      const useIds = new Set(useMerge.map((u) => u.id));
      for (const u of p.specialExcessUses ?? []) {
        if (useIds.has(u.id)) continue;
        useIds.add(u.id);
        useMerge.push(u);
      }
      // 4A — Planos/reservas [10+]: mesma política dos usos (união por id;
      // colisão → prevalece o local).
      const planMerge = [...(d.specialExcessPlans ?? [])];
      const planIds = new Set(planMerge.map((p2) => p2.id));
      for (const pl of p.specialExcessPlans ?? []) {
        if (planIds.has(pl.id)) continue;
        planIds.add(pl.id);
        planMerge.push(pl);
      }
      return {
        ...d,
        entries: entryMerge.merged,
        compensations: compMerge.merged,
        absences: absenceMerge.merged,
        companyCalendars: mergedCalendars.length > 0 ? mergedCalendars : undefined,
        faltas: faltaMerge,
        excessReasons: reasonMerge.merged,
        specialExcessUses: useMerge,
        specialExcessPlans: planMerge,
      };
    });
  },

  /**
   * Adiciona o calendário de um NOVO ciclo. Recusa duplicidade de ciclo:
   * para trocar o calendário de um ciclo existente use replaceCompanyCalendar.
   */
  addCompanyCalendar(calendar: CompanyCalendar): ActionResult {
    const existing = getAppData().companyCalendars ?? [];
    if (existing.some((c) => c.cycleStart === calendar.cycleStart)) {
      return { ok: false, code: "overlap", error: `Já existe um calendário para o ciclo ${calendar.cycleLabel}.` };
    }
    mutate((d) => ({ ...d, companyCalendars: [...(d.companyCalendars ?? []), calendar].sort((a, b) => a.cycleStart.localeCompare(b.cycleStart)) }));
    return OK;
  },

  /** Substitui SOMENTE o calendário do mesmo ciclo (demais ciclos intactos). */
  replaceCompanyCalendar(calendar: CompanyCalendar): ActionResult {
    mutate((d) => {
      const list = (d.companyCalendars ?? []).filter((c) => c.cycleStart !== calendar.cycleStart);
      return { ...d, companyCalendars: [...list, calendar].sort((a, b) => a.cycleStart.localeCompare(b.cycleStart)) };
    });
    return OK;
  },

  /** Remove SOMENTE o calendário do ciclo informado (registros de ponto intactos). */
  removeCompanyCalendar(cycleStart: string): ActionResult {
    mutate((d) => {
      const list = (d.companyCalendars ?? []).filter((c) => c.cycleStart !== cycleStart);
      return { ...d, companyCalendars: list.length > 0 ? list : undefined };
    });
    return OK;
  },

  /* ── NOVO MEU HORÁRIO — USOS DO BANCO PARALELO [10+] (3D) ──
     Coletânea: specialExcessUses (3B). Nunca delete: o histórico persiste. */

  /**
   * Cria UM uso de [10+] para COMPLETAR uma jornada factual abaixo da base.
   * Atômico: qualquer rejeição persiste nada. O uso nasce "utilizado"
   * (não existe pendente/planejado/reservado no modelo novo).
   *
   * fifo: as origens são escolhidas pela 3C (mais antigas do MESMO ciclo,
   * origem posterior ao destino é válida se já realizada no asOf).
   * manual: o caller informa as origens (validação da 3C; duplicatas da
   * mesma origem são consolidadas em uma única allocation).
   */
  createSpecialExcessUse(p: {
    destinationDate: string;
    minutes: number;
    allocationStrategy: "fifo" | "manual";
    manualAllocations?: SpecialExcessAllocation[];
    note?: string | null;
    asOfDate?: string;
    periodClosed?: boolean;
    now?: number;
  }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const asOf = p.asOfDate ?? todayString();
      if (p.periodClosed) {
        result = { ok: false, code: "period-closed", error: SPECIAL_PERIOD_CLOSED_MSG };
        return d;
      }
      const isManual = p.allocationStrategy === "manual";
      const manualRequested = p.manualAllocations ?? [];
      const requestedTotal = isManual
        ? manualRequested.reduce((s, a) => s + a.minutes, 0)
        : p.minutes;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(p.destinationDate) ||
        !Number.isInteger(requestedTotal) ||
        requestedTotal <= 0 ||
        (p.allocationStrategy !== "fifo" && p.allocationStrategy !== "manual")
      ) {
        result = {
          ok: false,
          code: isManual ? "invalid-manual-allocation" : "invalid",
          error: "Parâmetros inválidos para criar um uso de [10+].",
        };
        return d;
      }
      const dest = checkSpecialDestination(d, p.destinationDate, asOf, null, requestedTotal);
      if (dest.error) {
        result = dest.error;
        return d;
      }
      const bank = specialBankOf(d, p.destinationDate, asOf, null);
      let allocations: SpecialExcessAllocation[];
      if (isManual) {
        const m = validateManualSelection(bank, p.destinationDate, asOf, manualRequested);
        if (m.error) {
          result = m.error;
          return d;
        }
        allocations = m.allocations;
      } else {
        const fifo = allocateSpecialExcessFifo({ bank, destinationDate: p.destinationDate, requestedMinutes: p.minutes });
        if (fifo.error) {
          result = { ok: false, code: "invalid", error: fifo.error };
          return d;
        }
        if (fifo.unfulfilledMinutes > 0) {
          result = {
            ok: false,
            code: "insufficient-special-balance",
            error: insufficientFifoMsg(bank, p.minutes, fifo.allocatedMinutes, fifo.unfulfilledMinutes),
            available: fifo.allocatedMinutes,
            limitMinutes: fifo.allocatedMinutes,
          };
          return d;
        }
        allocations = fifo.allocations;
      }
      const use: SpecialExcessUse = {
        id: nextSpecialUseId(d.specialExcessUses ?? []),
        destinationDate: p.destinationDate,
        allocations,
        allocationStrategy: p.allocationStrategy,
        status: "utilizado",
        createdAt: p.now ?? Date.now(),
        ...(p.note != null ? { note: p.note } : {}),
      };
      const v = validateSpecialExcessUse(use);
      if (!v.ok) {
        result = { ok: false, code: "invalid-use", error: `Uso de [10+] estruturalmente inválido: ${v.errors.join(", ")}.` };
        return d;
      }
      return { ...d, specialExcessUses: [...(d.specialExcessUses ?? []), use] };
    });
    return result;
  },

  /**
   * Edita um uso ATIVO como SUBSTITUIÇÃO ATÔMICA: valida a nova
   * configuração contra o banco SEM o uso em edição (suas allocations
   * antigas ficam temporariamente livres) e só então substitui o registro
   * (id e createdAt preservados; status permanece "utilizado").
   * Em qualquer falha o uso antigo permanece intacto.
   *
   * Recálculo FIFO somente quando a edição EXPLICITAMENTE o pede
   * (allocationStrategy "fifo" e/ou novo minutos); caso contrário as
   * allocations existentes são mantidas e REVALIDADAS. Seleção manual
   * (manualAllocations) sempre valida como manual.
   */
  updateSpecialExcessUse(p: {
    id: string;
    destinationDate?: string;
    minutes?: number;
    allocationStrategy?: "fifo" | "manual";
    manualAllocations?: SpecialExcessAllocation[];
    note?: string | null;
    asOfDate?: string;
    periodClosed?: boolean;
    now?: number;
  }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const asOf = p.asOfDate ?? todayString();
      if (p.periodClosed) {
        result = { ok: false, code: "period-closed", error: SPECIAL_PERIOD_CLOSED_MSG };
        return d;
      }
      const target = (d.specialExcessUses ?? []).find((u) => u.id === p.id);
      if (!target) {
        result = { ok: false, code: "use-not-found", error: "Uso de [10+] não encontrado." };
        return d;
      }
      if (target.status === "cancelado") {
        result = {
          ok: false,
          code: "use-already-cancelled",
          error: "Este uso de [10+] já foi cancelado; o histórico não pode ser alterado.",
        };
        return d;
      }
      const newDest = p.destinationDate ?? target.destinationDate;
      if (p.destinationDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(newDest)) {
        result = { ok: false, code: "invalid", error: "Data de destino inválida." };
        return d;
      }
      const strategy: SpecialExcessAllocationStrategy =
        p.allocationStrategy ?? (p.manualAllocations !== undefined ? "manual" : target.allocationStrategy);
      const oldTotal = target.allocations.reduce((s, a) => s + a.minutes, 0);
      const requestedTotal =
        strategy === "fifo" ? (p.minutes ?? oldTotal) : (p.manualAllocations ?? target.allocations).reduce((s, a) => s + a.minutes, 0);
      if (!Number.isInteger(requestedTotal) || requestedTotal <= 0) {
        result = {
          ok: false,
          code: strategy === "manual" ? "invalid-manual-allocation" : "invalid",
          error: "Parâmetros inválidos para editar o uso de [10+].",
        };
        return d;
      }
      // Banco SEM o uso em edição → suas allocations antigas ficam livres.
      const bank = specialBankOf(d, newDest, asOf, target.id);
      const dest = checkSpecialDestination(d, newDest, asOf, target.id, requestedTotal);
      if (dest.error) {
        result = dest.error;
        return d;
      }
      let allocations: SpecialExcessAllocation[];
      const recomputeFifo = strategy === "fifo" && (p.allocationStrategy === "fifo" || p.minutes !== undefined);
      if (recomputeFifo) {
        const fifo = allocateSpecialExcessFifo({ bank, destinationDate: newDest, requestedMinutes: requestedTotal });
        if (fifo.error) {
          result = { ok: false, code: "invalid", error: fifo.error };
          return d;
        }
        if (fifo.unfulfilledMinutes > 0) {
          result = {
            ok: false,
            code: "insufficient-special-balance",
            error: insufficientFifoMsg(bank, requestedTotal, fifo.allocatedMinutes, fifo.unfulfilledMinutes),
            available: fifo.allocatedMinutes,
            limitMinutes: fifo.allocatedMinutes,
          };
          return d;
        }
        allocations = fifo.allocations;
      } else {
        const requested = strategy === "manual" ? (p.manualAllocations ?? target.allocations) : target.allocations;
        const m = validateManualSelection(bank, newDest, asOf, requested);
        if (m.error) {
          result = m.error;
          return d;
        }
        allocations = m.allocations;
      }
      const nowTs = p.now ?? Date.now();
      const updated: SpecialExcessUse = {
        ...target,
        destinationDate: newDest,
        allocations,
        allocationStrategy: strategy,
        updatedAt: nowTs,
        ...(p.note != null ? { note: p.note } : {}),
      };
      const v = validateSpecialExcessUse(updated);
      if (!v.ok) {
        result = { ok: false, code: "invalid-use", error: `Uso de [10+] estruturalmente inválido: ${v.errors.join(", ")}.` };
        return d;
      }
      return {
        ...d,
        specialExcessUses: (d.specialExcessUses ?? []).map((u) => (u.id === target.id ? updated : u)),
      };
    });
    return result;
  },

  /**
   * Cancela um uso ATIVO: status "utilizado" → "cancelado" (+ cancelledAt/
   * updatedAt). NUNCA apaga: id, destino, allocations, estratégia e
   * createdAt permanecem. O saldo volta ao disponível por derivação (3C
   * ignora cancelados no consumo ativo) e a projeção 3A deixa de contar o
   * uso via usedSpecialMinutesByDestination.
   */
  cancelSpecialExcessUse(p: { id: string; periodClosed?: boolean; now?: number }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      if (p.periodClosed) {
        result = { ok: false, code: "period-closed", error: SPECIAL_PERIOD_CLOSED_MSG };
        return d;
      }
      const target = (d.specialExcessUses ?? []).find((u) => u.id === p.id);
      if (!target) {
        result = { ok: false, code: "use-not-found", error: "Uso de [10+] não encontrado." };
        return d;
      }
      if (target.status === "cancelado") {
        result = {
          ok: false,
          code: "use-already-cancelled",
          error: "Este uso de [10+] já foi cancelado; o histórico não pode ser alterado.",
        };
        return d;
      }
      const nowTs = p.now ?? Date.now();
      return {
        ...d,
        specialExcessUses: (d.specialExcessUses ?? []).map((u) =>
          u.id === target.id ? { ...u, status: "cancelado" as const, cancelledAt: nowTs, updatedAt: nowTs } : u,
        ),
      };
    });
    return result;
  },

  /* ── ETAPA 4A — PLANOS/RESERVAS FUTURAS DO BANCO [10+] ──
     Coletânea: specialExcessPlans. Nunca delete: o histórico persiste.
     PLANEJADO NÃO É UTILIZADO: a reserva não altera fatos, saldo regular,
     "No ponto", Resumo, SpecialExcessUse nem projeção de dia realizado.
     A conversão PLANO → USO REAL é uma etapa posterior (§16: "concluded"
     só desliga a reserva). SEM UI nesta etapa. */

  /**
   * Cria UMA reserva de [10+] para um DIA FUTURO. Atômica: qualquer
   * rejeição persiste nada — nunca plano parcial inesperado.
   *
   * destinationDate deve ser FUTURA em relação à data civil do app
   * (America/Sao_Paulo via todayString(); nunca toISOString()). Hoje e
   * passado são rejeitados — dias realizados usam SpecialExcessUse.
   * Ciclo anual: nenhuma allocation atravessa 30/04 (§9).
   *
   * automatic: origens escolhidas pelo FIFO canônico (3C — mais antigas
   * do ciclo, respeitando usos ativos E outras reservas ativas).
   * manual: o caller informa as origens; capacidade real validada pela
   * 3C; a origem manual NUNCA é substituída silenciosamente.
   *
   * Fórmula de capacidade pós-4A por origem:
   *   geração factual − usos ativos − reservas ativas (§11)
   */
  createSpecialExcessPlan(p: {
    destinationDate: string;
    minutes: number;
    selectionMode: "automatic" | "manual";
    manualAllocations?: SpecialExcessAllocation[];
    note?: string | null;
    asOfDate?: string;
    periodClosed?: boolean;
    now?: number;
  }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const asOf = p.asOfDate ?? todayString();
      if (p.periodClosed) {
        result = { ok: false, code: "period-closed", error: SPECIAL_PLAN_PERIOD_CLOSED_MSG };
        return d;
      }
      const isManual = p.selectionMode === "manual";
      const manualRequested = p.manualAllocations ?? [];
      const requestedTotal = isManual
        ? manualRequested.reduce((s, a) => s + a.minutes, 0)
        : p.minutes;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(p.destinationDate) ||
        !Number.isInteger(requestedTotal) ||
        requestedTotal <= 0 ||
        (p.selectionMode !== "automatic" && p.selectionMode !== "manual")
      ) {
        result = {
          ok: false,
          code: isManual ? "invalid-manual-allocation" : "invalid",
          error: "Parâmetros inválidos para criar uma reserva de [10+].",
        };
        return d;
      }
      // §8: destino deve ser FUTURO em relação à data civil atual (hoje e
      // passado são rejeitados; dias realizados usam SpecialExcessUse).
      if (p.destinationDate <= asOf) {
        result = { ok: false, code: "destination-not-future", error: SPECIAL_PLAN_FUTURE_MSG };
        return d;
      }
      // §9: seleção manual nunca atravessa o fechamento anual (30/04).
      if (isManual) {
        for (const a of manualRequested) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(a.originDate) && !sameAnnualCycle(a.originDate, p.destinationDate)) {
            result = {
              ok: false,
              code: "cross-cycle",
              error: `${SPECIAL_PLAN_CROSS_CYCLE_MSG} (origem ${a.originDate} = ciclo ${getAnnualPointCycle(a.originDate)}; destino ${p.destinationDate} = ciclo ${getAnnualPointCycle(p.destinationDate)}).`,
            };
            return d;
          }
        }
      }
      // 4D.3 — GATE CANÔNICO DE PLANEJAMENTO: um futuro só aceita reserva
      // [10+] quando tem BASE EFETIVA POSITIVA que possa receber o uso. A
      // capacidade vem da resolução central (companyDayContext.effectiveExpected)
      // — nenhuma regra paralela: feriado/abono integral, férias/afastamento
      // integral, fim de semana comum e COMPENSAR com jornadaEsperada 0 têm
      // base 0 ⇒ proibidos (a obrigação de calendário é OUTRA grandeza e
      // nunca vira necessidade de [10+]). Jornada parcial (ex.: Cinzas 4h)
      // limita a reserva à própria base. A UI nunca é a única barreira.
      const planningCapacityMinutes = companyDayContext(
        p.destinationDate,
        d.entries,
        d.absences,
        d.companyCalendars,
        settingsOf(d.user),
      ).effectiveExpected;
      if (planningCapacityMinutes <= 0) {
        result = {
          ok: false,
          code: "destination-no-planning-capacity",
          error:
            "Este dia futuro não tem jornada base para completar (feriado, abono, folga ou afastamento) — não aceita planejamento de [10+].",
        };
        return d;
      }
      if (requestedTotal > planningCapacityMinutes) {
        result = {
          ok: false,
          code: "requested-exceeds-planning-capacity",
          error: `Este dia aceita no máximo ${formatMinutes(planningCapacityMinutes)} de planejamento [10+] (base efetiva do dia).`,
          limitMinutes: planningCapacityMinutes,
        };
        return d;
      }
      // Banco canônico 3C com USOS + RESERVAS ativas (disponível líquido, §10/§11).
      const bank = specialBankOf(d, p.destinationDate, asOf, null);
      let allocations: SpecialExcessAllocation[];
      if (isManual) {
        const m = validateManualSelection(bank, p.destinationDate, asOf, manualRequested);
        if (m.error) {
          result = m.error;
          return d;
        }
        allocations = m.allocations;
      } else {
        const fifo = allocateSpecialExcessFifo({ bank, destinationDate: p.destinationDate, requestedMinutes: p.minutes });
        if (fifo.error) {
          result = { ok: false, code: "invalid", error: fifo.error };
          return d;
        }
        if (fifo.unfulfilledMinutes > 0) {
          // §14: reserva que não pode ser criada integralmente é REJEITADA
          // — nenhum plano parcial, nenhuma allocation parcial persistida.
          result = {
            ok: false,
            code: "insufficient-special-balance",
            error: insufficientFifoMsg(bank, p.minutes, fifo.allocatedMinutes, fifo.unfulfilledMinutes),
            available: fifo.allocatedMinutes,
            limitMinutes: fifo.allocatedMinutes,
          };
          return d;
        }
        allocations = fifo.allocations;
      }
      const plan: SpecialExcessPlan = {
        id: nextSpecialPlanId(d.specialExcessPlans ?? []),
        destinationDate: p.destinationDate,
        allocations,
        selectionMode: p.selectionMode,
        status: "planned",
        createdAt: p.now ?? Date.now(),
        ...(p.note != null ? { note: p.note } : {}),
      };
      const v = validateSpecialExcessPlan(plan);
      if (!v.ok) {
        result = { ok: false, code: "invalid-plan", error: `Reserva de [10+] estruturalmente inválida: ${v.errors.join(", ")}.` };
        return d;
      }
      return { ...d, specialExcessPlans: [...(d.specialExcessPlans ?? []), plan] };
    });
    return result;
  },

  /**
   * Cancela um plano ATIVO: status "planned" → "cancelled" (+ cancelledAt/
   * updatedAt). NUNCA apaga: id, destino, allocations, modo e createdAt
   * permanecem. A capacidade volta ao disponível POR DERIVAÇÃO (o banco
   * canônico 4A só conta planos "planned" como RESERVADO) — sem devolução
   * duplicada. Não cria uso; não altera fatos; não altera saldo regular.
   *
   * Cancelar plano já cancelado é IDEMPOTENTE (§15): nada muda e a
   * capacidade não é devolvida duas vezes. Plano "concluded" é histórico:
   * cancelamento rejeitado (transições só partem de "planned").
   */
  cancelSpecialExcessPlan(p: { id: string; now?: number }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const target = (d.specialExcessPlans ?? []).find((pl) => pl.id === p.id);
      if (!target) {
        result = { ok: false, code: "plan-not-found", error: SPECIAL_PLAN_NOT_FOUND_MSG };
        return d;
      }
      if (target.status === "concluded") {
        result = { ok: false, code: "plan-already-concluded", error: SPECIAL_PLAN_ALREADY_CONCLUDED_MSG };
        return d;
      }
      if (target.status === "cancelled") {
        return d; // §15: idempotente — nunca devolve a mesma hora duas vezes.
      }
      const nowTs = p.now ?? Date.now();
      return {
        ...d,
        specialExcessPlans: (d.specialExcessPlans ?? []).map((pl) =>
          pl.id === target.id ? { ...pl, status: "cancelled" as const, cancelledAt: nowTs, updatedAt: nowTs } : pl,
        ),
      };
    });
    return result;
  },

  /* ── ETAPA 4C — RESOLUÇÃO DO PLANEJAMENTO QUANDO O DIA CHEGA ──
     PLANO NUNCA VIRA USO AUTOMATICAMENTE (§2/§4): a resolução existe
     SOMENTE por ação explícita do usuário, nesta action ATÔMICA. */

  /**
   * Resolve UM planejamento/reserva [10+] cujo destinationDate JÁ CHEGOU:
   * dentro de UMA única mutation revalida plano, data, dia e necessidade
   * (gate canônico 3A/3G — nada recalculado), cria o SpecialExcessUse com
   * as MESMAS origens reservadas (§10 — NENHUM FIFO novo), marca o plano
   * como "concluded" com metadados de resolução (§12) e libera a sobra da
   * reserva de volta ao Banco [10+]. Qualquer falha → NADA persiste (§11).
   *
   * Regras:
   *  - destinationDate <= hoje civil (a data chegou; §5);
   *  - dia realizado, financeiramente válido, não incompleto/inconsistente
   *    (isProjectableDayStatus sobre o row canônico — §6);
   *  - necessidade real restante > 0, considerando jornada factual, base
   *    efetiva e usos [10+] ativos do dia (checkSpecialDestination);
   *  - minutes ≤ min(reservado no plano, necessidade restante);
   *  - consumo parcial na ORDEM PERSISTIDA das allocations do plano
   *    (prefixo — as origens foram escolhidas na reserva; §10);
   *  - sobra (reservado − aplicado) é LIBERADA: nenhuma sobra permanece
   *    reservada para um dia já resolvido (§8/§9).
   * Não executa FIFO, não altera fatos, não toca other plans/uses.
   */
  resolveSpecialExcessPlan(p: { id: string; minutes: number; asOfDate?: string; now?: number }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const asOf = p.asOfDate ?? todayString();
      const target = (d.specialExcessPlans ?? []).find((pl) => pl.id === p.id);
      if (!target) {
        result = { ok: false, code: "plan-not-found", error: SPECIAL_PLAN_NOT_FOUND_MSG };
        return d;
      }
      if (target.status === "cancelled") {
        result = { ok: false, code: "plan-already-cancelled", error: SPECIAL_PLAN_ALREADY_CANCELLED_MSG };
        return d;
      }
      if (target.status === "concluded") {
        result = { ok: false, code: "plan-already-concluded", error: SPECIAL_PLAN_ALREADY_CONCLUDED_MSG };
        return d;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(target.destinationDate) || !Number.isInteger(p.minutes) || p.minutes <= 0) {
        result = { ok: false, code: "invalid", error: "Parâmetros inválidos para usar o planejamento de [10+]." };
        return d;
      }
      // §5: o planejamento só pode ser usado quando o dia chega.
      if (target.destinationDate > asOf) {
        result = {
          ok: false,
          code: "destination-not-realized",
          error: "O planejamento ainda é uma reserva futura: só pode ser usado quando o dia planejado chegar.",
        };
        return d;
      }
      // §5/§6/§13: GATE CANÔNICO do destino (3A/3G) — dia realizado, válido,
      // não incompleto/inconsistente, com necessidade restante considerando
      // os usos [10+] ativos do dia. Nada é recalculado aqui.
      const planMinutes = specialExcessPlanMinutes(target);
      const dest = checkSpecialDestination(d, target.destinationDate, asOf, null, p.minutes);
      if (dest.error) {
        if (dest.error.code === "destination-no-remaining-need") {
          result = {
            ok: false,
            code: "destination-no-remaining-need",
            error:
              "Sua jornada já atingiu a base. Esta reserva não é mais necessária — libere a reserva para devolver o saldo ao Banco [10+].",
            limitMinutes: 0,
          };
        } else if (dest.error.code === "destination-not-eligible") {
          result = {
            ok: false,
            code: "destination-not-eligible",
            error: "Complete ou corrija os registros deste dia antes de decidir o uso do [10+].",
          };
        } else {
          result = dest.error;
        }
        return d;
      }
      const maxApplicable = Math.min(planMinutes, dest.remainingMinutes);
      if (p.minutes > maxApplicable) {
        result = {
          ok: false,
          code: "requested-exceeds-destination-need",
          error: `Você pode aplicar no máximo ${formatMinutes(maxApplicable)} deste planejamento agora (necessidade restante do dia).`,
          limitMinutes: maxApplicable,
        };
        return d;
      }
      // §10: consumir as PRÓPRIAS allocations do plano na ORDEM PERSISTIDA
      // (prefixo) — sem novo FIFO, sem buscar outra origem.
      let toConsume = p.minutes;
      const useAllocations: SpecialExcessAllocation[] = [];
      for (const a of target.allocations) {
        if (toConsume <= 0) break;
        const take = Math.min(a.minutes, toConsume);
        if (take > 0) useAllocations.push({ originDate: a.originDate, minutes: take });
        toConsume -= take;
      }
      const applied = useAllocations.reduce((s, a) => s + a.minutes, 0);
      const released = planMinutes - applied;
      const nowTs = p.now ?? Date.now();
      // O uso criado herda as origens reservadas; a estratégia registra COMO
      // as origens foram escolhidas originalmente (automatic → fifo).
      const use: SpecialExcessUse = {
        id: nextSpecialUseId(d.specialExcessUses ?? []),
        destinationDate: target.destinationDate,
        allocations: useAllocations,
        allocationStrategy: target.selectionMode === "automatic" ? "fifo" : "manual",
        status: "utilizado",
        createdAt: nowTs,
        note: `Aplicado do planejamento ${target.id} (reserva de ${formatMinutes(planMinutes)}).`,
      };
      const v = validateSpecialExcessUse(use);
      if (!v.ok) {
        result = { ok: false, code: "invalid-use", error: `Uso de [10+] estruturalmente inválido: ${v.errors.join(", ")}.` };
        return d;
      }
      const resolvedPlan: SpecialExcessPlan = {
        ...target,
        status: "concluded",
        concludedAt: nowTs,
        updatedAt: nowTs,
        resolvedAt: nowTs,
        resolvedUseId: use.id,
        resolvedMinutes: applied,
        releasedMinutes: released,
      };
      const vp = validateSpecialExcessPlan(resolvedPlan);
      if (!vp.ok) {
        result = { ok: false, code: "invalid-plan", error: `Reserva de [10+] estruturalmente inválida: ${vp.errors.join(", ")}.` };
        return d;
      }
      return {
        ...d,
        specialExcessUses: [...(d.specialExcessUses ?? []), use],
        specialExcessPlans: (d.specialExcessPlans ?? []).map((pl) => (pl.id === target.id ? resolvedPlan : pl)),
      };
    });
    return result;
  },

  /**
   * Marca um plano ATIVO como "concluded" (+ concludedAt/updatedAt).
   * §16 — propositalmente simples NESTA etapa: o plano deixa de contar
   * como RESERVADO (a capacidade volta ao disponível por derivação),
   * NÃO cria SpecialExcessUse, NÃO altera jornada, NÃO altera projeção
   * e NÃO conclui acordo algum. A transformação PLANO → USO REAL é a
   * etapa posterior. Histórico preservado; transição só de "planned".
   */
  concludeSpecialExcessPlan(p: { id: string; now?: number }): ActionResult {
    let result: ActionResult = OK;
    mutate((d) => {
      const target = (d.specialExcessPlans ?? []).find((pl) => pl.id === p.id);
      if (!target) {
        result = { ok: false, code: "plan-not-found", error: SPECIAL_PLAN_NOT_FOUND_MSG };
        return d;
      }
      if (target.status === "cancelled") {
        result = { ok: false, code: "plan-already-cancelled", error: SPECIAL_PLAN_ALREADY_CANCELLED_MSG };
        return d;
      }
      if (target.status === "concluded") {
        result = { ok: false, code: "plan-already-concluded", error: SPECIAL_PLAN_ALREADY_CONCLUDED_MSG };
        return d;
      }
      const nowTs = p.now ?? Date.now();
      return {
        ...d,
        specialExcessPlans: (d.specialExcessPlans ?? []).map((pl) =>
          pl.id === target.id ? { ...pl, status: "concluded" as const, concludedAt: nowTs, updatedAt: nowTs } : pl,
        ),
      };
    });
    return result;
  },
};

export function getAppData(): AppData {
  load();
  return data;
}

export function useAppData(): AppData {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** `true` no cliente depois de ler o localStorage — não usar `pristine` como fato. */
export function useIsStoreReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      ensureLoaded();
      return ready;
    },
    () => false,
  );
}

/** `true` após a hidratação (evita flash de estado vazio). */
export function useIsClient(): boolean {
  const [client, setClient] = useState(false);
  useEffect(() => setClient(true), []);
  return client;
}

export function settingsOf(u: User): WorkSettings {
  return {
    workStart: u.workStart,
    workEnd: u.workEnd,
    lunchStart: u.lunchStart,
    lunchEnd: u.lunchEnd,
    maxDailyMinutes: u.maxDailyMinutes,
    autoDeductLunch: u.autoDeductLunch,
  };
}

/** Enriquece uma compensação com o resumo dos dias de origem/destino. */
export function enrichComp(
  c: Compensation,
  entries: TimeEntry[],
  settings: WorkSettings,
): CompWithDays {
  const dayFor = (date: string): DayResult | null => {
    const list = entries.filter((e) => e.date === date);
    return list.length > 0 ? computeDay(list, settings) : null;
  };
  const src = dayFor(c.sourceDate);
  const tgt = dayFor(c.targetDate);
  return {
    ...c,
    sourceDay: src
      ? { workedMinutes: src.workedMinutes, excessMinutes: src.excessMinutes }
      : null,
    targetDay: tgt
      ? {
          workedMinutes: tgt.workedMinutes,
          // Saldo regular pelo PONTO OFICIAL (min(worked, limite) − base);
          // o [10+] não entra no saldo do dia de destino.
          balanceMinutes: regularBalanceMinutes(tgt.workedMinutes, tgt.expectedMinutes, settings.maxDailyMinutes),
        }
      : null,
  };
}

export function storageBytes(): number {
  if (typeof window === "undefined") return 0;
  try {
    return (window.localStorage.getItem(STORAGE_KEY) ?? "").length;
  } catch {
    return 0;
  }
}
