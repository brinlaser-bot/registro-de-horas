// ─────────────────────────────────────────────────────────────
// ETAPA 3G — RECONCILIAÇÃO DO [10+] APÓS ALTERAÇÃO DA JORNADA FACTUAL.
//
// BUG ESTRUTURAL corrigido: o usuário utilizava [10+] para completar uma
// jornada (ex.: 7h → precisa 1h), ALTERAVA as batidas (ex.: 7h → 8h) e o
// uso ativo continuava consumindo o banco mesmo sem necessidade.
//
// REGRA-MÃE (3G): para um destino com uso ativo de [10+],
//
//   ACTIVE_SPECIAL_USED  ≤  NEEDED_TO_BASE
//
// depois de uma alteração factual VÁLIDA E FINALIZADA ser confirmada,
// onde NEEDED_TO_BASE é a REGRA JÁ CONSOLIDADA NA 3A
// (official-projection.ts): max(base efetiva − registrável, 0), aplicada
// ao estado PROSPECTIVO do dia (como ele ficará após a edição). Nenhuma
// segunda fórmula: o need é LIDO da própria projeção 3A do dia.
//
// O helper é PURO: recebe o destino, o estado factual PROSPECTIVO do dia
// e os usos ativos do destino; devolve um PLANO determinístico.
// NÃO persiste nada. NÃO altera fatos. NÃO usa mais [10+] automaticamente
// (só reduz/cancela — necessidade maior que o uso ativo NÃO gera consumo).
//
// Preservação de histórico (3B): usos NUNCA são apagados. Liberação total
// → cancelamento histórico (status "cancelado"). Redução parcial de um uso
// → o original é cancelado (id/allocations/strategy/createdAt/nota
// preservados) e uma versão ativa reconciliada é criada com o PREFIXO das
// allocations originais, na MESMA estratégia (fifo continua fifo, manual
// continua manual) e SEM novas origens.
//
// Múltiplos usos no mesmo destino: reconcilia dos mais ANTIGOS para os
// mais novos (os mais antigos permanecem inteiros; o uso que atravessa o
// limite é o único reduzido; os posteriores são cancelados).
//
// Estados NÃO reconciliáveis (futuro, incompleto, inconsistente, falta,
// férias, afastamento, dia aberto, sem registro): o plano NÃO destrói uso
// — correções em várias etapas nunca cancelam [10+] no meio do caminho.
// ─────────────────────────────────────────────────────────────
import { projectRealizedDayOfficial } from "./official-projection";
import type { ResumoTableStatus } from "./resumo-days";
import {
  specialExcessUseMinutes,
  type SpecialExcessAllocation,
  type SpecialExcessUse,
} from "./special-excess-use";

/**
 * Únicos status prospectivos em que a jornada factual é VÁLIDA, ENCERRADA
 * e financeiramente calculável — os mesmos da auditoria de elegibilidade
 * da 3A: "deficit" (abaixo da base — pode precisar de [10+]), "ok" (base
 * cumprida) e "excess" (acima do teto). Neles o need é lido da 3A.
 * Qualquer outro status (incomplete/inconsistent/falta/férias/afastamento/
 * in-progress/future/empty/idle) NÃO é reconciliável: nada é cancelado.
 */
const RECONCILABLE_STATUS: readonly ResumoTableStatus[] = ["deficit", "ok", "excess"];

/** Decisão determinística por uso ativo do destino (ordem: mais antigo primeiro). */
export type SpecialReconciliationDecision =
  | { useId: string; action: "keep"; keepAllocations: SpecialExcessAllocation[] }
  | { useId: string; action: "cancel"; keepAllocations: [] }
  | {
      useId: string;
      action: "reduce";
      /** PREFIXO das allocations históricas, na ordem registrada (§16/§18). */
      keepAllocations: SpecialExcessAllocation[];
      /** Parte liberada de volta ao banco (eco para auditoria/UI). */
      releasedAllocations: SpecialExcessAllocation[];
    };

/** PLANO puro da reconciliação de UM destino — nada aqui persiste. */
export interface SpecialReconciliationPlan {
  destinationDate: string;
  /**
   * O dia PROSPECTIVO é válido e encerrado (financeiramente calculável)?
   * false → plano inerte (nenhuma decisão destrutiva; release 0).
   */
  reconcilable: boolean;
  /** Σ usos ativos do destino ANTES da reconciliação. */
  activeUsedMinutesBefore: number;
  /**
   * Necessidade após a edição — REGRA 3A lida no estado prospectivo
   * (max(base efetiva − registrável, 0)). null quando o dia prospectivo
   * não é reconciliável (não se inventa need para dia inválido).
   */
  neededMinutesAfter: number | null;
  /** Σ usos ativos permitida APÓS a reconciliação = min(before, need). */
  allowedUsedMinutesAfter: number;
  /** Volta ao banco: before − allowedAfter (0 quando nada muda). */
  releaseMinutes: number;
  /** true somente quando releaseMinutes > 0 (exige confirmação humana). */
  needsReconciliation: boolean;
  /** Decisões por uso (todas "keep" quando o plano é inerte). */
  decisions: SpecialReconciliationDecision[];
  /* ── Ecos do estado prospectivo (para a confirmação humana, §29) ── */
  prospectiveWorkedMinutes: number;
  /** Base efetiva do dia prospectivo (jornada esperada). */
  prospectiveBaseMinutes: number;
  prospectiveRegistrableMinutes: number;
}

/**
 * Consome um LIMITE de minutos preservando o PREFIXO das allocations na
 * ordem registrada (§18): A40+B20 com limite 30 → A30 (libera 10 de A+B20);
 * limite 45 → A40+B5 (libera 15 de B). NUNCA reordena nem traz origem nova.
 */
function trimAllocationsPrefix(
  allocations: SpecialExcessAllocation[],
  limitMinutes: number,
): { kept: SpecialExcessAllocation[]; released: SpecialExcessAllocation[] } {
  let remaining = limitMinutes;
  const kept: SpecialExcessAllocation[] = [];
  const released: SpecialExcessAllocation[] = [];
  for (const a of allocations) {
    if (remaining >= a.minutes) {
      kept.push(a);
      remaining -= a.minutes;
    } else if (remaining > 0) {
      kept.push({ originDate: a.originDate, minutes: remaining });
      released.push({ originDate: a.originDate, minutes: a.minutes - remaining });
      remaining = 0;
    } else {
      released.push(a);
    }
  }
  return { kept, released };
}

/**
 * Plano de reconciliação de UM destino (função pura, determinística).
 *
 * `uses` deve conter APENAS os usos ATIVOS do destino (cancelados não
 * participam — 3B/§25). A ordem de reconciliação é por createdAt asc
 * (mais antigo primeiro; empate mantém a ordem do array).
 */
export function planSpecialExcessReconciliation(args: {
  destinationDate: string;
  /** Status PROSPECTIVO do dia (buildResumoDayRow após a edição). */
  prospectiveStatus: ResumoTableStatus;
  /** Fatos PROSPECTIVOS do dia (após a edição confirmada). */
  prospectiveWorkedMinutes: number;
  /** Base efetiva (jornada esperada) do dia prospectivo. */
  prospectiveBaseMinutes: number;
  /** Registrável no ponto oficial (min(trabalhado, teto)) do dia prospectivo. */
  prospectiveRegistrableMinutes: number;
  uses: SpecialExcessUse[];
}): SpecialReconciliationPlan {
  const uses = [...args.uses]
    .filter((u) => u.status === "utilizado")
    .filter((u) => u.destinationDate === args.destinationDate) // §26: reconciliação é POR destino
    .sort((a, b) => a.createdAt - b.createdAt || 0);

  const activeUsedMinutesBefore = uses.reduce((s, u) => s + specialExcessUseMinutes(u), 0);

  // Dia prospectivo precisa estar realizado, válido e ENCERRADO para que a
  // reconciliação seja avaliada (§12): correção multi-etapa nunca destrói
  // uso em estado intermediário (§40).
  const reconcilable = RECONCILABLE_STATUS.includes(args.prospectiveStatus);

  // NECESSIDADE: regra JÁ consolidada na 3A (official-projection) —
  // neededToBase = max(base efetiva − registrável, 0) lida do motor.
  // "deficit" é o único status financeiramente válido para a 3A; em ok/excess
  // a própria 3A devolve need 0. Dia não reconciliável → need null (nada).
  const neededMinutesAfter = reconcilable
    ? projectRealizedDayOfficial({
        date: args.destinationDate,
        factualWorkedMinutes: args.prospectiveWorkedMinutes,
        factualRegistrableMinutes: args.prospectiveRegistrableMinutes,
        factualRegularBalanceMinutes: 0,
        effectiveBaseMinutes: args.prospectiveBaseMinutes,
        financialValid: args.prospectiveStatus === "deficit",
        realized: true,
        usedSpecialMinutes: 0,
      }).neededToBaseMinutes
    : null;

  // SOMENTE REDUZ (§4): necessidade maior que o uso ativo NÃO consome mais
  // banco automaticamente — allowed = min(before, need).
  const allowedUsedMinutesAfter =
    neededMinutesAfter === null ? activeUsedMinutesBefore : Math.min(activeUsedMinutesBefore, neededMinutesAfter);
  const releaseMinutes = activeUsedMinutesBefore - allowedUsedMinutesAfter;
  const needsReconciliation = reconcilable && releaseMinutes > 0;

  const decisions: SpecialReconciliationDecision[] = [];
  if (needsReconciliation) {
    let remaining = allowedUsedMinutesAfter; // §15: preservar os mais antigos primeiro
    for (const u of uses) {
      const total = specialExcessUseMinutes(u);
      if (remaining >= total) {
        decisions.push({ useId: u.id, action: "keep", keepAllocations: u.allocations });
        remaining -= total;
      } else if (remaining > 0) {
        // Limite corta DENTRO deste uso: preservar os anteriores inteiros e
        // reconciliar SÓ este, com o PREFIXO das allocations históricas.
        const { kept, released } = trimAllocationsPrefix(u.allocations, remaining);
        decisions.push({ useId: u.id, action: "reduce", keepAllocations: kept, releasedAllocations: released });
        remaining = 0;
      } else {
        decisions.push({ useId: u.id, action: "cancel", keepAllocations: [] });
      }
    }
  } else {
    for (const u of uses) decisions.push({ useId: u.id, action: "keep", keepAllocations: u.allocations });
  }

  return {
    destinationDate: args.destinationDate,
    reconcilable,
    activeUsedMinutesBefore,
    neededMinutesAfter,
    allowedUsedMinutesAfter,
    releaseMinutes,
    needsReconciliation,
    decisions,
    prospectiveWorkedMinutes: args.prospectiveWorkedMinutes,
    prospectiveBaseMinutes: args.prospectiveBaseMinutes,
    prospectiveRegistrableMinutes: args.prospectiveRegistrableMinutes,
  };
}
