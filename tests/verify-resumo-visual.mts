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

check("1. quatro cards do Resumo têm ícone e malha alinhada", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes('label="Dias com registro"'));
  assert.ok(page.includes('label="Total trabalhado"'));
  assert.ok(page.includes('label="Saldo do período"'));
  assert.ok(page.includes('label="Excedente do período [10+]"'));
  assert.ok(page.includes("icon={<CalendarDays size={16} />}"));
  assert.ok(page.includes("icon={<Clock3 size={16} />}"));
  assert.ok(page.includes("icon={<Wallet size={16} />}"));
  assert.ok(page.includes("icon={<TriangleAlert size={16} />}"));
  assert.ok(page.includes("grid grid-cols-2 items-stretch gap-4 lg:grid-cols-4"));
  const ui = srcOf("src/components/ui.tsx");
  assert.ok(ui.includes("flex h-full flex-col justify-center"));
  assert.ok(ui.includes("text-2xl font-extrabold tabular-nums leading-none tracking-tight"));
});

check("2. card [10+] preserva gerado / Realocado / A realocar", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes("periodExcessBook.original"));
  assert.ok(page.includes("Realocado {formatMinutes(periodExcessBook.realized)}"));
  assert.ok(page.includes("A realocar {formatMinutes(Math.max(0, periodExcessBook.original - periodExcessBook.realized))}"));
  assert.ok(page.includes('tone={periodExcessBook.original > 0 ? "violet"'));
  assert.ok(page.includes('className="block truncate"'));
});

check("3. títulos das três seções têm hierarquia maior que os itens", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes('title="Jornada e saldo"'));
  assert.ok(page.includes('title="Compensações"'));
  assert.ok(page.includes('title="Ausências e abonos"'));
  assert.ok(page.includes('className="mb-3 text-[13px] font-bold text-slate-800"'));
  assert.ok(!page.includes("mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400"));
});

check("4. rótulo e valor ficam no mesmo bloco, valor à direita", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes('className="flex items-start gap-2"'));
  assert.ok(page.includes("ml-auto shrink-0 text-right"));
  assert.ok(page.includes('label="No ponto"'));
  assert.ok(page.includes('label="Déficit do período"'));
  assert.ok(page.includes('label="Acordo a compensar"'));
  assert.ok(page.includes("hint={`feito ${formatMinutes(detailStats.acordoDone)} · falta ${formatMinutes(detailStats.acordoPending)}`}"));
  assert.ok(page.includes("value={formatMinutes(detailStats.acordoTotal)}"));
});

check("5. três colunas como blocos discretos e empilháveis", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes("mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-3"));
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

check("9. matemática do card [10+] do período não foi trocada", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes("acc.balanceTotal += d.balanceContribution"));
  assert.ok(page.includes("deficitMinutes: allDays.reduce((s, d) => s + d.deficitContribution, 0)"));
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
