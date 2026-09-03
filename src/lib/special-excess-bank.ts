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
//   RESERVADO  = soma ATIVA dos allocations dos SpecialExcessPlan com
//                status "planned" (4A). PLANEJADO NÃO É UTILIZADO —
//                cancelados/concluídos NÃO reservam.
//   DISPONÍVEL = max(GERADO − UTILIZADO − RESERVADO, 0) por lote.
//
// Sem UI, sem store, sem adapter legado. O banco é SOMENTE derivação de
// FATOS + SpecialExcessUse[] + SpecialExcessPlan[] (4A).
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
// ETAPA 4A — RESERVA FUTURA (SpecialExcessPlan): `plans` é OPCIONAL;
// chamadas que não o informam (visões de uso, day-view, Central)
// comportam-se EXATAMENTE como antes (reserved = 0). Com planos ativos,
// disponível por lote = GERADO − UTILIZADO − RESERVADO (§10/§11): uma
// mesma hora não pode estar simultaneamente utilizada e reservada.
// Overreserve (reservado sem lastro, histórico): NUNCA escondido —
// available = 0 e overreserved > 0 sinaliza needsReview.
//
// ETAPA 4H — SALDO TRANSPORTADO (AnnualCycleClosure):
//   Fatias carregadas pelo fechamento do ciclo anterior (disposition
//   "carried") viram LOTES OPERACIONAIS no ciclo destino. Elas:
//    · NÃO contam como "Gerado neste ciclo" (generatedMinutes = 0);
//    · preservam a origem cronológica ORIGINAL (originalOriginDate,
//      que vive no ciclo anterior) — por isso `originDate` do lote pode
//      ser de outro ciclo, e os allocations que as consomem carregam
//      `carried: true`;
//    · participam do FIFO pela DATA ORIGINAL (mais antiga → consumida
//      primeiro) e podem ser selecionadas manualmente no ciclo atual;
//    · têm lastro `carriedInMinutes` (DISPONÍVEL = carriedIn − usado −
//      reservado no ciclo atual).
//   O insumo `carried` é OPCIONAL: chamadas antigas comportam-se
//   exatamente como antes (sem saldo transportado).
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
import type { AnnualCycleClosureSourceSlice } from "./annual-cycle-closure";
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
import type { SpecialExcessPlan } from "./special-excess-plan";
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
  originDate: string; // YYYY-MM-DD (dia factual que gerou, ou origem ORIGINAL p/ transportado)
  /** Horas [10+] factuais geradas neste dia (excesso > 10h oficial).
   *  0 para saldo TRANSPORTADO (nunca conta como "gerado neste ciclo"). */
  generatedMinutes: number;
  /** Somente usos ATIVOS ("utilizado"). Cancelados não consomem. */
  usedMinutes: number;
  /** Somente planos ATIVOS ("planned") — 4A. Cancelados/concluídos não reservam. */
  reservedMinutes: number;
  /**
   * 4A: max(GERADO − UTILIZADO − RESERVADO, 0) nunca negativo.
   * 4H (transportado): max(carriedInMinutes − UTILIZADO − RESERVADO, 0).
   */
  availableMinutes: number;
  /** max(used − generated, 0) — inconsistência histórica NUNCA é escondida. */
  overusedMinutes: number;
  /** max(0, used + reserved − base) − overused: reserva sem lastro (4A). */
  overreservedMinutes: number;
  needsReview: boolean;
  /** 4H: true quando este lote é saldo TRANSPORTADO do ciclo anterior. */
  carried?: boolean;
  /** 4H: lastro transportado para ESTE ciclo (0/ausente em lote factual). */
  carriedInMinutes?: number;
  /** 4H: ciclo onde o [10+] deste lote nasceu de fato (proveniência). */
  originCycle?: string;
  /** Para quais destinos foi (histórico completo, inclusive cancelados). */
  destinations: SpecialExcessLotDestination[];
}

export interface SpecialExcessBankSummary {
  cycle: string; // ex.: "2026/2027"
  /** = Σ generatedMinutes dos lotes FACTUAIS (apenas do ciclo). O saldo
   *  TRANSPORTADO NÃO entra — "gerado neste ciclo" é só geração factual. */
  generatedMinutes: number;
  /** = Σ usedMinutes dos lotes (usos ativos). */
  usedMinutes: number;
  /** = Σ reservedMinutes dos lotes (planos ativos). */
  reservedMinutes: number;
  /** = Σ availableMinutes dos lotes (factual + transportado disponível). */
  availableMinutes: number;
  /** 4H: saldo TRANSPORTADO para este ciclo que ainda está disponível. */
  carriedAvailableMinutes: number;
  /** 4H: saldo TRANSPORTADO para este ciclo (lastro), independente de uso. */
  carriedMinutes: number;
  overusedMinutes: number;
  overreservedMinutes: number;
  needsReview: boolean;
  /** Lotes ordenados por originDate ascendente (data ORIGINAL; transportado
   *  fica com a data factual antiga → consumido primeiro no FIFO). */
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
  /**
   * Planos de reserva futura (4A) — somente ATIVOS ("planned") reservam.
   * Opcional: chamadas antigas sem o campo comportam-se como antes (reserved 0).
   */
  plans?: SpecialExcessPlan[];
  /**
   * 4H — fatias TRANSPORTADAS para ESTE ciclo (de um fechamento "carried" do
   * ciclo anterior). Opcional: chamadas antigas comportam-se como antes.
   */
  carried?: AnnualCycleClosureSourceSlice[];
}

/** type guard: allocation consome um lote deste banco. */
function isConsumableInCycle(
  originDate: string,
  carriedFlag: boolean | undefined,
  cycle: string,
  carriedOrigins: Set<string>,
): boolean {
  if (carriedFlag === true) return carriedOrigins.has(originDate);
  return getAnnualPointCycle(originDate) === cycle;
}

/**
 * Deriva o banco [10+] de UM ciclo anual a partir de FATOS + SpecialExcessUse[]
 * (+ fatias transportadas 4H). Pura: não muta nada; não lê store.
 */
export function buildSpecialExcessBank(input: SpecialExcessBankInput): SpecialExcessBankSummary {
  const { cycle, asOfDate, entries, absences, calendars, settings, faltas, controlStartDate, uses, plans = [], carried = [] } = input;
  const bounds = annualCycleBounds(cycle);

  // Transportadas: mapa original-origin → fatia.
  const carriedByOrigin = new Map<string, AnnualCycleClosureSourceSlice>();
  for (const s of carried) {
    if (s.minutes > 0) {
      const existing = carriedByOrigin.get(s.originalOriginDate);
      carriedByOrigin.set(s.originalOriginDate, existing
        ? { ...existing, minutes: existing.minutes + s.minutes }
        : { ...s });
    }
  }
  const carriedOrigins = new Set(carriedByOrigin.keys());

  // GERADO (factual): excessMinutes do row — fonte factual limpa.
  const generated = new Map<string, number>();
  for (const date of listDaysBetween(bounds.from, bounds.to)) {
    const row = buildResumoDayRow({
      date, today: asOfDate, entries, absences, calendars, settings, faltas, controlStartDate,
    });
    if (row.excessMinutes > 0) generated.set(date, row.excessMinutes);
  }

  // UTILIZADO (ativo) + histórico de destinos, por origem consumível.
  const usedByOrigin = new Map<string, number>();
  const destinationsByOrigin = new Map<string, SpecialExcessLotDestination[]>();
  for (const use of uses) {
    for (const a of use.allocations) {
      if (!isConsumableInCycle(a.originDate, a.carried, cycle, carriedOrigins)) continue;
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

  // RESERVADO (4A): somente planos ATIVOS ("planned").
  const reservedByOrigin = new Map<string, number>();
  for (const plan of plans) {
    if (plan.status !== "planned") continue;
    for (const a of plan.allocations) {
      if (!isConsumableInCycle(a.originDate, a.carried, cycle, carriedOrigins)) continue;
      reservedByOrigin.set(a.originDate, (reservedByOrigin.get(a.originDate) ?? 0) + a.minutes);
    }
  }

  const originDates = new Set<string>([
    ...generated.keys(),
    ...destinationsByOrigin.keys(),
    ...reservedByOrigin.keys(),
    // 4H: fatias TRANSPORTADAS para este ciclo ficam OPERACIONAIS mesmo sem
    // uso/reserva (origem cronológica vive no ciclo ANTERIOR — nunca entra em
    // `generated`, pois este varre só as datas deste ciclo). Sem isto, um
    // saldo trazido e ainda não usado sumiria do Disponível da Central.
    ...carriedByOrigin.keys(),
  ]);
  const lots: SpecialExcessOriginLot[] = [...originDates]
    .sort()
    .map((originDate) => {
      const carriedSlice = carriedByOrigin.get(originDate);
      const isCarried = carriedSlice !== undefined;
      const g = isCarried ? 0 : (generated.get(originDate) ?? 0);
      const base = isCarried ? carriedSlice.minutes : g;
      const u = usedByOrigin.get(originDate) ?? 0;
      const r = reservedByOrigin.get(originDate) ?? 0;
      const over = Math.max(0, u - base);
      const overReserved = Math.max(0, Math.max(0, u + r - base) - over);
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
        reservedMinutes: r,
        availableMinutes: Math.max(0, base - u - r),
        overusedMinutes: over,
        overreservedMinutes: overReserved,
        needsReview: over > 0 || overReserved > 0,
        ...(isCarried
          ? {
              carried: true,
              carriedInMinutes: carriedSlice.minutes,
              originCycle: carriedSlice.originCycle,
            }
          : {}),
        destinations,
      };
    });

  const sumLot = (f: (l: SpecialExcessOriginLot) => number) => lots.reduce((s, l) => s + f(l), 0);
  const overusedMinutes = sumLot((l) => l.overusedMinutes);
  const overreservedMinutes = sumLot((l) => l.overreservedMinutes);
  const carriedLots = lots.filter((l) => l.carried);
  const carriedMinutes = carriedLots.reduce((s, l) => s + (l.carriedInMinutes ?? 0), 0);
  const carriedAvailableMinutes = carriedLots.reduce((s, l) => s + l.availableMinutes, 0);
  return {
    cycle,
    generatedMinutes: sumLot((l) => l.generatedMinutes),
    usedMinutes: sumLot((l) => l.usedMinutes),
    reservedMinutes: sumLot((l) => l.reservedMinutes),
    availableMinutes: sumLot((l) => l.availableMinutes),
    carriedAvailableMinutes,
    carriedMinutes,
    overusedMinutes,
    overreservedMinutes,
    needsReview: overusedMinutes > 0 || overreservedMinutes > 0,
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
 * Sugere as allocations de um NOVO uso/plano FIFO: lotes com disponível > 0,
 * ordenados por originDate ascendente (mais antiga primeiro — data ORIGINAL,
 * então saldo TRANSPORTADO do ciclo anterior é consumido antes de geração
 * nova), consumindo cada um até esgotar. 4H: allocation de lote transportado
 * carrega `carried: true` (origem vive no ciclo anterior — não é transação
 * comum entre ciclos: é o saldo formalmente autorizado no fechamento).
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
    allocations.push({
      originDate: lot.originDate,
      minutes: take,
      ...(lot.carried ? { carried: true as const } : {}),
    });
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
 * - origem inexistente no banco (ou de outro ciclo SEM transporte formal)
 *   → erro explícito;
 * - saldo TRANSPORTADO formalmente para o ciclo atual é origem operacional
 *   VÁLIDA (origem do ciclo anterior NÃO transportada NÃO é);
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

  // ordem informada pelo usuário (primeira ocorrência de cada origem);
  // allocation de lote transportado carrega `carried: true`.
  const allocations: SpecialExcessAllocation[] = [];
  for (const a of requestedAllocations) {
    if (!allocations.some((x) => x.originDate === a.originDate)) {
      const lot = lotByDate.get(a.originDate)!;
      allocations.push({
        originDate: a.originDate,
        minutes: totalByOrigin.get(a.originDate)!,
        ...(lot.carried ? { carried: true as const } : {}),
      });
    }
  }
  return { ok: true, requestedMinutes, allocatedMinutes: requestedMinutes, allocations };
}
