// ─────────────────────────────────────────────────────────────
// ETAPA 4A — MODELO DE DOMÍNIO PURO: PLANEJAMENTO/RESERVA FUTURA [10+].
//
// SpecialExcessPlan = UMA RESERVA de [10+] para um DIA FUTURO:
//  - UM único DESTINO (dia futuro para o qual o saldo foi reservado);
//  - UMA ou VÁRIAS ORIGENS (dias que GERARAM o [10+] reservado), cada
//    uma com seus minutos — a MESMA SpecialExcessAllocation dos usos
//    (uma única forma de allocation, sem segunda matemática);
//  - o MODO de escolha das origens: "automatic" (FIFO canônico 3C, mais
//    antigas primeiro) | "manual" (escolha explícita do usuário — a
//    origem manual NUNCA é substituída silenciosamente);
//  - status: "planned" (ativa — reserva de fato) | "cancelled" |
//    "concluded"; o histórico NUNCA é apagado.
//
// Nomenclatura (NUNCA inverter):
//  destinationDate = dia FUTURO para o qual o saldo foi RESERVADO;
//  originDate      = dia que GEROU o [10+] reservado.
//
// PLANEJADO NÃO É UTILIZADO (regra-mãe §1/§5): a reserva NÃO altera
// jornada factual, saldo regular, "No ponto", Resumo, dias recentes,
// SpecialExcessUse nem a projeção oficial de dia realizado. Nesta etapa
// a reserva é SOMENTE camada de domínio/persistência: sem projeção
// futura visual, sem UI, sem conversão plano→uso (etapa posterior).
//
// Fórmula canônica do banco após a 4A (special-excess-bank.ts):
//   DISPONÍVEL = GERADO − UTILIZADO ATIVO − RESERVADO ATIVO
// O total do plano é SEMPRE derivado de allocations (uma única fonte
// de verdade — nenhum campo de total independente, como nos usos).
//
// Regras de criação (camada superior/store — aqui é só estrutura):
//  - destinationDate deve ser FUTURA em relação à data civil do app
//    (America/Sao_Paulo; nunca toISOString() para decidir dia civil);
//    dias realizados usam SpecialExcessUse, não SpecialExcessPlan;
//  - ciclo anual: nenhuma reserva atravessa 30/04 — origem e destino
//    no MESMO ciclo (01/05→30/04).
//
// "concluded" (§16) apenas DESLIGA a reserva: deixa de contar como
// reserved, NÃO cria SpecialExcessUse, NÃO conclui acordo e NÃO altera
// projeção. A transformação PLANO → USO REAL é uma etapa futura.
// ─────────────────────────────────────────────────────────────
import { sameAnnualCycle } from "./periods";
import type { SpecialExcessAllocation } from "./special-excess-use";

/** "planned" reserva de fato; "cancelled"/"concluded" são histórico (não consomem). */
export type SpecialExcessPlanStatus = "planned" | "cancelled" | "concluded";

/** Como as origens foram escolhidas: "automatic" (FIFO 3C) | "manual" (usuário). */
export type SpecialExcessPlanSelectionMode = "automatic" | "manual";

export interface SpecialExcessPlan {
  id: string;
  /** Dia FUTURO para o qual o [10+] foi RESERVADO (NUNCA a origem). */
  destinationDate: string; // YYYY-MM-DD
  /** Origens que lastreiam a reserva (mesma forma dos usos — 3B). */
  allocations: SpecialExcessAllocation[];
  /** Como as origens foram escolhidas: "automatic" | "manual". */
  selectionMode: SpecialExcessPlanSelectionMode;
  /** Nasce "planned"; "cancelled"/"concluded" preservam todo o histórico. */
  status: SpecialExcessPlanStatus;
  createdAt: number;
  updatedAt?: number;
  cancelledAt?: number;
  concludedAt?: number;
  /* ── 4C — RASTREABILIDADE DA RESOLUÇÃO (somente na conclusão por uso) ──
     Preenchidos ATOMICAMENTE por resolveSpecialExcessPlan: quanto do plano
     virou uso, quanto voltou ao banco, qual uso foi criado e quando.
     Informação estrutural — NUNCA depender só da note. Opcional: planos
     antigos (backup 4A/4A.1) não os têm. */
  resolvedAt?: number;
  resolvedUseId?: string;
  resolvedMinutes?: number;
  releasedMinutes?: number;
  note?: string;
}

/**
 * Total da reserva em minutos — SEMPRE derivado de allocations.
 * O modelo NÃO guarda um segundo total independente (uma única fonte
 * de verdade, igual a specialExcessUseMinutes).
 */
export function specialExcessPlanMinutes(plan: SpecialExcessPlan): number {
  return plan.allocations.reduce((sum, a) => sum + a.minutes, 0);
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

export interface SpecialExcessPlanValidation {
  ok: boolean;
  /** Todos os erros encontrados (não corrige silenciosamente; não para no primeiro). */
  errors: string[];
}

/**
 * Valida invariantes ESTRUTURAIS do plano. NÃO valida disponibilidade de
 * banco, lastro por origem, futuro do destino nem conflito com usos —
 * isso pertence às camadas 3C/4A (store). O futuro do destino é regra de
 * CRIAÇÃO (um plano legítimo envelhece: o destino chega a ser "hoje").
 */
export function validateSpecialExcessPlan(plan: SpecialExcessPlan): SpecialExcessPlanValidation {
  const errors: string[] = [];
  if (!plan || typeof plan.id !== "string" || plan.id.trim() === "") {
    errors.push("id-vazio");
  }
  if (!isValidYmd(plan.destinationDate)) {
    errors.push(`destino-invalido: ${String(plan.destinationDate)}`);
  }
  if (!Array.isArray(plan.allocations) || plan.allocations.length === 0) {
    errors.push("allocations-vazias");
  } else {
    const seen = new Set<string>();
    for (const a of plan.allocations) {
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
      // Ciclo anual: a reserva NUNCA atravessa o fechamento em 30/04.
      if (
        isValidYmd(a.originDate) &&
        isValidYmd(plan.destinationDate) &&
        !sameAnnualCycle(plan.destinationDate, a.originDate)
      ) {
        errors.push(`ciclos-diferentes: origem ${a.originDate} x destino ${plan.destinationDate}`);
      }
    }
  }
  if (plan.selectionMode !== "automatic" && plan.selectionMode !== "manual") {
    errors.push(`modo-invalido: ${String(plan.selectionMode)}`);
  }
  if (plan.status !== "planned" && plan.status !== "cancelled" && plan.status !== "concluded") {
    errors.push(`status-invalido: ${String(plan.status)}`);
  }
  if (plan.status === "cancelled" && (plan.cancelledAt === undefined || plan.cancelledAt === null)) {
    errors.push("cancelado-sem-cancelledAt");
  }
  if (plan.status === "concluded" && (plan.concludedAt === undefined || plan.concludedAt === null)) {
    errors.push("concluido-sem-concludedAt");
  }
  if (plan.status === "planned" && (plan.cancelledAt !== undefined || plan.concludedAt !== undefined || plan.resolvedAt !== undefined)) {
    errors.push("planejado-com-cancelledAt-ou-concludedAt");
  }
  return { ok: errors.length === 0, errors };
}

/* ── Agregados (somente planos ATIVOS — cancelados/concluídos não reservam) ── */

/** Apenas planos com status "planned" (os únicos que consomem disponibilidade). */
export function activeSpecialExcessPlans(plans: SpecialExcessPlan[]): SpecialExcessPlan[] {
  return plans.filter((p) => p.status === "planned");
}

/**
 * Soma ATIVA de minutos reservados por ORIGEM — insumo da fórmula canônica
 * do banco 4A: DISPONÍVEL = GERADO − UTILIZADO − RESERVADO.
 */
export function reservedSpecialMinutesByOrigin(plans: SpecialExcessPlan[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of activeSpecialExcessPlans(plans)) {
    for (const a of p.allocations) {
      out[a.originDate] = (out[a.originDate] ?? 0) + a.minutes;
    }
  }
  return out;
}

/**
 * Planos ATIVOS ("planned") com destino NA data — insumo do badge/detalhe
 * da UI (4B). Cancelados/concluídos não aparecem (não reservam).
 */
export function activeSpecialPlansForDate(plans: SpecialExcessPlan[], destinationDate: string): SpecialExcessPlan[] {
  return plans.filter((p) => p.status === "planned" && p.destinationDate === destinationDate);
}

/* ── Rastreabilidade (histórico completo, inclusive cancelados/concluídos) ── */

export interface SpecialExcessPlanTrace {
  planId: string;
  status: SpecialExcessPlanStatus;
  destinationDate: string;
  minutes: number;
}

/** ORIGEM → planos: para uma origem, quem reservou quantos minutos para onde. */
export function specialPlanReservationsForOrigin(
  plans: SpecialExcessPlan[],
  originDate: string,
): SpecialExcessPlanTrace[] {
  const out: SpecialExcessPlanTrace[] = [];
  for (const p of plans) {
    for (const a of p.allocations) {
      if (a.originDate === originDate) {
        out.push({
          planId: p.id,
          status: p.status,
          destinationDate: p.destinationDate,
          minutes: a.minutes,
        });
      }
    }
  }
  return out;
}
