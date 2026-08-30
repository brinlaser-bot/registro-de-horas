// ─────────────────────────────────────────────────────────────
// ETAPA 3C — BANCO ANUAL [10+] + SELEÇÃO FIFO/MANUAL (PURA).
//
// O [10+] é UM ÚNICO BANCO paralelo dentro do ciclo anual
// (01/05–30/04), composto por LOTES rastreáveis por dia de origem.
//
//   GERADO     = horas [10+] FACTUAIS geradas no dia (excesso acima do
//                teto oficial de 10h) — fonte: row.excessMinutes de
//                buildResumoDayRow (computeDay: finalized ?
//                max(0, worked − maxDaily) : 0). Nada de dívida,
//                compensação, freeRegular nem settlement legado.
//   UTILIZADO  = soma ATIVA dos allocations dos SpecialExcessUse com
//                status "utilizado" (3B). Cancelados NÃO consomem.
//   DISPONÍVEL = max(GERADO − UTILIZADO, 0) por lote.
//
// Sem UI, sem store, sem adapter legado, sem planejamento/reserva.
// O banco é SOMENTE derivação de FATOS + SpecialExcessUse[].
//
// Escopo: consulta SEMPRE vinculada a UM ciclo anual (periods.ts).
// O fechamento do ponto 21→20 NÃO segmenta o banco — o saldo
// atravessa os períodos mensais do MESMO ciclo.
//
// Origem FUTURA (após asOfDate) não entra: o row já mascara futuro
// (realized) — reutilizado, não reinventado.
//
// Overuse (used > generated, histórico): NUNCA corrigir —
// available = 0, overused = used − generated, needsReview = true.
//
// FIFO/MANUAL apenas SUGEREM allocations para um NOVO uso
// (destino já determinado pela camada superior — 3A decide a
// necessidade). NUNCA recalculam allocations de uso existente:
// depois que um SpecialExcessUse foi criado, allocations[] é a
// verdade histórica.
//
// Exclusividade: o banco é SÓ do [10+] — crédito regular, hora extra
// regular, regularCoverage e openDeficit NUNCA entram.
// ─────────────────────────────────────────────────────────────
import type { Absence } from "./absences";
import type { CompanyCalendars } from "./company-calendar";
import {
  annualCycleBounds,
  getAnnualPointCycle,
  listDaysBetween,
} from "./periods";
import { buildResumoDayRow } from "./resumo-days";
import type {
  SpecialExcessAllocation,
  SpecialExcessAllocationStrategy,
  SpecialExcessUse,
  SpecialExcessUseStatus,
} from "./special-excess-use";
import type { WorkSettings } from "./time";
import type { Falta, TimeEntry } from "./types";

export interface SpecialExcessLotDestination {
  useId: string;
  destinationDate: string;
  minutes: number;
  allocationStrategy: SpecialExcessAllocationStrategy;
  /** Histórico completo: "utilizado" e "cancelado" (rastreabilidade). */
  status: SpecialExcessUseStatus;
}

export interface SpecialExcessOriginLot {
  originDate: string; // YYYY-MM-DD
  /** Horas [10+] factuais geradas neste dia (excesso > 10h oficial). */
  generatedMinutes: number;
  /** Somente usos ATIVOS ("utilizado"). Cancelados não consomem. */
  usedMinutes: number;
  /** max(generated − used, 0) — nunca negativo. */
  availableMinutes: number;
  /** max(used − generated, 0) — inconsistência histórica NUNCA é escondida. */
  overusedMinutes: number;
  needsReview: boolean;
  /** Para quais destinos foi (histórico completo, inclusive cancelados). */
  destinations: SpecialExcessLotDestination[];
}

export interface SpecialExcessBankSummary {
  cycle: string; // ex.: "2026/2027"
  /** = Σ generatedMinutes dos lotes (apenas do ciclo). */
  generatedMinutes: number;
  /** = Σ usedMinutes dos lotes (apenas usos ativos do ciclo). */
  usedMinutes: number;
  /** = Σ availableMinutes dos lotes. Sem overuse: generated = used + available. */
  availableMinutes: number;
  overusedMinutes: number;
  needsReview: boolean;
  /** Lotes ordenados por originDate ascendente. */
  lots: SpecialExcessOriginLot[];
}

export interface SpecialExcessBankInput {
  /** Ciclo anual da consulta (ex.: getAnnualPointCycle(date)). */
  cycle: string;
  /** Corte as-of: somente fatos realizados até esta data entram (futuro mascarado). */
  asOfDate: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string;
  /** Registros de uso (3B) — insumo histórico; nunca mutados. */
  uses: SpecialExcessUse[];
}

/**
 * Deriva o banco [10+] de UM ciclo anual a partir de FATOS + SpecialExcessUse[].
 * Pura: não muta nada; não lê store; não toca legado.
 */
export function buildSpecialExcessBank(input: SpecialExcessBankInput): SpecialExcessBankSummary {
  const { cycle, asOfDate, entries, absences, calendars, settings, faltas, controlStartDate, uses } = input;
  const bounds = annualCycleBounds(cycle);

  // GERADO: fonte factual limpa — excessMinutes do row (0 em dia futuro
  // relativo a asOfDate, em dia sem fato ou em dia ainda não finalizado).
  const generated = new Map<string, number>();
  for (const date of listDaysBetween(bounds.from, bounds.to)) {
    const row = buildResumoDayRow({
      date, today: asOfDate, entries, absences, calendars, settings, faltas, controlStartDate,
    });
    if (row.excessMinutes > 0) generated.set(date, row.excessMinutes);
  }

  // UTILIZADO (ativo) + histórico de destinos, SOMENTE origens do ciclo.
  const usedByOrigin = new Map<string, number>();
  const destinationsByOrigin = new Map<string, SpecialExcessLotDestination[]>();
  for (const use of uses) {
    for (const a of use.allocations) {
      if (getAnnualPointCycle(a.originDate) !== cycle) continue; // ciclo de outro banco
      const list = destinationsByOrigin.get(a.originDate) ?? [];
      list.push({
        useId: use.id,
        destinationDate: use.destinationDate,
        minutes: a.minutes,
        allocationStrategy: use.allocationStrategy,
        status: use.status,
      });
      destinationsByOrigin.set(a.originDate, list);
      if (use.status === "utilizado") {
        usedByOrigin.set(a.originDate, (usedByOrigin.get(a.originDate) ?? 0) + a.minutes);
      }
    }
  }

  const originDates = new Set<string>([...generated.keys(), ...destinationsByOrigin.keys()]);
  const lots: SpecialExcessOriginLot[] = [...originDates]
    .sort()
    .map((originDate) => {
      const g = generated.get(originDate) ?? 0;
      const u = usedByOrigin.get(originDate) ?? 0;
      const over = Math.max(0, u - g);
      const destinations = (destinationsByOrigin.get(originDate) ?? []).slice().sort(
        (x, y) =>
          x.destinationDate === y.destinationDate
            ? x.useId.localeCompare(y.useId)
            : x.destinationDate < y.destinationDate
              ? -1
              : 1,
      );
      return {
        originDate,
        generatedMinutes: g,
        usedMinutes: u,
        availableMinutes: Math.max(0, g - u),
        overusedMinutes: over,
        needsReview: over > 0,
        destinations,
      };
    });

  const sumLot = (f: (l: SpecialExcessOriginLot) => number) => lots.reduce((s, l) => s + f(l), 0);
  const overusedMinutes = sumLot((l) => l.overusedMinutes);
  return {
    cycle,
    generatedMinutes: sumLot((l) => l.generatedMinutes),
    usedMinutes: sumLot((l) => l.usedMinutes),
    availableMinutes: sumLot((l) => l.availableMinutes),
    overusedMinutes,
    needsReview: overusedMinutes > 0,
    lots,
  };
}

/* ── Seleção FIFO (sugere allocations para um NOVO uso) ─────── */

export interface SpecialExcessFifoResult {
  requestedMinutes: number;
  allocatedMinutes: number;
  /** restante não atendido (saldo insuficiente) — nunca fabricado. */
  unfulfilledMinutes: number;
  /** origens mais antigas primeiro; vazio em erro estrutural. */
  allocations: SpecialExcessAllocation[];
  /** Só em erro estrutural (pedido inválido / destino fora do ciclo). */
  error?: string;
}

/**
 * Sugere as allocations de um NOVO uso FIFO: origens com disponível > 0,
 * do MESMO ciclo do destino, ordenadas por originDate ascendente
 * (mais antiga primeiro), consumindo cada uma até esgotar.
 *
 * - NÃO filtra originDate <= destinationDate (origem posterior é válida);
 * - NÃO cria SpecialExcessUse (a montagem cabe à camada superior);
 * - saldo insuficiente → unfulfilledMinutes explícito (sem falha silenciosa).
 */
export function allocateSpecialExcessFifo(args: {
  bank: SpecialExcessBankSummary;
  destinationDate: string;
  requestedMinutes: number;
}): SpecialExcessFifoResult {
  const { bank, destinationDate, requestedMinutes } = args;
  if (!Number.isInteger(requestedMinutes) || requestedMinutes <= 0) {
    return {
      requestedMinutes,
      allocatedMinutes: 0,
      unfulfilledMinutes: requestedMinutes,
      allocations: [],
      error: `pedido-invalido: ${requestedMinutes}`,
    };
  }
  if (getAnnualPointCycle(destinationDate) !== bank.cycle) {
    return {
      requestedMinutes,
      allocatedMinutes: 0,
      unfulfilledMinutes: requestedMinutes,
      allocations: [],
      error: `destino-fora-do-ciclo: ${destinationDate} (${getAnnualPointCycle(destinationDate)}) x banco ${bank.cycle}`,
    };
  }
  const available = bank.lots
    .filter((l) => l.availableMinutes > 0)
    .sort((a, b) => (a.originDate < b.originDate ? -1 : 1));
  const allocations: SpecialExcessAllocation[] = [];
  let remaining = requestedMinutes;
  for (const lot of available) {
    if (remaining <= 0) break;
    const take = Math.min(lot.availableMinutes, remaining);
    allocations.push({ originDate: lot.originDate, minutes: take });
    remaining -= take;
  }
  return {
    requestedMinutes,
    allocatedMinutes: requestedMinutes - remaining,
    unfulfilledMinutes: remaining,
    allocations,
  };
}

/* ── Seleção manual (sugere allocations para um NOVO uso) ───── */

export interface SpecialExcessManualInsufficient {
  originDate: string;
  requested: number;
  available: number;
  insufficient: number;
}

export interface SpecialExcessManualResult {
  ok: boolean;
  requestedMinutes: number;
  allocatedMinutes: number;
  /** Somente quando ok — origem em ordem informada pelo usuário. */
  allocations: SpecialExcessAllocation[];
  /** Erro explícito — nunca substitui origem nem clampa silenciosamente. */
  error?: string;
  /** Detalhe de origem com disponibilidade insuficiente. */
  insufficient?: SpecialExcessManualInsufficient[];
}

/**
 * Valida/monta a seleção MANUAL do usuário (ordem preservada; não vira FIFO).
 *
 * - origem inexistente no banco (ou de outro ciclo) → erro explícito;
 * - origem com disponível < pedido → erro explícito com
 *   { requested, available, insufficient } — SEM allocation parcial;
 * - duplicatas da mesma origem na seleção são somadas (o registro 3B
 *   proíbe duas allocations da mesma origem no mesmo uso).
 */
export function allocateSpecialExcessManual(args: {
  bank: SpecialExcessBankSummary;
  destinationDate: string;
  requestedAllocations: SpecialExcessAllocation[];
}): SpecialExcessManualResult {
  const { bank, destinationDate, requestedAllocations } = args;
  const requestedMinutes = requestedAllocations.reduce((s, a) => s + a.minutes, 0);
  const base: SpecialExcessManualResult = {
    ok: false,
    requestedMinutes,
    allocatedMinutes: 0,
    allocations: [],
  };
  if (requestedAllocations.length === 0) {
    return { ...base, error: "selecao-vazia" };
  }
  if (getAnnualPointCycle(destinationDate) !== bank.cycle) {
    return {
      ...base,
      error: `destino-fora-do-ciclo: ${destinationDate} (${getAnnualPointCycle(destinationDate)}) x banco ${bank.cycle}`,
    };
  }

  const selectionErrors: string[] = [];
  const totalByOrigin = new Map<string, number>();
  for (const a of requestedAllocations) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.originDate) || !Number.isInteger(a.minutes) || a.minutes <= 0) {
      selectionErrors.push(`selecao-invalida: ${a.originDate}=${a.minutes}`);
      continue;
    }
    totalByOrigin.set(a.originDate, (totalByOrigin.get(a.originDate) ?? 0) + a.minutes);
  }
  if (selectionErrors.length > 0) {
    return { ...base, error: selectionErrors.join("; ") };
  }

  const missing: string[] = [];
  const insufficient: SpecialExcessManualInsufficient[] = [];
  const lotByDate = new Map(bank.lots.map((l) => [l.originDate, l]));
  for (const [originDate, total] of totalByOrigin) {
    const lot = lotByDate.get(originDate);
    if (!lot) {
      missing.push(`origem-inexistente: ${originDate}`);
      continue;
    }
    if (total > lot.availableMinutes) {
      insufficient.push({
        originDate,
        requested: total,
        available: lot.availableMinutes,
        insufficient: total - lot.availableMinutes,
      });
    }
  }
  if (missing.length > 0) {
    return { ...base, error: missing.join("; ") };
  }
  if (insufficient.length > 0) {
    return { ...base, error: "disponibilidade-insuficiente", insufficient };
  }

  // ordem informada pelo usuário (primeira ocorrência de cada origem)
  const allocations: SpecialExcessAllocation[] = [];
  for (const a of requestedAllocations) {
    if (!allocations.some((x) => x.originDate === a.originDate)) {
      allocations.push({ originDate: a.originDate, minutes: totalByOrigin.get(a.originDate)! });
    }
  }
  return { ok: true, requestedMinutes, allocatedMinutes: requestedMinutes, allocations };
}
