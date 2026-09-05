// Seed determinístico 4.0 — bancada de teste manual do MODELO ATUAL do Meu Horário.
// Datas fixas (não relativas a "hoje"): Restaurar dados de exemplo reproduz o mesmo conjunto.
//
// 4.0 (2026-08): reorganizado para validar o fluxo [10+] NOVO (3A/3B/3C/3D/3E):
//   - 3 origens factuais de [10+] (18/08 40min, 20/08 1h, 28/08 30min — total 2h10);
//   - 2 destinos de jornada abaixo do previsto (24/08 7h30, 26/08 7h);
//   - 1 dia normal 8h (25/08) como controle;
//   - 1 registro incompleto (27/08) para contrastar com "abaixo do previsto";
//   - SEM compensações/ausências/faltas/calendário/motivos legados: o cenário
//     demonstra UMA OPERAÇÃO (jornada factual → [10+] → projeção), sem poluição
//     dos dois modelos lado a lado.
//
// O cenário 3.1 anterior (bancada do modelo legado) permanece INTACTO em
// buildLegacyDemoScenario() — fixture própria dos testes de regressão legada.
// Nenhum dado real é afetado; o seed só entra quando o usuário escolhe
// explicitamente "Restaurar dados de exemplo".
import type { Absence } from "./absences";
import { seedCompanyCalendars } from "./seed-calendars";
import { todayString } from "./time";
import type { AppData, Compensation, ExcessReason, Falta, TimeEntry, User } from "./types";

/** Início do controle do seed 4.0 — anterior ao primeiro dia demonstrativo. */
export const SEED_CONTROL_START = "2026-08-01";

/** Início do controle do cenário legado 3.1 (fixture dos testes legados). */
export const LEGACY_SEED_CONTROL_START = "2026-04-01";

export const SEED_VERSION = "4.0";

/** Jornada e teto estruturais — defaults de funcionamento, não dados de teste. */
export const DEFAULT_WORK_SETTINGS = {
  workStart: "08:00",
  workEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  maxDailyMinutes: 600,
  autoDeductLunch: true,
} as const;

/**
 * Identidade do cenário de demonstração (bancada de teste manual).
 * ETAPA 4L: NUNCA é usada em conta nova/primeiro uso — só existe dentro do
 * seed de exemplo (disponível apenas em desenvolvimento).
 */
export const REAL_USER_IDENTITY = {
  name: "Maria Helena",
  email: "meu@horario.com",
  birthDate: "1989-08-23",
} as const;

/**
 * ETAPA 4L — Identidade de instalação nova: NENHUM dado pessoal fictício.
 * Nome/e-mail vazios e sem data de nascimento; o onboarding preenche o nome e
 * o e-mail vem da conta autenticada.
 */
export const NEW_ACCOUNT_IDENTITY = {
  name: "",
  email: "",
  birthDate: null,
} as const;

/** Identidade antiga de demonstração — migrada na hidratação para o perfil real. */
export const DEMO_USER_IDENTITY = {
  name: "Alex Santos",
  email: "voce@exemplo.com",
  birthDate: "1990-08-10",
} as const;

export function isDemoUserIdentity(user: Pick<User, "name" | "email">): boolean {
  return user.name === DEMO_USER_IDENTITY.name && user.email === DEMO_USER_IDENTITY.email;
}

/**
 * Copia nome, e-mail e nascimento da origem — jornada e controlStartDate ficam
 * no destino.
 *
 * ETAPA 4L: instalação nova não tem identidade (nome vazio). Nesse caso a
 * identidade do destino é mantida como está — nada a "preservar" e nenhum
 * perfil em branco é imposto sobre a bancada de exemplo.
 */
export function withPreservedIdentity<T extends Pick<User, "name" | "email" | "birthDate">>(
  target: T,
  source: Pick<User, "name" | "email" | "birthDate">,
): T {
  if (!(source.name ?? "").trim()) return target;
  return {
    ...target,
    name: source.name,
    email: source.email,
    birthDate: source.birthDate,
  };
}

/** Troca só a identidade de demo (Alex Santos) pelo perfil real, sem tocar fatos. */
export function applyDemoIdentityMigration(data: AppData): AppData {
  if (!isDemoUserIdentity(data.user)) return data;
  return {
    ...data,
    user: {
      ...data.user,
      ...REAL_USER_IDENTITY,
    },
  };
}

export const DEFAULT_USER: User = {
  id: 1,
  ...REAL_USER_IDENTITY,
  ...DEFAULT_WORK_SETTINGS,
  controlStartDate: SEED_CONTROL_START,
  // 4I — limites do Guia do Ponto (defaults oficiais desta etapa).
  guideMinEntry: "08:00",
  guideMaxExit: "17:45",
};

/**
 * Instalação nova (ETAPA 4L): jornada genérica editável, SEM dado pessoal.
 * Nome/e-mail vêm do onboarding e da conta autenticada; nascimento é opcional.
 */
export const EMPTY_USER: User = {
  id: 1,
  ...NEW_ACCOUNT_IDENTITY,
  ...DEFAULT_WORK_SETTINGS,
  controlStartDate: null,
  // 4I — limites do Guia do Ponto (defaults oficiais desta etapa).
  guideMinEntry: "08:00",
  guideMaxExit: "17:45",
};

/**
 * Estado transacional vazio para primeiro uso em produção.
 * Sem punches, faltas, ausências, compensações, calendário de demo ou [10+].
 * controlStartDate = hoje local (injetável nos testes).
 */
export function createEmptyState(today: string = todayString()): AppData {
  return {
    user: { ...EMPTY_USER, controlStartDate: today },
    entries: [],
    compensations: [],
    absences: [],
    companyCalendars: undefined,
    faltas: [],
    excessReasons: [],
    specialExcessUses: [],
    specialExcessPlans: [],
    periodConsolidations: [],
    annualCycleClosures: [],
  };
}

function e(id: number, date: string, time: string, type: "entrada" | "saida", note: string | null = null): TimeEntry {
  return { id, date, time, type, note };
}
function day(id0: number, date: string, end: string, note: string | null = null): TimeEntry[] {
  return [
    e(id0, date, "08:00", "entrada"),
    e(id0 + 1, date, "12:00", "saida"),
    e(id0 + 2, date, "13:00", "entrada"),
    e(id0 + 3, date, end, "saida", note),
  ];
}

/**
 * Seed de demonstração 4.0 — um único modelo operacional, o ATUAL:
 * jornada factual → saldo regular factual → [10+] gerado → uso [10+] → projeção.
 *
 * Ciclo anual 2026/2027 (01/05/2026 → 30/04/2027); validação em agosto/2026.
 * Os [10+] NASCEM das batidas (excesso acima do teto de 10h) — nada é
 * hardcodado em estrutura paralela.
 */
export function buildSeedData(): AppData {
  const entries: TimeEntry[] = [
    // ORIGEM 1 — 18/08 (ter): 10h40 → [10+] 40min (07:30–12:00 + 13:00–19:10)
    e(1, "2026-08-18", "07:30", "entrada"),
    e(2, "2026-08-18", "12:00", "saida"),
    e(3, "2026-08-18", "13:00", "entrada"),
    e(4, "2026-08-18", "19:10", "saida", "Exemplo — gera 40min [10+]"),
    // ORIGEM 2 — 20/08 (qui): 11h → [10+] 1h (07:00–12:00 + 13:00–19:00)
    e(5, "2026-08-20", "07:00", "entrada"),
    e(6, "2026-08-20", "12:00", "saida"),
    e(7, "2026-08-20", "13:00", "entrada"),
    e(8, "2026-08-20", "19:00", "saida", "Exemplo — gera 1h [10+]"),
    // DESTINO 7h30 — 24/08 (seg): falta 30min para completar a jornada
    ...day(10, "2026-08-24", "16:30", "Exemplo — jornada 7h30"),
    // CONTROLE — 25/08 (ter): dia normal 8h, saldo 0 (sem botão [10+])
    ...day(20, "2026-08-25", "17:00", "Exemplo — dia normal 8h"),
    // DESTINO PRINCIPAL — 26/08 (qua): falta 1h (uso parcial + segundo uso + cancel)
    ...day(30, "2026-08-26", "16:00", "Exemplo — jornada 7h"),
    // REGISTRO INCOMPLETO — 27/08 (qui): sem saída final (≠ abaixo do previsto)
    e(40, "2026-08-27", "08:00", "entrada"),
    e(41, "2026-08-27", "12:00", "saida"),
    e(42, "2026-08-27", "13:00", "entrada", "Exemplo — registro incompleto"),
    // ORIGEM 3 — 28/08 (sex): 10h30 → [10+] 30min (07:30–12:00 + 13:00–19:00)
    // Posterior ao destino 26/08 e já realizada: visível no modo manual.
    e(50, "2026-08-28", "07:30", "entrada"),
    e(51, "2026-08-28", "12:00", "saida"),
    e(52, "2026-08-28", "13:00", "entrada"),
    e(53, "2026-08-28", "19:00", "saida", "Exemplo — gera 30min [10+]"),
  ];

  return {
    user: { ...DEFAULT_USER },
    entries,
    // Cenário limpo: sem modelo legado ativo no visual (compensações/ausências/
    // faltas/calendário/motivos ficam na fixture 3.1 para os testes legados).
    compensations: [],
    absences: [],
    companyCalendars: undefined,
    faltas: [],
    excessReasons: [],
    // Banco [10+] nasce dos fatos acima; os usos são feitos pelo usuário
    // através da interface (botão "Completar jornada com [10+]").
    specialExcessUses: [],
    // 4A: seed NÃO cria reservas — o seed continua previsível (§23).
    specialExcessPlans: [],
  };
}

/**
 * CENÁRIO LEGADO 3.1 — fixture própria dos testes de regressão do modelo
 * legado ([10+] com motivo + realocação/compensação). Preservado byte-a-byte;
 * NUNCA é usado pelo "Restaurar dados de exemplo" da UI.
 */
export function buildLegacyDemoScenario(): AppData {
  const now = Date.parse("2026-08-25T12:00:00");
  const entries: TimeEntry[] = [
    // 29/04 ciclo anterior — déficit 1h (NÃO elegível para 24/08)
    ...day(1, "2026-04-29", "16:00"),
    // 06/08 acordo a compensar + 07/08 9h (hora extra que quita 2h do acordo)
    ...day(10, "2026-08-07", "19:00"),
    // 11/08 10h15 — especial 15min SEM motivo (testa "Registrar motivo")
    ...day(20, "2026-08-11", "19:15"),
    // 14/08 8h com 6 batidas — só layout (wrap desktop / 2 colunas mobile)
    e(94, "2026-08-14", "08:00", "entrada"),
    e(95, "2026-08-14", "10:00", "saida"),
    e(96, "2026-08-14", "10:15", "entrada"),
    e(97, "2026-08-14", "12:00", "saida"),
    e(98, "2026-08-14", "13:00", "entrada"),
    e(99, "2026-08-14", "17:15", "saida"),
    // 16/08 7h30 — déficit 30min, quitado pelo especial de 17/08
    ...day(30, "2026-08-16", "16:30"),
    // 17/08 10h30 — especial 30min tratado ✓
    ...day(40, "2026-08-17", "19:30", "Demanda urgente"),
    // 18/08 10h45 — especial 45min PROGRAMADO (não realizado)
    ...day(50, "2026-08-18", "19:45", "Atendimento/evento"),
    // 19/08 7h30 — déficit 30, 10 concluídos + 10 planejados, 20 em aberto
    ...day(60, "2026-08-19", "16:30"),
    // 20/08 7h45 — déficit 15 totalmente quitado com excedente de 24/08
    ...day(70, "2026-08-20", "16:45"),
    // 21/08 7h45 — déficit 15 quitado (5 regular + 10 especial de 24/08)
    ...day(80, "2026-08-21", "16:45"),
    // 22/08 sábado +2h
    e(90, "2026-08-22", "10:00", "entrada"),
    e(91, "2026-08-22", "12:00", "saida"),
    // 23/08 domingo +1h
    e(92, "2026-08-23", "09:00", "entrada"),
    e(93, "2026-08-23", "10:00", "saida"),
    // 24/08 11h — regular +2h, especial 1h, 25min realocados / 35min livres
    ...day(100, "2026-08-24", "20:00", "Demanda urgente de trabalho"),
    // 26/08 7h30 — inspeção visual do Resumo (Jornada abaixo do previsto)
    ...day(112, "2026-08-26", "16:30"),
    // 28/08 11h30 — 10h no ponto · extra +2h · [10+] 1h30 (30min realocados neste dia)
    ...day(116, "2026-08-28", "20:30", "Demanda urgente de trabalho"),
    // 03/09 futuro parcial 08:00–10:00 — previsto, não entra no realizado
    e(108, "2026-09-03", "08:00", "entrada"),
    e(109, "2026-09-03", "10:00", "saida"),
    // 07/09 futuro +2h em feriado abonado — NÃO entra no realizado antes da data
    e(110, "2026-09-07", "08:00", "entrada"),
    e(111, "2026-09-07", "10:00", "saida"),
  ];

  const compensations: Compensation[] = [
    {
      id: 1, sourceDate: "2026-08-06", targetDate: "2026-08-07", minutes: 120,
      status: "concluida", note: "Quitação parcial do acordo de 06/08 (hora extra de 07/08)", kind: "acordo", createdAt: now - 18 * 86_400_000,
    },
    {
      id: 2, sourceDate: "2026-08-16", targetDate: "2026-08-17", minutes: 30,
      status: "concluida", note: "Alocado excedente acima de 10h (realizado)", kind: "deficit", portion: "especial", createdAt: now - 8 * 86_400_000,
    },
    {
      id: 3, sourceDate: "2026-08-18", targetDate: "2026-08-26", minutes: 45,
      status: "pendente", note: "Planejo sair mais cedo para compensar.", kind: "excedente", createdAt: now - 7 * 86_400_000,
    },
    {
      id: 4, sourceDate: "2026-08-19", targetDate: "2026-08-22", minutes: 10,
      status: "concluida", note: "Usadas horas positivas realizadas", kind: "deficit", portion: "regular", createdAt: now - 5 * 86_400_000,
    },
    {
      id: 5, sourceDate: "2026-08-19", targetDate: "2026-08-28", minutes: 10,
      status: "pendente", note: "Hora extra planejada", kind: "deficit", createdAt: now - 5 * 86_400_000,
    },
    {
      id: 6, sourceDate: "2026-08-21", targetDate: "2026-08-24", minutes: 5,
      status: "concluida", note: "Usadas horas positivas realizadas", kind: "deficit", portion: "regular", createdAt: now - 1 * 86_400_000,
    },
    {
      id: 7, sourceDate: "2026-08-21", targetDate: "2026-08-24", minutes: 10,
      status: "concluida", note: "Alocado excedente acima de 10h (realizado)", kind: "deficit", portion: "especial", createdAt: now - 1 * 86_400_000,
    },
    {
      id: 8, sourceDate: "2026-08-20", targetDate: "2026-08-24", minutes: 15,
      status: "concluida", note: "Alocado excedente acima de 10h (realizado)", kind: "deficit", portion: "especial", createdAt: now - 1 * 86_400_000,
    },
    {
      id: 9, sourceDate: "2026-08-06", targetDate: "2026-08-28", minutes: 60,
      status: "pendente", note: "Hora extra planejada do acordo de 06/08", kind: "acordo", createdAt: now - 4 * 86_400_000,
    },
    {
      id: 10, sourceDate: "2026-08-26", targetDate: "2026-08-28", minutes: 30,
      status: "concluida", note: "Alocado excedente acima de 10h (realizado)", kind: "deficit", portion: "especial", createdAt: now + 3 * 86_400_000,
    },
  ];

  const absences: Absence[] = [
    {
      id: 1, kind: "acordado", startDate: "2026-08-06", endDate: "2026-08-06",
      duration: "integral", treatment: "compensar", note: "Folga acordada", createdAt: now - 20 * 86_400_000,
    },
    {
      id: 2, kind: "abono", startDate: "2026-08-10", endDate: "2026-08-10",
      duration: "integral", note: "Abono de aniversário", createdAt: now - 15 * 86_400_000,
    },
  ];

  const faltas: Falta[] = [
    { id: 1, date: "2026-08-31", createdAt: now },
  ];

  const excessReasons: ExcessReason[] = [
    { id: 1, date: "2026-08-17", reason: "demanda-urgente", customReason: null, observation: null, createdAt: now - 8 * 86_400_000, updatedAt: now - 8 * 86_400_000 },
    { id: 2, date: "2026-08-18", reason: "atendimento-evento", customReason: null, observation: null, createdAt: now - 7 * 86_400_000, updatedAt: now - 7 * 86_400_000 },
    { id: 3, date: "2026-08-24", reason: "demanda-urgente", customReason: null, observation: null, createdAt: now - 1 * 86_400_000, updatedAt: now - 1 * 86_400_000 },
    { id: 4, date: "2026-08-28", reason: "demanda-urgente", customReason: null, observation: null, createdAt: now + 3 * 86_400_000, updatedAt: now + 3 * 86_400_000 },
  ];

  return {
    user: { ...DEFAULT_USER, controlStartDate: LEGACY_SEED_CONTROL_START },
    entries,
    compensations,
    absences,
    companyCalendars: seedCompanyCalendars(),
    faltas,
    excessReasons,
    // Seed legado NUNCA é convertido para o modelo novo (adapter é etapa
    // futura): o novo banco começa vazio, sem duplicar as compensações antigas.
    specialExcessUses: [],
    specialExcessPlans: [],
  };
}

/** Alias explícito do seed de demonstração 4.0 — nunca usado no bootstrap de produção. */
export function createDemoSeed(): AppData {
  return buildSeedData();
}
