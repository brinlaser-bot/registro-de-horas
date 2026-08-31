/**
 * VERIFICAÇÃO — Resumo: refinamento visual (cards, detalhes, [10+] violeta, seed).
 * TZ=America/Sao_Paulo npx tsx tests/verify-resumo-visual.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { specialExcessBook, specialExcessLedger } from "../src/lib/hour-bank.ts";
import { getPointPeriod } from "../src/lib/periods.ts";
import { buildResumoDayRow, resumoEventKind } from "../src/lib/resumo-days.ts";
import { buildLegacyDemoScenario } from "../src/lib/seed-data.ts";
import { settingsOf } from "../src/lib/store.ts";
import { buildStackedPeriodData } from "../src/components/stacked-period-chart.tsx";
import { computeDay, formatMinutes } from "../src/lib/time.ts";

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

const TODAY = "2026-08-30";
const PERIOD = getPointPeriod(TODAY);
const seed = buildLegacyDemoScenario();
const S = settingsOf(seed.user);

check("1. quatro cards principais do Resumo têm ícone e malha alinhada (3F)", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes('label="Horas registradas"'));
  assert.ok(page.includes('label="Saldo regular"'));
  assert.ok(page.includes('label="[10+] gerado no período"'));
  assert.ok(page.includes('label="Projeção no ponto"'));
  assert.ok(page.includes("icon={<Clock3 size={16} />}"));
  assert.ok(page.includes("icon={<Wallet size={16} />}"));
  assert.ok(page.includes("icon={<TriangleAlert size={16} />}"));
  assert.ok(page.includes("icon={<TrendingUp size={16} />}"));
  assert.ok(page.includes("grid grid-cols-2 items-stretch gap-4 lg:grid-cols-4"));
  const ui = srcOf("src/components/ui.tsx");
  assert.ok(ui.includes("flex h-full flex-col justify-center"));
  assert.ok(ui.includes("text-2xl font-extrabold tabular-nums leading-none tracking-tight"));
});

check("2. card [10+] do período mostra o gerado factual — sem Realocado/A realocar (3F)", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes('label="[10+] gerado no período"'));
  assert.ok(page.includes("Excedente factual acima de 10h/dia."));
  assert.ok(page.includes('tone={cards.specialGeneratedMinutes > 0 ? "violet" : "slate"}'));
  assert.ok(!page.includes("Realocado"), "sem 'Realocado'");
  assert.ok(!page.includes("A realocar"), "sem 'A realocar'");
});

check("3. seções de detalhes têm hierarquia maior que os itens (3F: sem 'Compensações')", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes('title="Composição do saldo regular"'));
  assert.ok(page.includes('title="Ausências e abonos"'));
  assert.ok(!page.includes('title="Compensações"'), "bloco Compensações fora do Resumo");
  assert.ok(page.includes('className="mb-3 text-[13px] font-bold text-slate-800"'));
  assert.ok(!page.includes("mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400"));
});

check("4. rótulo e valor ficam no mesmo bloco, valor à direita (3F: composição + ausências)", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes('className="flex items-start gap-2"'));
  assert.ok(page.includes("ml-auto shrink-0 text-right"));
  assert.ok(page.includes('label="Créditos regulares"'));
  assert.ok(page.includes('label="Jornadas abaixo da base"'));
  assert.ok(page.includes('label="Férias"'));
  assert.ok(!page.includes('label="Acordo a compensar"'), "acordo (legado) fora do Resumo");
});

check("5. duas seções como blocos discretos e empilháveis (3F)", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes("mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-2"));
  assert.ok(page.includes("rounded-xl bg-slate-50/80 px-3.5 py-3 ring-1 ring-slate-100"));
});

check("6. segmento e legenda [10+] usam violeta", () => {
  const chart = srcOf("src/components/charts.tsx");
  assert.ok(chart.includes('className="w-full bg-violet-500"'));
  assert.ok(chart.includes("h-2.5 w-2.5 rounded-sm bg-violet-500"));
  assert.ok(!chart.includes("h-2.5 w-2.5 rounded-sm bg-rose-500"));
  assert.ok(chart.includes("Excedente [10+]: {formatMinutes(d.excess)}"));
  assert.ok(chart.includes("Trabalhado: {formatMinutes(d.workedMinutes)}"));
  assert.ok(chart.includes("No ponto: {formatMinutes(Math.min(d.workedMinutes, cap))}"));
  assert.ok(chart.includes("Extra regular: +{formatMinutes(d.extra)}"));
  assert.ok(!chart.includes("Saldo regular:"));
});

check("7. seed explícito: 26/08 7h30 abaixo do previsto", () => {
  const date = "2026-08-26";
  const entries = seed.entries.filter((e) => e.date === date);
  assert.equal(entries.map((e) => e.time).join(","), "08:00,12:00,13:00,16:30");
  const day = computeDay(entries, S);
  assert.equal(day.workedMinutes, 450);
  const d = buildResumoDayRow({
    date, today: TODAY, entries: seed.entries, absences: seed.absences,
    calendars: seed.companyCalendars, settings: S, faltas: seed.faltas,
    controlStartDate: seed.user.controlStartDate,
  });
  assert.equal(resumoEventKind(d), "Jornada abaixo do previsto");
});

check("8. seed explícito: 28/08 11h30 com 10h no ponto, extra +2h, [10+] 1h30", () => {
  const date = "2026-08-28";
  const entries = seed.entries.filter((e) => e.date === date);
  assert.equal(entries.map((e) => e.time).join(","), "08:00,12:00,13:00,20:30");
  const day = computeDay(entries, S);
  assert.equal(day.workedMinutes, 690);
  assert.equal(day.registrableMinutes, 600);
  assert.equal(day.excessMinutes, 90);
  const data = buildStackedPeriodData({
    entries: seed.entries, compensations: seed.compensations, absences: seed.absences,
    companyCalendars: seed.companyCalendars, settings: S, period: { from: date, to: date },
    faltas: seed.faltas, today: TODAY,
  });
  const bar = data.find((x) => x.date === date)!;
  assert.equal(bar.base, 480);
  assert.equal(bar.extra, 120);
  assert.equal(bar.excess, 90);
  const led = specialExcessLedger(date, seed.compensations, 90);
  assert.equal(led.original, 90);
  assert.equal(led.realized, 30);
  assert.equal(formatMinutes(led.original), "1h30");
  assert.equal(formatMinutes(led.realized), "30min");
  assert.equal(formatMinutes(Math.max(0, led.original - led.realized)), "1h");
});

check("9. [10+] do período vem da derivação única (3C); engine legado intacto (3F)", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  const view = srcOf("src/lib/resumo-period-view.ts");
  assert.ok(page.includes("cards.specialGeneratedMinutes"), "card consome a derivação única");
  assert.ok(view.includes("buildSpecialExcessBank"), "gerado derivado dos lotes 3C");
  assert.ok(view.includes("generatedByDate"), "lote por origem → dia");
  // engine legado continua calculando o mesmo (preservado em 2º plano)
  const book = specialExcessBook(
    seed.entries, seed.compensations, seed.absences, seed.companyCalendars,
    S, seed.excessReasons, PERIOD, TODAY,
  );
  assert.ok(book.original >= 90);
  assert.ok(book.realized >= 30);
  assert.equal(PERIOD.from, "2026-08-21");
  assert.equal(PERIOD.to, "2026-09-20");
});

check("10. produção continua sem auto-seed", () => {
  const store = srcOf("src/lib/store.ts");
  assert.ok(store.includes("createEmptyState"));
  assert.ok(store.includes("buildSeedData()"));
  assert.ok(store.includes("withPreservedIdentity"));
  assert.ok(!store.includes("mutate(() => buildSeedData())"));
});

console.log(`\nRESUMO VISUAL — OK (${passed} testes)`);
