/**
 * VERIFICAÇÃO — SEED 4.0 / RESTAURAR DADOS DE EXEMPLO (modelo atual)
 *
 * O seed visual demonstra UM modelo operacional (o atual):
 *   jornada factual → saldo regular factual → [10+] gerado → uso [10+] → projeção.
 *
 *  A  restore: sem dados do modelo legado (compensações/ausências/faltas/
 *     calendário/motivos) no seed visual
 *  B  sem calendário fictício; restore não duplica
 *  C  apenas os 7 dias demonstrativos (27 batidas)
 *  D  restore duas vezes = mesmo cenário (reseed === buildSeedData)
 *  E  backup JSON round-trip preserva dados (incl. specialExcessUses)
 *  F  26/08: déficit 1h; banco [10+] 130min (motor 3C); elegível (3A)
 *  G  25/08: 8h normal, saldo 0, não elegível
 *  H  24/08: 7h30 (déficit 30min); 27/08: registro incompleto (não elegível)
 *  I  controlStartDate 01/08/2026; SEED_VERSION 4.0
 *
 * O cenário legado 3.1 continua coberto pelos testes de regressão que usam a
 * fixture própria buildLegacyDemoScenario().
 *
 * Executar: npx tsx tests/verify-seed-restore.mts
 */
import assert from "node:assert/strict";

import { buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { buildSeedData, SEED_CONTROL_START, SEED_VERSION } from "../src/lib/seed-data.ts";
import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import type { AppData } from "../src/lib/types.ts";

const ASOF = "2026-08-30";

const snap = (d: AppData) => JSON.stringify(d);
let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const dayView = (d: AppData, date: string) =>
  buildSpecialExcessDayView({
    date,
    asOfDate: ASOF,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate,
    uses: d.specialExcessUses ?? [],
  });

check("A. seed limpo: sem compensações/ausências/faltas/calendário/motivos legados", () => {
  actions.reseed();
  const d = getAppData();
  assert.equal(d.compensations.length, 0, "um único modelo operacional no visual");
  assert.equal(d.absences.length, 0);
  assert.equal(d.faltas.length, 0);
  assert.equal(d.companyCalendars, undefined);
  assert.equal((d.excessReasons ?? []).length, 0);
  assert.deepEqual(d.specialExcessUses, [], "banco novo nasce dos fatos; usos pela interface");
});

check("B. sem calendário fictício; restore não duplica", () => {
  actions.reseed();
  const n = getAppData().entries.length;
  actions.reseed();
  assert.equal((getAppData().companyCalendars ?? []).length, 0);
  assert.equal(getAppData().entries.length, n, "não duplica ocorrências");
});

check("C. apenas os 7 dias demonstrativos (27 batidas)", () => {
  actions.reseed();
  const d = getAppData();
  const dates = [...new Set(d.entries.map((e) => e.date))].sort();
  assert.deepEqual(
    dates,
    ["2026-08-18", "2026-08-20", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"],
  );
  assert.equal(d.entries.length, 27);
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

check("E. backup JSON round-trip preserva dados (incl. specialExcessUses)", () => {
  const payload = buildBackupPayload(buildSeedData());
  assert.ok(payload.entries.length > 0);
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
    specialExcessUses: parsed.backup.specialExcessUses,
  });
  const d = getAppData();
  assert.equal(d.entries.length, payload.entries.length);
  assert.ok(d.entries.some((e) => e.date === "2026-08-26"));
  assert.deepEqual(d.specialExcessUses, []);
  assert.equal(d.user.controlStartDate, SEED_CONTROL_START);
});

check("F. 26/08: déficit 1h; banco [10+] 130min (motor 3C); elegível (3A)", () => {
  actions.reseed();
  const d = getAppData();
  const v = dayView(d, "2026-08-26");
  assert.equal(v.eligible, true, "7h → jornada abaixo do previsto");
  assert.equal(v.workedMinutes, 420);
  assert.equal(v.factualBalanceMinutes, -60);
  assert.equal(v.neededMinutes, 60);
  assert.equal(v.usedActiveMinutes, 0);
  assert.equal(v.bankAvailableMinutes, 130, "banco nasce das batidas (40+60+30)");
  assert.equal(v.canComplete, true);
  assert.deepEqual(
    v.bank.lots.map((l) => [l.originDate, l.generatedMinutes, l.availableMinutes]),
    [
      ["2026-08-18", 40, 40],
      ["2026-08-20", 60, 60],
      ["2026-08-28", 30, 30],
    ],
    "lotes: origem data-origem, gerado e disponível",
  );
});

check("G. 25/08: 8h normal, saldo 0, sem [10+]", () => {
  actions.reseed();
  const d = getAppData();
  const v = dayView(d, "2026-08-25");
  assert.equal(v.workedMinutes, 480);
  assert.equal(v.factualBalanceMinutes, 0);
  assert.equal(v.eligible, false, "na base → não é elegível");
  assert.equal(v.canComplete, false);
});

check("H. 24/08: 7h30 (déficit 30); 27/08: incompleto (não elegível)", () => {
  actions.reseed();
  const d = getAppData();
  const v24 = dayView(d, "2026-08-24");
  assert.equal(v24.workedMinutes, 450);
  assert.equal(v24.factualBalanceMinutes, -30);
  assert.equal(v24.neededMinutes, 30);
  assert.equal(v24.eligible, true);
  assert.equal(v24.canComplete, true);

  const row27 = buildResumoDayRow({
    date: "2026-08-27",
    today: ASOF,
    entries: d.entries,
    absences: d.absences,
    calendars: d.companyCalendars,
    settings: settingsOf(d.user),
    faltas: d.faltas,
    controlStartDate: d.user.controlStartDate,
  });
  assert.equal(row27.status, "incomplete", "sem saída final → Registro incompleto");
  const v27 = dayView(d, "2026-08-27");
  assert.equal(v27.eligible, false, "incompleto ≠ abaixo do previsto");
  assert.equal(v27.canComplete, false);
});

check("I. controlStartDate 01/08/2026 e versão 4.0", () => {
  assert.equal(SEED_VERSION, "4.0");
  assert.equal(SEED_CONTROL_START, "2026-08-01");
  actions.reseed();
  assert.equal(getAppData().user.controlStartDate, SEED_CONTROL_START);
});

console.log(`\nSEED 4.0 / RESTORE — OK (${passed} testes)`);
