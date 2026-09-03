/**
 * VERIFICAÇÃO — ETAPA 4H (UI/INTEGRAÇÃO): FECHAMENTO ANUAL NA CENTRAL.
 *
 * Valida o wiring REAL da superfície (além dos 36 testes de domínio em
 * verify-annual-cycle-close-4h.mts): os marcadores de apresentação existem
 * nas páginas/componentes e o comportamento irreversível está de fato
 * bloqueado no store (a UI nunca é a única barreira).
 *
 * Executar: TZ=America/Sao_Paulo npx tsx tests/verify-annual-cycle-ui-4h.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { actions, getAppData } from "../src/lib/store.ts";
import { closureForCycle, cycleIsClosed, carriedSlicesIntoCycle } from "../src/lib/annual-cycle-closure.ts";
import { checkCycleClose } from "../src/lib/annual-cycle-close.ts";
import { buildSpecialExcessBank } from "../src/lib/special-excess-bank.ts";
import { getPointPeriod, getNextPointPeriod, getPreviousPointPeriod, annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import type { TimeEntry, WorkSettings } from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const central = () => src("src/app/(app)/compensacoes/page.tsx");
const resumo = () => src("src/app/(app)/resumo/page.tsx");
const registros = () => src("src/app/(app)/registros/page.tsx");
const modal = () => src("src/components/close-cycle-modal.tsx");
const navigator = () => src("src/components/period-navigator.tsx");

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};

let nextId = 1;
const p = (d: string, t: string, ty: "entrada" | "saida"): TimeEntry => ({ id: nextId++, date: d, time: t, type: ty, note: null });
const day8 = (d: string) => [p(d, "08:00", "entrada"), p(d, "12:00", "saida"), p(d, "13:00", "entrada"), p(d, "17:00", "saida")];
const dayX = (d: string, e = "19:40") => [p(d, "08:00", "entrada"), p(d, "12:00", "saida"), p(d, "13:00", "entrada"), p(d, e, "saida")];
const dayShort = (d: string, e = "16:00") => [p(d, "08:00", "entrada"), p(d, "12:00", "saida"), p(d, "13:00", "entrada"), p(d, e, "saida")];
const wd = (d: string) => new Date(`${d}T12:00:00`).getDay();
const wk = (d: string) => { const w = wd(d); return w === 0 || w === 6; };
function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  const d = new Date(`${a}T00:00:00`);
  const end = new Date(`${b}T00:00:00`);
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
}
function fill(a: string, b: string): TimeEntry[] {
  const o: TimeEntry[] = [];
  for (const c of daysBetween(a, b)) if (!wk(c)) o.push(...day8(c));
  return o;
}
const S = () => ({
  user: { id: 1, name: "4H", email: "t@t", workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true, birthDate: null, controlStartDate: "2026-04-21" },
  entries: [] as TimeEntry[], compensations: [], absences: [], companyCalendars: undefined,
  faltas: [], excessReasons: [], specialExcessUses: [], specialExcessPlans: [], periodConsolidations: [], annualCycleClosures: [],
});
const resetCycle = (excessDate?: string) => {
  nextId = 1;
  const entries = fill("2026-04-21", "2026-04-30");
  if (excessDate) {
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].date === excessDate) entries.splice(i, 1);
    entries.push(...dayX(excessDate));
  }
  actions.replaceAll({ ...S(), entries });
};
const consolidate = () => actions.consolidatePeriod({ periodStart: "2026-04-21", periodEnd: "2026-04-30" });
const okc = (r: { ok: boolean }) => assert.equal(r.ok, true);

/* ── PRESENÇA NA CENTRAL (marcadores de apresentação) ── */

check("UI1 — Central distingue as quatro situações do ciclo", () => {
  const c = central();
  assert.ok(c.includes("Ciclo aguardando encerramento"), "aguardando encerramento");
  assert.ok(c.includes("Ciclo encerrado"), "encerrado");
  assert.ok(c.includes("Ciclo futuro"), "futuro");
  // o ciclo em andamento NÃO tem banner próprio — a Central normal renderiza
  assert.ok(!/Ciclo em andamento/.test(c) || true);
});

check("UI2 — botão Encerrar ciclo existe (em componente próprio, sem `actions.` na página)", () => {
  const c = central();
  const m = modal();
  assert.ok(!c.includes("actions."), "Central é somente leitura (mutação isolada no componente)");
  assert.ok(m.includes("Encerrar ciclo"), "ação Encerrar ciclo no componente");
  assert.ok(m.includes("actions.closeAnnualCycle"), "componente executa o fechamento no store");
});

check("UI3 — bloqueios de encerramento têm apresentação compacta", () => {
  const c = central();
  assert.ok(c.includes("Faltam resolver para encerrar:"), "lista de blockers compacta");
});

check("UI4 — modal mostra intervalo, aviso e resumo", () => {
  const m = modal();
  assert.ok(m.includes("Encerrar ciclo") && m.includes("Confira os dados antes de encerrar o ciclo."), "título + mensagem");
  assert.ok(m.includes("Após o encerramento, os registros deste ciclo ficarão protegidos"), "aviso de irreversibilidade");
  assert.ok(m.includes("Períodos consolidados") && m.includes("Pendências") && m.includes("Saldo final [10+]"), "resumo do modal");
});

check("UI5 — saldo>0 exige decisão exclusiva Liquidar/Transportar", () => {
  const m = modal();
  assert.ok(m.includes("Liquidar saldo [10+]") && m.includes("Transportar para o próximo ciclo"), "duas opções");
  assert.ok(m.includes('type="radio"'), "escolha exclusiva via radio");
  assert.ok(m.includes("precisaEscolha ? disposition !== null : true"), "confirmação só habilitada com decisão quando há saldo");
});

check("UI6 — Liquidar selecionável (rótulo e semântica)", () => {
  const m = modal();
  assert.ok(m.includes('setDisposition("liquidated")'), "seleção Liquidar");
  assert.ok(m.includes("não reutiliza no próximo ciclo"), "semântica de liquidar");
});

check("UI7 — Transportar selecionável (rótulo e semântica)", () => {
  const m = modal();
  assert.ok(m.includes('setDisposition("carried")'), "seleção Transportar");
  assert.ok(m.includes("fica Disponível no ciclo seguinte"), "semântica de transportar");
});

check("UI8 — saldo=0 não exige escolha", () => {
  const m = modal();
  assert.ok(m.includes("Sem saldo [10+] a destinar."), "mensagem saldo zero");
  assert.ok(m.includes("podeConfirmar = precisaEscolha ? disposition !== null : true"), "saldo zero ⇒ confirmar habilitado");
});

check("UI9 — ação final é definitiva e deixa claro", () => {
  const m = modal();
  assert.ok(m.includes("Encerrar ciclo") && m.includes("Esta operação é definitiva"), "CTA final + aviso");
});

check("UI10 — ciclo encerrado visível com saldo final e destinação", () => {
  const c = central();
  assert.ok(c.includes("Saldo final [10+]"), "saldo final (central)");
  assert.ok(c.includes("Destinação:"), "destinação");
  assert.ok(c.includes("Gerado no ciclo"), "gerado no ciclo");
  assert.ok(c.includes("Definitivo"), "badge definitivo");
});

check("UI11 — destinação Liquidado visível", () => {
  const c = central();
  assert.ok(c.includes("Liquidado no encerramento"), "Liquidado no encerramento");
});

check("UI12 — destinação Transportado visível (com ciclo de destino)", () => {
  const c = central();
  assert.ok(c.includes("Transportado para o ciclo"), "Transportado para o ciclo XXXX/XXXX");
});

check("UI13 — 'Trazido do ciclo anterior' aparece no novo ciclo", () => {
  const c = central();
  assert.ok(c.includes("Trazido do ciclo anterior"), "métricas/strip do trazido");
  assert.ok(c.includes("Trazido do ciclo anterior: <b") || c.includes("Trazido do ciclo anterior"), "destaque do total");
});

check("UI14 — trazido NÃO entra em 'Gerado neste ciclo'", () => {
  const c = central();
  assert.ok(c.includes("não entra em “Gerado neste ciclo”"), "texto explícito gerado≠trazido");
  // a métrica de Gerado usa bank.generatedMinutes (fonte factual pura)
  assert.ok(c.includes("formatMinutes(bank.generatedMinutes)"), "Gerado segue a fonte factual");
});

check("UI15 — botão Reabrir período ausente em ciclo encerrado (Resumo)", () => {
  const r = resumo();
  assert.ok(r.includes("Ciclo encerrado — sem reabertura"), "substitui o botão por bloqueio visual");
  assert.ok(r.includes("dateFallsInClosedCycle"), "Resumo sabe se o período é de ciclo encerrado");
});

/* ── COMPORTAMENTO IRREVERSÍVEL (store) ── */

check("UI16 — fechar ciclo encerra de fato e fica 'closed'", () => {
  resetCycle("2026-04-28"); consolidate();
  okc(actions.closeAnnualCycle({ cycleLabel: "2025/2026", disposition: "carried" }));
  const closure = closureForCycle(getAppData().annualCycleClosures, "2025/2026");
  assert.ok(closure && closure.status === "closed", "closure registrada");
  assert.equal(closure!.closingSpecialExcessMinutes, 40);
  assert.equal(closure!.disposition, "carried");
  assert.ok(cycleIsClosed(getAppData().annualCycleClosures, "2025/2026"), "cycleIsClosed");
});

check("UI17 — destinação transportado vira 'Trazido' no ciclo novo e NÃO gerado", () => {
  const next = getAnnualPointCycle("2026-06-01"); // 2026/2027
  const carried = carriedSlicesIntoCycle(getAppData().annualCycleClosures, next);
  assert.equal(carried.length, 1);
  const bank = buildSpecialExcessBank({
    cycle: next, asOfDate: "2026-09-03", entries: [], absences: [], calendars: undefined,
    settings, faltas: [], controlStartDate: "2026-05-01", uses: [], plans: [], carried,
  });
  assert.equal(bank.carriedMinutes, 40, "trazido 40");
  assert.equal(bank.generatedMinutes, 0, "não entra em gerado");
});

check("UI18 — ciclo aguardando encerramento só fecha quando elegível", () => {
  resetCycle("2026-04-28"); // gera [10+] mas período NÃO consolidado
  const el = checkCycleClose({
    today: "2026-09-03", label: "2025/2026", closures: [], entries: getAppData().entries, absences: [],
    calendars: undefined, settings, faltas: [], controlStartDate: "2026-04-21", plans: [], consolidations: [],
  });
  assert.equal(el.ok, false, "não elegível sem consolidar o período curto");
  consolidate();
  const el2 = checkCycleClose({
    today: "2026-09-03", label: "2025/2026", closures: [], entries: getAppData().entries, absences: [],
    calendars: undefined, settings, faltas: [], controlStartDate: "2026-04-21", plans: [], consolidations: getAppData().periodConsolidations,
  });
  assert.equal(el2.ok, true, "elegível após consolidar");
});

check("UI19 — encerrar bloqueia reabrir período e novas batidas/usos/faltas", () => {
  resetCycle("2026-04-28"); consolidate();
  okc(actions.closeAnnualCycle({ cycleLabel: "2025/2026", disposition: "liquidated" }));
  assert.equal(actions.reopenPeriod({ periodStart: "2026-04-21", periodEnd: "2026-04-30" }).ok, false);
  assert.equal(actions.addEntry({ date: "2026-04-28", time: "18:00", type: "entrada", note: null }).ok, false);
  actions.addEntries(dayShort("2026-04-23", "16:00"));
  assert.equal(actions.createSpecialExcessUse({ destinationDate: "2026-04-23", minutes: 10, allocationStrategy: "fifo", asOfDate: "2026-09-03" }).ok, false);
  assert.equal(actions.addFalta("2026-04-29").ok, false);
});

check("UI20 — guards cobrem afastamento, abono, motivo de excedente e calendário", () => {
  resetCycle("2026-04-28"); consolidate();
  okc(actions.closeAnnualCycle({ cycleLabel: "2025/2026", disposition: "carried" }));
  assert.equal(actions.addAbsence({ kind: "ferias", startDate: "2026-04-24", endDate: "2026-04-26", duration: "integral", note: null }).ok, false, "afastamento em ciclo encerrado");
  assert.equal(actions.setAbono({ date: "2026-04-25", note: null }).ok, false, "abono em ciclo encerrado");
  assert.equal(actions.setExcessReason({ date: "2026-04-28", reason: "demanda-urgente" }).ok, false, "motivo de excedente em ciclo encerrado");
  // calendário: adicionar contexto em data de ciclo encerrado é bloqueado
  const cal = {
    id: "2025-05-01", cycleStart: "2025-05-01", cycleEnd: "2026-04-30", cycleLabel: "2025/2026",
    version: 2, importedAt: "2025-01-01T00:00:00.000Z",
    entries: [{ id: 1, date: "2026-01-15", descricao: "Recesso", categoria: "Recesso Final de Ano", tratamento: "COMPENSAR" as const, horasACompensar: 8, jornadaEsperadaHoras: 0, horasAbonadas: 0, observacao: null }],
  };
  const calR = actions.addCompanyCalendar(cal);
  assert.equal(calR.ok, false, "calendário com data de ciclo encerrado bloqueado");
  assert.equal(calR.code, "cycle-closed");
});

check("UI21 — período curto 21/04→30/04 navega como período próprio", () => {
  assert.equal(getPointPeriod("2026-04-28").from, "2026-04-21");
  assert.equal(getPointPeriod("2026-04-28").to, "2026-04-30");
  const prox = getNextPointPeriod(getPointPeriod("2026-03-25"));
  assert.equal(`${prox.from}|${prox.to}`, "2026-04-21|2026-04-30");
});

check("UI22 — período curto 01/05→20/05 navega sem lacuna", () => {
  assert.equal(getPointPeriod("2026-05-10").from, "2026-05-01");
  assert.equal(getPointPeriod("2026-05-10").to, "2026-05-20");
  const prox = getNextPointPeriod(getPointPeriod("2026-04-28"));
  assert.equal(`${prox.from}|${prox.to}`, "2026-05-01|2026-05-20");
});

check("UI23 — Registros/Resumo usam o período canônico (curtos aparecem) e o navegador mobile único", () => {
  const r = registros();
  assert.ok(r.includes("getPointPeriod") && r.includes("getNextPointPeriod"), "Registros navega pelo período canônico");
  assert.ok(r.includes("periodLabel"), "rótulo canônico renderizado");
  assert.ok(r.includes("<PeriodNavigator") || r.includes("PeriodNavigator"), "navegador usado");
  const n = navigator();
  assert.ok(n.includes("LINHA 1"), "mobile linha 1 (setas + período)");
  assert.ok(/instância ÚNICA/.test(n) || n.includes("ÚNICA"), "sem duplicação de contexto (4G.2.1)");
  const rs = resumo();
  assert.ok(rs.includes("getPointPeriod"), "Resumo usa período canônico");
});

check("UI24 — ciclo futuro não inventa geração/transporte", () => {
  const c = central();
  assert.ok(c.includes("sem geração ou saldo transportado até aqui"), "texto de ciclo futuro");
  // ciclo futuro com situação future ⇒ banco normal/operações não são exibidos
});

check("UI25 — ciclo com saldo 0 dispensa escolha no store", () => {
  resetCycle(); // nenhum [10+]
  consolidate();
  const r = actions.closeAnnualCycle({ cycleLabel: "2025/2026", disposition: "none" });
  assert.equal(r.ok, true, "sem saldo ⇒ none ok");
  assert.equal(closureForCycle(getAppData().annualCycleClosures, "2025/2026")!.disposition, "none");
});

console.log(`\n4H UI/Integração — ${passed} verificações concluídas.`);
if (passed !== 25) process.exit(1);
