// Tipos compartilhados — app 100% client-side (sem banco de dados)
import type { DayResult, DayStatus, EntryType, WorkSettings } from "./time";

export type { DayResult, DayStatus, EntryType, WorkSettings };

export interface User {
  id: number;
  name: string;
  email: string;
  workStart: string;
  workEnd: string;
  lunchStart: string;
  lunchEnd: string;
  maxDailyMinutes: number;
  autoDeductLunch: boolean;
  /** Data de nascimento (YYYY-MM-DD, data local) — usada no banner de
   *  aniversário e na SUGESTÃO de data do Abono de aniversário. Opcional. */
  birthDate?: string | null;
  /**
   * Data LOCAL (YYYY-MM-DD) a partir da qual o app cobra registro ou
   * justificativa. Dias anteriores não são Sem registro. Opcional em dados
   * antigos — a hidratação preenche. */
  controlStartDate?: string | null;
  /**
   * 4I — GUIA DO PONTO (opcional, retrocompatível): horários usados APENAS
   * para montar sugestões de lançamento quando horas [10+] precisam ser
   * representadas no sistema oficial. NUNCA alteram batidas reais, saldo,
   * projeção ou qualquer motor. HH:MM em America/Sao_Paulo (data civil).
   * Ausentes em dados antigos → defaults 08:00 / 17:45.
   */
  guideMinEntry?: string | null;
  guideMaxExit?: string | null;
}

export interface TimeEntry {
  id: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  type: EntryType;
  note: string | null;
  /** live = ponto registrado em tempo real · manual = lançado/editado depois */
  source?: "live" | "manual";
  /** true quando o registro foi editado manualmente após o lançamento */
  edited?: boolean;
}

export type CompStatus = "pendente" | "concluida" | "cancelada";

/**
 * excedente: dia passou de 10h → compensa SAINDO MAIS CEDO no dia destino.
 * deficit:   dia ficou abaixo da base → compensa FAZENDO HORA EXTRA no destino.
 * acordo:    horas de afastamento acordado "a compensar" → HORA EXTRA no destino
 *            (sempre dentro do mesmo ciclo anual da origem).
 */
export type CompKind = "excedente" | "deficit" | "acordo" | "calendario";

export interface Compensation {
  id: number;
  sourceDate: string;
  targetDate: string;
  minutes: number;
  status: CompStatus;
  note: string | null;
  createdAt: number;
  kind?: CompKind; // ausente = "excedente" (compatível com dados antigos)
  /**
   * Porção do crédito REALIZADO consumida no dia de destino (§5/§8):
   * "especial" = reserva do excedente acima de 10h (exige motivo);
   * "regular"/ausente = crédito comum até o limite diário.
   * Ausente em registros antigos → atribuição regular primeiro (legado).
   */
  portion?: "regular" | "especial";
}

/** Resumo de um dia que gerou dívida de horas (excesso ou déficit). */
export interface DebtDay {
  date: string;
  kind: CompKind;
  workedMinutes: number;
  expectedMinutes: number;
  debtMinutes: number; // total original (excedente ou déficit)
  allocatedMinutes: number; // já vinculado a compensações ativas (planejado + concluído)
  pendingMinutes: number; // vinculado e ainda pendente de execução
  concludedMinutes: number; // vinculado e já concluído
  remainingMinutes: number; // ainda falta ALOCAR (sem destinação nenhuma)
  /** EM ABERTO de verdade: original − CONCLUÍDO (planejado NÃO quita a dívida). */
  openMinutes: number;
}

/** Totais agregados para as barras de progresso. */
export interface DebtTotals {
  debtTotal: number;
  allocated: number;
  concluded: number;
  pending: number;
  remaining: number;
  percent: number; // 0..100 concluído
}

export interface TargetSuggestion {
  date: string;
  workedMinutes: number;
  balanceMinutes: number;
  isToday: boolean;
}

export interface AppData {
  user: User;
  entries: TimeEntry[];
  compensations: Compensation[];
  absences: import("./absences").Absence[];
  /** Calendários da empresa — um por ciclo anual (01/05→30/04). */
  companyCalendars?: import("./company-calendar").CompanyCalendar[];
  /** Faltas registradas manualmente (integrais, um registro por dia). */
  faltas: Falta[];
  /**
   * Motivo do EXCEDENTE acima de 10h (um registro por data). Obrigatório antes
   * de destinar a reserva especial. Dados antigos sem o campo convivem: a
   * quantidade continua derivada das batidas; apenas o motivo fica "não
   * informado" até o usuário registrar.
   */
  excessReasons?: ExcessReason[];
  /**
   * USOS do banco paralelo [10+] (novo modelo — Etapas 3B/3D). Exclusivo do
   * novo Meu Horário: NUNCA armazenar dentro de compensations/debts/hourBank.
   * Opcional em dados antigos — a hidratação preenche [].
   */
  specialExcessUses?: import("./special-excess-use").SpecialExcessUse[];
  /**
   * PLANOS/RESERVAS futuras do banco [10+] (Etapa 4A). PLANEJADO NÃO É
   * UTILIZADO: a reserva não altera fatos, saldo regular nem projeção de
   * dia realizado — dias realizados usam specialExcessUses. Opcional em
   * dados antigos — a hidratação preenche [].
   */
  specialExcessPlans?: import("./special-excess-plan").SpecialExcessPlan[];
  /**
   * CONSOLIDAÇÕES DO PERÍODO DO PONTO (Etapa 4G). Congelam a fotografia do
   * resultado considerado no sistema oficial — NUNCA transformam projeção
   * em factual (o saldo factual permanece história real). Revisões antigas
   * nunca são sobrescritas; somente uma revisão fica "active". Opcional em
   * dados antigos — a hidratação preenche [].
   */
  periodConsolidations?: import("./period-consolidation").PeriodConsolidation[];
  /**
   * FECHAMENTOS ANUAIS DEFINITIVOS (Etapa 4H). Registram a decisão formal de
   * encerramento de cada ciclo (01/05→30/04): se foi liquidado/transportado o
   * saldo [10+] final e a proveniência. Opcional em dados antigos — a
   * hidratação preenche [] (ausência = nenhum ciclo formalmente encerrado).
   */
  annualCycleClosures?: import("./annual-cycle-closure").AnnualCycleClosure[];
}

/** Códigos do MOTIVO DO EXCEDENTE acima de 10h (select do modal). */
export type ExcessReasonCode =
  | "demanda-urgente" // Demanda urgente de trabalho
  | "reuniao-prolongada" // Reunião/atividade prolongada
  | "viagem-deslocamento" // Viagem/deslocamento
  | "atendimento-evento" // Atendimento/evento
  | "necessidade-operacional" // Necessidade operacional
  | "outro"; // Outro → exige texto

/** Registro do motivo do excedente de um dia (histórico §11 — um por data). */
export interface ExcessReason {
  id: number;
  /** YYYY-MM-DD do dia com jornada acima de 10h. */
  date: string;
  reason: ExcessReasonCode;
  /** Texto obrigatório quando reason = "outro". */
  customReason: string | null;
  /** Observação opcional. */
  observation: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Falta — ocorrência de ponto (NÃO é férias/afastamento): o dia tinha jornada
 * efetiva e o usuário não trabalhou. Só existe por registro explícito; dia
 * vazio nunca vira falta automaticamente. Futura = "Falta prevista" (sem
 * déficit até a data chegar): a vigência é derivada de date vs. hoje.
 */
export interface Falta {
  id: number;
  /** YYYY-MM-DD — um registro por dia. */
  date: string;
  createdAt: number;
}

export interface CompWithDays extends Compensation {
  sourceDay: { workedMinutes: number; excessMinutes: number } | null;
  targetDay: { workedMinutes: number; balanceMinutes: number } | null;
}

export interface DaySummary {
  date: string;
  workedMinutes: number;
  expectedMinutes: number;
  balanceMinutes: number;
  excessMinutes: number;
  registrableMinutes: number;
  status: DayStatus;
  open: boolean;
  entryCount: number;
}
