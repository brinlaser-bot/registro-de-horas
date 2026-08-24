/**
 * VERIFICAÇÃO — RODADA DE AJUSTE: EXPERIÊNCIA DE ANIVERSÁRIO + ABONO (testes 1–39)
 *
 * - Banner da Visão geral passa a ser SOMENTE felicitação (sem assunto
 *   funcional/profissional, sem CTA);
 * - Configurações: "Data de nascimento" limpa; card do Abono sem textos
 *   técnicos; Definir/Alterar acontecem EM Configurações (modal próprio) —
 *   nunca mais redirecionando para Férias e Afastamentos;
 * - Férias e Afastamentos: Abono sai do "Novo evento" (somente histórico e
 *   sem lápis de edição), mantendo MESMO evento do store;
 * - validação de conflitos IMEDIATA compartilhando a verdade central
 *   (abonoDayDecision + validateAbsence) — nada duplicado;
 * - regra especial: o Abono pode SUBSTITUIR um "Afastamento acordado —
 *   compensar posteriormente", nunca silenciosamente: confirmação explícita,
 *   compensações pendentes vinculadas são canceladas junto, compensação
 *   concluída vinculada BLOQUEIA (histórico preservado).
 *
 * Executar: npx tsx tests/verify-abono-ux.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  abonoDayDecision,
  abonoInCycle,
  isBirthdayToday,
  suggestedAbonoDate,
} from "../src/lib/absences.ts";
import {
  abonoDateAdvisory,
  buildCompanyCalendar,
  companyDayContext,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { activeAcordos, acordoLinkedComps, buildDebtDays } from "../src/lib/debt.ts";
import { effectiveFaltas } from "../src/lib/faltas.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import { buildStackedPeriodData } from "../src/components/stacked-period-chart.tsx";
import { actions, getAppData } from "../src/lib/store.ts";
import type { User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste Silva", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
  birthDate: null,
};

const readFix = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(readFix("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(readFix("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

const TODAY = "2026-08-23";
const BOUNDS = annualCycleBounds(getAnnualPointCycle(TODAY));

const reset = (u: User = user) =>
  actions.replaceAll({ user: u, entries: [], compensations: [], absences: [], companyCalendars: both, faltas: [] });

const srcOf = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const acordoIntegral = (date: string) => ({
  kind: "acordado" as const, startDate: date, endDate: date,
  duration: "integral" as const, treatment: "compensar" as const, note: null,
});

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ══ CONFIGURAÇÕES (1–6) ══════════════════════════════════════════════ */
check("1-3. Configurações mostra apenas \"Data de nascimento\" — sem \"(opcional)\" e sem texto explicativo", () => {
  const src = srcOf("src/app/(app)/configuracoes/page.tsx");
  assert.ok(src.includes('label="Data de nascimento"'));
  assert.ok(!src.includes("Data de nascimento (opcional)"), "sem \"(opcional)\"");
  assert.ok(!src.includes("Usada para a felicitação do dia"), "sem texto explicativo abaixo do campo");
  assert.ok(!src.includes("sugerir a data do Abono"), "sem referência funcional ao Abono na legenda");
});

check("4-6. Card do Abono: \"Ainda não definido\" / \"Definido para DD/MM/AAAA\" — sem frase de regra interna", () => {
  const src = srcOf("src/app/(app)/configuracoes/page.tsx");
  assert.ok(src.includes("Ainda não definido para este ciclo anual."));
  assert.ok(src.includes("Definido para {formatDateBR(abonoDoCiclo.startDate)} 🎂"));
  assert.ok(
    !src.includes("um por ciclo anual · dia integral · jornada 0 · saldo neutro"),
    "regra interna não aparece ao usuário",
  );
  assert.ok(!src.includes("jornada 0 · saldo neutro"), "sem outro texto técnico no lugar");
});

/* ══ BANNER (7–11) ═════════════════════════════════════════════════════ */
check("7-10. Banner: aparece só no aniversário; texto é SOMENTE felicitação (sem assunto funcional)", () => {
  assert.equal(isBirthdayToday("1989-08-23", "2026-08-23"), true, "hoje → banner");
  assert.equal(isBirthdayToday("1989-08-24", "2026-08-23"), false, "outro dia → sem banner");
  const src = srcOf("src/app/(app)/page.tsx");
  const start = src.indexOf("<div className=\"flex items-center gap-3 rounded-2xl border border-amber-200");
  const end = src.indexOf("{/* Cabeçalho */}");
  assert.ok(start > 0 && end > start, "bloco do banner localizado");
  const banner = src.slice(start, end);
  assert.ok(banner.includes("Feliz aniversário, {firstName}! 🎉"), "felicitação com o primeiro nome");
  assert.ok(banner.includes("Que seu novo ciclo seja repleto de alegrias, saúde e boas realizações."));
  for (const proibido of ["Abono", "Férias", "trabalho", "horas", "saldo", "jornada", "benefício", "configuraç"]) {
    assert.ok(!banner.includes(proibido), `banner não menciona \"${proibido}\"`);
  }
});

check("11. Banner segue sem efeito em cálculos (dívidas idênticas com/sem nascimento)", () => {
  const calc = () => {
    const st = getAppData();
    return buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, st.companyCalendars, effectiveFaltas(st.faltas, TODAY));
  };
  reset(user);
  actions.addEntry({ date: "2026-08-20", time: "08:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-20", time: "17:00", type: "saida", note: null });
  const before = calc();
  reset({ ...user, birthDate: "1989-08-23" });
  actions.addEntry({ date: "2026-08-20", time: "08:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-20", time: "17:00", type: "saida", note: null });
  assert.ok(isBirthdayToday(getAppData().user.birthDate, TODAY));
  assert.deepEqual(calc(), before);
  reset();
});

/* ══ MODAL EM CONFIGURAÇÕES (12–17) ═══════════════════════════════════ */
check("12-13. Definir/Alterar abre modal PRÓPRIO em Configurações — nunca navega para /ferias", () => {
  const cfg = srcOf("src/app/(app)/configuracoes/page.tsx");
  assert.ok(cfg.includes("AbonoModal"), "modal próprio montado na página");
  assert.ok(cfg.includes("setAbonoOpen(true)"), "botões abrem o modal");
  assert.ok(!cfg.includes('href="/ferias"'), "nenhum redirecionamento para Férias e Afastamentos");
});

check("14-15. Modal contém apenas \"Data do Abono\" (+ Observação) — sem Data final/Tipo/Duração", () => {
  const modal = srcOf("src/components/abono-modal.tsx");
  assert.ok(modal.includes('label="Data do Abono"'));
  assert.ok(modal.includes("Definir Abono de aniversário"));
  assert.ok(modal.includes("Alterar Abono de aniversário"));
  for (const ausente of ["Data final", "Data inicial", 'label="Tipo"', 'label="Duração"', "Dia inteiro"]) {
    assert.ok(!modal.includes(ausente), `modal não mostra \"${ausente}\"`);
  }
});

check("16. Nascimento 23/08 + ciclo 2026/2027 → sugestão 23/08/2026 (10/01 → 10/01/2027)", () => {
  assert.equal(suggestedAbonoDate("1989-08-23", "2026-08-23"), "2026-08-23");
  assert.equal(suggestedAbonoDate("1989-01-10", "2026-08-23"), "2027-01-10");
});

check("17. Escolha livre: usuário define 02/09/2026 (longe do aniversário) — permitido", () => {
  reset({ ...user, birthDate: "1989-08-23" });
  const res = actions.setAbono({ date: "2026-09-02", note: null });
  assert.equal(res.ok, true);
  assert.equal(getAppData().absences[0].startDate, "2026-09-02");
  reset();
});

/* ══ UM POR CICLO (18–21) ══════════════════════════════════════════════ */
check("18-20. Definir cria UM evento; Alterar edita o MESMO id — nunca cria segundo Abono", () => {
  reset();
  assert.equal(actions.setAbono({ date: "2026-08-28", note: null }).ok, true);
  const id = getAppData().absences[0].id;
  assert.equal(actions.setAbono({ date: "2026-09-02", note: "teste" }).ok, true, "Alterar");
  const abs = getAppData().absences;
  assert.equal(abs.length, 1, "nenhum segundo Abono criado");
  assert.equal(abs[0].id, id, "mesmo evento (id preservado)");
  assert.equal(abs[0].startDate, "2026-09-02");
  assert.equal(abs[0].note, "teste");
  reset();
});

check("21. A regra interna segue ativa: store recusa duplicidade acidental (addAbsence direto)", () => {
  reset();
  assert.equal(actions.setAbono({ date: "2026-08-28", note: null }).ok, true);
  const res = actions.addAbsence({ kind: "abono", startDate: "2026-11-10", endDate: "2026-11-10", duration: "integral", note: null });
  assert.equal(res.ok, false, "proteção interna independente da UI");
  assert.match(res.error ?? "", /Já existe um Abono de aniversário neste ciclo anual/);
  assert.equal(getAppData().absences.filter((a) => a.kind === "abono").length, 1);
  reset();
});

/* ══ FÉRIAS E AFASTAMENTOS (22–24) ════════════════════════════════════ */
check("22. \"Abono de aniversário\" NÃO está mais no select Novo evento → Tipo", () => {
  const modal = srcOf("src/components/absence-modal.tsx");
  assert.ok(!modal.includes('value: "abono"'), "tipo removido das opções");
  assert.ok(!modal.includes("Abono de aniversário 🎂\" <"), "label removida");
});

check("23-24. Abono existente continua no histórico de Férias e Afastamentos, SEM lápis de edição", () => {
  const ferias = srcOf("src/app/(app)/ferias/page.tsx");
  assert.ok(ferias.includes('a.kind === "abono"'), "card/ícone do Abono preservado (histórico)");
  assert.ok(ferias.includes("<Cake size={20} />"), "ícone 🎂 preservado");
  assert.ok(ferias.includes('a.kind !== "abono"'), "edição oculta para o Abono nessa tela");
  reset();
  assert.equal(actions.setAbono({ date: "2026-09-02", note: null }).ok, true);
  assert.equal(getAppData().absences[0].kind, "abono", "evento segue no MESMO store do histórico");
  reset();
});

/* ══ CONFLITOS IMEDIATOS (25–31) ══════════════════════════════════════ */
check("25. sábado/domingo: decisão imediata = ok + AVISO (não bloqueia; store aceita)", () => {
  reset();
  assert.equal(abonoDayDecision("2026-08-29", { absences: [], entries: [], faltas: [] }).status, "ok");
  assert.match(abonoDateAdvisory("2026-08-29", both) ?? "", /folga e não possui jornada regular/);
  assert.match(abonoDateAdvisory("2026-08-30", both) ?? "", /folga e não possui jornada regular/);
  assert.equal(actions.setAbono({ date: "2026-08-29", note: null }).ok, true, "aviso não bloqueia");
  reset();
});

check("26. feriado abonado 07/09: AVISO imediato; calendário nunca é alterado", () => {
  reset();
  assert.equal(abonoDayDecision("2026-09-07", { absences: [], entries: [], faltas: [] }).status, "ok");
  assert.match(abonoDateAdvisory("2026-09-07", both) ?? "", /já está abonada pelo calendário/);
  assert.equal(actions.setAbono({ date: "2026-09-07", note: null }).ok, true);
  assert.equal(parseCompanyCalendarCsv(readFix("calendario-ficticio-2026-2027.csv"), settings).entries.length > 0, true);
  reset();
});

check("27. folga a compensar 25/08: AVISO imediato e a obrigação permanece INTACTA (8h)", () => {
  reset();
  assert.match(abonoDateAdvisory("2026-08-25", both) ?? "", /abono NÃO abate a obrigação/);
  assert.equal(actions.setAbono({ date: "2026-08-25", note: null }).ok, true);
  const st = getAppData();
  const debts = buildDebtDays(st.entries, [], settings, BOUNDS, st.absences, both);
  assert.equal(debts.find((d) => d.date === "2026-08-25" && d.kind === "calendario")?.debtMinutes, 480);
  reset();
});

check("28. Férias na data: conflito IMEDIATO + save bloqueado (nunca substitui Férias)", () => {
  reset();
  actions.addAbsence({ kind: "ferias", startDate: "2026-08-17", endDate: "2026-08-21", duration: "integral", note: null });
  const d = abonoDayDecision("2026-08-17", getAppData());
  assert.equal(d.status, "blocked");
  if (d.status === "blocked") {
    assert.equal(d.code, "overlap");
    assert.equal(d.error, "Esta data já está coberta por Férias. Escolha outra data para o Abono de aniversário.");
  }
  const res = actions.setAbono({ date: "2026-08-17", note: null });
  assert.equal(res.ok, false);
  assert.equal(res.code, "overlap");
  assert.equal(getAppData().absences.filter((a) => a.kind === "ferias").length, 1, "Férias intactas");
  reset();
});

check("29. Saúde integral na data: conflito IMEDIATO + save bloqueado", () => {
  reset();
  actions.addAbsence({ kind: "saude", startDate: "2026-08-17", endDate: "2026-08-17", duration: "integral", medicalCert: true, note: null });
  const d = abonoDayDecision("2026-08-17", getAppData());
  assert.equal(d.status, "blocked");
  if (d.status === "blocked") assert.match(d.error, /coberta por Afastamento por saúde/);
  assert.equal(actions.setAbono({ date: "2026-08-17", note: null }).ok, false);
  reset();
});

check("30. Falta (ou prevista) na data: conflito IMEDIATO — nada é convertido/apagado em silêncio", () => {
  reset();
  actions.addFalta("2026-08-18");
  actions.addFalta("2026-08-28");
  for (const date of ["2026-08-18", "2026-08-28"]) {
    const d = abonoDayDecision(date, getAppData());
    assert.equal(d.status, "blocked");
    if (d.status === "blocked") {
      assert.equal(d.code, "falta");
      assert.match(d.error, /possui uma falta registrada/);
    }
    assert.equal(actions.setAbono({ date, note: null }).ok, false);
  }
  assert.equal(getAppData().faltas.length, 2, "faltas preservadas");
  reset();
});

check("31. Batidas na data: conflito IMEDIATO — save bloqueado, registros intactos", () => {
  reset();
  actions.addEntry({ date: "2026-08-20", time: "08:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-20", time: "12:00", type: "saida", note: null });
  const d = abonoDayDecision("2026-08-20", getAppData());
  assert.equal(d.status, "blocked");
  if (d.status === "blocked") {
    assert.equal(d.code, "punches");
    assert.equal(d.error, "Esta data já possui registros de horário. Resolva os registros antes de aplicar o Abono de aniversário.");
  }
  assert.equal(actions.setAbono({ date: "2026-08-20", note: null }).ok, false);
  assert.equal(getAppData().entries.filter((e) => e.date === "2026-08-20").length, 2, "batidas preservadas");
  reset();
});

/* ══ REGRA ESPECIAL — ACORDO A COMPENSAR (32–36) ══════════════════════ */
check("32. acordo 8h sem compensações: decisão = SUBSTITUÍVEL, mas save sem confirmação é recusado", () => {
  reset();
  actions.addAbsence(acordoIntegral("2026-08-13"));
  const d = abonoDayDecision("2026-08-13", getAppData());
  assert.equal(d.status, "replace-acordo");
  if (d.status === "replace-acordo") assert.equal(d.acordo.startDate, "2026-08-13");
  const res = actions.setAbono({ date: "2026-08-13", note: null });
  assert.equal(res.ok, false, "nunca silenciosamente — exige confirmação explícita");
  assert.equal(res.code, "confirm-replace");
  assert.equal(
    activeAcordos([], [], settings, BOUNDS, getAppData().absences).length,
    1,
    "acordo intacto (nada foi removido sem confirmação)",
  );
});

check("33. confirmada a substituição: acordo + obrigação somem; Abono criado; base/saldo/déficit = 0", () => {
  reset();
  actions.addAbsence(acordoIntegral("2026-08-13"));
  assert.equal(activeAcordos([], [], settings, BOUNDS, getAppData().absences).length, 1);
  const res = actions.setAbono({ date: "2026-08-13", note: null, replaceAcordo: true });
  assert.equal(res.ok, true);
  const st = getAppData();
  assert.equal(st.absences.some((a) => a.kind === "acordado"), false, "acordo removido");
  assert.equal(st.absences.length, 1, "apenas o Abono");
  assert.equal(st.absences[0].kind, "abono");
  assert.equal(activeAcordos(st.entries, st.compensations, settings, BOUNDS, st.absences).length, 0, "obrigação deixou de existir");
  const cctx = companyDayContext("2026-08-13", st.entries, st.absences, both, settings);
  assert.equal(cctx.effectiveExpected, 0, "base 0");
  assert.equal(cctx.adjustedBalance, 0, "saldo 0");
  assert.equal(cctx.adjustedDeficit, 0, "déficit 0");
  const debts = buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, both);
  assert.equal(debts.find((d) => d.date === "2026-08-13"), undefined, "sem acordo, sem déficit, sem falta");
  reset();
});

check("34/36. acordo com compensação PENDENTE: é cancelada junto; compensação de OUTRA origem intacta", () => {
  reset();
  actions.addAbsence(acordoIntegral("2026-08-13"));
  // Compensação vinculada ao acordo (pendente)
  const cAcordo = actions.addComp({ sourceDate: "2026-08-13", targetDate: "2026-08-14", minutes: 120, note: null, kind: "acordo" });
  assert.equal(cAcordo.ok, true);
  // Compensação de déficit comum (outra origem) — nunca pode ser tocada
  actions.addEntry({ date: "2026-08-24", time: "08:00", type: "entrada", note: null });
  actions.addEntry({ date: "2026-08-24", time: "12:00", type: "saida", note: null });
  const cDef = actions.addComp({ sourceDate: "2026-08-24", targetDate: "2026-08-26", minutes: 60, note: null, kind: "deficit" });
  assert.equal(cDef.ok, true);
  const linked = acordoLinkedComps(getAppData().compensations, getAppData().absences[0]);
  assert.equal(linked.length, 1, "apenas a do acordo está vinculada");
  const res = actions.setAbono({ date: "2026-08-13", note: null, replaceAcordo: true });
  assert.equal(res.ok, true);
  const comps = getAppData().compensations;
  assert.equal(comps.find((c) => c.sourceDate === "2026-08-13")?.status, "cancelada", "pendente do acordo cancelada junto");
  assert.equal(comps.find((c) => c.sourceDate === "2026-08-24")?.status, "pendente", "compensação de déficit comum INTACTA");
  reset();
});

check("35. acordo com compensação CONCLUÍDA: substituição BLOQUEADA — histórico preservado", () => {
  reset();
  actions.addAbsence(acordoIntegral("2026-08-13"));
  const c = actions.addComp({ sourceDate: "2026-08-13", targetDate: "2026-08-14", minutes: 120, note: null, kind: "acordo" });
  assert.equal(c.ok, true);
  const compId = getAppData().compensations[0].id;
  actions.updateComp(compId, { status: "concluida" });
  const res = actions.setAbono({ date: "2026-08-13", note: null, replaceAcordo: true });
  assert.equal(res.ok, false);
  assert.equal(res.code, "concluded-history");
  assert.match(res.error ?? "", /já possui horas compensadas concluídas/);
  const st = getAppData();
  assert.equal(st.absences.some((a) => a.kind === "acordado"), true, "acordo preservado");
  assert.equal(st.absences.some((a) => a.kind === "abono"), false, "nenhum Abono criado");
  assert.equal(st.compensations[0].status, "concluida", "compensação concluída NUNCA apagada");
  reset();
});

/* ══ REGISTROS / RESUMO (37–39) ═══════════════════════════════════════ */
check("37-39. Abono neutro: Registros/Resumo 0/0/+0; gráfico identifica \"abono-aniversario\"", () => {
  reset();
  assert.equal(actions.setAbono({ date: "2026-09-02", note: null }).ok, true);
  const st = getAppData();
  // Registros (view central): Trabalhado 0 / Base 0 / Saldo +0 / No ponto 0
  const cctx = companyDayContext("2026-09-02", st.entries, st.absences, both, settings);
  assert.equal(cctx.effectiveExpected, 0);
  assert.equal(cctx.adjustedBalance, 0);
  assert.equal(cctx.adjustedDeficit, 0);
  assert.equal(cctx.displayDay.workedMinutes, 0);
  assert.equal(cctx.displayDay.registrableMinutes, 0);
  // Resumo do período: jornada 0, saldo +0, totais sem impacto
  const debts = buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, both);
  assert.equal(debts.find((d) => d.date === "2026-09-02"), undefined);
  // Gráfico/legenda
  const data = buildStackedPeriodData({
    entries: st.entries, compensations: [], absences: st.absences, companyCalendars: both,
    settings, period: { from: "2026-08-21", to: "2026-09-20" }, faltas: [], today: TODAY,
  });
  const d = data.find((x) => x.date === "2026-09-02");
  assert.equal(d?.marker, "abono-aniversario");
  assert.equal(d?.markerLabel, "Abono de aniversário");
  assert.equal(d?.regularBalance, 0);
  reset();
});

console.log(`\n✅ ${passed} verificações passaram: 1–39 (banner · Configurações · modal · um por ciclo · histórico · conflitos · substituição do acordo · Registros/Resumo)`);
