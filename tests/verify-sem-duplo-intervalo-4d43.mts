/**
 * VERIFICAÇÃO — ETAPA 4D.4.3: NÃO DUPLICAR INTERVALO AUTOMÁTICO QUANDO JÁ
 * EXISTE PAUSA REAL ENTRE BATIDAS.
 *
 * BUG MANUAL (01/09/2026): batidas 05:00–09:00 e 10:00–13:30 (segmentos de
 * 4h + 3h30) exibiam 6h30 trabalhadas, saldo −1h30 e "intervalo automático
 * (1h)" — a pausa real 09:00–10:00 já estava FORA dos segmentos e ainda
 * assim a janela de almoço foi descontada outra vez (DUPLA CONTAGEM).
 *
 * CAUSA RAIZ (auditada): lunchDeductionOf (punches.ts — fonte única de
 * computeDay) deduzia a janela de almoço INTEIRA quando nenhum gap
 * intersectava a faixa configurada, mesmo com pausas reais representadas
 * entre pares.
 *
 * CORREÇÃO CANÔNICA (mesma fonte, sem fórmula na UI):
 *   4D.4.3 eliminou a dupla contagem; 4D.4.3.1 definiu a regra FINAL:
 *   existe ≥1 gap explícito entre pares ⇒ dedução automática 0 (o intervalo
 *   real é respeitado exatamente — nunca completado, reduzido ou limitado);
 *   sem gap algum ⇒ fallback integral (política consolidada).
 * A política existente permanece: dia sem intervalo representado continua
 * com a dedução automática integral.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-sem-duplo-intervalo-4d43.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { computeDay, plannedExitTime } from "../src/lib/time.ts";
import { analyzePunches, lunchDeductionOf, totalRealBreakMinutes } from "../src/lib/punches.ts";
import { companyDayContext, type CompanyCalendars, type CalendarEntry } from "../src/lib/company-calendar.ts";
import { buildCalendarForecast } from "../src/lib/calendar-forecast.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
import { buildCycleSituation } from "../src/lib/cycle-dashboard.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import type { TimeEntry } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Helpers ── */
const SETTINGS = { workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true };
const CLK_DIA = (date: string) => ({ date, minutes: 23 * 60 }); // fim da noite: tudo realizado
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const COMP8 = (d: string): Omit<CalendarEntry, "id"> => ({
  date: d, descricao: "Compensado", categoria: "Compensação 8 Horas",
  tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
});
const CINZAS: Omit<CalendarEntry, "id"> = {
  date: "2027-02-10", descricao: "Quarta-feira de Cinzas", categoria: "Compensação 4 Horas",
  tratamento: "COMPENSAR", horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null,
};

const seedUser = buildSeedData().user;
const S = () => settingsOf(getAppData().user);
const reset = (entries: TimeEntry[], calendars: CompanyCalendars = [], opts: { reasons?: string[] } = {}) => {
  actions.replaceAll({
    user: seedUser, entries, compensations: [], absences: [], companyCalendars: calendars,
    faltas: [], excessReasons: (opts.reasons ?? []).map((date, i) => ({ id: i + 1, date, reason: "demanda-urgente" })),
    specialExcessUses: [], specialExcessPlans: [],
  });
};
const st = () => getAppData();

/* ════════════════ TESTES 01–09 ════════════════ */

check("TESTE 01 DE 09 — 05–09 / 10–13:30 ⇒ worked 7h30 (não 6h30), saldo −30min, sem dedução", () => {
  const dia = "2026-09-01";
  const d = computeDay([
    punch(dia, "05:00", "entrada"), punch(dia, "09:00", "saida"),
    punch(dia, "10:00", "entrada"), punch(dia, "13:30", "saida"),
  ], SETTINGS, undefined, CLK_DIA(dia));
  assert.equal(d.workedMinutes, 450, "trabalhado = 4h + 3h30 = 7h30");
  assert.notEqual(d.workedMinutes, 390, "NUNCA 7h30 − 1h");
  assert.equal(d.balanceMinutes, -30, "saldo factual do dia −30min (base 8h)");
  assert.equal(d.registrableMinutes, 450, "No ponto 7h30");
  assert.equal(d.lunchDeductedMinutes, 0, "nenhuma dedução automática adicional");
  assert.equal(d.segments.length, 2, "dois segmentos reais");
  assert.equal(d.derivedBreak ?? null, null, "sem 'intervalo automático' derivado (o chip some)");
});

check("TESTE 02 DE 09 — Gap real de 60min ⇒ a segunda hora automática NÃO é descontada", () => {
  const dia = "2026-08-20";
  const entries = [
    punch(dia, "05:00", "entrada"), punch(dia, "09:00", "saida"),
    punch(dia, "10:00", "entrada"), punch(dia, "13:30", "saida"),
  ];
  const analysis = analyzePunches(entries);
  assert.equal(totalRealBreakMinutes(analysis.pairs), 60, "pausa real representada: 1h");
  assert.equal(lunchDeductionOf(analysis, SETTINGS), 0, "com intervalo real explícito ⇒ auto 0");
  // 4D.4.3.1 (SUPERADA a fórmula de complemento max(0, exigido − real) da
  // 4D.4.3 — expectativa atualizada com justificativa, não reverteda à mão):
  // a regra canônica agora é "qualquer gap explícito entre pares ⇒ fallback
  // 0; sem gap ⇒ fallback integral". Âncora da FONTE ÚNICA:
  const fonte = src("src/lib/punches.ts");
  assert.ok(fonte.includes("if (analysis.pairs.length >= 2) return 0;"), "gap explícito ⇒ dedução automática 0");
  const d = computeDay(entries, SETTINGS, undefined, CLK_DIA(dia));
  assert.equal(d.workedMinutes, 450);
});

check("TESTE 03 DE 09 — Sem intervalo representado: a dedução automática continua funcionando", () => {
  const dia = "2026-08-20";
  const entries = [punch(dia, "08:00", "entrada"), punch(dia, "17:00", "saida")];
  const analysis = analyzePunches(entries);
  assert.equal(totalRealBreakMinutes(analysis.pairs), 0, "nenhuma pausa representada (par único)");
  assert.equal(lunchDeductionOf(analysis, SETTINGS), 60, "fallback integral (política existente)");
  const d = computeDay(entries, SETTINGS, undefined, CLK_DIA(dia));
  assert.equal(d.workedMinutes, 480, "9h − 1h automática = 8h (regra intacta)");
  assert.equal(d.lunchDeductedMinutes, 60);
  assert.notEqual(d.derivedBreak ?? null, null, "chip 'intervalo automático' segue existindo neste caso");
});

check("TESTE 04 DE 09 — Intervalo criado pelo fluxo 'Registrar intervalo': sem dupla dedução", () => {
  // Mesma action do fluxo do card/modal (addEntry): par saída+entrada na
  // janela de almoço — pausa real DENTRO da faixa neutraliza o fallback
  // (política existente preservada) e NADA é descontado duas vezes:
  reset([]);
  assert.ok(actions.addEntry({ date: "2026-08-20", time: "08:00", type: "entrada", note: null }).ok);
  assert.ok(actions.addEntry({ date: "2026-08-20", time: "12:10", type: "saida", note: null }).ok);
  assert.ok(actions.addEntry({ date: "2026-08-20", time: "12:40", type: "entrada", note: null }).ok);
  assert.ok(actions.addEntry({ date: "2026-08-20", time: "17:00", type: "saida", note: null }).ok);
  const d = computeDay(st().entries, S(), undefined, CLK_DIA("2026-08-20"));
  assert.equal(d.workedMinutes, 510, "250 + 260 = 8h30 (gap real preservado)");
  assert.equal(d.lunchDeductedMinutes, 0, "pausa dentro da faixa ⇒ zero dedução (nunca 510 − 60)");
  assert.equal(d.balanceMinutes, 30);
});

check("TESTE 05 DE 09 — Múltiplos pares com pausas reais: a soma dos segmentos não perde intervalo 2×", () => {
  const dia = "2026-08-20";
  const entries = [
    punch(dia, "06:00", "entrada"), punch(dia, "09:00", "saida"),
    punch(dia, "09:30", "entrada"), punch(dia, "11:30", "saida"),
    punch(dia, "12:00", "entrada"), punch(dia, "13:30", "saida"),
  ];
  const analysis = analyzePunches(entries);
  assert.equal(totalRealBreakMinutes(analysis.pairs), 60, "pausas reais: 30min + 30min");
  assert.equal(lunchDeductionOf(analysis, SETTINGS), 0);
  const d = computeDay(entries, SETTINGS, undefined, CLK_DIA(dia));
  assert.equal(d.workedMinutes, 390, "3h + 2h + 1h30 = 6h30 (sem segunda dedução)");
  assert.equal(d.segments.length, 3);
});

/* ── Cenário atual (fixture 4D.4 + 01/09): 18/08 estendido p/ 11h30
 *    (regular capped +2h · [10+] 1h30) · uso aplicado 30min (26/08) ·
 *    reserva planejada 30min (01/09) · 01/09 com 7h30. ── */
const FIX_PAST_FOLGAS = ["2026-05-04", "2026-06-05", "2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24"];
const FIX_FUTUROS = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"];
const FIX_CALS: CompanyCalendars = [{
  id: "cal-2627", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  cycleLabel: "2026/2027", version: 1, importedAt: "2026-05-01",
  entries: [
    ...[...FIX_PAST_FOLGAS, "2026-08-25"].map((d, i) => ({ id: i + 1, ...COMP8(d) })),
    ...FIX_FUTUROS.map((d, i) => ({ id: 30 + i, ...COMP8(d) })),
    { id: 50, ...CINZAS },
  ],
}];
const HOJE_F = "2026-09-02"; // 01/09 já realizado
const resetFixture = () => {
  const entries: TimeEntry[] = [
    // 18/08: 07:00–19:30 = 11h30 ⇒ regular capped +2h · [10+] 1h30 (motivo)
    punch("2026-08-18", "07:00", "entrada"), punch("2026-08-18", "19:30", "saida"),
    // 20/08: 10h ⇒ +2h
    punch("2026-08-20", "07:00", "entrada"), punch("2026-08-20", "12:00", "saida"),
    punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "18:00", "saida"),
    // 24/08: 7h (com almoço real 12–13) ⇒ −1h
    punch("2026-08-24", "08:00", "entrada"), punch("2026-08-24", "12:00", "saida"),
    punch("2026-08-24", "13:00", "entrada"), punch("2026-08-24", "16:00", "saida"),
    // 25/08: 8h na folga COMPENSAR ⇒ 0
    punch("2026-08-25", "08:00", "entrada"), punch("2026-08-25", "12:00", "saida"),
    punch("2026-08-25", "13:00", "entrada"), punch("2026-08-25", "17:00", "saida"),
    // 26/08: 7h ⇒ −1h (destino do [10+] aplicado)
    punch("2026-08-26", "08:00", "entrada"), punch("2026-08-26", "16:00", "saida"),
    // 28/08: 10h30 (almoço real) ⇒ +2h, sem excesso
    punch("2026-08-28", "08:00", "entrada"), punch("2026-08-28", "12:00", "saida"),
    punch("2026-08-28", "13:00", "entrada"), punch("2026-08-28", "19:00", "saida"),
    // 01/09: 05–09 / 10–13:30 ⇒ 7h30 (O DIA DO BUG)
    punch("2026-09-01", "05:00", "entrada"), punch("2026-09-01", "09:00", "saida"),
    punch("2026-09-01", "10:00", "entrada"), punch("2026-09-01", "13:30", "saida"),
  ];
  reset(entries, FIX_CALS, { reasons: ["2026-08-18"] });
  const uso = actions.createSpecialExcessUse({ destinationDate: "2026-08-26", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-08-28" });
  assert.ok(uso.ok, `uso aplicado 30min: ${uso.error ?? "ok"}`);
  const plano = actions.createSpecialExcessPlan({ destinationDate: "2026-09-01", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-28" });
  assert.ok(plano.ok, `reserva 30min p/ 01/09: ${plano.error ?? "ok"}`);
};

check("TESTE 06 DE 09 — Fixture 01/09: saldo do dia −30min (7h30 de 8h)", () => {
  resetFixture();
  const cctx = companyDayContext("2026-09-01", st().entries, st().absences, st().companyCalendars, S());
  assert.equal(cctx.ctx.day.workedMinutes, 450, "Trabalhado 7h30");
  assert.equal(cctx.ctx.day.lunchDeductedMinutes, 0, "sem intervalo automático adicional");
  assert.equal(cctx.regularBalance, -30, "saldo factual do dia −30min");
  const row = buildResumoDayRow({ date: "2026-09-01", today: HOJE_F, entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
  assert.equal(row.balanceMinutes, -30);
  assert.equal(row.status, "deficit");
  assert.equal(dayBalanceContribution(cctx, st().faltas, "2026-09-01", HOJE_F), -30, "contribuição factual −30min");
});

check("TESTE 07 DE 09 — Ciclo atual: factual −44h30 · projetado −44h (antes de usar a reserva)", () => {
  resetFixture();
  const sit = buildCycleSituation({
    today: HOJE_F, entries: st().entries, absences: st().absences,
    calendars: st().companyCalendars, settings: S(), faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null, uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  /* Saldos regulares: 18/08 +2h · 20/08 +2h · 24/08 −1h · 25/08 0 ·
   * 26/08 −1h · 28/08 +2h · 01/09 −30min = +3h30; − 48h (6 folgas
   * passadas 0h) = −44h30 — a correção elimina o −1h30 falso do 01/09. */
  assert.equal(sit.factualBalanceMinutes, -2670, "saldo factual do ciclo −44h30");
  assert.equal(sit.projectedBalanceMinutes, -2640, "projetado = factual + [10+] aplicado 30min = −44h");
  // Banco: gerado 1h30 − usado ativo 30min − reservado ativo 30min:
  const bank = buildSpecialExcessBank({
    cycle: "2026/2027", asOfDate: HOJE_F, entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S(), faltas: [],
    controlStartDate: st().user.controlStartDate ?? "",
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  assert.equal(bank.generatedMinutes, 90);
  assert.equal(bank.usedMinutes, 30, "uso aplicado (26/08)");
  assert.equal(bank.reservedMinutes, 30, "reserva de 01/09 continua reservada");
  assert.equal(bank.availableMinutes, 30);
});

check("TESTE 08 DE 09 — Reserva 30min preservada; necessidade do destino = 30min; 'Usar planejamento' oferecido", () => {
  resetFixture();
  // NADA é convertido automaticamente: o único uso é o aplicado em 26/08:
  const destinosUso = (st().specialExcessUses ?? []).filter((u) => u.status === "utilizado").map((u) => u.destinationDate);
  assert.deepEqual(destinosUso, ["2026-08-26"], "nenhum uso automático no destino 01/09");
  const plano = st().specialExcessPlans?.find((p) => p.destinationDate === "2026-09-01");
  assert.ok(plano, "plano da reserva presente");
  assert.equal(plano?.status, "planned", "reserva segue 'planned' (aguardando confirmação)");
  // Necessidade REAL do dia (fonte canônica 4D.4.2): 8h − 7h30 = 30min —
  // NÃO 1h30 (que viria do worked falso 6h30):
  const view = buildSpecialExcessDayView({
    date: "2026-09-01", asOfDate: HOJE_F, entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S(), faltas: [],
    controlStartDate: st().user.controlStartDate ?? null,
    uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  assert.equal(view.eligible, true, "dia realizado abaixo da base é elegível");
  assert.equal(view.remainingMinutes, 30, "necessidade real 30min (nunca 'faltam 1h30')");
  assert.equal(view.canComplete, true);
  // A UI oferece a resolução explícita: "Usar planejamento" (bloco do plano,
  // alimentado pela MESMA necessidade canônica):
  const summary = src("src/components/special-excess-plan-summary.tsx");
  assert.ok(summary.includes("Usar planejamento"), "botão de resolução explícita");
  assert.ok(summary.includes("const canApply = arrived && eligible === true && needRemaining > 0;"), "oferecido só com necessidade real > 0");
  const card = src("src/components/day-card.tsx");
  assert.ok(card.includes("remainingNeedMinutes={specialExcess ? specialExcess.remainingMinutes : null}"), "necessidade vem da fonte canônica (sem 2ª matemática)");
  // E a faixa [10+] do card exibiria "Faltam 30min" (fonte única):
  const useSummary = src("src/components/special-excess-use-summary.tsx");
  assert.ok(useSummary.includes("Faltam <b className=\"tabular-nums\">{formatMinutes(view.remainingMinutes)}</b> para completar a jornada."), "faixa lê o restante canônico");
});

check("TESTE 09 DE 09 — Smart Exit / Registros / Resumo / calendário / [10+] coerentes", () => {
  resetFixture();
  // Smart Exit: comportamento EXISTENTE preservado (projeção de saída soma a
  // janela quando o trecho aberto ainda vai cruzá-la — não é dedução factual):
  const prevista = plannedExitTime([punch("2026-09-03", "08:00", "entrada")], SETTINGS, 480);
  assert.equal(prevista, "17:00", "previsão de saída 08:00 + 8h + almoço = 17:00 (intacta)");
  // Registros/Resumo: contribuição factual do dia do bug é −30min (fonte única):
  const cctx = companyDayContext("2026-09-01", st().entries, st().absences, st().companyCalendars, S());
  assert.equal(dayBalanceContribution(cctx, st().faltas, "2026-09-01", HOJE_F), -30);
  // Calendário 4D.4 intocado: impacto futuro do fixture = −88h (11×8h; Cinzas parcial ⇒ 0):
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: "2026/2027", today: HOJE_F, entries: st().entries, absences: [], settings: S() });
  assert.equal(fc.futureImpactMinutes, -5280, "forecast −88h inalterado");
  assert.equal(fc.eventCount, 11);
  // Previsão do ciclo (Parte L 4D.4): projetado + impacto futuro = −44h − 88h:
  const sit = buildCycleSituation({
    today: HOJE_F, entries: st().entries, absences: st().absences,
    calendars: st().companyCalendars, settings: S(), faltas: st().faltas,
    controlStartDate: st().user.controlStartDate ?? null, uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  assert.equal(sit.projectedBalanceMinutes + fc.futureImpactMinutes, -7920, "previsão −132h (projeção coerente com o factual corrigido)");
  // [10+] 4D.3 intocado: plano em dia especial é rejeitado (gate de planejamento —
  // folga COMPENSAR 04/09 tem base 0 ⇒ sem capacidade):
  const rGate = actions.createSpecialExcessPlan({ destinationDate: "2026-09-04", minutes: 30, selectionMode: "automatic", asOfDate: HOJE_F });
  assert.equal(rGate.ok, false);
  assert.equal(rGate.code, "destination-no-planning-capacity", "ABONADO 07/09 segue sem capacidade de planejamento");
});

console.log(`\n${passed}/9 verificações da Etapa 4D.4.3 passaram.`);
if (passed !== 9) process.exit(1);
