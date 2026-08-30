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
  /** Projeção 3A com os usos ativos (null quando não há uso ativo). */
  projection: { workedMinutes: number; balanceMinutes: number } | null;
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
  /** Banco já computado (a página calcula uma vez por ciclo). */
  bank?: SpecialExcessBankSummary;
}

export function buildSpecialExcessDayView(args: SpecialExcessDayViewInput): SpecialExcessDayView {
  const { date, asOfDate, entries, absences, calendars, settings, faltas, controlStartDate, uses } = args;
  const row = buildResumoDayRow({
    date, today: asOfDate, entries, absences, calendars, settings, faltas, controlStartDate,
  });
  const eligible = isProjectableDayStatus(row.status);
  const neededMinutes = Math.max(row.expectedMinutes - row.registrableMinutes, 0);
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
            effectiveBaseMinutes: row.expectedMinutes,
            financialValid: isProjectableDayStatus(row.status),
            realized: row.entryCount > 0 && date <= asOfDate,
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
    projection,
    bank,
  };
}
