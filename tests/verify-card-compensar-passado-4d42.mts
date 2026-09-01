/**
 * VERIFICAÇÃO — ETAPA 4D.4.2: CARD DE COMPENSAR PASSADO SEM BATIDAS E
 * NECESSIDADE [10+] COERENTE COM A SEMÂNTICA FACTUAL.
 *
 * BUG MANUAL: 04/05/2026 (Folga a compensar — Calendário, sem batidas) tinha
 * saldo factual −8h correto, mas o card (1) escondia os MiniStats da
 * semântica do calendário e (2) mostrava a faixa [10+] "Faltam 0min para
 * completar a jornada".
 *
 * CAUSAS (auditadas):
 *  · MiniStats: noFacts DENTRO do DayCard (d.empty && !falta && !absence)
 *    não conhecia a isenção canônica de evento de calendário (Parte I da
 *    4D.4) — e o badge do cabeçalho caía em "Sem registros" (status "empty"
 *    do displayDay).
 *  · "Faltam 0min": a necessidade [10+] usava row.expectedMinutes (=effective
 *    Expected — gate de PLANEJAMENTO FUTURO da 4D.3, 0 no evento integral)
 *    em vez do trabalho NECESSÁRIO canônico (requiredWorkMinutes, 8h) — e o
 *    motor ainda tratava o dia-evento passado como "não realizado" por exigir
 *    batidas (entryCount > 0), quando o evento explícito é fato suficiente.
 *
 * AUDITORIA [10+] (Parte C): o motor NÃO tem regra de produto bloqueando
 * COMPENSAR como destino de USO em dia realizado — a elegibilidade é por
 * status ("deficit", que o 04/05 tem). Conclusão: PERMITIDO pela política
 * existente; a necessidade deve refletir o requiredWork canônico. Efeito só
 * na PROJEÇÃO (Parte D): factual continua −8h; 8h de [10+] ⇒ projeção 0h;
 * trabalhado NUNCA é reescrito.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-card-compensar-passado-4d42.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { companyDayContext, type CompanyCalendars, type CalendarEntry } from "../src/lib/company-calendar.ts";
import { buildResumoDayRow } from "../src/lib/resumo-days.ts";
import { dayBalanceContribution } from "../src/lib/faltas.ts";
import { buildSpecialExcessDayView } from "../src/lib/special-excess-day-view.ts";
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
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const COMP8 = (d: string): Omit<CalendarEntry, "id"> => ({
  date: d, descricao: "Compensado", categoria: "Compensação 8 Horas",
  tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null,
});
const ABONADO = (d: string, ha: number): Omit<CalendarEntry, "id"> => ({
  date: d, descricao: "Feriado", categoria: "Feriado Nacional",
  tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: ha, observacao: null,
});
const calOf = (entries: Omit<CalendarEntry, "id">[]): CompanyCalendars => [{
  id: "cal-2627", cycleStart: "2026-05-01", cycleEnd: "2027-04-30",
  cycleLabel: "2026/2027", version: 1, importedAt: "2026-05-01",
  entries: entries.map((e, i) => ({ ...e, id: i + 1 })),
}];
/** 04/05/2026 é segunda-feira — o dia do bug manual. */
const DIA = "2026-05-04";
const HOJE = "2026-05-10"; // após o dia (passado realizado)

const seedUser = buildSeedData().user;
const S = () => settingsOf(getAppData().user);
const reset = (entries: TimeEntry[] = [], calendars: CompanyCalendars = [], opts: { controlStartDate?: string | null; reasons?: { date: string }[] } = {}) => {
  actions.replaceAll({
    user: opts.controlStartDate === undefined ? seedUser : { ...seedUser, controlStartDate: opts.controlStartDate },
    entries,
    compensations: [],
    absences: [],
    companyCalendars: calendars,
    faltas: [],
    excessReasons: (opts.reasons ?? []).map((r, i) => ({ id: i + 1, date: r.date, reason: "demanda-urgente" })),
    specialExcessUses: [],
    specialExcessPlans: [],
  });
};
const st = () => getAppData();
const rowOf = (date: string, today: string) =>
  buildResumoDayRow({ date, today, entries: st().entries, absences: st().absences, calendars: st().companyCalendars, settings: S(), faltas: st().faltas, controlStartDate: st().user.controlStartDate ?? null });
const viewOf = (date: string, today: string) =>
  buildSpecialExcessDayView({ date, asOfDate: today, entries: st().entries, absences: st().absences, calendars: st().companyCalendars, settings: S(), faltas: st().faltas, controlStartDate: st().user.controlStartDate ?? null, uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [] });

/* ════════════════ TESTES 01–08 ════════════════ */

check("TESTE 01 DE 08 — COMPENSAR passado 0h: semântica completa no card e saldo −8h", () => {
  reset([], calOf([COMP8(DIA)]));
  const row = rowOf(DIA, HOJE);
  assert.equal(row.status, "deficit", "classificação canônica: déficit factual (nunca Sem registro)");
  assert.equal(row.balanceMinutes, -480, "saldo factual −8h");
  assert.equal(row.calendarEventDay, true, "flag canônica de dia-evento");
  const cctx = companyDayContext(DIA, st().entries, [], st().companyCalendars, S());
  assert.equal(cctx.referenceBaseMinutes, 480, "Base de referência 8h");
  assert.equal(cctx.calendarCreditMinutes, 0, "Crédito calendário 0h");
  assert.equal(cctx.requiredWorkMinutes, 480, "Jornada a cumprir 8h");
  assert.equal(cctx.regularBalance, -480, "Saldo regular −8h");
  assert.equal(cctx.ctx.day.workedMinutes, 0, "Trabalhado 0h");
  assert.equal(cctx.displayDay.registrableMinutes, 0, "No ponto 0h");
  // O card exibe: noFacts isenta evento de calendário (MiniStats visíveis) e
  // o badge não cai em "Sem registros" para evento explícito:
  const card = src("src/components/day-card.tsx");
  assert.ok(card.includes("const noFacts = d.empty && !falta && !absence && !calendarSemantics;"), "noFacts com isenção de evento de calendário");
  assert.ok(card.includes("regularBalance < 0 ? <Badge tone=\"amber\">Abaixo da base</Badge> : <Badge tone=\"emerald\">Dia ok</Badge>"), "badge do evento realizado nunca 'Sem registros'");
  assert.ok(card.includes('label={calendarSemantics ? "Base de referência" : "Base regular"}'), "MiniStat Base de referência");
  assert.ok(card.includes('label="Crédito calendário"'), "MiniStat Crédito calendário");
  assert.ok(card.includes("Jornada a cumprir:"), "jornada a cumprir visível no sub do crédito");
});

check("TESTE 02 DE 08 — COMPENSAR passado 0h: NUNCA 'Faltam 0min' quando o factual é −8h", () => {
  reset([], calOf([COMP8(DIA)]));
  const view = viewOf(DIA, HOJE);
  assert.equal(view.eligible, true, "dia realizado abaixo da base é elegível (3A/3E)");
  assert.equal(view.neededMinutes, 480, "necessidade = trabalho necessário canônico (8h)");
  assert.equal(view.remainingMinutes, 480, "restante 8h — nunca 0 com factual −8h");
  assert.notEqual(view.remainingMinutes, 0, "a faixa 'Faltam X' não pode exibir 0min aqui");
  // A linha da faixa consome o restante da fonte única (mesma view):
  const summary = src("src/components/special-excess-use-summary.tsx");
  assert.ok(summary.includes("Faltam <b className=\"tabular-nums\">{formatMinutes(view.remainingMinutes)}</b> para completar a jornada."), "faixa lê o restante da fonte canônica");
  // A necessidade vem da row canônica (fonte única com o motor):
  const viewSrc = src("src/lib/special-excess-day-view.ts");
  assert.ok(viewSrc.includes("row.requiredWorkMinutes - row.registrableMinutes"), "necessidade = requiredWork − registrável (fonte única)");
  assert.ok(!viewSrc.includes("row.expectedMinutes - row.registrableMinutes"), "fórmula antiga (effectiveExpected) removida da view");
});

check("TESTE 03 DE 08 — COMPENSAR passado 8h: mantém base 8h / crédito 0h / saldo 0", () => {
  reset([
    punch(DIA, "08:00", "entrada"), punch(DIA, "12:00", "saida"),
    punch(DIA, "13:00", "entrada"), punch(DIA, "17:00", "saida"),
  ], calOf([COMP8(DIA)]));
  const cctx = companyDayContext(DIA, st().entries, [], st().companyCalendars, S());
  assert.equal(cctx.referenceBaseMinutes, 480);
  assert.equal(cctx.calendarCreditMinutes, 0);
  assert.equal(cctx.requiredWorkMinutes, 480);
  assert.equal(cctx.regularBalance, 0, "8h quitam a folga pelo saldo factual");
  const row = rowOf(DIA, HOJE);
  assert.equal(row.status, "ok");
  assert.equal(row.balanceMinutes, 0);
});

check("TESTE 04 DE 08 — ABONADO passado sem batidas: base/crédito/saldo neutros (útil e fim de semana)", () => {
  // Dia ÚTIL abonado (crédito 8h derivado): base 8h · crédito 8h · saldo 0:
  reset([], calOf([ABONADO(DIA, 8)]));
  const v = companyDayContext(DIA, [], [], st().companyCalendars, S());
  assert.equal(v.referenceBaseMinutes, 480);
  assert.equal(v.calendarCreditMinutes, 480);
  assert.equal(v.regularBalance, 0, "saldo neutro");
  assert.equal(v.adjustedDeficit, 0);
  const row = rowOf(DIA, HOJE);
  assert.equal(row.status, "ok", "abonado integral realizado é dia ok");
  // SÁBADO abonado (contrato legítimo 0h abonadas): saldo 0, sem déficit,
  // sem inventar 8h abonadas (4D.4.1):
  reset([], calOf([ABONADO("2026-08-15", 0)]));
  const sab = companyDayContext("2026-08-15", [], [], st().companyCalendars, S());
  assert.equal(sab.abonadasMinutes, 0, "não inventar 8h abonadas");
  assert.equal(sab.regularBalance, 0);
  assert.equal(sab.adjustedDeficit, 0);
});

check("TESTE 05 DE 08 — Dia comum vazio pré-controlStartDate: neutro, sem card factual artificial", () => {
  reset([], calOf([COMP8(DIA)]), { controlStartDate: "2026-06-01" });
  const comum = "2026-05-11"; // segunda comum, antes do início do controle
  const row = rowOf(comum, HOJE);
  assert.equal(row.status, "empty", "dia comum vazio pré-start permanece Sem registro");
  assert.equal(row.balanceMinutes, 0, "sem saldo factual artificial");
  assert.equal(row.balanceContribution, 0, "contribuição factual 0");
  assert.equal(dayBalanceContribution(companyDayContext(comum, st().entries, st().absences, st().companyCalendars, S()), st().faltas, comum, HOJE), 0);
  // O card de dia comum SEM evento continua ocultando MiniStats (noFacts):
  const card = src("src/components/day-card.tsx");
  assert.ok(card.includes("!calendarSemantics;"), "isenção só para evento de calendário — dia comum vazio segue 'sem fatos'");
  // E o evento explícito PRÉ-start segue fato suficiente (4D.4 Parte H):
  const evento = rowOf(DIA, HOJE);
  assert.equal(evento.balanceContribution, -480, "COMPENSAR importado pré-start conta no factual");
});

check("TESTE 06 DE 08 — COMPENSAR hoje não encerrado: nada de −8h factual prematuro", () => {
  const HOJE6 = DIA; // hoje = o próprio dia do evento
  reset([], calOf([COMP8(DIA)]));
  const cctx = companyDayContext(DIA, st().entries, st().absences, st().companyCalendars, S());
  assert.equal(cctx.regularBalance, -480, "contexto bruto calcula o efeito potencial");
  assert.equal(dayBalanceContribution(cctx, st().faltas, DIA, HOJE6), 0, "contribuição factual 0 (hoje pendente)");
  const row = rowOf(DIA, HOJE6);
  assert.equal(row.balanceMinutes, 0, "card/row exibem 0 — nunca −8h prematuro");
  const view = viewOf(DIA, HOJE6);
  assert.equal(view.eligible, false, "não é elegível a [10+] (dia ainda não realizado)");
  assert.equal(view.canComplete, false, "sem CTA enquanto o dia não é fato");
  // E o bloco [10+] nem renderiza no card (condição da página de Registros):
  const registros = src("src/app/(app)/registros/page.tsx");
  assert.ok(registros.includes("specialExcess.eligible || specialExcess.activeUses.length > 0 ? specialExcess : null"), "bloco [10+] só com elegibilidade/usos");
});

check("TESTE 07 DE 08 — [10+] em COMPENSAR passado: PERMITIDO pela política existente; efeito só na projeção", () => {
  // AUDITORIA REGISTRADA: o motor NÃO bloqueia COMPENSAR como destino de USO
  // em dia realizado (elegibilidade por status "deficit"; sem regra de
  // produto anterior proibindo). A necessidade usa a fonte canônica única
  // (requiredWorkMinutes) — view, modal e motor compartilham a MESMA fórmula.
  reset([], calOf([COMP8(DIA)]));
  // 4 origens de [10+] (13h30 − 1h almoço ⇒ 2h30 especial com motivo) = 10h:
  const origens: TimeEntry[] = [];
  const reasons: { date: string }[] = [];
  for (const d of ["2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"]) {
    origens.push(punch(d, "07:00", "entrada"), punch(d, "20:30", "saida"));
    reasons.push({ date: d });
  }
  reset(origens, calOf([COMP8(DIA)]), { reasons });
  const antes = rowOf(DIA, HOJE).balanceMinutes;
  assert.equal(antes, -480);
  const r = actions.createSpecialExcessUse({ destinationDate: DIA, minutes: 480, allocationStrategy: "fifo", asOfDate: HOJE });
  assert.equal(r.ok, true, `uso [10+] permitido no COMPENSAR passado: ${r.error ?? "ok"}`);
  const view = viewOf(DIA, HOJE);
  assert.equal(view.usedActiveMinutes, 480);
  assert.equal(view.remainingMinutes, 0);
  assert.equal(view.workedMinutes, 0, "trabalhado factual NUNCA é reescrito (Parte D)");
  assert.deepEqual(view.projection, { workedMinutes: 480, balanceMinutes: 0 }, "projeção oficial: 0h (factual −8h + 8h aplicadas)");
  const depois = rowOf(DIA, HOJE);
  assert.equal(depois.balanceMinutes, -480, "factual CONTINUA −8h (uso não altera fato)");
  assert.equal(depois.balanceContribution, -480, "contribuição factual do ciclo inalterada");
  // Cancelamento devolve ao banco (histórico preservado — 3D/3G):
  const useId = st().specialExcessUses?.[0]?.id ?? "";
  assert.ok(actions.cancelSpecialExcessUse({ id: useId }).ok);
  assert.equal(viewOf(DIA, HOJE).remainingMinutes, 480, "restaurado após cancelamento");
  // A base da projeção no modal é a mesma fonte canônica:
  const modal = src("src/components/special-excess-use-modal.tsx");
  assert.ok(modal.includes("effectiveBaseMinutes: view.requiredWorkMinutes"), "modal usa a base canônica");
});

check("TESTE 08 DE 08 — 4D.4 e 4D.4.1 permanecem intactas", () => {
  // 4D.4 — COMPENSAR integral: 0h→−8h · 3h→−5h · 8h→0 · 9h→+1h · 11h→[10+]:
  reset([], calOf([COMP8("2026-08-20")]));
  const c0 = companyDayContext("2026-08-20", [], [], st().companyCalendars, S());
  assert.equal(c0.regularBalance, -480);
  reset([punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "11:00", "saida")], calOf([COMP8("2026-08-20")]));
  assert.equal(companyDayContext("2026-08-20", st().entries, [], st().companyCalendars, S()).regularBalance, -300);
  const dia8 = [punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "12:00", "saida"), punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "17:00", "saida")];
  reset(dia8, calOf([COMP8("2026-08-20")]));
  assert.equal(companyDayContext("2026-08-20", st().entries, [], st().companyCalendars, S()).regularBalance, 0);
  const dia9 = [punch("2026-08-20", "08:00", "entrada"), punch("2026-08-20", "12:00", "saida"), punch("2026-08-20", "13:00", "entrada"), punch("2026-08-20", "18:00", "saida")];
  reset(dia9, calOf([COMP8("2026-08-20")]));
  assert.equal(companyDayContext("2026-08-20", st().entries, [], st().companyCalendars, S()).regularBalance, 60);
  // 4D.4.1 — ABONADO com trabalho: saldo neutro em dia útil E em sábado;
  // sábado comum mantém a regra normal:
  reset([punch("2026-08-17", "08:00", "entrada"), punch("2026-08-17", "10:00", "saida")], calOf([ABONADO("2026-08-17", 8)]));
  const util = companyDayContext("2026-08-17", st().entries, [], st().companyCalendars, S());
  assert.equal(util.regularBalance, 0);
  assert.equal(util.abonadoIntegral, true);
  reset([punch("2026-08-15", "08:00", "entrada"), punch("2026-08-15", "10:00", "saida")], calOf([ABONADO("2026-08-15", 0)]));
  const sabAbonado = companyDayContext("2026-08-15", st().entries, [], st().companyCalendars, S());
  assert.equal(sabAbonado.regularBalance, 0, "ABONADO em sábado: trabalho NÃO vira crédito");
  assert.equal(sabAbonado.abonadoIntegral, true);
  reset([punch("2026-08-15", "08:00", "entrada"), punch("2026-08-15", "10:00", "saida")], []);
  assert.equal(companyDayContext("2026-08-15", st().entries, [], [], S()).regularBalance, 120, "sábado comum: +2h como sempre");
  // Forecast (Parte E): folga integral futura segue na previsão, fora do factual:
  reset([], calOf([COMP8("2026-09-10")]));
  assert.equal(dayBalanceContribution(companyDayContext("2026-09-10", [], [], st().companyCalendars, S()), st().faltas, "2026-09-10", HOJE), 0);
});

console.log(`\n${passed}/8 verificações da Etapa 4D.4.2 passaram.`);
if (passed !== 8) process.exit(1);
