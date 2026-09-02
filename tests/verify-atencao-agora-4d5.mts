/**
 * VERIFICAÇÃO — ETAPA 4D.5: "ATENÇÃO AGORA" EM FAIXAS INDEPENDENTES,
 * COM CTA DIRETO PARA O PROBLEMA EM REGISTROS.
 *
 * Quatro categorias independentes (nunca somadas numa faixa genérica):
 *   inconsistente | incompleto | sem-registro | plano-10
 * Fonte única: src/lib/attention-now.ts — a MESMA classificação consumida
 * pelas faixas da Visão Geral E pelo filtro de Registros (coerência por
 * construção). Escopo: CICLO ANUAL atual — pendência de período de ponto
 * anterior continua visível; a coerência VG→Registros vem do escopo
 * compartilhado (?escopo=ciclo), nunca da redução de contagem.
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-atencao-agora-4d5.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { todayString } from "../src/lib/time.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { attentionNowSummary, attentionCategoriesForDay } from "../src/lib/attention-now.ts";
import { situationsOfDay } from "../src/lib/day-situation.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { getAnnualPointCycle, annualCycleBounds, getPointPeriod, listDaysBetween } from "../src/lib/periods.ts";
import type { TimeEntry, Falta, Absence } from "../src/lib/types.ts";
import type { CompanyCalendars, CalendarEntry } from "../src/lib/company-calendar.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Helpers ── */
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const seedUser = buildSeedData().user;
const S = () => settingsOf(getAppData().user);
const st = () => getAppData();
const reset = (
  entries: TimeEntry[],
  opts: { calendars?: CompanyCalendars; faltas?: Falta[]; absences?: Absence[]; reasons?: string[]; controlStartDate?: string } = {},
) => {
  actions.replaceAll({
    user: opts.controlStartDate ? { ...seedUser, controlStartDate: opts.controlStartDate } : seedUser,
    entries,
    compensations: [],
    absences: opts.absences ?? [],
    companyCalendars: opts.calendars ?? [],
    faltas: opts.faltas ?? [],
    excessReasons: (opts.reasons ?? []).map((date, i) => ({ id: i + 1, date, reason: "demanda-urgente" })),
    specialExcessUses: [],
    specialExcessPlans: [],
  });
};
const HOJE = "2026-09-02"; // dias do fixture ficam ANTERIORES (incompleto/sem registro exigem date < today)
const summary = (entries: TimeEntry[], opts: Parameters<typeof attentionNowSummary>[0] = {}) =>
  attentionNowSummary({
    today: HOJE,
    entries,
    absences: [],
    calendars: undefined,
    settings: S(),
    faltas: [],
    ...opts,
  });

/* ════════════════ 1. INCOMPLETO ════════════════ */

check("TESTE 01 DE 14 — Dia passado com entrada sem saída final ⇒ 1 incompleto", () => {
  const entries = [punch("2026-08-05", "08:00", "entrada"), punch("2026-08-05", "12:00", "saida"), punch("2026-08-05", "13:00", "entrada")];
  reset(entries);
  const s = summary(entries);
  assert.deepEqual(s.incompleto, ["2026-08-05"], "sequência válida, aberta, dia passado ⇒ incompleto");
  assert.equal(s.inconsistente.length, 0, "não é inconsistente");
});

check("TESTE 02 DE 14 — Mesma sequência no DIA ATUAL em andamento ⇒ NÃO conta incompleto", () => {
  const hoje = todayString(); // relógio REAL: o teste não envelhece
  const entries = [punch(hoje, "08:00", "entrada"), punch(hoje, "12:00", "saida"), punch(hoje, "13:00", "entrada")];
  const cats = attentionCategoriesForDay({
    date: hoje,
    today: hoje,
    day: { consistent: true, open: true, empty: false },
    missingExpected: false,
    hasArrivedPlan: false,
  });
  assert.deepEqual(cats, [], "jornada atual em andamento não é pendência");
  const s = summary(entries, { today: hoje });
  assert.equal(s.incompleto.filter((d) => d === hoje).length, 0);
});

/* ════════════════ 2. INCONSISTENTE ════════════════ */

check("TESTE 03 DE 14 — Sequência inválida Entrada→Entrada ⇒ inconsistente", () => {
  const entries = [punch("2026-08-05", "08:00", "entrada"), punch("2026-08-05", "08:30", "entrada")];
  const s = summary(entries);
  assert.deepEqual(s.inconsistente, ["2026-08-05"], "validação canônica computeDay (!consistent)");
});

check("TESTE 04 DE 14 — Dia inconsistente NÃO conta também como incompleto (prioridade)", () => {
  const entries = [punch("2026-08-05", "08:00", "entrada"), punch("2026-08-05", "08:30", "entrada")];
  const cats = attentionCategoriesForDay({
    date: "2026-08-05",
    today: HOJE,
    day: { consistent: false, open: false, empty: false },
    missingExpected: false,
    hasArrivedPlan: false,
  });
  assert.ok(cats.includes("inconsistente"), "inconsistente presente");
  assert.ok(!cats.includes("incompleto"), "mesma data NUNCA nas duas faixas");
  const s = summary(entries);
  assert.equal(s.incompleto.length, 0);
});

/* ════════════════ 3. SEM REGISTRO (fonte canônica isMissingExpectedRecord) ════════════════ */

check("TESTE 05 DE 14 — Dia regular passado de 8h sem batidas/justificativa ⇒ sem registro", () => {
  reset([], { controlStartDate: "2026-05-01" });
  const s = summary([]);
  assert.ok(s["sem-registro"].includes("2026-08-05"), "quarta-feira regular vazia e já encerrada");
  assert.ok(!s["sem-registro"].includes(HOJE), "hoje jamais entra (date >= today)");
  assert.equal(s.incompleto.length + s.inconsistente.length, 0);
});

check("TESTE 06 DE 14 — Fim de semana vazio ⇒ NÃO entra em sem registro", () => {
  const s = summary([]); // 2026-08-08 = sábado · 2026-08-09 = domingo
  assert.ok(!s["sem-registro"].includes("2026-08-08"));
  assert.ok(!s["sem-registro"].includes("2026-08-09"));
});

check("TESTE 07 DE 14 — ABONADO / COMPENSAR / férias / afastamento / falta ⇒ NÃO entram em sem registro", () => {
  const DIA = "2026-08-25"; // terça regular, PÓS-controlStartDate do seed (baseline conta)
  assert.ok(summary([])["sem-registro"].includes(DIA), "baseline: sem nenhum fato, o dia conta");
  const CAL: Omit<CalendarEntry, "id"> = { date: DIA, descricao: "Feriado", categoria: "Feriado Nacional", tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: 8, observacao: null };
  const COMP: Omit<CalendarEntry, "id"> = { date: DIA, descricao: "Compensado", categoria: "Compensação 8 Horas", tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null };
  const calOf = (e: Omit<CalendarEntry, "id">): CompanyCalendars => [{ id: "c", cycleStart: "2026-05-01", cycleEnd: "2027-04-30", cycleLabel: "2026/2027", version: 1, importedAt: "2026-05-01", entries: [{ id: 1, ...e }] }];
  assert.equal(summary([], { calendars: calOf(CAL) })["sem-registro"].includes(DIA), false, "ABONADO é fato conhecido");
  assert.equal(summary([], { calendars: calOf(COMP) })["sem-registro"].includes(DIA), false, "COMPENSAR é fato conhecido");
  const ferias: Absence = { id: 1, kind: "ferias", startDate: "2026-08-24", endDate: "2026-08-26", duration: "integral", note: null, createdAt: 1 };
  assert.equal(summary([], { absences: [ferias] })["sem-registro"].includes(DIA), false, "férias explica o dia");
  const saude: Absence = { id: 2, kind: "saude", startDate: DIA, endDate: DIA, duration: "integral", note: null, createdAt: 2 };
  assert.equal(summary([], { absences: [saude] })["sem-registro"].includes(DIA), false, "afastamento explica o dia");
  assert.equal(summary([], { faltas: [{ id: 1, date: DIA, createdAt: 3 }] })["sem-registro"].includes(DIA), false, "falta já registrada/justificada");
});

check("TESTE 08 DE 14 — Dia comum vazio pré-controlStartDate ⇒ permanece neutro e NÃO entra", () => {
  reset([], { controlStartDate: "2026-08-20" });
  const s = summary([], { controlStartDate: "2026-08-20" });
  assert.ok(!s["sem-registro"].includes("2026-08-05"), "nenhuma inferência automática pré-start");
  assert.ok(!s["sem-registro"].includes("2026-08-19"), "véspera do start também neutra");
  assert.ok(s["sem-registro"].includes("2026-08-25"), "pós-start segue cobrando (neutralidade só pré-start)");
});

/* ════════════════ 4. PLANEJAMENTO [10+] AGUARDANDO ════════════════ */

/* Origem [10+]: 18/08 com 11h30 (regular capped +2h · excesso [10+] 1h30, com motivo). */
const resetComExcesso = () => {
  reset([punch("2026-08-18", "07:00", "entrada"), punch("2026-08-18", "19:30", "saida")], { reasons: ["2026-08-18"] });
};

check("TESTE 09 DE 14 — Plano [10+] FUTURO ⇒ NÃO gera faixa de atenção", () => {
  resetComExcesso();
  const r = actions.createSpecialExcessPlan({ destinationDate: "2026-09-10", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-20" });
  assert.ok(r.ok, `plano futuro criado: ${r.error ?? "ok"}`);
  const s = summary(st().entries, { plans: st().specialExcessPlans });
  assert.equal(s["plano-10"].length, 0, "reserva puramente futura não é 'Atenção agora'");
});

check("TESTE 10 DE 14 — Plano cuja data CHEGOU ⇒ gera faixa aguardando confirmação", () => {
  resetComExcesso();
  const r = actions.createSpecialExcessPlan({ destinationDate: "2026-08-26", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-20" });
  assert.ok(r.ok, `plano criado: ${r.error ?? "ok"}`);
  const s = summary(st().entries, { plans: st().specialExcessPlans });
  assert.deepEqual(s["plano-10"], ["2026-08-26"], "reserva chegou ao dia ⇒ atenção");
});

check("TESTE 11 DE 14 — Plano já UTILIZADO (fluxo 01/09: plan→use) ⇒ NÃO aparece mais como aguardando; banco sem consumo duplo", () => {
  resetComExcesso();
  const r = actions.createSpecialExcessPlan({ destinationDate: "2026-08-26", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-20" });
  assert.ok(r.ok);
  const plano = st().specialExcessPlans?.[0];
  assert.ok(plano, "plano presente");
  // Fluxo real 01/09: o dia chega com 7h30 (05–09 / 10–13:30) e o usuário
  // usa a reserva de 30min (mesma sequência do caso manual validado):
  actions.addEntry({ date: "2026-08-26", time: "05:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-26", time: "09:00", type: "saida", note: null });
  actions.addEntry({ date: "2026-08-26", time: "10:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-26", time: "13:30", type: "saida", note: null });
  const res = actions.resolveSpecialExcessPlan({ id: plano.id, minutes: 30, asOfDate: "2026-08-27" });
  assert.ok(res.ok, `resolução: ${res.error ?? "ok"}`);
  assert.notEqual(st().specialExcessPlans?.find((p) => p.id === plano.id)?.status, "planned", "não está mais aguardando");
  const s = summary(st().entries, { plans: st().specialExcessPlans });
  assert.equal(s["plano-10"].length, 0, "faixa some após a utilização");
  // Banco: gerado 90 − usado 30 = 60 disponível (reserva virou uso UMA vez):
  const bank = buildSpecialExcessBank({
    cycle: getAnnualPointCycle(HOJE), asOfDate: HOJE, entries: st().entries, absences: [],
    calendars: st().companyCalendars, settings: S(), faltas: [],
    controlStartDate: st().user.controlStartDate ?? "", uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
  });
  assert.equal(bank.generatedMinutes, 90);
  assert.equal(bank.usedMinutes, 30);
  assert.equal(bank.reservedMinutes, 0);
  assert.equal(bank.availableMinutes, 60, "sem consumo duplo");
});

/* ════════════════ 5. NAVEGAÇÃO DOS CTAs ════════════════ */

check("TESTE 12 DE 14 — CTA com exatamente 1 item ⇒ abre Registros na data correta + card expandido", () => {
  const vg = src("src/app/(app)/page.tsx");
  // Filtro da categoria + escopo do ciclo como BASE do href:
  assert.ok(vg.includes("`/registros?situacao=${filtro}&escopo=ciclo`"), "base do CTA: filtro + escopo ciclo");
  assert.ok(vg.includes("dates.length === 1 ? `${base}&data=${dates[0]}` : base;"), "1 item ⇒ foco na data");
  assert.ok(vg.includes("`/registros?atencao=plano-10&escopo=ciclo&data=${attention[\"plano-10\"][0]}`"), "plano único ⇒ data");
  // Registros recebe o foco e expande o card correspondente:
  const reg = src("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("initiallyExpanded={focusDate === date}"), "card da data focada expandido");
  const card = src("src/components/day-card.tsx");
  assert.ok(card.includes("useState(initiallyExpanded ?? false)"), "DayCard aceita estado inicial expandido");
});

check("TESTE 13 DE 14 — CTA com múltiplos itens ⇒ filtro correto + escopo ciclo + só resultados pertinentes", () => {
  const vg = src("src/app/(app)/page.tsx");
  // O href SEM data (base) lista a categoria inteira no escopo do ciclo:
  assert.ok(!vg.includes("situacao=${filtro}&escopo=ciclo&data=${dates[0]}` :"), "2+ itens ⇒ sem foco em data única");
  const reg = src("src/app/(app)/registros/page.tsx");
  assert.ok(reg.includes("const cycleRange = useMemo(() => annualCycleBounds(getAnnualPointCycle(todayStr)), [todayStr]);"), "escopo ciclo anual atual");
  assert.ok(reg.includes("let r = wantCycleScope ? cycleRange : query ?? period;"), "?escopo=ciclo muda o range da listagem");
  assert.ok(reg.includes("? days.filter((d) => d.planoAguardando)"), "atencao=plano-10 ⇒ somente dias com reserva chegada");
  assert.ok(reg.includes("? days.filter((d) => dayMatchesSituations(d.situations, situationIds))"), "situação do dia ⇒ somente dias da categoria");
  assert.ok(reg.includes("if (planoOnly && planoCount === 0) router.replace(\"/registros\");"), "sem aguardando ⇒ filtro some");
});

/* ════════════════ 6. COERÊNCIA VG = REGISTROS ════════════════ */

check("TESTE 14 DE 14 — Contagens VG = resultados do filtro de Registros (mesmo escopo ciclo), inclusive pendência de período anterior", () => {
  // Pendências em PERÍODOS DE PONTO ANTERIORES, ainda dentro do ciclo anual:
  // 05/08 (período 21/07→20/08) inconsistente · 12/08 (21/07→20/08) incompleto ·
  // 13/08 (mesmo período) sem registro · 27/08 (período atual 21/08→20/09) inconsistente.
  const entries = [
    punch("2026-08-05", "08:00", "entrada"), punch("2026-08-05", "08:30", "entrada"),
    punch("2026-08-12", "08:00", "entrada"), punch("2026-08-12", "12:00", "saida"), punch("2026-08-12", "13:00", "entrada"),
    punch("2026-08-27", "08:00", "entrada"), punch("2026-08-27", "08:15", "entrada"),
  ];
  const bounds = annualCycleBounds(getAnnualPointCycle(HOJE));
  const vg = summary(entries, { range: bounds });
  assert.deepEqual(vg.inconsistente, ["2026-08-05", "2026-08-27"]);
  assert.deepEqual(vg.incompleto, ["2026-08-12"]);
  assert.ok(vg["sem-registro"].includes("2026-08-13"), "13/08 vazio ⇒ sem registro (a igualdade total vem abaixo)");
  // A pendência de 05/08 está FORA do período de ponto atual — não pode sumir:
  const periodoAtual = getPointPeriod(HOJE);
  assert.ok("2026-08-05" < periodoAtual.from, "05/08 é de período anterior ⇒ escopo período a esconderia");
  assert.ok(vg.inconsistente.includes("2026-08-05"), "escopo CICLO mantém a pendência visível");
  // Lado Registros: MESMO classificador canônico (situationsOfDay) sobre o
  // MESMO range (ciclo) — igualdade total por construção:
  const regInconsistente: string[] = [];
  const regIncompleto: string[] = [];
  const regSemRegistro: string[] = [];
  for (const date of listDaysBetween(bounds.from, bounds.to)) {
    const ids = situationsOfDay(date, HOJE, entries, [], undefined, S(), { faltas: [], controlStartDate: null });
    if (ids.includes("registro-inconsistente")) regInconsistente.push(date);
    if (ids.includes("registro-incompleto")) regIncompleto.push(date);
    if (ids.includes("sem-registro")) regSemRegistro.push(date);
  }
  assert.deepEqual(regInconsistente, vg.inconsistente, "inconsistentes: VG = filtro Registros");
  assert.deepEqual(regIncompleto, vg.incompleto, "incompletos: VG = filtro Registros");
  assert.deepEqual(regSemRegistro, vg["sem-registro"], "sem registro: VG = filtro Registros");
});

console.log(`\n${passed}/14 verificações da Etapa 4D.5 passaram.`);
if (passed !== 14) process.exit(1);
