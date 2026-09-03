// ─────────────────────────────────────────────────────────────
// ETAPA 3B — MODELO DE DOMÍNIO PURO: USO DO BANCO PARALELO [10+].
//
// SpecialExcessUse = UM registro de USO do [10+]:
//  - UM único DESTINO (dia cuja jornada está sendo completada);
//  - UMA ou VÁRIAS ORIGENS (dias que GERARAM o [10+] utilizado),
//    cada uma com seus minutos (SpecialExcessAllocation);
//  - a estratégia que escolheu as origens ("fifo" | "manual");
//  - status ("utilizado" | "cancelado");
//  - histórico preservado.
//
// Nomenclatura (decisão de produto — sem semântica de planejamento):
//  destinationDate = dia cuja jornada está sendo COMPLETADA com [10+];
//  originDate      = dia que GEROU o [10+] utilizado.
//  NUNCA inverter.
//
// Regra-mãe: o uso NÃO altera a jornada factual. O registro nasce
// "utilizado" no momento em que o usuário decide completar a jornada;
// se cancelado antes do fechamento, vira "cancelado" (NUNCA apagado).
// Futuramente alimenta a projeção oficial (official-projection.ts,
// Etapa 3A) via:
//   usedSpecialMinutesByDestination(uses) → Record<destinationDate, min>
//
// Ciclo anual: [10+] só circula dentro do MESMO ciclo anual
// (01/05–30/04, periods.ts). originDate pode ser POSTERIOR a
// destinationDate (mesmo ciclo) — usar [10+] gerado depois em um
// déficit anterior é permitido; cruzar 30/04 NÃO.
//
// NESTA ETAPA NÃO VALIDA (próximas camadas):
//  - disponibilidade do banco / saldo real de cada origem;
//  - se o destino realmente está com status "deficit";
//  - se o uso ultrapassa a necessidade da base (3A detecta no destino);
//  - algoritmo FIFO real (apenas a estratégia é registrada);
//  - fechamento real do período (periodClosed entra como insumo puro);
//  - momento em que o [10+] foi adquirido;
//  - escrita em store.
// ─────────────────────────────────────────────────────────────
import { getAnnualPointCycle, sameAnnualCycle } from "./periods";

export interface SpecialExcessAllocation {
  /** Dia que GEROU o [10+] utilizado (NUNCA o dia que está sendo completado). */
  originDate: string; // YYYY-MM-DD
  /** Minutos retirados desta origem (> 0, inteiro; a origem pode ser fracionada entre usos). */
  minutes: number;
  /**
   * 4H — true quando esta origem é saldo TRANSPORTADO: nasceu em um ciclo
   * ANTERIOR e foi formalmente autorizado para este ciclo pelo fechamento
   * anual (disposition "carried"). Por isso originDate (dia factual original)
   * vive fora do ciclo do destino. Falsy/ausente em origens FACTUAIS do
   * MESMO ciclo. Transações COMUNS entre ciclos (sem `carried`) continuam
   * proibidas (ver validador).
   */
  carried?: boolean;
}

export type SpecialExcessUseStatus = "utilizado" | "cancelado";

export type SpecialExcessAllocationStrategy = "fifo" | "manual";

export interface SpecialExcessUse {
  id: string;
  /** Dia cuja jornada está sendo COMPLETADA com [10+] (NUNCA a origem). */
  destinationDate: string; // YYYY-MM-DD
  allocations: SpecialExcessAllocation[];
  /** Como as origens foram escolhidas: "fifo" (sistema, mais antigas) | "manual" (usuário). */
  allocationStrategy: SpecialExcessAllocationStrategy;
  /** O registro nasce "utilizado"; "cancelado" preserva todo o histórico. */
  status: SpecialExcessUseStatus;
  createdAt: number;
  updatedAt?: number;
  cancelledAt?: number;
  note?: string;
}

/**
 * Total do uso em minutos — SEMPRE derivado de allocations.
 * O modelo NÃO guarda um segundo total independente (uma única fonte de verdade).
 */
export function specialExcessUseMinutes(use: SpecialExcessUse): number {
  return use.allocations.reduce((sum, a) => sum + a.minutes, 0);
}

/* ── Validação estrutural ─────────────────────────────────── */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

/** Data YYYY-MM-DD calendariamente válida. */
function isValidYmd(date: string): boolean {
  if (typeof date !== "string" || !YMD_RE.test(date)) return false;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  const max = m === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[m - 1];
  return d <= max;
}

export interface SpecialExcessUseValidation {
  ok: boolean;
  /** Todos os erros encontrados (não corrige silenciosamente; não para no primeiro). */
  errors: string[];
}

/**
 * Valida invariantes ESTRUTURAIS do uso. Não valida disponibilidade de
 * banco, saldo da origem, status do destino, excesso sobre a base, FIFO
 * real nem fechamento — isso pertence às próximas camadas (3A/3C).
 */
export function validateSpecialExcessUse(use: SpecialExcessUse): SpecialExcessUseValidation {
  const errors: string[] = [];
  if (!use || typeof use.id !== "string" || use.id.trim() === "") {
    errors.push("id-vazio");
  }
  if (!isValidYmd(use.destinationDate)) {
    errors.push(`destino-invalido: ${String(use.destinationDate)}`);
  }
  if (!Array.isArray(use.allocations) || use.allocations.length === 0) {
    errors.push("allocations-vazias");
  } else {
    const seen = new Set<string>();
    for (const a of use.allocations) {
      if (!isValidYmd(a.originDate)) {
        errors.push(`origem-invalida: ${String(a.originDate)}`);
      }
      if (!Number.isFinite(a.minutes) || !Number.isInteger(a.minutes) || a.minutes <= 0) {
        errors.push(`minutos-invalidos: ${a.originDate}=${String(a.minutes)}`);
      }
      if (seen.has(a.originDate)) {
        errors.push(`origem-duplicada: ${a.originDate}`);
      }
      seen.add(a.originDate);
      if (isValidYmd(a.originDate) && isValidYmd(use.destinationDate)) {
        const sameCycle = sameAnnualCycle(use.destinationDate, a.originDate);
        if (a.carried === true) {
          // Saldo TRANSPORTADO: nasceu em ciclo ANTERIOR (origem fora do ciclo
          // do destino) — permitido SOMENTE pela autorização formal do
          // fechamento. Um allocation marcado carried no MESMO ciclo é
          // inconsistente (transporte nunca é intra-ciclo).
          if (sameCycle) {
            errors.push(
              `carried-no-mesmo-ciclo: origem ${a.originDate} e destino ${use.destinationDate} no mesmo ciclo não podem ser transporte`,
            );
          }
        } else if (!sameCycle) {
          errors.push(
            `ciclos-diferentes: origem ${a.originDate} (${getAnnualPointCycle(a.originDate)}) x destino ${use.destinationDate} (${getAnnualPointCycle(use.destinationDate)})`,
          );
        }
      }
    }
  }
  if (use.allocationStrategy !== "fifo" && use.allocationStrategy !== "manual") {
    errors.push(`estrategia-invalida: ${String(use.allocationStrategy)}`);
  }
  if (use.status !== "utilizado" && use.status !== "cancelado") {
    errors.push(`status-invalido: ${String(use.status)}`);
  }
  if (use.status === "cancelado" && (use.cancelledAt === undefined || use.cancelledAt === null)) {
    errors.push("cancelado-sem-cancelledAt");
  }
  if (use.status === "utilizado" && use.cancelledAt !== undefined && use.cancelledAt !== null) {
    errors.push("utilizado-com-cancelledAt");
  }
  return { ok: errors.length === 0, errors };
}

/* ── Agregados (somente usos ATIVOS — cancelados não consomem banco) ── */

/** Apenas usos com status "utilizado". */
export function activeSpecialExcessUses(uses: SpecialExcessUse[]): SpecialExcessUse[] {
  return uses.filter((u) => u.status === "utilizado");
}

/**
 * Soma ATIVA de minutos por DESTINO.
 * Formato exato do insumo `usedSpecialMinutesByDate` da projeção oficial
 * (projectRealizedPeriodOfficial, Etapa 3A) — a ponte 3B → 3A.
 */
export function usedSpecialMinutesByDestination(uses: SpecialExcessUse[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of activeSpecialExcessUses(uses)) {
    out[u.destinationDate] = (out[u.destinationDate] ?? 0) + specialExcessUseMinutes(u);
  }
  return out;
}

/** Soma ATIVA de minutos por ORIGEM (base para o cálculo de disponível — 3C). */
export function usedSpecialMinutesByOrigin(uses: SpecialExcessUse[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of activeSpecialExcessUses(uses)) {
    for (const a of u.allocations) {
      out[a.originDate] = (out[a.originDate] ?? 0) + a.minutes;
    }
  }
  return out;
}

/* ── Rastreabilidade bidirecional (histórico completo, inclusive cancelados) ── */

export interface SpecialExcessOriginTrace {
  useId: string;
  status: SpecialExcessUseStatus;
  destinationDate: string;
  minutes: number;
}

/** ORIGEM → destinos: para uma origem, quem utilizou quantos minutos para onde. */
export function specialUseDestinationsForOrigin(
  uses: SpecialExcessUse[],
  originDate: string,
): SpecialExcessOriginTrace[] {
  const out: SpecialExcessOriginTrace[] = [];
  for (const u of uses) {
    for (const a of u.allocations) {
      if (a.originDate === originDate) {
        out.push({ useId: u.id, status: u.status, destinationDate: u.destinationDate, minutes: a.minutes });
      }
    }
  }
  return out;
}

export interface SpecialExcessDestinationTrace {
  useId: string;
  status: SpecialExcessUseStatus;
  allocations: SpecialExcessAllocation[];
  totalMinutes: number;
}

/** DESTINO → origens: para um destino, de quais origens o [10+] veio. */
export function specialUseOriginsForDestination(
  uses: SpecialExcessUse[],
  destinationDate: string,
): SpecialExcessDestinationTrace[] {
  const out: SpecialExcessDestinationTrace[] = [];
  for (const u of uses) {
    if (u.destinationDate === destinationDate) {
      out.push({ useId: u.id, status: u.status, allocations: u.allocations, totalMinutes: specialExcessUseMinutes(u) });
    }
  }
  return out;
}

/* ── Permissão de edição/cancelamento (estado puro — sem store) ── */

export interface CanEditSpecialExcessUseResult {
  allowed: boolean;
  reason?: "period-closed" | "already-cancelled";
}

/**
 * Permissão conceitual de editar/cancelar um uso. O estado real de
 * fechamento do período ainda NÃO existe no projeto — quem decidir o uso
 * futuramente passará `periodClosed` como insumo puro.
 *
 *  - periodClosed = true  → nunca editável/cancelável;
 *  - uso já cancelado    → não pode ser tratado como ativo (histórico imutável);
 *  - caso contrário      → editável/cancelável.
 */
export function canEditSpecialExcessUse(args: {
  use: SpecialExcessUse;
  periodClosed: boolean;
}): CanEditSpecialExcessUseResult {
  if (args.periodClosed) return { allowed: false, reason: "period-closed" };
  if (args.use.status === "cancelado") return { allowed: false, reason: "already-cancelled" };
  return { allowed: true };
}
