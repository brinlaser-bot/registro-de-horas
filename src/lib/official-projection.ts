// ─────────────────────────────────────────────────────────────
// PROJEÇÃO OFICIAL (Etapa 3A) — FATO REAL + [10+] UTILIZADO →
// COMO FICARIA NO SISTEMA OFICIAL.
//
// Regra-mãe: o Meu Horário registra a realidade. O saldo regular
// FACTUAL NUNCA muda quando o usuário decide utilizar [10+]; a
// projeção é uma derivação pura que responde "como o ponto oficial
// ficaria" se o uso fosse considerado.
//
// Escopo desta etapa (motor puro):
//   - projeção oficial de UM dia realizado;
//   - projeção oficial de UM PERÍODO realizado.
//
// Fora de propósito (NÃO existe nesta etapa — nem pode ser
// introduzido aqui):
//   - planejamento futuro de uso / reserva / planejado / saída
//     antecipada planejada (a decisão é tomada fora do app);
//   - SpecialExcessAgreement, banco [10+] novo, FIFO, origem manual;
//   - adapter Compensation legado, store, UI, fechamento persistido.
//
// Fontes permitidas: a camada factual já validada
// (buildResumoDayRow + balanceContribution — a MESMA fonte do Resumo
// e da Etapa 2A) e periods/time. Fontes PROIBIDAS como insumo:
// buildDebtDays, hourBankSummary, openDeficit (2C), cobertura 2B,
// ledger de compensações legado, dayCreditView de destinação.
//
// ELEGIBILIDADE: o uso de [10+] serve SOMENTE para COMPLETAR uma
// jornada factual válida que terminou ABAIXO da base efetiva.
// NÃO é elegível: falta · férias · afastamento · dia com jornada-base
// já cumprida (ok, saldo 0) · dia com saldo positivo · dia acima do
// teto (excess) · dia incompleto · dia inconsistente · dia aberto ·
// dia futuro/sem fato.
//
// Na projeção do período, a elegibilidade é o status "deficit" de
// buildResumoDayRow — que representa EXATAMENTE esse caso (ver a
// auditoria documentada em isProjectableDayStatus).
//
// [10+] no destino: serve SOMENTE para completar a jornada até a
// BASE EFETIVA do dia (neededToBase = max(base − registrável, 0)).
// Nunca cria hora extra regular artificial. Uso acima da necessidade
// — ou em dia NÃO ELEGÍVEL — NÃO é corrigido silenciosamente: aplica-
// se o necessário (0 no não elegível) e o resto é sinalizado em
// excessUsedMinutes + needsReview. A função apenas detecta.
//
// Ciclo anual (30/04): nesta etapa ainda não há modelo de
// origem/acordo — os usos chegam JÁ associados ao destino
// (destinationDate). O uso de uma data só afeta essa data, portanto
// nada aqui cruza ciclo; nenhum caminho desta API permite cruzar 30/04.
// ─────────────────────────────────────────────────────────────
import { listDaysBetween } from "./periods";
import { isRealizedDate } from "./time";
import { buildResumoDayRow, type ResumoTableStatus } from "./resumo-days";
import type { Absence } from "./absences";
import type { CompanyCalendars } from "./company-calendar";
import type { Falta, TimeEntry, WorkSettings } from "./types";

/* ── PROJEÇÃO DE UM DIA REALIZADO ─────────────────────────── */

/** Insumo factual de UM dia (valores NUNCA mutados pela projeção). */
export interface RealizedDayOfficialProjectionInput {
  /** YYYY-MM-DD. */
  date: string;
  /** Minutos trabalhados factualmente (fato — imutável). */
  factualWorkedMinutes: number;
  /** Minutos registráveis no ponto oficial = min(trabalhado, teto oficial) (fato — imutável). */
  factualRegistrableMinutes: number;
  /** Saldo regular factual do dia (registrável − base efetiva; 0 em dia sem fato) (fato — imutável). */
  factualRegularBalanceMinutes: number;
  /** Jornada-base efetiva do dia pela resolução central (0 em folga/abonado). */
  effectiveBaseMinutes: number;
  /**
   * O dia é ELEGÍVEL para uso de [10+]: jornada factual válida que
   * terminou ABAIXO da base efetiva. Na projeção do período, o critério
   * é o status "deficit" do Resumo (isProjectableDayStatus).
   */
  financialValid: boolean;
  /** O dia já foi realizado (data <= hoje). */
  realized: boolean;
  /**
   * Minutos de [10+] que o usuário EFETIVAMENTE decidiu utilizar neste
   * destino. NÃO é planejamento — é uso já decidido.
   */
  usedSpecialMinutes: number;
}

/** Motivo explícito quando `projectable = false`. */
export type DayProjectionBlockReason = "not-realized" | "not-financially-valid";

/** Resultado da projeção oficial de UM dia. */
export interface RealizedDayOfficialProjection {
  date: string;
  /**
   * A projeção é aplicável ao dia? Só quando o dia JÁ foi realizado e
   * possui fato financeiro válido. Sem isso, NÃO se inventa projeção
   * (o resultado é a identidade: projetado = factual, aplicado = 0).
   */
  projectable: boolean;
  /** Motivo quando `projectable = false`. */
  reason?: DayProjectionBlockReason;
  /* Fatos (eco dos insumos — nunca alterados): */
  factualWorkedMinutes: number;
  factualRegistrableMinutes: number;
  factualRegularBalanceMinutes: number;
  /**
   * Minutos necessários para COMPLETAR a base efetiva:
   * max(base − registrável, 0). 7h → 1h · 7h45 → 15min · 8h+ → 0.
   * 0 quando o dia não é projetável.
   */
  neededToBaseMinutes: number;
  /** [10+] efetivamente aplicado: min(usado, necessário). 0 quando não projetável. */
  appliedSpecialMinutes: number;
  /**
   * Uso acima do aplicado (usado − aplicado) — apenas sinaliza; NUNCA
   * corrige. Em dia não elegível, aplicado = 0: todo o uso é excesso.
   */
  excessUsedMinutes: number;
  /** Uso acima da necessidade do dia — precisa de revisão (nunca tratamento silencioso). */
  needsReview: boolean;
  /** Horas projetadas no ponto oficial = registrável + aplicado (o [10+] nunca ultrapassa a base). */
  projectedWorkedMinutes: number;
  /** Saldo projetado no sistema oficial = saldo factual + aplicado. */
  projectedBalanceMinutes: number;
}

/**
 * PROJEÇÃO OFICIAL de um dia realizado.
 *
 * Fórmulas (apenas quando `realized && financialValid`):
 *   neededToBase  = max(effectiveBaseMinutes − factualRegistrableMinutes, 0)
 *   applied       = min(usedSpecialMinutes, neededToBase)
 *   excessUsed    = usedSpecialMinutes − applied
 *   needsReview   = excessUsed > 0
 *   projected     = factualRegistrableMinutes + applied
 *   projectedSald = factualRegularBalanceMinutes + applied
 *
 * Dia não projetável → identidade (projetado = factual, aplicado 0,
 * needed 0): nada é projetado nem inventado. Se ainda assim houver uso
 * registrado, TODO ele é sinalizado (excessUsedMinutes + needsReview) —
 * detecção de uso indevido, SEM correção silenciosa.
 * A função é pura: não muta os insumos nem lê estado externo.
 */
export function projectRealizedDayOfficial(
  input: RealizedDayOfficialProjectionInput,
): RealizedDayOfficialProjection {
  const used = Number.isFinite(input.usedSpecialMinutes)
    ? Math.max(0, input.usedSpecialMinutes)
    : 0;
  const projectable = input.realized && input.financialValid;
  const neededToBaseMinutes = projectable
    ? Math.max(0, input.effectiveBaseMinutes - input.factualRegistrableMinutes)
    : 0;
  const appliedSpecialMinutes = projectable
    ? Math.min(used, neededToBaseMinutes)
    : 0;
  // Uso acima do aplicado — vale também para dia NÃO ELEGÍVEL, onde
  // aplicado = 0: todo o uso registrado é sinalizado (nunca corrigido).
  const excessUsedMinutes = used - appliedSpecialMinutes;

  return {
    date: input.date,
    projectable,
    reason: !projectable
      ? input.realized
        ? "not-financially-valid"
        : "not-realized"
      : undefined,
    factualWorkedMinutes: input.factualWorkedMinutes,
    factualRegistrableMinutes: input.factualRegistrableMinutes,
    factualRegularBalanceMinutes: input.factualRegularBalanceMinutes,
    neededToBaseMinutes,
    appliedSpecialMinutes,
    excessUsedMinutes,
    needsReview: excessUsedMinutes > 0,
    projectedWorkedMinutes: input.factualRegistrableMinutes + appliedSpecialMinutes,
    projectedBalanceMinutes: input.factualRegularBalanceMinutes + appliedSpecialMinutes,
  };
}

/* ── PROJEÇÃO DE UM PERÍODO REALIZADO ─────────────────────── */

/**
 * ELEGIBILIDADE (auditoria da classificação real de buildResumoDayRow /
 * resumoTableStatus): o status "deficit" representa EXATAMENTE "jornada
 * factual válida que terminou abaixo da base efetiva" — é o ÚNICO status
 * elegível para uso de [10+].
 *
 * A ordem da classificação já exclui o resto ANTES de chegar ao deficit:
 *  - "future"/"empty"/"idle" → dia não realizado, sem fato ou hoje ainda
 *    não iniciado (dia sem fato nunca é "abaixo da base");
 *  - "falta"                 → falta efetiva (checada antes do deficit);
 *  - "ferias"/"afastamento"  → ausência (integral ou parcial);
 *  - "inconsistent"          → batidas inconsistentes;
 *  - "incomplete"            → dia passado com ponto financeiro pendente;
 *  - "in-progress"           → dia ainda aberto (jornada não definida);
 *  - "excess"                → jornada acima do teto diário (10h);
 *  - "ok"                    → jornada encerrada com base cumprida
 *    (saldo 0 ou positivo).
 *
 * "deficit" só ocorre quando TODAS valem: dia realizado, com batidas,
 * consistente, encerrado (canFinalizeFinancialDay, não aberto, não
 * pendente financeiro), sem falta efetiva, sem ausência, sem excedente
 * >10h e adjustedDeficit > 0 (isAbaixoDaBase) — jornada válida ABAIXO da
 * base efetiva.
 *
 * Por isso o critério é o STATUS, não "saldo negativo": dias com saldo
 * negativo que não são jornada trabalhada (falta) ou dia trabalhado em
 * ausência têm status próprio ("falta"/"afastamento") e não elegem uso
 * de [10+].
 */
export function isProjectableDayStatus(status: ResumoTableStatus): boolean {
  return status === "deficit";
}

/** Insumo da projeção oficial de um PERÍODO. */
export interface RealizedPeriodOfficialProjectionInput {
  /** Início do escopo (YYYY-MM-DD, inclusivo). */
  from: string;
  /** Fim do escopo (YYYY-MM-DD, inclusivo). */
  to: string;
  /** Corte temporal (hoje) — injetável. */
  today: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate?: string | null;
  /**
   * [10+] EFETIVAMENTE utilizado, agregado por DESTINO (destinationDate).
   * Nesta etapa os usos chegam já filtrados/associados (não há modelo de
   * origem/acordo ainda); cada uso afeta APENAS a data do destino — nada
   * cruza 30/04 por construção. Ausente = 0 para a data.
   */
  usedSpecialMinutesByDate: Record<string, number>;
}

/** Resultado da projeção oficial de um PERÍODO. */
export interface RealizedPeriodOfficialProjection {
  from: string;
  to: string;
  /**
   * Saldo regular FACTUAL do período (Σ balanceContribution — a MESMA
   * fonte do "Saldo do período" do Resumo). INDEPENDENTE do uso de [10+].
   */
  factualBalanceMinutes: number;
  /**
   * Saldo projetado no sistema oficial = saldo factual + Σ aplicado.
   * Muda SOMENTE pelo [10+] efetivamente aplicável (limitado por dia).
   */
  projectedBalanceMinutes: number;
  /** Total de [10+] efetivamente aplicado no período (somente o aplicável). */
  appliedSpecialMinutes: number;
  /** Total de uso acima da necessidade dos dias (para revisão futura). */
  reviewRequiredMinutes: number;
  /** Datas com uso acima da necessidade (needsReview). */
  daysWithReview: string[];
  /** Projeção de cada dia do escopo (dias sem fato: projectable = false). */
  days: RealizedDayOfficialProjection[];
}

/**
 * PROJEÇÃO OFICIAL de um período realizado.
 *
 * Cada dia passa pela MESMA fonte do Resumo (buildResumoDayRow) e, só
 * então, pela projeção diária (projectRealizedDayOfficial). O saldo
 * factual do período é a soma das contribuições diárias (idêntica ao
 * "Saldo do período" do Resumo) e NUNCA é alterada pelos usos; o saldo
 * projetado soma o [10+] aplicado, sempre dentro do teto individual de
 * cada dia (completar a base — nunca hora extra artificial).
 *
 * Função pura: sem store, sem mutação, sem estado persistente.
 */
export function projectRealizedPeriodOfficial(
  input: RealizedPeriodOfficialProjectionInput,
): RealizedPeriodOfficialProjection {
  const days = listDaysBetween(input.from, input.to).map((date) => {
    const row = buildResumoDayRow({
      date,
      today: input.today,
      entries: input.entries,
      absences: input.absences,
      calendars: input.calendars,
      settings: input.settings,
      faltas: input.faltas,
      controlStartDate: input.controlStartDate,
    });
    return projectRealizedDayOfficial({
      date,
      factualWorkedMinutes: row.workedMinutes,
      factualRegistrableMinutes: row.registrableMinutes,
      factualRegularBalanceMinutes: row.balanceContribution,
      effectiveBaseMinutes: row.expectedMinutes,
      financialValid: isProjectableDayStatus(row.status),
      realized: isRealizedDate(date, input.today),
      usedSpecialMinutes: input.usedSpecialMinutesByDate?.[date] ?? 0,
    });
  });

  const factualBalanceMinutes = days.reduce(
    (s, d) => s + d.factualRegularBalanceMinutes,
    0,
  );
  const appliedSpecialMinutes = days.reduce(
    (s, d) => s + d.appliedSpecialMinutes,
    0,
  );
  const reviewRequiredMinutes = days.reduce(
    (s, d) => s + d.excessUsedMinutes,
    0,
  );

  return {
    from: input.from,
    to: input.to,
    factualBalanceMinutes,
    projectedBalanceMinutes: factualBalanceMinutes + appliedSpecialMinutes,
    appliedSpecialMinutes,
    reviewRequiredMinutes,
    daysWithReview: days.filter((d) => d.needsReview).map((d) => d.date),
    days,
  };
}
