/**
 * Filtro Situação do dia em Registros — consulta classificações existentes.
 * TZ=America/Sao_Paulo npx tsx tests/verify-filtro-situacao.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DAY_SITUATION_OPTIONS,
  dayMatchesSituations,
  filterDatesBySituation,
  parseSituationParam,
  serializeSituationParam,
  situationsOfDay,
  type DaySituationId,
} from "../src/lib/day-situation.ts";
import { registrosTimelineDates } from "../src/lib/missing-records.ts";
import { hourBankSummary } from "../src/lib/hour-bank.ts";
import { seedCompanyCalendars } from "../src/lib/seed-calendars.ts";
import { buildSeedData, DEFAULT_USER } from "../src/lib/seed-data.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import type { Absence } from "../src/lib/absences.ts";
import type { Falta, TimeEntry, WorkSettings } from "../src/lib/types.ts";

const S: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const cals = seedCompanyCalendars();
const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const TODAY = "2026-08-28";
const PERIOD = { from: "2026-08-21", to: "2026-09-20" };
const seed = buildSeedData();

function classify(date: string, extra?: {
  entries?: TimeEntry[];
  absences?: Absence[];
  faltas?: Falta[];
}): DaySituationId[] {
  return situationsOfDay(
    date,
    TODAY,
    extra?.entries ?? seed.entries,
    extra?.absences ?? seed.absences,
    cals,
    S,
    {
      compensations: seed.compensations,
      faltas: extra?.faltas ?? seed.faltas,
      excessReasons: seed.excessReasons,
    },
  );
}

function punch(id: number, date: string, time: string, type: "entrada" | "saida"): TimeEntry {
  return { id, date, time, type, note: null };
}

check("1. filtro aparece na página Registros", () => {
  const page = srcOf("src/app/(app)/registros/page.tsx");
  const ui = srcOf("src/components/day-situation-filter.tsx");
  assert.ok(page.includes("DaySituationFilter"));
  assert.ok(page.includes("Situação do dia") || ui.includes("Situação do dia"));
  assert.ok(ui.includes("Todos os dias"));
  assert.ok(page.includes("searchParams.get(\"situacao\")"));
});

check("2. Todos os dias mostra linha do tempo normal", () => {
  const dates = registrosTimelineDates(PERIOD);
  assert.equal(dates.length, 31);
  const filtered = filterDatesBySituation(dates, [], classify);
  assert.deepEqual(filtered, dates);
});

check("3. Abaixo da base retorna somente dias correspondentes", () => {
  const dates = filterDatesBySituation(registrosTimelineDates(PERIOD), ["abaixo-base"], classify);
  assert.ok(dates.includes("2026-08-21"));
  assert.ok(!dates.includes("2026-08-24"));
  assert.ok(!dates.includes("2026-08-26"), "Sem registro não é abaixo da base");
  assert.ok(!dates.includes("2026-08-28"), "hoje vazio não é abaixo da base");
  assert.ok(classify("2026-08-21").includes("abaixo-base"));
  const incomplete = [
    punch(1, "2026-08-26", "08:00", "entrada"),
  ];
  assert.ok(!classify("2026-08-26", { entries: incomplete }).includes("abaixo-base"));
});

check("4. Hora extra regular retorna dia > base e <=10h", () => {
  const ids = classify("2026-08-07");
  assert.ok(ids.includes("hora-extra-regular"));
  assert.ok(!ids.includes("excedente-10"));
  const sat = classify("2026-08-22");
  assert.ok(sat.includes("hora-extra-regular"));
});

check("5. [10+] retorna dia >10h", () => {
  const ids = classify("2026-08-24");
  assert.ok(ids.includes("excedente-10"));
  assert.ok(ids.includes("hora-extra-regular"), "11h também tem crédito regular até 10h");
  assert.ok(!classify("2026-08-07").includes("excedente-10"));
  const page = srcOf("src/lib/day-situation.ts");
  assert.ok(page.includes("excessSpecial"));
  assert.ok(!srcOf("src/app/(app)/registros/page.tsx").includes("workedMinutes - settings.maxDailyMinutes"));
});

check("6. Trabalho em folga retorna dias correspondentes", () => {
  assert.ok(classify("2026-08-22").includes("trabalho-folga"));
  assert.ok(classify("2026-08-23").includes("trabalho-folga"));
  assert.ok(!classify("2026-08-21").includes("trabalho-folga"));
});

check("7. Falta retorna faltas", () => {
  const faltas: Falta[] = [{ id: 1, date: "2026-08-26", createdAt: 1 }];
  assert.ok(classify("2026-08-26", { faltas }).includes("falta"));
  assert.ok(!classify("2026-08-26", { faltas }).includes("falta-prevista"));
});

check("8. Falta prevista retorna faltas previstas", () => {
  assert.ok(classify("2026-08-31").includes("falta-prevista"));
  assert.ok(!classify("2026-08-31").includes("falta"));
});

check("9. Férias retorna férias", () => {
  const absences: Absence[] = [{
    id: 9, kind: "ferias", startDate: "2026-08-26", endDate: "2026-08-26",
    duration: "integral", createdAt: 1,
  }];
  assert.ok(classify("2026-08-26", { absences }).includes("ferias"));
});

check("10. Saúde/afastamento retorna situação correspondente", () => {
  const absences: Absence[] = [{
    id: 9, kind: "saude", startDate: "2026-08-26", endDate: "2026-08-26",
    duration: "integral", createdAt: 1,
  }];
  assert.ok(classify("2026-08-26", { absences }).includes("saude"));
});

check("11. Dispensado retorna dispensados", () => {
  const absences: Absence[] = [{
    id: 9, kind: "acordado", startDate: "2026-08-26", endDate: "2026-08-26",
    duration: "integral", treatment: "dispensado", createdAt: 1,
  }];
  assert.ok(classify("2026-08-26", { absences }).includes("dispensado"));
  const outro: Absence[] = [{
    id: 10, kind: "outro", startDate: "2026-08-27", endDate: "2026-08-27",
    duration: "integral", createdAt: 1,
  }];
  assert.ok(classify("2026-08-27", { absences: outro }).includes("dispensado"));
});

check("12. Abono retorna abono integral", () => {
  assert.ok(classify("2026-08-10").includes("abono"));
  assert.ok(!classify("2026-08-10").includes("abono-parcial"));
});

check("13. Abono parcial retorna abono parcial", () => {
  const ids = classify("2027-02-10", { entries: [], absences: [], faltas: [] });
  assert.ok(ids.includes("abono-parcial"));
  assert.ok(!ids.includes("abono"));
});

check("14. Folga a compensar retorna COMPENSAR/calendário correspondente", () => {
  assert.ok(classify("2026-08-25").includes("folga-compensar"));
  assert.ok(!classify("2026-08-21").includes("folga-compensar"));
});

check("15. Sem registro NÃO aparece no seletor", () => {
  const labels = DAY_SITUATION_OPTIONS.map((o) => o.label).join(" | ").toLowerCase();
  assert.ok(!labels.includes("sem registro"));
  const ui = srcOf("src/components/day-situation-filter.tsx");
  const block = ui.slice(ui.indexOf("DAY_SITUATION_GROUPS"), ui.length);
  assert.ok(!block.includes("Sem registro"));
});

check("16. incompleto NÃO aparece no seletor", () => {
  const labels = DAY_SITUATION_OPTIONS.map((o) => o.label.toLowerCase()).join(" ");
  assert.ok(!labels.includes("incompleto"));
});

check("17. inconsistente NÃO aparece no seletor", () => {
  const labels = DAY_SITUATION_OPTIONS.map((o) => o.label.toLowerCase()).join(" ");
  assert.ok(!labels.includes("inconsistente"));
});

check("18. múltiplas situações usam OR", () => {
  const dates = filterDatesBySituation(
    registrosTimelineDates(PERIOD),
    ["abaixo-base", "excedente-10"],
    classify,
  );
  assert.ok(dates.includes("2026-08-21"));
  assert.ok(dates.includes("2026-08-24"));
  assert.ok(dayMatchesSituations(["abaixo-base"], ["abaixo-base", "excedente-10"]));
  assert.ok(dayMatchesSituations(["excedente-10", "hora-extra-regular"], ["abaixo-base", "excedente-10"]));
  assert.equal(dayMatchesSituations(["dia-ok"], ["abaixo-base", "excedente-10"]), false);
});

check("19. filtro sem DE/ATÉ usa período atual", () => {
  const page = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("registrosTimelineDates(range)"));
  assert.ok(page.includes("const range = query ?? period"));
  const dates = filterDatesBySituation(registrosTimelineDates(PERIOD), ["trabalho-folga"], classify);
  assert.ok(dates.every((d) => d >= PERIOD.from && d <= PERIOD.to));
  assert.ok(dates.includes("2026-08-22"));
});

check("20. DE/ATÉ personalizado limita os resultados", () => {
  const custom = registrosTimelineDates({ from: "2026-08-01", to: "2026-08-20" });
  const dates = filterDatesBySituation(custom, ["excedente-10"], classify);
  assert.ok(dates.includes("2026-08-11"));
  assert.ok(dates.includes("2026-08-17"));
  assert.ok(!dates.includes("2026-08-24"), "24/08 está fora de 01–20/08");
});

check("21. DE sozinho continua sendo um único dia", () => {
  const one = registrosTimelineDates({ from: "2026-08-24", to: "2026-08-24" });
  assert.deepEqual(one, ["2026-08-24"]);
  const hit = filterDatesBySituation(one, ["excedente-10"], classify);
  assert.deepEqual(hit, ["2026-08-24"]);
  const miss = filterDatesBySituation(one, ["falta"], classify);
  assert.deepEqual(miss, []);
  const page = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("if (from && !to)"));
  assert.ok(page.includes("setQuery({ from, to: from })"));
});

check("22. resumo compacto não muda seus totais por causa do filtro", () => {
  const page = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("for (const { date, ctx, balanceContribution, deficitContribution, absence } of days)"));
  assert.ok(page.includes("const pendingCount = days.filter"));
  assert.ok(page.includes("const missingCount = days.filter"));
  assert.ok(!page.includes("of listedDays)"));
  const bank = hourBankSummary(seed.entries, seed.compensations, seed.absences, cals, seed.faltas, seed.excessReasons, S, PERIOD, TODAY);
  const again = hourBankSummary(seed.entries, seed.compensations, seed.absences, cals, seed.faltas, seed.excessReasons, S, PERIOD, TODAY);
  assert.equal(bank.realizedBalance, again.realizedBalance);
  assert.equal(bank.freeRegularTotal, again.freeRegularTotal);
});

check("23. “X dias encontrados” reflete somente a lista filtrada", () => {
  const page = srcOf("src/app/(app)/registros/page.tsx");
  const ui = srcOf("src/components/day-situation-filter.tsx");
  assert.ok(page.includes("found={listedDays.length}"));
  assert.ok(ui.includes("dias encontrados") || ui.includes("dia encontrado"));
  const n = filterDatesBySituation(registrosTimelineDates(PERIOD), ["trabalho-folga"], classify).length;
  assert.equal(n, 2);
});

check("24. Limpar remove datas + situações", () => {
  const page = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("clearAllFilters"));
  assert.ok(page.includes("setQueryDraft({ from: \"\", to: \"\" })"));
  assert.ok(page.includes("setPeriod(getPointPeriod(todayStr))"));
  assert.ok(page.includes("router.replace(\"/registros\")"));
  assert.ok(page.includes("> Limpar"));
});

check("25. estado vazio mostra mensagem adequada", () => {
  const page = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("Nenhum dia encontrado com os filtros selecionados."));
  assert.ok(page.includes("Limpar filtros"));
});

check("26. entrar em ?pendentes=1 desativa filtro Situação", () => {
  const page = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("wantPending || wantMissing ? null : situacaoRaw"));
  assert.ok(page.includes("wantPending && situacaoRaw"));
  assert.ok(page.includes('router.replace("/registros?pendentes=1")'));
});

check("27. entrar em ?semRegistro=1 desativa filtro Situação", () => {
  const page = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("wantMissing && situacaoRaw"));
  assert.ok(page.includes('router.replace("/registros?semRegistro=1")'));
  assert.ok(page.includes("situationActive = situationIds.length > 0 && !pendingOnly && !missingOnly"));
});

check("28. nenhuma regra financeira é alterada pelo filtro", () => {
  const before = hourBankSummary(seed.entries, seed.compensations, seed.absences, cals, seed.faltas, seed.excessReasons, S, PERIOD, TODAY);
  filterDatesBySituation(registrosTimelineDates(PERIOD), ["excedente-10", "abaixo-base"], classify);
  const after = hourBankSummary(seed.entries, seed.compensations, seed.absences, cals, seed.faltas, seed.excessReasons, S, PERIOD, TODAY);
  assert.equal(after.realizedBalance, before.realizedBalance);
  assert.equal(after.openNegativeTotal, before.openNegativeTotal);
  assert.equal(after.freeRegularTotal, before.freeRegularTotal);
  assert.equal(after.excessSpecialFreeTotal, before.excessSpecialFreeTotal);
  const page = srcOf("src/app/(app)/registros/page.tsx");
  assert.ok(page.includes("listedDays"));
  assert.ok(page.includes("summaries"));
});

check("29. URL serializa situações e ignora tokens desconhecidos", () => {
  assert.equal(serializeSituationParam(["abaixo-base", "excedente-10"]), "abaixo-base,excedente-10");
  assert.deepEqual(parseSituationParam("abaixo-base,excedente-10,invalido"), ["abaixo-base", "excedente-10"]);
  assert.deepEqual(parseSituationParam(null), []);
});

actions.replaceAll({
  user: { ...DEFAULT_USER },
  entries: [],
  compensations: [],
  absences: [],
  companyCalendars: cals,
  faltas: [],
  excessReasons: [],
});
void getAppData;
console.log(`\nFILTRO SITUAÇÃO — OK (${passed} testes)`);
