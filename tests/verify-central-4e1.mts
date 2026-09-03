/**
 * VERIFICAÇÃO — ETAPA 4E.1: CORREÇÕES PÓS-VALIDAÇÃO DA CENTRAL
 * (evento parcial do calendário · foco data= com scroll · ordem cronológica
 * crescente em Registros · dropdown à prova de viewport · métricas 2×2).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-central-4e1.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData, settingsOf } from "../src/lib/store.ts";
import { buildSeedData } from "../src/lib/seed-data.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { buildCalendarForecast } from "../src/lib/calendar-forecast.ts";
import { centralCalendarEvents } from "../src/lib/central-view.ts";
import { annualCycleBounds, listDaysBetween } from "../src/lib/periods.ts";
import { registrosTimelineDates } from "../src/lib/missing-records.ts";
import { situationsOfDay } from "../src/lib/day-situation.ts";
import { daySituationPanelBox } from "../src/components/day-situation-filter.tsx";
import type { TimeEntry, CompanyCalendars, CalendarEntry, Falta, WorkSettings } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const central = () => src("src/app/(app)/compensacoes/page.tsx");
const reg = () => src("src/app/(app)/registros/page.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✔ ${id}`);
};

/* ── Helpers ── */
let nextId = 1;
const punch = (date: string, time: string, type: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date, time, type, note: null });
const S = (): WorkSettings => settingsOf(getAppData().user);
const st = () => getAppData();
const HOJE = "2026-09-02";
const COMP8 = (d: string): Omit<CalendarEntry, "id"> => ({ date: d, descricao: "Compensado", categoria: "Compensação 8 Horas", tratamento: "COMPENSAR", horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null });
/** Fixture da correção: Cinzas COMPENSAR com horasACompensar 4h + jornadaEsperadaHoras 4h. */
const CINZAS: Omit<CalendarEntry, "id"> = { date: "2027-02-10", descricao: "Cinzas", categoria: "Compensação 4 Horas", tratamento: "COMPENSAR", horasACompensar: 4, jornadaEsperadaHoras: 4, horasAbonadas: 0, observacao: null };
const ABON8 = (d: string): Omit<CalendarEntry, "id"> => ({ date: d, descricao: "Feriado", categoria: "Feriado Nacional", tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: 8, observacao: null });
const calOf = (entries: Omit<CalendarEntry, "id">[]): CompanyCalendars => [
  { id: "cal-2627", cycleStart: "2026-05-01", cycleEnd: "2027-04-30", cycleLabel: "2026/2027", version: 1, importedAt: "2026-05-01", entries: entries.map((e, i) => ({ id: i + 1, ...e })) },
];
/** Fixture 4E íntegro: 37 datas · 148h COMPENSAR · 112h ABONADAS. */
const FIX_FUTUROS = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"];
const FIX_PAST_FOLGAS = ["2026-05-04", "2026-06-05", "2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-08-25"];
const FIX_ABONADOS8 = ["2026-05-01", "2026-06-04", "2026-07-09", "2026-07-20", "2026-08-10", "2026-08-17", "2026-08-24", "2026-09-07", "2026-10-12", "2026-10-28", "2026-11-02", "2026-11-20", "2026-12-25", "2027-01-01"];
const FIX_ABONADOS0 = ["2026-05-10", "2026-06-20", "2026-07-25", "2026-12-24"];
const CAL_FIX = calOf([
  ...[...FIX_PAST_FOLGAS, ...FIX_FUTUROS].map((d) => COMP8(d)),
  CINZAS,
  ...FIX_ABONADOS8.map((d) => ABON8(d)),
  ...FIX_ABONADOS0.map((d) => ABON0(d)),
]);
function ABON0(d: string): Omit<CalendarEntry, "id"> {
  return { date: d, descricao: "Ponto facultativo", categoria: "Feriado Nacional", tratamento: "ABONADO", horasACompensar: 0, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null };
}
const reset = (entries: TimeEntry[], calendars: CompanyCalendars = []) => {
  actions.replaceAll({
    user: buildSeedData().user, entries, compensations: [], absences: [], companyCalendars: calendars, faltas: [] as Falta[],
    excessReasons: [], specialExcessUses: [], specialExcessPlans: [],
  });
};
const eventos = () =>
  centralCalendarEvents({ today: HOJE, cycle: "2026/2027", entries: st().entries, absences: [], calendars: st().companyCalendars, settings: S(), faltas: [], controlStartDate: null });
const cinzas = () => eventos().future.find((e) => e.date === "2027-02-10")!;

/* ════════ CORREÇÃO 1 — EVENTO PARCIAL (CINZAS) ════════ */

check("TESTE 01 DE 18 — Cinzas 10/02 NÃO é 'Folga integral' (classificação: jornada parcial)", () => {
  reset([], CAL_FIX);
  assert.equal(cinzas().jornadaParcial, true, "classificado como JORNADA PARCIAL");
  const p = central();
  assert.ok(p.includes("(e.jornadaParcial"), "condicional pela classificação canônica");
  assert.ok(p.includes('"Jornada parcial — sem impacto futuro automático."'), "texto parcial no ramo correto");
  assert.ok(p.includes(': "Folga integral a compensar — impacto conhecido no futuro.")'), "texto integral SOMENTE no ramo da folga integral");
});

check("TESTE 02 DE 18 — Cinzas mostra base 8h · crédito 4h · jornada a cumprir 4h", () => {
  reset([], CAL_FIX);
  const c = cinzas();
  assert.equal(c.baseReferenciaMinutes, 480);
  assert.equal(c.creditoCalendarioMinutes, 240);
  assert.equal(c.jornadaACumprirMinutes, 240);
  // A página apresenta o detalhe canônico também nos PRÓXIMOS eventos:
  const fut = central().slice(central().indexOf("Próximos eventos"), central().indexOf("Eventos realizados"));
  assert.ok(fut.includes("Base referência"), "base no futuro");
  assert.ok(fut.includes("Crédito calendário"), "crédito no futuro");
  assert.ok(fut.includes("Jornada a cumprir"), "jornada a cumprir no futuro");
});

check("TESTE 03 DE 18 — Cinzas NÃO recebe impacto futuro −4h", () => {
  reset([], CAL_FIX);
  assert.equal(cinzas().impactoFuturoConhecidoMinutes, null);
  const p = central();
  assert.ok(p.includes("e.impactoFuturoConhecidoMinutes !== null && !e.jornadaParcial"), "guard exclui parcial do 'Impacto conhecido'");
});

check("TESTE 04 DE 18 — Forecast do fixture permanece −88h / 11 eventos", () => {
  reset([], CAL_FIX);
  const fc = buildCalendarForecast({ calendars: st().companyCalendars, cycle: "2026/2027", today: HOJE, entries: st().entries, absences: [], settings: S() });
  assert.equal(fc.eventCount, 11);
  assert.equal(fc.futureImpactMinutes, -5280);
  assert.ok(!fc.events.some((e) => e.date === "2027-02-10"), "Cinzas continua fora do forecast");
});

check("TESTE 05 DE 18 — COMPENSAR integral futuro continua com −8h quando aplicável", () => {
  reset([], CAL_FIX);
  const integral = eventos().future.find((e) => e.date === "2026-09-04")!;
  assert.equal(integral.jornadaParcial, false);
  assert.equal(integral.baseReferenciaMinutes, 480);
  assert.equal(integral.creditoCalendarioMinutes, 0);
  assert.equal(integral.jornadaACumprirMinutes, 480);
  assert.equal(integral.impactoFuturoConhecidoMinutes, -480, "impacto conhecido −8h");
  const p = central();
  assert.ok(p.includes("Folga integral a compensar"), "rótulo integral preservado");
  assert.ok(p.includes("Impacto conhecido:"), "impacto renderizado para integral");
});

check("TESTE 06 DE 18 — ABONADO futuro continua neutro (base 8h · crédito 8h · jornada 0)", () => {
  reset([], CAL_FIX);
  const abon = eventos().future.find((e) => e.date === "2026-09-07")!;
  assert.equal(abon.tratamento, "ABONADO");
  assert.equal(abon.baseReferenciaMinutes, 480);
  assert.equal(abon.creditoCalendarioMinutes, 480);
  assert.equal(abon.jornadaACumprirMinutes, 0);
  assert.equal(abon.impactoFuturoConhecidoMinutes, null, "neutro");
  assert.equal(abon.jornadaParcial, false);
});

/* ════════ CORREÇÃO 2 — data= LEVA AO CARD ════════ */

check("TESTE 07 DE 18 — ?data= identifica, expande e posiciona o card (mecanismo dedicado)", () => {
  const p = reg();
  assert.ok(p.includes("id={`dia-card-${date}`}"), "cada card tem âncora id");
  assert.ok(p.includes("document.getElementById(`dia-card-${focusDate}`)"), "efeito localiza o card focado");
  assert.ok(p.includes("window.scrollTo"), "posiciona a viewport");
  assert.ok(p.includes("HEADER_STICKY_OFFSET"), "compensa o header sticky");
  // 4D.5.2 preservado: remount + expansão continuam no DayCard:
  assert.ok(p.includes("key={focusDate === date ? `${date}-atencao` : date}"), "key de remount intacta");
  assert.ok(p.includes("initiallyExpanded={focusDate === date}"), "card focado expandido");
  assert.ok(p.includes("useRef"), "ref para não-reprocessar");
});

check("TESTE 08 DE 18 — Funciona para 25/08, 31/08 e qualquer data — SEM hardcode", () => {
  const p = reg();
  assert.ok(!p.includes("2026-08-25"), "nenhuma data cravada");
  assert.ok(!p.includes("2026-08-31"), "nenhuma data cravada");
  assert.ok(p.includes("const focusDate = focusDateRaw && /^\\d{4}-\\d{2}-\\d{2}$/.test(focusDateRaw) ? focusDateRaw : null;"), "qualquer YYYY-MM-DD");
  assert.ok(p.includes("`dia-card-${focusDate}`"), "ancoragem derivada da URL");
});

check("TESTE 09 DE 18 — Sem ?data= NÃO há scroll automático", () => {
  const p = reg();
  assert.ok(p.includes("if (!focusDate || lastFocusScrolled.current === focusDate) return;"), "guard: sem foco ⇒ efeito não faz nada");
});

/* ════════ CORREÇÃO 3 — ORDEM CRONOLÓGICA ════════ */

check("TESTE 10 DE 18 — Período 21/08→20/09 renderiza em ordem CRESCENTE", () => {
  const tl = registrosTimelineDates({ from: "2026-08-21", to: "2026-09-20" });
  const asc = [...tl].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(tl, asc, "timeline crescente");
  assert.equal(tl[0], "2026-08-21");
  assert.equal(tl[tl.length - 1], "2026-09-20");
  const p = reg();
  assert.ok(p.includes(".sort((a, b) => a.localeCompare(b))"), "renderização ordena crescente");
  assert.ok(!p.includes(".sort((a, b) => b.localeCompare(a))"), "nenhuma ordenação decrescente restou na página");
});

check("TESTE 11 DE 18 — Ciclo 01/05→30/04 renderiza crescente", () => {
  const b = annualCycleBounds("2026/2027");
  assert.deepEqual(b, { from: "2026-05-01", to: "2027-04-30" });
  const tl = registrosTimelineDates(b);
  assert.equal(tl[0], "2026-05-01");
  assert.equal(tl[tl.length - 1], "2027-04-30");
  assert.deepEqual(tl, [...tl].sort((a, b2) => a.localeCompare(b2)));
});

check("TESTE 12 DE 18 — Filtro sem-registro retorna datas crescentes", () => {
  reset([], []);
  const b = annualCycleBounds("2026/2027");
  const sem = listDaysBetween(b.from, b.to).filter((d) => d <= HOJE && situationsOfDay(d, HOJE, [], [], undefined, S(), { faltas: [], controlStartDate: st().user.controlStartDate ?? null }).includes("sem-registro"));
  assert.ok(sem.length > 0);
  assert.deepEqual(sem, [...sem].sort((a, b2) => a.localeCompare(b2)), "crescente");
  // A página filtra a coleção JÁ ordenada (sem re-ordenar):
  const p = reg();
  assert.ok(p.includes("? days.filter((d) => d.missingExpected)"), "filtro herda a ordem crescente de days");
});

check("TESTE 13 DE 18 — Inconsistente/incompleto: classificação preservada + ordem crescente", () => {
  actions.replaceAll({
    user: { ...buildSeedData().user, controlStartDate: "2026-05-01" },
    entries: [
      punch("2026-08-05", "08:00", "entrada"), punch("2026-08-05", "08:30", "entrada"),
      punch("2026-08-27", "08:00", "entrada"), punch("2026-08-27", "08:15", "entrada"),
      punch("2026-08-28", "08:00", "entrada"), punch("2026-08-28", "12:00", "saida"), punch("2026-08-28", "13:00", "entrada"),
    ],
    compensations: [], absences: [], companyCalendars: [], faltas: [], excessReasons: [], specialExcessUses: [], specialExcessPlans: [],
  });
  const cls = (d: string) => situationsOfDay(d, HOJE, st().entries, [], undefined, S(), { faltas: [], controlStartDate: st().user.controlStartDate ?? null });
  const incon = ["2026-08-05", "2026-08-27"].filter((d) => cls(d).includes("registro-inconsistente"));
  const incom = ["2026-08-28"].filter((d) => cls(d).includes("registro-incompleto"));
  assert.deepEqual(incon, ["2026-08-05", "2026-08-27"], "2 inconsistentes preservados, crescente");
  assert.deepEqual(incom, ["2026-08-28"], "incompleto preservado");
  const p = reg();
  assert.ok(p.includes("days.filter((d) => dayMatchesSituations(d.situations, situationIds))"), "filtro por classificação canônica herda a ordem");
});

/* ════════ CORREÇÃO 4 — DROPDOWN À PROVA DE VIEWPORT ════════ */

check("TESTE 14 DE 18 — Painel cabe integralmente em 320/360/412px (clamp puro)", () => {
  for (const vw of [320, 360, 412]) {
    for (const left of [0, 40, 244, 296, 500]) {
      const box = daySituationPanelBox({ left, bottom: 100 }, vw);
      assert.equal(box.width, Math.min(288, vw - 16), `vw=${vw}: largura ≤ área útil`);
      assert.ok(box.left >= 8, `vw=${vw} left=${left}: respeita margem lateral`);
      assert.ok(box.left + box.width <= vw - 8, `vw=${vw} left=${left}: não ultrapassa a viewport`);
    }
  }
  const p = src("src/components/day-situation-filter.tsx");
  assert.ok(p.includes('position: "fixed"'), "painel fixo (não cria scroll horizontal)");
  assert.ok(p.includes("calc(100vw - ${VIEWPORT_MARGIN * 2}px)"), "largura máxima ≤ área útil");
});

check("TESTE 15 DE 18 — Dropdown fecha por outside click, seleção, trigger e Escape", () => {
  const p = src("src/components/day-situation-filter.tsx");
  assert.ok(p.includes("const onPointerDown = (ev: PointerEvent)"), "listener de clique/touch fora");
  assert.ok(p.includes("if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;"), "ignora cliques internos");
  assert.ok(p.includes('if (ev.key === "Escape")'), "Escape fecha");
  assert.ok(p.includes("triggerRef.current?.focus()"), "devolve foco ao trigger");
  assert.ok(p.includes("onChange([]);"), "seleção ('Todos os dias') aplica");
  assert.ok(p.includes("setOpen(false); // seleção ⇒ fecha"), "seleção fecha");
  assert.ok(p.includes("setOpen((o) => !o)"), "novo clique no trigger alterna");
  assert.ok(p.includes('aria-expanded={open}'), "a11y: estado exposto");
});

/* ════════ CORREÇÃO 5 — MÉTRICAS DA CENTRAL 2×2 NO MOBILE ════════ */

check("TESTE 16 DE 18 — Central mobile usa grid 2×2 com a ordem Disponível|Gerado / Reservado|Utilizado", () => {
  const p = central();
  assert.ok(p.includes('className="grid grid-cols-2 gap-3 lg:grid-cols-4"'), "2 colunas no mobile; desktop 4 em linha");
  const bloco = p.slice(p.indexOf("grid grid-cols-2"), p.indexOf("Origens do [10+]"));
  assert.ok(bloco.includes('className="order-1 lg:order-1"'), "Disponível: linha 1, coluna 1");
  assert.ok(bloco.includes('className="order-2 lg:order-4"'), "Gerado: linha 1, coluna 2 (desktop: última)");
  assert.ok(bloco.includes('className="order-3 lg:order-2"'), "Reservado: linha 2, coluna 1 (desktop: 2º)");
  assert.ok(bloco.includes('className="order-4 lg:order-3"'), "Utilizado: linha 2, coluna 2 (desktop: 3º)");
  assert.ok(bloco.includes('label="Disponível [10+]"'), "indicador principal presente");
});

check("TESTE 17 DE 18 — Em 320/360/412px os cards 2×2 não estouram (wrap e valor em destaque)", () => {
  const p = central();
  assert.ok(!p.includes("w-screen") && !p.includes("overflow-x"), "sem vetor de scroll horizontal");
  const ui = src("src/components/ui.tsx");
  assert.ok(ui.includes("${className ?? \"\"}"), "StatCard aceita classes de order (opt-in)");
  assert.ok(ui.includes("min-w-0 text-[11px] font-bold uppercase tracking-wider"), "título menor com wrap (min-w-0)");
  assert.ok(ui.includes("text-2xl font-extrabold tabular-nums"), "valor continua em destaque");
  assert.ok(ui.includes("min-h-4 text-xs leading-4 text-slate-500"), "descrição quebra em até 2 linhas");
  assert.equal((p.match(/grid grid-cols-2 gap-3 lg:grid-cols-4/g) ?? []).length, 1, "grid único e consistente");
});

/* ════════ NÃO-REGRESSÃO ════════ */

check("TESTE 18 DE 18 — Backups A/B da Central, 4D.5.2 e backup sentinel íntegros", () => {
  // BACKUP A: gerado 2h10 · usado 30min · reservado 30min · disponível 1h10
  reset([
    punch("2026-08-18", "07:00", "entrada"), punch("2026-08-18", "19:30", "saida"),
    punch("2026-08-21", "08:00", "entrada"), punch("2026-08-21", "19:40", "saida"),
    punch("2026-08-31", "05:00", "entrada"), punch("2026-08-31", "09:00", "saida"),
    punch("2026-08-31", "10:00", "entrada"), punch("2026-08-31", "13:30", "saida"),
    punch("2026-09-01", "05:00", "entrada"), punch("2026-09-01", "09:00", "saida"),
    punch("2026-09-01", "10:00", "entrada"), punch("2026-09-01", "13:30", "saida"),
  ], [], );
  actions.replaceAll({ ...st(), excessReasons: [{ id: 1, date: "2026-08-18", reason: "demanda-urgente" }, { id: 2, date: "2026-08-21", reason: "demanda-urgente" }] });
  const bankOf = () =>
    buildSpecialExcessBank({
      cycle: "2026/2027", asOfDate: HOJE, entries: st().entries, absences: [], calendars: st().companyCalendars,
      settings: S(), faltas: [], controlStartDate: st().user.controlStartDate ?? "",
      uses: st().specialExcessUses ?? [], plans: st().specialExcessPlans ?? [],
    });
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-08-31", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-01" }).ok, "uso 31/08 (validado)");
  assert.ok(actions.createSpecialExcessPlan({ destinationDate: "2026-09-01", minutes: 30, selectionMode: "automatic", asOfDate: "2026-08-28" }).ok, "reserva 01/09 origem 18/08 automática");
  let b = bankOf();
  assert.equal(b.generatedMinutes, 130, "gerado 2h10");
  assert.equal(b.usedMinutes, 30, "usado 30min");
  assert.equal(b.reservedMinutes, 30, "reservado 30min");
  assert.equal(b.availableMinutes, 70, "disponível 1h10");
  // BACKUP B: reserva concluída em uso ⇒ usado 1h · reservado 0 · disponível 1h10
  const plano = st().specialExcessPlans?.[0]!;
  assert.ok(actions.cancelSpecialExcessPlan({ id: plano.id, now: 2 }).ok);
  assert.ok(actions.createSpecialExcessUse({ destinationDate: "2026-09-01", minutes: 30, allocationStrategy: "fifo", asOfDate: "2026-09-02" }).ok, "uso 01/09 (backup B)");
  b = bankOf();
  assert.equal(b.usedMinutes, 60, "usado 1h");
  assert.equal(b.reservedMinutes, 0, "reservado 0");
  assert.equal(b.availableMinutes, 70, "disponível 1h10");
  assert.equal(b.generatedMinutes, 130, "gerado 2h10");
  // Sentinelas (etapas anteriores) continuam verdes:
  for (const t of ["verify-backup-contract-vg-ux-4c1b", "verify-fechamento-atencao-4d52", "verify-atencao-registros-4d51", "verify-central-4e"]) {
    execSync(`TZ=America/Sao_Paulo ./node_modules/.bin/tsx tests/${t}.mts`, { cwd: root, stdio: "pipe" });
  }
});

console.log(`\n${passed}/18 verificações da Etapa 4E.1 passaram.`);
if (passed !== 18) process.exit(1);
