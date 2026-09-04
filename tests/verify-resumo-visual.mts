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
  // 4F (SUPERADO — expectativa atualizada com justificativa): os quatro
  // cards principais da reforma: Saldo factual · Projeção no ponto ·
  // Dias com registro · Pendências de apuração:
  assert.ok(page.includes('label="Saldo factual"'));
  assert.ok(page.includes('label="Projeção no ponto"'));
  assert.ok(page.includes('label="Dias com registro"'));
  assert.ok(page.includes('label="Pendências de apuração"'));
  assert.ok(page.includes("icon={<Clock3 size={16} />}"));
  assert.ok(page.includes("icon={<Wallet size={16} />}"));
  assert.ok(page.includes("icon={<TriangleAlert size={16} />}"));
  assert.ok(page.includes("icon={<TrendingUp size={16} />}"));
  assert.ok(page.includes("grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4"), "4F: 2×2 no mobile · 4 em linha no desktop");
  const ui = srcOf("src/components/ui.tsx");
  assert.ok(ui.includes("flex h-full flex-col justify-center"));
  assert.ok(ui.includes("text-2xl font-extrabold tabular-nums leading-none tracking-tight"));
});

check("2. 4F: bloco [10+] do período mostra o gerado factual — sem Realocado/A realocar", () => {
  // 4F (SUPERADO — expectativa atualizada com justificativa):
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes("Gerado no período"));
  // 4H.1 (SUPERADO — subtexto dinâmico): range canônico, sem literal "21→20".
  assert.ok(page.includes("origens dentro de {periodLabel(period)}"));
  assert.ok(!page.includes("origens dentro de 21→20"), "sem hardcode '21→20' como range");
  assert.ok(page.includes("text-violet-700"), "tom violeta preservado");
  assert.ok(!page.includes("Realocado"), "sem 'Realocado'");
  assert.ok(!page.includes("A realocar"), "sem 'A realocar'");
});

check("3. 4F: seções da apuração têm hierarquia (sem 'Compensações')", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  // 4F (SUPERADO — expectativa atualizada com justificativa):
  assert.ok(page.includes("Como o período se formou"));
  assert.ok(page.includes("Calendário da empresa no período"));
  assert.ok(!page.includes('title="Compensações"'), "bloco Compensações fora do Resumo");
  assert.ok(page.includes('text-sm font-extrabold uppercase tracking-wider'), "hierarquia de seções");
  assert.ok(!page.includes("mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400"));
});

check("4. 4F: rótulo e valor no mesmo bloco (composição da apuração)", () => {
  // 4F (SUPERADO — expectativa atualizada com justificativa): os três blocos
  // da formação (positivas/negativas/saldo factual) têm rótulo + valor:
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  assert.ok(page.includes("Horas positivas regulares"));
  assert.ok(page.includes("Horas negativas regulares"));
  assert.ok(page.includes("composition.generatedCreditMinutes"));
  assert.ok(page.includes("composition.generatedDeficitMinutes"));
  assert.ok(!page.includes('label="Acordo a compensar"'), "acordo (legado) fora do Resumo");
});

check("5. 4F: blocos discretos e empilháveis na formação", () => {
  const page = srcOf("src/app/(app)/resumo/page.tsx");
  // 4F (SUPERADO — expectativa atualizada com justificativa): os blocos da
  // apuração são cards discretos em grade:
  assert.ok(page.includes('grid gap-3 sm:grid-cols-3'));
  assert.ok(page.includes("rounded-xl border border-slate-200 bg-white px-4 py-3"));
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
  // 4F (SUPERADO — expectativa atualizada com justificativa): a movimentação
  // do período consome o agregado derivado:
  assert.ok(page.includes("movement.generatedMinutes"), "bloco consome a derivação única");
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
