/**
 * VERIFICAÇÃO — ETAPA 4C.1A: CORREÇÃO CIRÚRGICA DA IMPORTAÇÃO DE BACKUP.
 *
 * BUG REAL: backup exportado continha SpecialExcessPlan (planned), mas o
 * fluxo REAL de importação (ImportBackupModal → actions) restaurava entries
 * e SpecialExcessUse e DESCARTAVA SpecialExcessPlan. Causa raiz encontrada
 * na auditoria: o modal não repassava `specialExcessPlans` às actions
 * replaceAll/mergeBackup (que default-izam para []). A correção adiciona o
 * campo nas DUAS chamadas do modal — nenhuma regra de domínio alterada.
 *
 * Cenário da fixture = arquivo real do usuário:
 *   18/08 gera 40min [10+] · 20/08 gera 1h · 28/08 gera 30min · 31/08 7h30
 *   SpecialExcessUse  → destino 31/08 · origem 28/08 · 30min · manual
 *   SpecialExcessPlan → destino 01/09 · origem 18/08 · 30min · planned/automatic
 *   Banco esperado após import: 2h10 gerado · 30 utilizado · 30 reservado · 1h10 disponível
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-backup-plans-import-4c1a.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { backupImportPayload, buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { activeSpecialPlansForDate, specialExcessPlanMinutes } from "../src/lib/special-excess-plan.ts";
import { getAnnualPointCycle } from "../src/lib/periods.ts";
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

/* ══════════ Fixture equivalente ao arquivo real (§7) ══════════ */

let eid = 1;
const e = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: eid++, date, time, type, note: null });
const day4 = (date: string, s: string, lo: string, li: string, end: string) => [e(date, s, "entrada"), e(date, lo, "saida"), e(date, li, "entrada"), e(date, end, "saida")];

const fixtureEntries: TimeEntry[] = [
  ...day4("2026-08-18", "07:00", "12:00", "13:00", "18:40"), // 10h40 → [10+] 40min
  ...day4("2026-08-20", "07:00", "12:00", "13:00", "19:00"), // 11h   → [10+] 1h
  ...day4("2026-08-28", "07:00", "12:00", "13:00", "18:30"), // 10h30 → [10+] 30min
  ...day4("2026-08-31", "08:00", "12:00", "13:00", "16:30"), // 7h30 (destino do uso)
];

const fixtureUse: SpecialExcessUse = {
  id: "seu-1",
  destinationDate: "2026-08-31",
  allocations: [{ originDate: "2026-08-28", minutes: 30 }],
  allocationStrategy: "manual",
  status: "utilizado",
  createdAt: 1756600000000,
};

const fixturePlan: SpecialExcessPlan = {
  id: "sep-1",
  destinationDate: "2026-09-01",
  allocations: [{ originDate: "2026-08-18", minutes: 30 }],
  selectionMode: "automatic",
  status: "planned",
  createdAt: 1756600001000,
};

const SEED = buildSeedData();

/** Estado do deployment A (com os dados do arquivo real). */
function loadDeploymentA(extraPlans: SpecialExcessPlan[] = []) {
  actions.replaceAll({
    user: SEED.user,
    entries: fixtureEntries.map((x) => ({ ...x })),
    compensations: [],
    absences: [],
    companyCalendars: undefined,
    faltas: [],
    excessReasons: [],
    specialExcessUses: [{ ...fixtureUse }],
    specialExcessPlans: [{ ...fixturePlan }, ...extraPlans.map((p) => ({ ...p }))],
  });
}

/** EXPORTAÇÃO (deployment A): estado → serialização → JSON ("arquivo real"). */
function exportJson(): string {
  return JSON.stringify(buildBackupPayload(getAppData()));
}

/** IMPORTAÇÃO no deployment B usando O MESMO CAMINHO do ImportBackupModal:
 * o payload derivado do CONTRATO ÚNICO de backup (4C.1B — antes da 4C.1A
 * esta função era a lista manual do modal, sem specialExcessPlans). */
function importReplaceViaModal(parsed: ReturnType<typeof parseBackup> extends { ok: true; backup: infer B } ? B : never) {
  actions.replaceAll(backupImportPayload(parsed));
}

function bankOf(asOf = "2026-08-31") {
  const st = getAppData();
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
}

/* ══════════ TESTES 01–08 ══════════ */

// Estado compartilhado do cenário real (deployment B após import correto):
let arquivoReal = "";

check("TESTE 01 DE 8 — Backup com plan `planned` é importado e preservado", () => {
  // DEPLOYMENT A → JSON (o arquivo real do usuário):
  loadDeploymentA();
  arquivoReal = exportJson();
  const exported = JSON.parse(arquivoReal) as { specialExcessPlans?: unknown[] };
  assert.equal(exported.specialExcessPlans?.length, 1, "EXPORTAÇÃO correta: JSON contém o plano (relato: arquivo correto)");
  // DEPLOYMENT B (novo): estado zerado.
  actions.clearAll();
  assert.equal((getAppData().specialExcessPlans ?? []).length, 0);
  // REPRODUÇÃO DO BUG: import pelo fluxo ANTIGO do modal (sem specialExcessPlans)
  // → plano perdido, exatamente como observado no navegador:
  const parsedBug = parseBackup(arquivoReal);
  assert.ok(parsedBug.ok);
  if (!parsedBug.ok) return;
  actions.replaceAll({
    user: parsedBug.backup.user,
    entries: parsedBug.backup.entries,
    compensations: parsedBug.backup.compensations,
    absences: parsedBug.backup.absences,
    companyCalendars: parsedBug.backup.companyCalendars,
    faltas: parsedBug.backup.faltas,
    excessReasons: parsedBug.backup.excessReasons,
    specialExcessUses: parsedBug.backup.specialExcessUses,
  });
  assert.equal((getAppData().specialExcessPlans ?? []).length, 0, "BUG REPRODUZIDO: fluxo antigo descartava o plano");
  assert.equal((getAppData().specialExcessUses ?? []).length, 1, "uso era restaurado (relato)");
  // IMPORT CORRIGIDO (pipeline real do modal, agora com plans):
  actions.clearAll();
  const parsed = parseBackup(arquivoReal);
  assert.ok(parsed.ok, "parse do arquivo real válido");
  if (!parsed.ok) return;
  importReplaceViaModal(parsed.backup);
  const plans = getAppData().specialExcessPlans ?? [];
  assert.equal(plans.length, 1, "plano restaurado");
  assert.equal(plans[0]?.id, "sep-1", "id preservado");
  assert.equal(plans[0]?.destinationDate, "2026-09-01", "data preservada");
  assert.equal(plans[0]?.status, "planned", "status planned preservado");
});

check("TESTE 02 DE 8 — Allocations do plan preservadas: 18/08 → 30min", () => {
  const plan = (getAppData().specialExcessPlans ?? [])[0];
  assert.ok(plan, "plano presente (estado do TESTE 01)");
  assert.deepEqual(plan?.allocations, [{ originDate: "2026-08-18", minutes: 30 }]);
  assert.equal(specialExcessPlanMinutes(plan!), 30);
});

check("TESTE 03 DE 8 — selectionMode `automatic` preservado", () => {
  const plan = (getAppData().specialExcessPlans ?? [])[0];
  assert.equal(plan?.selectionMode, "automatic");
});

check("TESTE 04 DE 8 — Use e Plan coexistem após import: used 30 + reserved 30", () => {
  const st = getAppData();
  assert.equal((st.specialExcessUses ?? []).length, 1, "uso restaurado");
  assert.equal((st.specialExcessPlans ?? []).length, 1, "plano restaurado");
  const b = bankOf();
  assert.equal(b.usedMinutes, 30, "uso ativo conta como utilizado");
  assert.equal(b.reservedMinutes, 30, "plano ativo conta como reservado");
});

check("TESTE 05 DE 8 — Banco canônico após import: 2h10 gerado · 30 utilizado · 30 reservado · 1h10 disponível", () => {
  const b = bankOf();
  assert.deepEqual(
    { g: b.generatedMinutes, u: b.usedMinutes, r: b.reservedMinutes, a: b.availableMinutes },
    { g: 130, u: 30, r: 30, a: 70 },
    "2h10 gerado − 30min utilizado − 30min reservado = 1h10 disponível (cenário real)",
  );
});

check("TESTE 06 DE 8 — Plan `cancelled` e `concluded` preservam status e metadados 4C", () => {
  const concluded: SpecialExcessPlan = {
    id: "sep-2",
    destinationDate: "2026-08-25",
    allocations: [{ originDate: "2026-08-20", minutes: 60 }],
    selectionMode: "manual",
    status: "concluded",
    createdAt: 1756600002000,
    concludedAt: 1756700000000,
    resolvedAt: 1756700000000,
    resolvedUseId: "seu-2",
    resolvedMinutes: 45,
    releasedMinutes: 15,
  };
  const cancelled: SpecialExcessPlan = {
    id: "sep-3",
    destinationDate: "2026-08-26",
    allocations: [{ originDate: "2026-08-18", minutes: 10 }],
    selectionMode: "automatic",
    status: "cancelled",
    createdAt: 1756600003000,
    cancelledAt: 1756650000000,
  };
  loadDeploymentA([concluded, cancelled]);
  const json = exportJson();
  actions.clearAll();
  const parsed = parseBackup(json);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  importReplaceViaModal(parsed.backup);
  const plans = getAppData().specialExcessPlans ?? [];
  assert.equal(plans.length, 3, "três planos restaurados (planned + concluded + cancelled)");
  const c = plans.find((p) => p.id === "sep-2");
  assert.equal(c?.status, "concluded");
  assert.equal(c?.concludedAt, 1756700000000);
  assert.equal(c?.resolvedAt, 1756700000000, "resolvedAt preservado");
  assert.equal(c?.resolvedUseId, "seu-2", "resolvedUseId preservado");
  assert.equal(c?.resolvedMinutes, 45, "resolvedMinutes preservado");
  assert.equal(c?.releasedMinutes, 15, "releasedMinutes preservado");
  const x = plans.find((p) => p.id === "sep-3");
  assert.equal(x?.status, "cancelled");
  assert.equal(x?.cancelledAt, 1756650000000, "cancelledAt preservado");
  // Round-trip estrutural: sem perda na serialização (deepEqual no plano concluded):
  const fromJson = JSON.parse(json) as { specialExcessPlans: SpecialExcessPlan[] };
  assert.deepEqual(fromJson.specialExcessPlans.find((p) => p.id === "sep-2"), concluded);
});

check("TESTE 07 DE 8 — Backup antigo SEM `specialExcessPlans` continua importável", () => {
  const old = JSON.parse(arquivoReal) as Record<string, unknown>;
  delete old.specialExcessPlans;
  const jsonAntigo = JSON.stringify(old);
  actions.clearAll();
  const parsed = parseBackup(jsonAntigo);
  assert.ok(parsed.ok, "backup antigo válido (retrocompatibilidade)");
  if (!parsed.ok) return;
  importReplaceViaModal(parsed.backup);
  const st = getAppData();
  assert.deepEqual(st.specialExcessPlans ?? [], [], "plans → [] (backups antigos não os têm)");
  assert.equal((st.specialExcessUses ?? []).length, 1, "uso segue restaurado");
  assert.equal(st.entries.length, 16, "entries seguem restauradas");
  const b = bankOf();
  assert.equal(b.reservedMinutes, 0, "sem planos → nada reservado");
  assert.equal(b.availableMinutes, 100, "2h10 − 30min utilizado = 1h40 disponível (estado do relato após o bug)");
});

check("TESTE 08 DE 8 — Round-trip real: estado → export → zerar → import → equivalente", () => {
  // Estado original (deployment A) restaurado a partir da fixture:
  loadDeploymentA();
  const original = getAppData();
  const json = exportJson();
  actions.clearAll();
  const parsed = parseBackup(json);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  importReplaceViaModal(parsed.backup);
  const restored = getAppData();
  // Equivalência semântica (entradas, usos, planos, allocations, status, metadados):
  assert.deepEqual(restored.entries, original.entries, "entries equivalentes (ids e conteúdo)");
  assert.deepEqual(restored.specialExcessUses, original.specialExcessUses, "uses equivalentes");
  assert.deepEqual(restored.specialExcessPlans, original.specialExcessPlans, "plans equivalentes (allocations/status/metadados 4C)");
  assert.equal(bankOf().availableMinutes, 70, "banco do round-trip = 1h10 disponível");
  // Caminho MERGE do modal (contrato 4C.1B): união por id — reimportar NÃO duplica:
  actions.mergeBackup(backupImportPayload(parsed.backup));
  const merged = getAppData();
  assert.equal((merged.specialExcessPlans ?? []).length, 1, "merge: plano não duplica (colisão de id → prevalece o local)");
  assert.equal((merged.specialExcessUses ?? []).length, 1, "merge: uso não duplica");
  assert.equal(merged.entries.length, original.entries.length, "merge: entries não duplicam");
});

/* ══════════ UI/INTEGRAÇÃO (§9) — dado restaurado chega à UI existente ══════════ */

check("UI/INTEGRAÇÃO — 01/09 reconhece '[10+] reservado · 30min' e NÃO 'Planejar uso de [10+]'", () => {
  // Estado atual = pós-import (TESTE 08). A visão derivada de Registros usa
  // EXATAMENTE este predicado (registros/page.tsx:254 → day-card):
  const plans = getAppData().specialExcessPlans ?? [];
  const specialPlans = activeSpecialPlansForDate(plans, "2026-09-01");
  assert.equal(specialPlans.length, 1, "reserva ativa reconhecida em 01/09");
  assert.equal(specialPlans[0]?.destinationDate, "2026-09-01");
  // day-card.tsx: com specialPlans.length > 0 renderiza o badge
  // "[10+] reservado · {formatMinutes(soma)}" (30min):
  const soma = specialPlans.reduce((s, p) => s + specialExcessPlanMinutes(p), 0);
  assert.equal(soma, 30, "badge exibiria 30min");
  // E o CTA "Planejar uso de [10+]" é gated por !(specialPlans.length > 0) —
  // com a reserva restaurada o gate oculta o CTA (nenhum planejamento duplicado):
  const dayCard = src("src/components/day-card.tsx");
  assert.ok(dayCard.includes("!(specialPlans && specialPlans.length > 0)"), "gate do CTA 'Planejar uso' exige dia SEM reserva");
  assert.ok(dayCard.includes("[10+] reservado ·"), "badge de reserva presente no card");
  // O modal deriva o payload do CONTRATO nas DUAS chamadas (guarda 4C.1B —
  // stronger que a guarda manual da 4C.1A: cobre TODAS as coleções):
  const modal = src("src/components/import-backup-modal.tsx");
  assert.equal(modal.split("backupImportPayload(parsed)").length - 1, 2, "replace() e merge() usam o payload do contrato");
});

console.log(`\n${passed} verificações da Etapa 4C.1A passaram.`);
if (passed !== 9) process.exit(1);
