"use client";

// Store client-side com persistência em localStorage.
// Uso pessoal: todos os dados ficam apenas no navegador.
import { useEffect, useState, useSyncExternalStore } from "react";
import { computeDay, formatMinutes, FUTURE_DATE_ERROR, isFutureDate, todayString, validatePunchSequence, type EntryType } from "./time";
import { buildSeedData, DEFAULT_USER } from "./seed-data";
import { absencesEqual, compsEqual, entriesEqual, mergeByIdAndContent } from "./backup";
import { canCompleteComp, concludedForSource, extraCapacityForDate, usesHourExtra, acordoLinkedComps } from "./debt";
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
        data = { user: parsed.user, entries: parsed.entries, compensations: parsed.compensations, absences, companyCalendars, faltas };
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

/**
 * GuARDA DE HISTÓRICO CONCLUÍDO (edição de batidas): o dia `date` pode ser
 * ORIGEM de compensações já CONCLUÍDAS, sustentadas pelas horas do dia. Se a
 * edição reduzir a dívida do dia (excedente/déficit/acordo pela resolução
 * central) abaixo do total já utilizado por compensações concluídas, a
 * alteração é BLOQUEADA — nunca cancela/reabre histórico automaticamente.
 * Recebe o estado JÁ com a edição simulada (entries finais).
 */
function concludedCompGuard(d: AppData, date: string): ActionResult | null {
  const cctx = companyDayContext(date, d.entries, d.absences, d.companyCalendars, settingsOf(d.user));
  const debts: [CompKind, number][] = [
    ["excedente", cctx.ctx.day.excessMinutes],
    ["deficit", cctx.adjustedDeficit],
    ["acordo", cctx.ctx.acordoMinutes],
  ];
  for (const [kind, debt] of debts) {
    if (concludedForSource(d.compensations, date, kind) > Math.max(0, debt)) {
      return { ok: false, code: "concluded-history", error: CONCLUDED_COMP_MSG };
    }
  }
  return null;
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
      const seq = validatePunchSequence([...d.entries.filter((e) => e.date === p.date), created]);
      if (!seq.ok) {
        result = { ok: false, code: "sequence", error: seq.error };
        return d;
      }
      return { ...d, entries: [...d.entries, created] };
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
      // Sequência cronológica final válida em TODOS os dias afetados
      const affectedDates = Array.from(new Set([target.date, next.date]));
      for (const date of affectedDates) {
        const finalList = d.entries.filter((e) => e.date === date && e.id !== id);
        if (next.date === date) finalList.push(next);
        const seq = validatePunchSequence(finalList);
        if (!seq.ok) {
          result = { ok: false, code: "sequence", error: seq.error };
          return d;
        }
      }
      // Guarda de histórico: compensação concluída sustentada pelo dia de origem
      const sim = { ...d, entries: d.entries.map((e) => (e.id === id ? next : e)) };
      for (const date of affectedDates) {
        const guard = concludedCompGuard(sim, date);
        if (guard) {
          result = guard;
          return d;
        }
      }
      return { ...d, entries: sim.entries };
    });
    return result;
  },

  deleteEntry(id: number) {
    mutate((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }));
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
      const kindChanged = (next.kind ?? "excedente") !== (target.kind ?? "excedente");
      const reactivated =
        patch.status !== undefined && patch.status !== "cancelada" && target.status === "cancelada";
      const touchesCapacity =
        (patch.minutes !== undefined && patch.minutes !== target.minutes) ||
        (patch.targetDate !== undefined && patch.targetDate !== target.targetDate) ||
        kindChanged ||
        reactivated;

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

  updateUser(patch: Partial<User>) {
    mutate((d) => ({ ...d, user: { ...d.user, ...patch } }));
  },

  /** Substitui tudo pelos dados de exemplo. */
  reseed() {
    mutate(() => buildSeedData());
  },

  /** Apaga registros e compensações (mantém o perfil/jornada). */
  clearAll() {
    mutate((d) => ({ ...d, entries: [], compensations: [] }));
  },

  /** Substitui integralmente os dados pelos do backup. */
  replaceAll(p: {
    user: User;
    entries: TimeEntry[];
    compensations: Compensation[];
    absences?: Absence[];
    companyCalendars?: CompanyCalendars;
    faltas?: Falta[];
  }) {
    mutate(() => ({
      user: p.user,
      entries: p.entries,
      compensations: p.compensations,
      absences: p.absences ?? [],
      companyCalendars: p.companyCalendars,
      faltas: p.faltas ?? [],
    }));
  },

  /**
   * Mescla o backup com os dados atuais, preservando eventos distintos.
   * Deduplicação segura via ID + conteúdo completo (nunca apenas dias/minutos).
   */
  mergeBackup(p: { entries: TimeEntry[]; compensations: Compensation[]; absences?: Absence[]; companyCalendars?: CompanyCalendars; faltas?: Falta[] }) {
    mutate((d) => {
      const entryMerge = mergeByIdAndContent(d.entries, p.entries, entriesEqual);
      const compMerge = mergeByIdAndContent(d.compensations, p.compensations, compsEqual);
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
