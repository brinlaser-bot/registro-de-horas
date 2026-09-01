// ─────────────────────────────────────────────────────────────
// ETAPA 3E — VISÃO POR DIA DO [10+] (card + modal da página Registros).
//
// FONTE ÚNICA da regra visual — a UI NÃO duplica regra paralela:
//  - elegibilidade: 3A (isProjectableDayStatus sobre o status do Resumo:
//    "deficit" = jornada factual válida terminada abaixo da base);
//  - saldo/lotes: 3C (buildSpecialExcessBank do ciclo do dia);
//  - projeção: 3A (projectRealizedDayOfficial com os usos ativos).
//
// "Registro incompleto" ≠ "jornada abaixo do previsto": dias incompletos
// ou inconsistentes têm status próprio no Resumo e NUNCA são elegíveis —
// mesmo HOJE (dia encerrado com 7h de batidas válidas é elegível).
// ─────────────────────────────────────────────────────────────
import type { Absence } from "./absences";
import type { CompanyCalendars } from "./company-calendar";
import { getAnnualPointCycle } from "./periods";
import { buildResumoDayRow } from "./resumo-days";
import { isProjectableDayStatus, projectRealizedDayOfficial } from "./official-projection";
import {
  buildSpecialExcessBank,
  type SpecialExcessBankSummary,
  type SpecialExcessOriginLot,
} from "./special-excess-bank";
import { specialExcessUseMinutes, type SpecialExcessUse } from "./special-excess-use";
import type { SpecialExcessPlan } from "./special-excess-plan";
import type { WorkSettings } from "./time";
import type { Falta, TimeEntry } from "./types";

export interface SpecialExcessDayView {
  date: string;
  /** 3A: jornada factual válida terminada abaixo da base (status "deficit"). */
  eligible: boolean;
  /** Base efetiva − registrável (≥ 0): o quanto falta para completar a jornada. */
  neededMinutes: number;
  /** Σ dos usos ATIVOS destinados ao dia (histórico cancelado não conta). */
  usedActiveMinutes: number;
  /** Necessidade restante (needed − used, ≥ 0). */
  remainingMinutes: number;
  /** Disponível do banco [10+] do ciclo do dia. */
  bankAvailableMinutes: number;
  /** Máximo utilizável agora = min(restante, disponível do banco). */
  maxUsableMinutes: number;
  /** Botão "Completar jornada com [10+]" disponível? */
  canComplete: boolean;
  /** Lotes com disponível > 0 (modo manual do modal). */
  lots: SpecialExcessOriginLot[];
  /** Usos ativos do dia (detalhe/cancelamento no card). */
  activeUses: SpecialExcessUse[];
  /** Fato (inalterado pelo uso): trabalhado e saldo regular do dia. */
  workedMinutes: number;
  factualBalanceMinutes: number;
  /** Insumos 3A para o preview de projeção no modal. */
  registrableMinutes: number;
  expectedMinutes: number;
  /** 4D.4.2: base canônica do dia para a projeção oficial no modal (o MESMO
   *  requiredWorkMinutes da row — fonte única com o motor do store). */
  requiredWorkMinutes: number;
  /** Projeção 3A com os usos ativos (null quando não há uso ativo). */
  projection: { workedMinutes: number; balanceMinutes: number } | null;
  /** 4D.4.2: o dia já é fato realizado (batidas OU evento de calendário
   *  explícito) até o corte — insumo "realized" do motor 3A no modal. */
  realized: boolean;
  /** Banco do ciclo do dia (alimenta o modal). */
  bank: SpecialExcessBankSummary;
}

export interface SpecialExcessDayViewInput {
  date: string;
  /** Data de corte civil (hoje). Origem futura em relação a ela não entra. */
  asOfDate: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string | null;
  uses: SpecialExcessUse[];
  /**
   * 4A — Planos/reservas ativas ("planned"). O day-view decide CAPACIDADE
   * para uma nova operação de [10+] (canComplete/maxUsable/lotes do modo
   * manual): minuto reservado NÃO está disponível — DISPONÍVEL = GERADO −
   * UTILIZADO ATIVO − RESERVADO ATIVO. Opcional: chamadas antigas sem o
   * campo comportam-se como antes (reserved 0).
   */
  plans?: SpecialExcessPlan[];
  /** Banco já computado (a página calcula uma vez por ciclo). */
  bank?: SpecialExcessBankSummary;
}

export function buildSpecialExcessDayView(args: SpecialExcessDayViewInput): SpecialExcessDayView {
  const { date, asOfDate, entries, absences, calendars, settings, faltas, controlStartDate, uses } = args;
  const row = buildResumoDayRow({
    date, today: asOfDate, entries, absences, calendars, settings, faltas, controlStartDate,
  });
  /* 4D.4.2/4D.4 (Parte E): evento em HOJE sem jornada encerrada ainda não é
   * fato — não é elegível a uso de [10+] (nunca "completar" um dia que não
   * terminou). */
  const eligible = isProjectableDayStatus(row.status) && !row.calendarEventPendingToday;
  /* 4D.4.2 (Parte C): a necessidade usa o trabalho NECESSÁRIO canônico do
   * dia (row.requiredWorkMinutes). Em dia de calendário integral realizado
   * abaixo do necessário (ex.: COMPENSAR 8h sem batidas) NÃO pode aparecer
   * como 0 só porque effectiveExpected (jornada regular restante) era o
   * gate de PLANEJAMENTO FUTURO da 4D.3. Dias comuns: valor idêntico. */
  const neededMinutes = Math.max(row.requiredWorkMinutes - row.registrableMinutes, 0);
  const activeUses = uses.filter((u) => u.status === "utilizado" && u.destinationDate === date);
  const usedActiveMinutes = activeUses.reduce((s, u) => s + specialExcessUseMinutes(u), 0);
  const remainingMinutes = Math.max(neededMinutes - usedActiveMinutes, 0);
  const bank =
    args.bank ??
    buildSpecialExcessBank({
      cycle: getAnnualPointCycle(date),
      asOfDate,
      entries,
      absences,
      calendars,
      settings,
      faltas,
      controlStartDate: controlStartDate ?? "",
      uses,
      plans: args.plans ?? [],
    });
  const bankAvailableMinutes = bank.availableMinutes;
  const projection =
    usedActiveMinutes > 0
      ? (() => {
          const p = projectRealizedDayOfficial({
            date,
            factualWorkedMinutes: row.workedMinutes,
            factualRegistrableMinutes: row.registrableMinutes,
            factualRegularBalanceMinutes: row.balanceMinutes,
            effectiveBaseMinutes: row.requiredWorkMinutes,
            financialValid: isProjectableDayStatus(row.status),
            // 4D.4.2: evento explícito do calendário é fato suficiente (o dia
            // pode estar "realizado" mesmo sem batidas — ex.: COMPENSAR 0h).
            realized: (row.entryCount > 0 || row.calendarEventDay) && date <= asOfDate,
            usedSpecialMinutes: usedActiveMinutes,
          });
          return { workedMinutes: p.projectedWorkedMinutes, balanceMinutes: p.projectedBalanceMinutes };
        })()
      : null;
  return {
    date,
    eligible,
    neededMinutes,
    usedActiveMinutes,
    remainingMinutes,
    bankAvailableMinutes,
    maxUsableMinutes: Math.min(remainingMinutes, bankAvailableMinutes),
    canComplete: eligible && remainingMinutes > 0 && bankAvailableMinutes > 0,
    lots: bank.lots.filter((l) => l.availableMinutes > 0),
    activeUses,
    workedMinutes: row.workedMinutes,
    factualBalanceMinutes: row.balanceMinutes,
    registrableMinutes: row.registrableMinutes,
    expectedMinutes: row.expectedMinutes,
    requiredWorkMinutes: row.requiredWorkMinutes,
    realized: (row.entryCount > 0 || row.calendarEventDay) && date <= asOfDate,
    projection,
    bank,
  };
}
