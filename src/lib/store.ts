"use client";

// Store client-side com persistência em localStorage.
// Uso pessoal: todos os dados ficam apenas no navegador.
import { useEffect, useState, useSyncExternalStore } from "react";
import { computeDay, formatMinutes, FUTURE_DATE_ERROR, insertPunchError, isFutureDate, todayString, type EntryType } from "./time";
import { buildSeedData, DEFAULT_USER } from "./seed-data";
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
import { sameAnnualCycle } from "./periods";
import { companyDayContext, normalizeCompanyCalendars, type CompanyCalendar, type CompanyCalendars } from "./company-calendar";

/** Resultado estruturado de operações que podem ser rejeitadas por validação. */
export interface ActionResult {
  ok: boolean;
  /** Mensagem pronta para exibição na interface. */
  error?: string;
  code?: "over-capacity" | "invalid" | "not-found" | "cross-cycle" | "overlap" | "linked-compensations" | "falta" | "punches" | "confirm-replace" | "concluded-history" | "sequence";
  /** Capacidade disponível no dia de destino (quando code = over-capacity). */
  available?: number;
  limitMinutes?: number;
  /** Evento atravessa o fechamento anual: sugestão de divisão em 2 registros. */
  split?: AbsenceSplit;
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

const pristine: AppData = {
  user: { ...DEFAULT_USER },
  entries: [],
  compensations: [],
  absences: [],
  companyCalendars: undefined,
  faltas: [],
  excessReasons: [],
};

let data: AppData = pristine;
let ready = false;
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

function load() {
  if (ready || typeof window === "undefined") return;
  ready = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppData> & AppData;
      if (
        parsed &&
        parsed.user &&
        Array.isArray(parsed.entries) &&
        Array.isArray(parsed.compensations)
      ) {
        // Retrocompatibilidade: dados antigos podem não ter "absences"
        const absences = Array.isArray(parsed.absences) ? parsed.absences : [];
        // MIGRAÇÃO multi-calendário: formato antigo { companyCalendar } (único)
        // vira coleção { companyCalendars } com ciclos normalizados na leitura.
        const legacy = parsed as unknown as { companyCalendar?: unknown; companyCalendars?: unknown };
        const companyCalendars =
          normalizeCompanyCalendars(legacy.companyCalendars) ??
          normalizeCompanyCalendars(legacy.companyCalendar);
        // Retrocompatibilidade: dados antigos podem não ter "faltas".
        const faltas = Array.isArray(parsed.faltas) ? parsed.faltas : [];
        // Retrocompatibilidade (§39): dados antigos não têm "excessReasons" —
        // o excedente segue derivado das batidas; só o motivo fica pendente.
        const excessReasons = Array.isArray(parsed.excessReasons) ? parsed.excessReasons : [];
        data = { user: parsed.user, entries: parsed.entries, compensations: parsed.compensations, absences, companyCalendars, faltas, excessReasons };
        emit();
        return;
      }
    }
    // Primeiro acesso: popula com dados de exemplo
    data = buildSeedData();
    persist();
  } catch {
    data = pristine;
  }
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  load();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
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
  }): ActionResult {
    let result: ActionResult = OK;
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
      return withCompensarReconcile({ ...d, entries: [...d.entries, created] }, p.date);
    });
    return result;
  },

  /**
   * Cria várias batidas de uma vez (lançamento manual de 1+ períodos).
   * Valida o conjunto RESULTANTE de cada data — a ordem de cadastro não importa.
   */
  addEntries(
    list: Array<{ date: string; time: string; type: EntryType; note: string | null; source?: "live" | "manual" }>,
  ): ActionResult {
    let result: ActionResult = OK;
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
      for (const date of byDate.keys()) next = withCompensarReconcile(next, date);
      return next;
    });
    return result;
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
  updateEntry(id: number, patch: Partial<Pick<TimeEntry, "time" | "type" | "note" | "date">>): ActionResult {
    let result: ActionResult = OK;
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
      for (const date of affectedDates) reconciled = withCompensarReconcile(reconciled, date);
      return reconciled;
    });
    return result;
  },

  /**
   * Exclui uma batida. §25 MESMA GUARDA CENTRAL do updateEntry (não duplica
   * regra): simula a exclusão e bloqueia quando o dia sustenta compensação
   * concluída — pela ORIGEM (dívida) ou pelo DESTINO (capacidade consumida).
   */
  deleteEntry(id: number): ActionResult {
    let result: ActionResult = OK;
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
      return withCompensarReconcile(sim, target.date);
    });
    return result;
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
      const usedTarget = markedSpecial + unmarkedUsed;
      const capacityTotal = actualExtraForDate(p.targetDate, d.entries, settingsOf(d.user), {
        companyCalendars: d.companyCalendars,
      });
      if (p.minutes > Math.max(0, capacityTotal - usedTarget)) {
        result = {
          ok: false,
          code: "over-capacity",
          error: `Este dia tem apenas ${formatMinutes(Math.max(0, capacityTotal - usedTarget))} de crédito livre.`,
        };
        return d;
      }
      const targetBase = companyDayContext(p.targetDate, d.entries, d.absences, d.companyCalendars, settingsOf(d.user)).effectiveExpected;
      const regularExtra = Math.min(capacityTotal, Math.max(0, settingsOf(d.user).maxDailyMinutes - targetBase));
      const freeRegular = Math.max(0, regularExtra - Math.min(unmarkedUsed, regularExtra));
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
        const usedSpecialViaSource = allocatedForSource(d.compensations, p.targetDate, "excedente");
        const freeSpecial = Math.max(
          0,
          targetDay.excessMinutes - markedSpecial - Math.max(0, unmarkedUsed - regularExtra) - usedSpecialViaSource,
        );
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

  /** Substitui tudo pelos dados de exemplo. */
  reseed() {
    resetCreateGuard();
    mutate(() => buildSeedData());
  },

  /** Apaga registros, compensações e motivos de excedente (mantém o perfil/jornada). */
  clearAll() {
    resetCreateGuard();
    mutate((d) => ({ ...d, entries: [], compensations: [], excessReasons: [] }));
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
    }));
  },

  /**
   * Mescla o backup com os dados atuais, preservando eventos distintos.
   * Deduplicação segura via ID + conteúdo completo (nunca apenas dias/minutos).
   */
  mergeBackup(p: { entries: TimeEntry[]; compensations: Compensation[]; absences?: Absence[]; companyCalendars?: CompanyCalendars; faltas?: Falta[]; excessReasons?: ExcessReason[] }) {
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
      return {
        ...d,
        entries: entryMerge.merged,
        compensations: compMerge.merged,
        absences: absenceMerge.merged,
        companyCalendars: mergedCalendars.length > 0 ? mergedCalendars : undefined,
        faltas: faltaMerge,
        excessReasons: reasonMerge.merged,
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
};

export function getAppData(): AppData {
  load();
  return data;
}

export function useAppData(): AppData {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
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
      ? { workedMinutes: tgt.workedMinutes, balanceMinutes: tgt.balanceMinutes }
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
