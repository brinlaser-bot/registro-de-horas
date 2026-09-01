/**
 * VERIFICAÇÃO — ETAPA 4C.1B: BACKUP COMO CONTRATO PERMANENTE +
 * "COMPLETAR JORNADA COM [10+]" NA VISÃO GERAL + REFINOS UX DE RESERVAS.
 *
 * PARTE A — o pipeline de backup passa a ter um CONTRATO ÚNICO
 * (BACKUP_COLLECTIONS em backup.ts): export, parse, replace/merge e o
 * ImportBackupModal derivam da mesma fonte; o teste sentinela compara o
 * contrato com o ESTADO REAL do store e falha se uma coleção persistente
 * ficar de fora (o bug 4C.1A ficaria impossível).
 *
 * PARTE B — a pendência da 4V: "Completar jornada com [10+]" no Registro
 * de hoje da Visão Geral, com o MESMO modal/fluxo de Registros e gating
 * canônico (canComplete — sem horário de parede).
 *
 * PARTE C — UX das reservas: linha empilhada no mobile (§14) e
 * "Planejar mais" antecipando saldo zero (§15).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-backup-contract-vg-ux-4c1b.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { backupImportPayload, BACKUP_COLLECTIONS, buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { buildResumoPeriodView } from "../src/lib/resumo-period-view.ts";
import { getAnnualPointCycle, getPointPeriod, listDaysBetween } from "../src/lib/periods.ts";
import { companyDayContext } from "../src/lib/company-calendar.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { manualMaxForOrigin } from "../src/components/special-excess-use-modal.tsx";
import type { SpecialExcessPlan, SpecialExcessUse } from "../src/lib/special-excess-plan.ts";
import type { TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ══════════ Sentinela (§5) — reutilizável nos três primeiros testes ══════════ */

/**
 * SENTINELA DE COBERTURA: compara as chaves do ESTADO REAL do store com o
 * contrato de backup. Toda chave do estado precisa estar no contrato OU na
 * lista de ignoradas (coleções classificadas como derivadas/UI — hoje
 * NENHUMA: AppData é 100% persistente). Uma coleção nova criada no store e
 * esquecida no contrato aparece aqui e o teste FALHA.
 * Limitação documentada: a inferência cobre o estado de AppData (por onde
 * passa TODA a persistência do app — localStorage grava o objeto inteiro).
 */
function sentinelaBackup(stateKeys: readonly string[], contrato: readonly string[], ignoradas: readonly string[] = []): string[] {
  return stateKeys.filter((k) => !contrato.includes(k) && !ignoradas.includes(k));
}

/* ══════════ Estado rich (round-trip/merge) via AÇÕES REAIS ══════════ */

const SEED = buildSeedData();

function resetSeed() {
  actions.replaceAll({
    user: SEED.user,
    entries: SEED.entries.map((x) => ({ ...x })),
    compensations: [],
    absences: [],
    companyCalendars: undefined,
    faltas: [],
    excessReasons: [],
    specialExcessUses: [],
    specialExcessPlans: [],
  });
}

const ok = <T extends { ok: boolean; error?: string }>(r: T, what: string): T => {
  assert.ok(r.ok, `${what}: ${r.error ?? "falhou"}`);
  return r;
};

/** Estado COMPLEXO: TODAS as coleções persistentes populadas. */
function loadRichState() {
  resetSeed();
  // Motivos do excedente >10h (18/08 gera 40min e 20/08 gera 1h no seed) —
  // ANTES de qualquer destinação:
  ok(actions.setExcessReason({ date: "2026-08-18", reason: "outro", customReason: "Cobertura de plantão", observation: null }), "setExcessReason 18/08");
  ok(actions.setExcessReason({ date: "2026-08-20", reason: "outro", customReason: "Fechamento mensal", observation: null }), "setExcessReason 20/08");
  // Compensação legada (coleção persistente):
  ok(actions.addComp({ sourceDate: "2026-08-20", targetDate: "2026-08-21", minutes: 30, note: null, kind: "excedente" }), "addComp");
  // Ausência (férias em janela sem batidas):
  ok(actions.addAbsence({ kind: "ferias", startDate: "2026-07-06", endDate: "2026-07-10", duration: "integral", note: null }), "addAbsence");
  // Falta (deficit correspondente à jornada do dia):
  ok(actions.addFalta("2026-08-12"), "addFalta");
  // Calendário da empresa (um por ciclo anual):
  ok(
    actions.addCompanyCalendar({
      id: "2026-05-01",
      cycleStart: "2026-05-01",
      cycleEnd: "2027-04-30",
      cycleLabel: "2026–2027",
      version: 1,
      importedAt: "2026-05-02T10:00:00.000Z",
      entries: [],
    }),
    "addCompanyCalendar",
  );
  // USO ATIVO criado pela RESOLUÇÃO do plano (4C — concluded com metadados):
  const planoResolvido = ok(
    actions.createSpecialExcessPlan({ destinationDate: "2026-08-26", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-20", now: 1000 }),
    "plano p/ 26/08",
  );
  const planIdResolvido = (getAppData().specialExcessPlans ?? []).at(-1)!.id;
  void planoResolvido;
  ok(actions.resolveSpecialExcessPlan({ id: planIdResolvido, minutes: 30, asOfDate: "2026-08-30", now: 2000 }), "resolve plano 26/08");
  // USO CANCELADO (histórico preservado):
  ok(
    actions.createSpecialExcessUse({
      destinationDate: "2026-08-26",
      minutes: 30,
      allocationStrategy: "manual",
      manualAllocations: [{ originDate: "2026-08-20", minutes: 30 }],
      asOfDate: "2026-08-30",
      now: 3000,
    }),
    "uso manual 26/08",
  );
  const usoCanceladoId = (getAppData().specialExcessUses ?? []).at(-1)!.id;
  ok(actions.cancelSpecialExcessUse({ id: usoCanceladoId, now: 3500 }), "cancela uso manual");
  // PLANO PLANNED (reserva futura):
  ok(actions.createSpecialExcessPlan({ destinationDate: "2026-09-15", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-30", now: 4000 }), "plano 15/09");
  // PLANO CANCELLED:
  // 4D.3: destino em dia ÚTIL (domingo 20/09 não tem base efetiva e deixou
  // de aceitar planejamento — o exemplo da sentinela move para 22/09):
  ok(actions.createSpecialExcessPlan({ destinationDate: "2026-09-22", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-30", now: 5000 }), "plano 22/09");
  const planoCanceladoId = (getAppData().specialExcessPlans ?? []).at(-1)!.id;
  ok(actions.cancelSpecialExcessPlan({ id: planoCanceladoId, now: 5500 }), "cancela plano 22/09");
}

const d = () => getAppData();
const bankOf = (asOf = "2026-08-30") => {
  const st = d();
  return buildSpecialExcessBank({
    cycle: getAnnualPointCycle(asOf),
    asOfDate: asOf,
    entries: st.entries,
    absences: st.absences,
    calendars: st.companyCalendars,
    settings: settingsOf(st.user),
    faltas: st.faltas,
    controlStartDate: st.user.controlStartDate ?? "",
    uses: st.specialExcessUses ?? [],
    plans: st.specialExcessPlans ?? [],
  });
};

/* ══════════ Fixtures §13 — "hoje" 24/08 (injeção canônica, sem relógio) ══════════ */

const HOJE = "2027-03-01"; // segunda "hoje" injetada, posterior a todas as
// origens (28/08/2026) e ao hoje real — determinístico (padrão da 4C: a
// parede de relógio só filtra batidas do dia REAL, então o dia simulado
// como "hoje" precisa ser ≠ do dia real da execução).

let eid = 1;
const e = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: eid++, date, time, type, note: null });
const day4 = (date: string, s: string, lo: string, li: string, end: string) => [e(date, s, "entrada"), e(date, lo, "saida"), e(date, li, "entrada"), e(date, end, "saida")];

/** §13: 18/08 gera 40 (30 reservados por plano → 10 livres) · 20/08 gera 20 ·
 * 28/08 gera 30 · hoje 24/08 encerrado 7h30 (−30min). */
function loadFixtureHoje() {
  actions.replaceAll({
    user: SEED.user,
    entries: [
      ...day4("2026-08-18", "07:00", "12:00", "13:00", "18:40"), // 10h40 → 40min
      ...day4("2026-08-20", "07:00", "12:00", "13:00", "18:20"), // 10h20 → 20min
      ...day4("2026-08-28", "07:00", "12:00", "13:00", "18:30"), // 10h30 → 30min
      ...day4(HOJE, "08:00", "12:00", "13:00", "16:30"),         // 7h30 → −30min
    ],
    compensations: [],
    absences: [],
    companyCalendars: undefined,
    faltas: [],
    excessReasons: [],
    specialExcessUses: [],
    specialExcessPlans: [],
  });
  ok(actions.createSpecialExcessPlan({ destinationDate: "2026-09-10", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-20", now: 100 }), "plano reserva 30 de 18/08");
}

function viewHoje(uses?: SpecialExcessUse[], plans?: SpecialExcessPlan[]) {
  const st = d();
  return buildSpecialExcessDayView({
    date: HOJE,
    asOfDate: HOJE,
    entries: st.entries,
    absences: st.absences,
    calendars: st.companyCalendars,
    settings: settingsOf(st.user),
    faltas: st.faltas,
    controlStartDate: st.user.controlStartDate ?? null,
    uses: uses ?? st.specialExcessUses ?? [],
    plans: plans ?? st.specialExcessPlans ?? [],
  });
}

/* ════════════════ PARTE A — TESTES 01–07 ════════════════ */

check("TESTE 01 DE 15 — Auditoria enumera as coleções persistentes e classifica", () => {
  loadRichState();
  const stateKeys = Object.keys(d()).sort();
  // O estado REAL do store tem exatamente as 9 coleções persistentes:
  assert.deepEqual(stateKeys, [...BACKUP_COLLECTIONS].sort(), "AppData = contrato (100% persistente)");
  // Classificação B (derivado/recalculável): bancos/projeções/classificações
  // NÃO são chaves do estado — são recalculados das coleções:
  for (const derivada of ["bank", "projection", "days", "summary", "cards"]) {
    assert.ok(!stateKeys.includes(derivada), `derivada fora do estado: ${derivada}`);
  }
  // Classificação C (temporária/UI): estados de modais/componentes não
  // aparecem no estado persistido:
  for (const ui of ["reasonDate", "completeDate", "stage", "busy", "preview"]) {
    assert.ok(!stateKeys.includes(ui), `estado de UI fora do store: ${ui}`);
  }
  // A única chave não-coleção do contrato é o perfil do usuário:
  assert.ok(stateKeys.includes("user"), "perfil/config faz parte do backup");
});

check("TESTE 02 DE 15 — Contrato cobre todas as coleções persistentes (export→parse→payload)", () => {
  loadRichState();
  const original = d();
  // Sentinela real contra o estado atual:
  assert.deepEqual(sentinelaBackup(Object.keys(original), BACKUP_COLLECTIONS), [], "nenhuma coleção fora do contrato");
  // EXPORT: o payload inclui TODAS as coleções do contrato:
  const json = JSON.stringify(buildBackupPayload(original));
  const exported = JSON.parse(json) as Record<string, unknown>;
  for (const key of BACKUP_COLLECTIONS) {
    assert.ok(key in exported, `payload de export tem ${key}`);
    assert.ok(exported[key] !== undefined || key === "companyCalendars", `payload de export populou ${key}`);
  }
  // PARSE: devolve TODAS as coleções (com defaults seguros p/ antigos):
  const parsed = ok(parseBackup(json), "parse do estado rich");
  for (const key of BACKUP_COLLECTIONS) {
    assert.ok(key in parsed.backup, `parse devolve ${key}`);
  }
  // PAYLOAD DE IMPORTAÇÃO: derivado do contrato, contém exatamente as 9 chaves:
  assert.deepEqual(Object.keys(backupImportPayload(parsed.backup)).sort(), [...BACKUP_COLLECTIONS].sort());
});

check("TESTE 03 DE 15 — Sentinela detecta coleção persistente omitida do contrato", () => {
  loadRichState();
  const stateKeys = Object.keys(d());
  // Simulação: uma NOVA coleção persistente criada no store e esquecida no
  // contrato (o cenário exato do bug 4C.1A, generalizado):
  const comRogue = [...stateKeys, "periodClosings"];
  assert.deepEqual(sentinelaBackup(comRogue, BACKUP_COLLECTIONS), ["periodClosings"], "coleção nova sem cobertura FALHA");
  // Demonstração histórica: com o contrato ANTERIOR à 4C.1A (sem plans),
  // o sentinela teria pego o bug do plano descartado:
  const contratoAntigo = BACKUP_COLLECTIONS.filter((k) => k !== "specialExcessPlans");
  assert.deepEqual(sentinelaBackup(stateKeys, contratoAntigo), ["specialExcessPlans"], "o bug 4C.1A seria pego pelo sentinela");
  // Estrutural: o modal deriva o payload do contrato nas DUAS ações e não
  // mantém lista manual que pode envelhecer:
  const modal = src("src/components/import-backup-modal.tsx");
  assert.equal(modal.split("backupImportPayload(parsed)").length - 1, 2, "Substituir e Mesclar usam o contrato");
  assert.ok(!modal.includes("specialExcessUses: parsed"), "sem lista manual de campos no modal");
  assert.ok(!modal.includes("specialExcessPlans: parsed"), "sem lista manual de campos no modal (plans)");
});

check("TESTE 04 DE 15 — Round-trip completo preserva o estado complexo", () => {
  loadRichState();
  const original = d();
  const json = JSON.stringify(buildBackupPayload(original));
  actions.clearAll();
  assert.equal(d().entries.length, 0, "estado zerado");
  const parsed = ok(parseBackup(json), "parse");
  actions.replaceAll(backupImportPayload(parsed.backup));
  const restored = d();
  // Equivalência semântica de TODAS as coleções (deepEqual — ids/datas/status/metadados):
  assert.deepEqual(restored.user, original.user, "perfil/config idênticos");
  assert.deepEqual(restored.entries, original.entries, "entries idênticas");
  assert.deepEqual(restored.compensations, original.compensations, "compensações idênticas");
  assert.deepEqual(restored.absences, original.absences, "ausências idênticas");
  // Calendários: o pipeline existente incrementa o CONTADOR interno
  // `version` ao (re)hidratar (comportamento pré-existente do store, não
  // desta etapa). Compara tudo exceto o contador:
  const stripCalVersion = (cs: typeof original.companyCalendars) =>
    (cs ?? []).map((c) => ({ ...c, version: typeof c.version === "number" ? "N" : c.version }));
  assert.deepEqual(stripCalVersion(restored.companyCalendars), stripCalVersion(original.companyCalendars), "calendários idênticos (contador interno à parte)");
  assert.ok((restored.companyCalendars ?? []).every((c) => typeof c.version === "number"), "version segue numérico");
  assert.deepEqual(restored.faltas, original.faltas, "faltas idênticas");
  assert.deepEqual(restored.excessReasons, original.excessReasons, "motivos idênticos");
  assert.deepEqual(restored.specialExcessUses, original.specialExcessUses, "usos idênticos (ativo + cancelado)");
  assert.deepEqual(restored.specialExcessPlans, original.specialExcessPlans, "planos idênticos (planned + cancelled + concluded)");
  // Metadados 4C sobrevivem:
  const concluded = restored.specialExcessPlans?.find((p) => p.status === "concluded");
  assert.ok(concluded?.resolvedAt && concluded?.resolvedUseId && concluded?.resolvedMinutes === 30, "metadados 4C preservados");
  const cancelado = restored.specialExcessUses?.find((u) => u.status === "cancelado");
  assert.ok(cancelado?.cancelledAt, "uso cancelado preserva histórico");
});

check("TESTE 05 DE 15 — Replace restaura integralmente todas as coleções do contrato", () => {
  loadRichState();
  const original = d();
  const parsed = ok(parseBackup(JSON.stringify(buildBackupPayload(original))), "parse");
  actions.clearAll();
  actions.replaceAll(backupImportPayload(parsed.backup));
  const st = d();
  // Cada coleção do contrato presente e populada após o REPLACE:
  assert.ok(st.entries.length > 0, "entries");
  assert.ok(st.compensations.length > 0, "compensations");
  assert.ok(st.absences.length > 0, "absences");
  assert.ok((st.companyCalendars ?? []).length > 0, "companyCalendars");
  assert.ok(st.faltas.length > 0, "faltas");
  assert.ok(st.excessReasons.length > 0, "excessReasons");
  assert.ok(st.specialExcessUses!.length === 2, "specialExcessUses (ativo + cancelado)");
  assert.ok(st.specialExcessPlans!.length === 3, "specialExcessPlans (planned + cancelled + concluded)");
  assert.equal(st.user.id, original.user.id, "user");
  assert.deepEqual(st.entries, original.entries, "replace é integral (sem mistura com estado zerado)");
});

check("TESTE 06 DE 15 — Merge inclui todas as coleções e preserva a política de colisão", () => {
  loadRichState();
  const richParsed = ok(parseBackup(JSON.stringify(buildBackupPayload(d()))), "parse rich");
  // Estado LOCAL distinto: falta NA MESMA data do backup (colisão por data,
  // createdAt diferente) e uso com id que VAI colidir com o backup:
  resetSeed();
  ok(actions.addFalta("2026-08-12"), "falta local (mesma data do backup)");
  ok(
    actions.createSpecialExcessUse({
      destinationDate: "2026-08-24", // déficit do seed: elegível para uso
      minutes: 0 + 30,
      allocationStrategy: "fifo",
      asOfDate: "2026-08-30",
      now: 900,
    }),
    "uso local",
  ).ok;
  const localUse = d().specialExcessUses!.at(-1)!;
  const localUseId = localUse.id;
  const faltaAntes = { ...d().faltas[0] };
  // Payload do contrato com o PRIMEIRO uso do backup forçado a colidir por id:
  const payload = backupImportPayload(richParsed.backup);
  const payloadComColisao = {
    ...payload,
    specialExcessUses: (payload.specialExcessUses ?? []).map((u, i) =>
      i === 0 ? { ...u, id: localUseId, note: "conteúdo do backup" } : u,
    ),
  };
  actions.mergeBackup(payloadComColisao);
  const st = d();
  // União de entries (sem duplicar as iguais do seed):
  assert.ok(st.entries.length >= richParsed.backup.entries.length, "entries unidas");
  // Coleções do backup entram:
  assert.ok(st.compensations.length === richParsed.backup.compensations.length, "compensações do backup");
  assert.ok(st.absences.length === richParsed.backup.absences.length, "ausências do backup");
  assert.ok((st.companyCalendars ?? []).length >= 1, "calendários");
  assert.ok(st.excessReasons.length === richParsed.backup.excessReasons.length, "motivos do backup");
  assert.ok(st.specialExcessPlans!.length === 3, "planos do backup (3)");
  // Política de colisão de USOS (união por id): o LOCAL prevalece:
  const depois = st.specialExcessUses!.find((u) => u.id === localUseId)!;
  assert.equal(depois.note, localUse.note, "uso LOCAL prevalece na colisão de id (note local)");
  assert.notEqual(depois.note, "conteúdo do backup", "conteúdo do backup descartado na colisão");
  assert.equal(st.specialExcessUses!.length, richParsed.backup.specialExcessUses.length, "união por id: nenhum uso duplicado");
  // Política de colisão de FALTAS (por data): a LOCAL prevalece:
  const faltaDepois = st.faltas.find((f) => f.date === "2026-08-12")!;
  assert.equal(faltaDepois.createdAt, faltaAntes.createdAt, "falta LOCAL prevalece na colisão de data");
  assert.equal(st.faltas.length, 1, "uma falta por dia (sem duplicar na mesclagem)");
});

check("TESTE 07 DE 15 — Backup antigo sem coleções posteriores continua importável", () => {
  loadRichState();
  const exported = JSON.parse(JSON.stringify(buildBackupPayload(d()))) as Record<string, unknown>;
  // "Backup antigo": sem planos (4A) e sem usos (3D):
  delete exported.specialExcessPlans;
  delete exported.specialExcessUses;
  const parsed = ok(parseBackup(JSON.stringify(exported)), "backup antigo válido");
  actions.clearAll();
  actions.replaceAll(backupImportPayload(parsed.backup));
  const st = d();
  assert.deepEqual(st.specialExcessPlans ?? [], [], "plans → [] (default seguro)");
  assert.deepEqual(st.specialExcessUses ?? [], [], "uses → [] (default seguro)");
  assert.equal(bankOf().reservedMinutes, 0, "nada reservado");
  assert.ok(st.entries.length > 0 && st.user.id, "resto do backup restaurado");
  // BACKUP_VERSION inalterado:
  const backupSrc = src("src/lib/backup.ts");
  assert.ok(backupSrc.includes("BACKUP_VERSION = 3"), "sem bump de versão");
});

/* ════════════════ PARTE B — TESTES 08–13 (Visão Geral) ════════════════ */

check("TESTE 08 DE 15 — Hoje não iniciado/em andamento: Visão Geral NÃO mostra o CTA", () => {
  // Dia vazio (jornada não iniciada):
  loadFixtureHoje();
  actions.replaceAll({
    ...d(),
    entries: d().entries.filter((x) => x.date !== HOJE),
  });
  const vazia = viewHoje();
  assert.equal(vazia.eligible, false, "dia vazio não é elegível");
  assert.equal(vazia.canComplete, false, "CTA não aparece: jornada não iniciada");
  // Em andamento (entrada sem saída — dia passado injetado, tudo realizado):
  loadFixtureHoje();
  actions.replaceAll({
    ...d(),
    entries: [...d().entries.filter((x) => x.date !== HOJE), e(HOJE, "08:00", "entrada")],
  });
  const aberta = viewHoje();
  assert.equal(aberta.eligible, false, "em andamento/incompleto não é elegível");
  assert.equal(aberta.canComplete, false, "CTA não aparece: jornada em andamento");
  // 8h+ (base atingida): sem remainingNeed
  loadFixtureHoje();
  actions.replaceAll({
    ...d(),
    entries: [...d().entries.filter((x) => x.date !== HOJE), ...day4(HOJE, "08:00", "12:00", "13:00", "17:00")],
  });
  const cheia = viewHoje();
  assert.equal(cheia.remainingMinutes, 0, "sem necessidade restante");
  assert.equal(cheia.canComplete, false, "CTA não aparece: base atingida");
  // Estrutural: o bloco da página é gated pela MESMA visão canônica:
  const page = src("src/app/(app)/page.tsx");
  assert.ok(page.includes("(todaySpecialView.canComplete || todaySpecialView.usedActiveMinutes > 0)"), "bloco só existe com canComplete/usos");
  assert.ok(page.includes("buildSpecialExcessDayView"), "fonte canônica na página");
  assert.ok(!page.includes("nowMinutes >"), "sem inferência por horário de parede");
});

check("TESTE 09 DE 15 — Hoje encerrado 7h30/−30 com saldo: Visão Geral mostra o CTA", () => {
  loadFixtureHoje();
  const view = viewHoje();
  assert.equal(view.eligible, true, "encerrado e financeiramente válido (deficit)");
  assert.equal(view.workedMinutes, 450, "factual 7h30");
  assert.equal(view.factualBalanceMinutes, -30, "saldo factual −30");
  assert.equal(view.remainingMinutes, 30, "remainingNeed 30");
  assert.ok(view.bankAvailableMinutes > 0, "Banco [10+] disponível");
  assert.equal(view.canComplete, true, "CTA disponível");
  // A página usa o MESMO rótulo de Registros e abre o MESMO modal:
  const page = src("src/app/(app)/page.tsx");
  assert.ok(page.includes("Completar jornada com [10+]"), "rótulo idêntico ao de Registros");
  assert.ok(page.includes("onClick={() => setCompleteDate(todayStr)}"), "abre o fluxo para o dia de hoje");
  assert.ok(page.includes("import { SpecialExcessUseModal }"), "MESMO modal de Registros");
  assert.ok(page.includes("{completeDate && (\n        <SpecialExcessUseModal date={completeDate} onClose={() => setCompleteDate(null)} />"), "montagem idêntica à de Registros");
});

check("TESTE 10 DE 15 — Automático pela Visão Geral usa o mesmo FIFO/store de Registros", () => {
  loadFixtureHoje();
  // Lotes livres: 18/08 → 10 (40 gerado − 30 reservados pelo plano), 20/08 → 20, 28/08 → 30:
  const view = viewHoje();
  assert.deepEqual(
    view.lots.map((l) => [l.originDate, l.availableMinutes]),
    [["2026-08-18", 10], ["2026-08-20", 20], ["2026-08-28", 30]],
    "o plano reservado de 18/08 está DESCONTADO do disponível",
  );
  // Automático (MESMA action do modal de Registros — FIFO, mais antigas primeiro):
  ok(actions.createSpecialExcessUse({ destinationDate: HOJE, minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE, now: 200 }), "uso automático hoje");
  const st = d();
  const uso = st.specialExcessUses!.at(-1)!;
  assert.deepEqual(uso.allocations, [
    { originDate: "2026-08-18", minutes: 10 },
    { originDate: "2026-08-20", minutes: 20 },
  ], "FIFO enxerga exatamente 18/08→10 e 20/08→20 (plano descontado)");
  assert.equal(uso.status, "utilizado");
  // Estrutural: Registros e Visão Geral renderizam O MESMO componente:
  const registros = src("src/app/(app)/registros/page.tsx");
  const page = src("src/app/(app)/page.tsx");
  assert.ok(registros.includes("<SpecialExcessUseModal date={completeDate}") && page.includes("<SpecialExcessUseModal date={completeDate}"));
  assert.ok(!page.includes("createSpecialExcessUse("), "a página NÃO cria uso fora do modal/store (nenhum segundo motor)");
});

check("TESTE 11 DE 15 — Manual pela Visão Geral preserva origem específica e limite dinâmico", () => {
  loadFixtureHoje();
  // Limite dinâmico 3G.2 (mesmo helper do modal): necessidade restante 30:
  assert.equal(manualMaxForOrigin(30, 30, 0), 30);
  assert.equal(manualMaxForOrigin(30, 30, 20), 10, "desconta outras seleções");
  // Acima do restante é rejeitado (gate do store — o mesmo do modal):
  const over = actions.createSpecialExcessUse({
    destinationDate: HOJE,
    minutes: 60,
    allocationStrategy: "manual",
    manualAllocations: [{ originDate: "2026-08-28", minutes: 60 }],
    asOfDate: HOJE,
    now: 300,
  });
  assert.equal(over.ok, false, "acima do restante rejeitado");
  assert.equal(over.code, "requested-exceeds-destination-need");
  // Manual seleciona EXATAMENTE 28/08 → 30min:
  ok(
    actions.createSpecialExcessUse({
      destinationDate: HOJE,
      minutes: 30,
      allocationStrategy: "manual",
      manualAllocations: [{ originDate: "2026-08-28", minutes: 30 }],
      asOfDate: HOJE,
      now: 400,
    }),
    "uso manual 28/08→30",
  );
  const uso = d().specialExcessUses!.at(-1)!;
  assert.deepEqual(uso.allocations, [{ originDate: "2026-08-28", minutes: 30 }], "origem específica preservada");
  assert.equal(uso.allocationStrategy, "manual");
});

check("TESTE 12 DE 15 — Após o uso: factual 7h30/−30 intacto e projeção 8h/0", () => {
  loadFixtureHoje();
  ok(actions.createSpecialExcessUse({ destinationDate: HOJE, minutes: 30, allocationStrategy: "fifo", asOfDate: HOJE, now: 500 }), "uso");
  const st = d();
  // Factual NÃO muda (usos [10+] nunca alteram batidas/saldo regular):
  const row = buildResumoDayRow({
    date: HOJE,
    today: HOJE,
    entries: st.entries,
    absences: st.absences,
    calendars: st.companyCalendars,
    settings: settingsOf(st.user),
    faltas: st.faltas,
    controlStartDate: st.user.controlStartDate ?? null,
  });
  assert.equal(row.workedMinutes, 450, "factual continua 7h30");
  assert.equal(row.balanceMinutes, -30, "saldo regular continua −30");
  // Projeção no ponto (3A): 8h / 0min — visão do dia E visão do período:
  const view = viewHoje();
  assert.deepEqual(view.projection, { workedMinutes: 480, balanceMinutes: 0 }, "projeção do dia 8h/0");
  const period = getPointPeriod(HOJE);
  const periodView = buildResumoPeriodView({
    period,
    today: HOJE,
    entries: st.entries,
    absences: st.absences,
    calendars: st.companyCalendars,
    settings: settingsOf(st.user),
    faltas: st.faltas,
    controlStartDate: st.user.controlStartDate ?? null,
    uses: st.specialExcessUses ?? [],
    plans: st.specialExcessPlans ?? [],
  });
  const linhaHoje = periodView.days.find((r) => r.day.date === HOJE);
  assert.equal(linhaHoje?.projection.projectedBalanceMinutes, 0, "projeção do período para hoje: 0");
  // A página apresenta de forma DISCRETA (sem substituir o factual):
  const page = src("src/app/(app)/page.tsx");
  assert.ok(page.includes("Aplicado hoje:"), "[10+] aplicado: apresentado");
  assert.ok(page.includes("Projeção no ponto:"), "projeção no ponto: apresentada");
  assert.ok(page.includes("todaySpecialView.usedActiveMinutes"), "fonte: usos ativos da visão canônica");
});

check("TESTE 13 DE 15 — Hoje sem saldo [10+]: CTA não aparece", () => {
  loadFixtureHoje();
  // Segunda reserva consome TODO o restante do banco (10+20+30 = 60 livres):
  ok(actions.createSpecialExcessPlan({ destinationDate: "2026-09-30", minutes: 60, selectionMode: "automatic", asOfDate: "2026-08-29", now: 600 }), "reserva esgota o banco");
  assert.equal(bankOf(HOJE).availableMinutes, 0, "banco zerado");
  const view = viewHoje();
  assert.equal(view.remainingMinutes, 30, "ainda há necessidade");
  assert.equal(view.bankAvailableMinutes, 0, "mas sem saldo disponível");
  assert.equal(view.canComplete, false, "CTA não aparece: sem saldo [10+] disponível");
});

/* ════════════════ PARTE C — TESTES 14–15 (UX) ════════════════ */

check("TESTE 14 DE 15 — Reserva no mobile: empilhada, sem overflow, ação acessível", () => {
  const summary = src("src/components/special-excess-plan-summary.tsx");
  // MOBILE: <li> empilha (space-y) e o DESKTOP segue compacto (sm:flex):
  assert.ok(summary.includes("space-y-1.5 rounded-lg bg-white/70 px-2.5 py-2 text-[11px] font-medium text-violet-900 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:space-y-0"), "li empilha no mobile / linha no desktop");
  // Título, origem e modo em blocos próprios no mobile (sem quebra caótica):
  assert.ok(summary.includes('block font-bold tabular-nums sm:contents'), "título da reserva em linha própria (mobile)");
  assert.ok(summary.includes('<span className="block sm:inline">'), "origem em linha própria (mobile)");
  assert.ok(summary.includes('block text-violet-600 sm:inline'), "modo de seleção em linha própria (mobile)");
  // Ações acessíveis (largura total no mobile, compactas no desktop):
  assert.ok(summary.includes('className="w-full !border-violet-300 !text-violet-700 hover:!bg-violet-50 sm:w-auto"'), "Usar planejamento acessível");
  assert.ok(summary.includes('className="w-full !px-2 !text-rose-600 hover:!bg-rose-50 sm:w-auto"'), "Cancelar reserva acessível");
  // Nenhuma regra alterada: cancelamento continua na action do store:
  assert.ok(summary.includes("actions.cancelSpecialExcessPlan("), "cancelar segue pela action (regra intacta)");
  assert.ok(!summary.includes("createSpecialExcess"), "nenhuma regra de uso/reserva na UI");
});

check("TESTE 15 DE 15 — Planejar mais com saldo 0: CTA inviável substituído; zero regra nova", () => {
  const summary = src("src/components/special-excess-plan-summary.tsx");
  // Com available = 0: estado desabilitado/discreto no lugar do CTA ativo:
  assert.ok(summary.includes("bankAvailableMinutes === 0"), "gate de saldo zero na UI");
  assert.ok(summary.includes("Sem saldo [10+] disponível"), "texto discreto de saldo zero");
  assert.ok(summary.includes('title="O Banco [10+] deste ciclo não tem saldo disponível para novas reservas."'), "tooltip curto");
  // CTA ativo somente com saldo (ou sem visão — prop null mantém comportamento):
  assert.ok(summary.includes("bankAvailableMinutes !== 0"), "CTA ativo apenas com saldo ≠ 0");
  // A fonte é a visão canônica repassada pelo day-card (nenhuma fórmula na UI):
  const dayCard = src("src/components/day-card.tsx");
  assert.ok(dayCard.includes("bankAvailableMinutes={specialExcess ? specialExcess.bankAvailableMinutes : null}"), "day-card repassa o valor canônico");
  assert.ok(!summary.includes("buildSpecialExcessBank"), "sem banco/fórmula paralela no summary");
  // O gate do store permanece a verdade final (modal continua bloqueando):
  const modal = src("src/components/special-excess-use-modal.tsx");
  assert.ok(modal.includes("insufficient-special-balance"), "store/modal seguem como gate final");
  // §16 preservado: futuro reserva; dia chegou → decisão (4C intacta):
  assert.ok(summary.includes("Planejamento aguardando confirmação"), "bloco de decisão 4C intacto");
  assert.ok(summary.includes("isFuture && onPlan"), "Planejar mais segue restrito ao futuro");
});

console.log(`\n${passed}/15 verificações da Etapa 4C.1B passaram.`);
if (passed !== 15) process.exit(1);
