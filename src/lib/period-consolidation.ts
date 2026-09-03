// ─────────────────────────────────────────────────────────────
// CONSOLIDAÇÃO SEGURA DO PERÍODO DO PONTO (ETAPA 4G).
//
// A consolidação CONGELA a fotografia do resultado que o usuário decidiu
// considerar no sistema oficial. Ela NUNCA transforma projeção em factual:
// o saldo factual permanece para sempre como história real.
//
// Fontes do snapshot (mesmas da tela): buildResumoPeriodView (3F),
// resumoPeriodPendencies (attention-now 4D.5) e resumoSpecialPeriodMovement
// (banco [10+]) — nenhuma segunda matemática.
//
// GUARD DE MUTAÇÃO (regra-mãe): uma consolidação ATIVA congela o período.
// O motor/action rejeita mutação inválida mesmo se acionada fora da tela —
// a UI não é segurança lógica.
// ─────────────────────────────────────────────────────────────
import { getPointPeriod } from "./periods";

/** Fotografia imutável de um fechamento (revision NUNCA é sobrescrita:
 *  nova consolidação após reabertura cria revision+1; somente uma revisão
 *  pode estar "active" por período). */
export interface PeriodConsolidation {
  id: number;
  periodStart: string; // YYYY-MM-DD (21)
  periodEnd: string; // YYYY-MM-DD (20)
  cycleStart: string;
  cycleEnd: string;
  consolidatedAt: number; // epoch ms
  revision: number;
  /** active = resultado vigente · superseded = reaberta/substituída (histórico). */
  status: "active" | "superseded";
  /** Fotografia da apuração (factual permanece história real — nunca é reescrito). */
  factualBalanceMinutes: number;
  projectedBalanceMinutes: number;
  regularPositiveMinutes: number;
  regularNegativeMinutes: number;
  trackedDays: number;
  /** [10+] utilizado com DESTINO dentro do período. */
  specialExcessUsedMinutes: number;
  /** IDs dos SpecialExcessUse que compõem o resultado. */
  useIds: string[];
  /** Snapshot das allocations desses usos (rastreabilidade origem → destino). */
  allocations: { originDate: string; minutes: number }[];
  /** Pendências de apuração no momento da consolidação (invariantemente 0). */
  pendingCountAtConsolidation: number;
  /** Reabertura (histórico preservado; consolidatedAt original intocado). */
  reopenedAt: number | null;
  reopenNote: string | null;
}

/** Consolidação ATIVA que cobre exatamente o período informado. */
export function activeConsolidationForPeriod(
  list: PeriodConsolidation[] | undefined,
  periodStart: string,
  periodEnd: string,
): PeriodConsolidation | null {
  return (
    (list ?? []).find(
      (c) => c.status === "active" && c.periodStart === periodStart && c.periodEnd === periodEnd,
    ) ?? null
  );
}

/** Consolidação ATIVA que contém a data (guard central de mutação). */
export function consolidationLockForDate(
  list: PeriodConsolidation[] | undefined,
  date: string,
): PeriodConsolidation | null {
  return (list ?? []).find((c) => c.status === "active" && date >= c.periodStart && date <= c.periodEnd) ?? null;
}

/** Consolidação ATIVA que cobre TODO o intervalo exibido (banner do Registros). */
export function consolidationLockCoveringRange(
  list: PeriodConsolidation[] | undefined,
  from: string,
  to: string,
): PeriodConsolidation | null {
  return (
    (list ?? []).find((c) => c.status === "active" && from >= c.periodStart && to <= c.periodEnd) ?? null
  );
}

/** true quando alguma data do intervalo pertence a um período consolidado. */
export function rangeIntersectsConsolidation(
  list: PeriodConsolidation[] | undefined,
  from: string,
  to: string,
): PeriodConsolidation | null {
  return (list ?? []).find((c) => c.status === "active" && to >= c.periodStart && from <= c.periodEnd) ?? null;
}

export type PeriodConsolidationStateId =
  | "em-andamento"
  | "encerrado-com-pendencias"
  | "pronto-para-consolidar"
  | "consolidado"
  | "reaberto-para-ajustes";

export const PERIOD_CONSOLIDATION_LABEL: Record<PeriodConsolidationStateId, string> = {
  "em-andamento": "Em andamento",
  "encerrado-com-pendencias": "Encerrado com pendências",
  "pronto-para-consolidar": "Pronto para consolidar",
  "consolidado": "Consolidado",
  "reaberto-para-ajustes": "Reaberto para ajustes",
};

/** Derivação do ESTADO do período (nenhum status manual arbitrário):
 *  1. consolidação ativa ⇒ CONSOLIDADO;
 *  2. today <= periodEnd ⇒ EM ANDAMENTO;
 *  3. today > periodEnd com revisão anterior reaberta ⇒ REABERTO PARA AJUSTES;
 *  4. today > periodEnd com pendências bloqueantes ⇒ ENCERRADO COM PENDÊNCIAS;
 *  5. caso restante ⇒ PRONTO PARA CONSOLIDAR.
 *  Não existe fechamento automático: passar o dia 21 apenas ENCERRA
 *  temporalmente — consolidar exige ação explícita. */
export function periodConsolidationState(input: {
  today: string;
  periodStart: string;
  periodEnd: string;
  consolidations: PeriodConsolidation[] | undefined;
  blockedCount: number;
}): PeriodConsolidationStateId {
  const { today, periodStart, periodEnd, consolidations, blockedCount } = input;
  if (activeConsolidationForPeriod(consolidations, periodStart, periodEnd)) return "consolidado";
  if (today <= periodEnd) return "em-andamento";
  const hasSuperseded = (consolidations ?? []).some(
    (c) => c.periodStart === periodStart && c.periodEnd === periodEnd && c.status === "superseded",
  );
  if (hasSuperseded) return "reaberto-para-ajustes";
  if (blockedCount > 0) return "encerrado-com-pendencias";
  return "pronto-para-consolidar";
}

/** Período do ponto que contém a data (para bloquear uso/plano retroativo
 *  cujo destino caia em consolidado, e para comparar calendários). */
export function periodOfDate(date: string): { periodStart: string; periodEnd: string } {
  const p = getPointPeriod(date);
  return { periodStart: p.from, periodEnd: p.to };
}

/** Comparação canônica de UMA data de calendário (significado, não metadados
 *  de importação: descricao/categoria/importedAt/version são irrelevantes). */
export function calendarEntryCanonicalKey(e: {
  tratamento: string;
  horasACompensar: number;
  jornadaEsperadaHoras: number;
  horasAbonadas: number;
}): string {
  return `${e.tratamento}|${e.horasACompensar}|${e.jornadaEsperadaHoras}|${e.horasAbonadas}`;
}

/** Datas dentro de períodos consolidados ATIVOS em que o calendário mudou
 *  de significado canônico (entrada removida, adicionada ou alterada).
 *  Usado pelo guard de importação/substituição de calendário. */
export function consolidatedCalendarConflicts(input: {
  consolidations: PeriodConsolidation[] | undefined;
  before?: { date: string; tratamento: string; horasACompensar: number; jornadaEsperadaHoras: number; horasAbonadas: number }[];
  after?: { date: string; tratamento: string; horasACompensar: number; jornadaEsperadaHoras: number; horasAbonadas: number }[];
}): string[] {
  const locks = (input.consolidations ?? []).filter((c) => c.status === "active");
  if (locks.length === 0) return [];
  const beforeMap = new Map((input.before ?? []).map((e) => [e.date, calendarEntryCanonicalKey(e)]));
  const afterMap = new Map((input.after ?? []).map((e) => [e.date, calendarEntryCanonicalKey(e)]));
  const conflicts: string[] = [];
  for (const lock of locks) {
    for (const [date, key] of beforeMap) {
      if (date >= lock.periodStart && date <= lock.periodEnd && afterMap.get(date) !== key) conflicts.push(date);
    }
    for (const [date, key] of afterMap) {
      if (date >= lock.periodStart && date <= lock.periodEnd && beforeMap.get(date) !== key) conflicts.push(date);
    }
  }
  return [...new Set(conflicts)].sort();
}
