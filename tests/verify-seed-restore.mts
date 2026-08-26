/**
 * VERIFICAÇÃO — SEED 3.0 / RESTAURAR DADOS DE EXEMPLO
 *
 *  A  excessReasons após restore: 17/18/24 com motivo; 11/08 sem
 *  B  calendário fictício presente, ABONADO + COMPENSAR + parcial; sem duplicar
 *  C  compensações/status/destinos preservados
 *  D  restore duas vezes = mesmo cenário
 *  E  backup JSON round-trip preserva excessReasons (bug do import)
 *  F  24/08: motivo, 25 realocados, 35 livres, Realocar (não Registrar)
 *  G  11/08 continua sem motivo
 *  H  19/08 tem excedente elegível; UI sem "Usar horas livres"
 *
 * Executar: npx tsx tests/verify-seed-restore.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { dayCreditView, eligibleSpecialSourcesForDeficit, specialExcessLedger } from "../src/lib/hour-bank.ts";
import { buildSeedData, SEED_VERSION } from "../src/lib/seed-data.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import { settingsOf } from "../src/lib/store.ts";
import type { AppData, WorkSettings } from "../src/lib/types.ts";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const TODAY = "2026-08-25";
const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};

const snap = (d: AppData) => JSON.stringify(d);
let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const importSrc = srcOf("src/components/import-backup-modal.tsx");
const dayCardSrc = srcOf("src/components/day-card.tsx");
const panelSrc = srcOf("src/components/excess-panel.tsx");
const bankSrc = srcOf("src/components/hour-bank-card.tsx");

assert.equal(SEED_VERSION, "3.0");

check("A. excessReasons: 17/18/24 com motivo; 11/08 sem", () => {
  actions.reseed();
  const d = getAppData();
  const byDate = new Map((d.excessReasons ?? []).map((r) => [r.date, r]));
  assert.equal(byDate.get("2026-08-17")?.reason, "demanda-urgente");
  assert.equal(byDate.get("2026-08-18")?.reason, "atendimento-evento");
  assert.equal(byDate.get("2026-08-24")?.reason, "demanda-urgente");
  assert.equal(byDate.has("2026-08-11"), false);
});

check("B. calendário fictício: ABONADO, COMPENSAR 8h, COMPENSAR 4h; restore não duplica", () => {
  actions.reseed();
  const cals = getAppData().companyCalendars ?? [];
  assert.equal(cals.length, 1);
  assert.equal(cals[0].cycleStart, "2026-05-01");
  assert.equal(cals[0].cycleEnd, "2027-04-30");
  const entries = cals[0].entries;
  assert.ok(entries.some((e) => e.tratamento === "ABONADO"));
  assert.ok(entries.some((e) => e.tratamento === "COMPENSAR" && e.horasACompensar === 8));
  assert.ok(entries.some((e) => e.tratamento === "COMPENSAR" && e.horasACompensar === 4));
  const n = entries.length;
  actions.reseed();
  assert.equal((getAppData().companyCalendars ?? [])[0].entries.length, n, "não duplica ocorrências");
});

check("C. compensações: destinos e status preservados; sem duplicar", () => {
  actions.reseed();
  const a = getAppData().compensations;
  assert.ok(a.some((c) => c.sourceDate === "2026-08-21" && c.portion === "especial" && c.status === "concluida" && c.minutes === 10));
  assert.ok(a.some((c) => c.sourceDate === "2026-08-20" && c.portion === "especial" && c.status === "concluida" && c.minutes === 15));
  assert.ok(a.some((c) => c.sourceDate === "2026-08-18" && c.kind === "excedente" && c.status === "pendente" && c.minutes === 45));
  assert.ok(a.some((c) => c.kind === "acordo" && c.status === "concluida"));
  assert.ok(a.some((c) => c.kind === "acordo" && c.status === "pendente"));
  const n = a.length;
  actions.reseed();
  assert.equal(getAppData().compensations.length, n);
});

check("D. restore duas vezes produz o mesmo cenário", () => {
  actions.reseed();
  const first = snap(getAppData());
  actions.reseed();
  const second = snap(getAppData());
  assert.equal(second, first);
  const seed = snap(buildSeedData());
  assert.equal(first, seed, "reseed === buildSeedData");
});

check("E. parseBackup + replaceAll preserva excessReasons (causa raiz do import)", () => {
  assert.ok(importSrc.includes("excessReasons: parsed.excessReasons"), "modal envia excessReasons no replace");
  assert.ok(importSrc.includes("excessReasons: parsed.excessReasons"), "modal envia excessReasons no merge");
  const payload = buildBackupPayload(buildSeedData());
  assert.ok((payload.excessReasons ?? []).length >= 3);
  const parsed = parseBackup(JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  actions.replaceAll({
    user: parsed.backup.user,
    entries: parsed.backup.entries,
    compensations: parsed.backup.compensations,
    absences: parsed.backup.absences,
    companyCalendars: parsed.backup.companyCalendars,
    faltas: parsed.backup.faltas,
    excessReasons: parsed.backup.excessReasons,
  });
  const byDate = new Map((getAppData().excessReasons ?? []).map((r) => [r.date, r]));
  assert.equal(byDate.get("2026-08-24")?.reason, "demanda-urgente");
  assert.equal(byDate.get("2026-08-17")?.reason, "demanda-urgente");
  assert.equal(byDate.get("2026-08-18")?.reason, "atendimento-evento");
  assert.equal(byDate.has("2026-08-11"), false);
});

check("F. 24/08 após restore: motivo, 25 realocados, 35 livres, sem Registrar motivo na UI de motivo presente", () => {
  actions.reseed();
  const d = getAppData();
  const v = dayCreditView("2026-08-24", d.entries, d.compensations, d.absences, d.companyCalendars, settingsOf(d.user), d.excessReasons);
  assert.equal(v.reason?.reason, "demanda-urgente");
  assert.equal(v.excessSpecial, 60);
  assert.equal(v.freeSpecial, 35);
  const led = specialExcessLedger("2026-08-24", d.compensations, 60);
  assert.equal(led.realized, 25);
  assert.equal(led.free, 35);
  assert.equal(led.status, "parcial");
  assert.ok(dayCardSrc.includes("Realocar excedente"));
  assert.ok(dayCardSrc.includes("{!creditView?.reason && onRegisterReason && ("));
  assert.ok(dayCardSrc.includes("{creditView?.reason && onRegisterReason && ("));
});

check("G. 11/08 continua sem motivo", () => {
  const d = getAppData();
  const v = dayCreditView("2026-08-11", d.entries, d.compensations, d.absences, d.companyCalendars, settings, d.excessReasons);
  assert.equal(v.excessSpecial, 15);
  assert.equal(v.reason, undefined);
  assert.equal(v.freeSpecial, 15);
});

check("H. 19/08: excedente elegível; UI sem Usar horas livres", () => {
  const d = getAppData();
  const srcs = eligibleSpecialSourcesForDeficit(
    "2026-08-19", d.entries, d.compensations, d.absences, d.companyCalendars, settings, d.excessReasons, TODAY,
  );
  assert.ok(srcs.some((v) => v.date === "2026-08-24" && v.freeSpecial === 35));
  assert.ok(dayCardSrc.includes("Usar excedente disponível"));
  assert.ok(!dayCardSrc.includes("Usar horas livres"));
  assert.ok(!panelSrc.includes("Usar horas livres"));
  assert.ok(bankSrc.includes("Previsão de horas a compensar"));
  assert.ok(bankSrc.includes("Ver detalhes"));
  assert.ok(!bankSrc.includes("Abrir Compensações"));
});

console.log(`\nSEED RESTORE 3.0 — OK (${passed} testes)`);
