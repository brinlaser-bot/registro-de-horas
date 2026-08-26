/**
 * VERIFICAÇÃO — ABONO DE ANIVERSÁRIO + DATA DE NASCIMENTO/BANNER + FALTA NO RESUMO
 * (rodada consolidada, testes P.12–P.31 + regras duras do novo tipo)
 *
 *  F/N) Falta identificada no Resumo e no gráfico compartilhado: efetiva (−8h)
 *       contamina o período; prevista não contamina.
 *  G/H) Data de nascimento persistida (backup retrocompat); banner do dia é
 *       SOMENTE VISUAL (nunca entra em cálculo).
 *  I–J) Novo tipo "Abono de aniversário": identidade própria, sempre um dia
 *       inteiro, jornada 0/saldo 0/déficit 0, sugestão = aniversário do ciclo
 *       (escolha LIVRE — distância nunca bloqueia), UM por ciclo anual.
 *  K)   Conflitos: férias/saúde/acordo/falta/batidas = bloqueio; fim de semana,
 *       feriado abonado e folga a compensar = aviso NÃO bloqueante (o abono
 *       NUNCA abate obrigação de calendário).
 *
 * Executar: npx tsx tests/verify-abono-aniversario.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  abonoInCycle,
  isBirthdayToday,
  suggestedAbonoDate,
  validateAbsence,
} from "../src/lib/absences.ts";
import {
  abonoDateAdvisory,
  buildCompanyCalendar,
  companyDayContext,
  entryOnDate,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { activeAcordos, buildDebtDays } from "../src/lib/debt.ts";
import { countEffectiveFaltas, effectiveFaltas } from "../src/lib/faltas.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import { buildStackedPeriodData } from "../src/components/stacked-period-chart.tsx";
import { BACKUP_VERSION, buildBackupPayload, parseBackup } from "../src/lib/backup.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import type { Falta, User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
  birthDate: null,
};

let nextId = 100;
const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

const TODAY = "2026-08-23"; // domingo
const BOUNDS = annualCycleBounds(getAnnualPointCycle(TODAY)); // 2026-05-01 → 2027-04-30
const PERIOD_WIDE = { from: "2026-07-21", to: "2026-09-20" };

const reset = (u: User = user) =>
  actions.replaceAll({ user: u, entries: [], compensations: [], absences: [], companyCalendars: both, faltas: [] });

const abonoDraft = (date: string) => ({
  kind: "abono" as const, startDate: date, endDate: date, duration: "integral" as const, note: null,
});

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── P.12  FALTA EFETIVA identificada: −8h no período + marcador no gráfico ─ */
check("P.12. falta efetiva 18/08: saldo do dia −8h (entra no período) + marcador \"Falta\" no gráfico", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-18").ok, true);
  const st = getAppData();
  // Resumo: contribuição do dia ao Saldo do período = −jornada efetiva (−8h)
  const cctx = companyDayContext("2026-08-18", st.entries, st.absences, both, settings);
  assert.equal(cctx.adjustedBalance, -480, "efetiva contamina o saldo (−8h)");
  assert.equal(countEffectiveFaltas(st.faltas, BOUNDS, TODAY), 1);
  // Gráfico compartilhado: marcador próprio na data
  const data = buildStackedPeriodData({
    entries: st.entries, compensations: st.compensations, absences: st.absences,
    companyCalendars: both, settings, period: PERIOD_WIDE, faltas: st.faltas, today: TODAY,
  });
  const d = data.find((x) => x.date === "2026-08-18");
  assert.ok(d);
  assert.equal(d.marker, "falta");
  assert.equal(d.markerLabel, "Falta");
});

/* ── P.13  FALTA PREVISTA: sem marcador, sem dívida, sem saldo ────────────── */
check("P.13. falta prevista 28/08 (futura): não afeta saldo — sem dívida, sem marcador", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-28").ok, true);
  const st = getAppData();
  assert.equal(effectiveFaltas(st.faltas, TODAY).length, 0);
  assert.equal(countEffectiveFaltas(st.faltas, BOUNDS, TODAY), 0);
  const debts = buildDebtDays(st.entries, [], settings, BOUNDS, st.absences, both, effectiveFaltas(st.faltas, TODAY));
  assert.equal(debts.find((d) => d.date === "2026-08-28"), undefined);
  const data = buildStackedPeriodData({
    entries: st.entries, compensations: [], absences: [], companyCalendars: both,
    settings, period: PERIOD_WIDE, faltas: st.faltas, today: TODAY,
  });
  const d = data.find((x) => x.date === "2026-08-28");
  assert.ok(d);
  assert.notEqual(d.marker, "falta", "prevista não ganha marcador (não contamina)");
});

/* ── P.14  BACKUP: birthDate + Abono persistem; legado sem o campo funciona ─ */
check("P.14. backup v3: persiste Data de nascimento e evento Abono; v1/v2/v3 antigos seguem válidos", () => {
  const uBirth: User = { ...user, birthDate: "1990-08-15" };
  reset(uBirth);
  assert.equal(actions.addAbsence(abonoDraft("2026-09-15")).ok, true);
  assert.equal(BACKUP_VERSION, 3, "sem nova versão (campo opcional)");
  const payload = buildBackupPayload(getAppData());
  assert.equal(payload.user.birthDate, "1990-08-15");
  const parsed = parseBackup(JSON.stringify(payload));
  assert.equal(parsed.ok, true, "round-trip válido (kind abono aceito)");
  if (parsed.ok) {
    assert.equal(parsed.backup.user.birthDate, "1990-08-15");
    assert.equal(parsed.backup.absences.length, 1);
    assert.equal(parsed.backup.absences[0].kind, "abono");
  }
  // Legado: backup sem birthDate e sem faltas → continua importando
  const legacy = JSON.stringify({
    version: 2, exportedAt: "2025-01-01T00:00:00.000Z",
    user: { name: "Antigo", email: "a@a.com", workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true },
    entries: [], compensations: [], absences: [],
  });
  const parsedLegacy = parseBackup(legacy);
  assert.equal(parsedLegacy.ok, true);
  if (parsedLegacy.ok) assert.equal(parsedLegacy.backup.user.birthDate, undefined);
  reset();
});

/* ── P.15/P.16  BANNER: só no dia+mês (data local) ───────────────────────── */
check("P.15/P.16. banner de aniversário: hoje (23/08) sim; amanhã (24/08) não; sem nascimento, nunca", () => {
  assert.equal(isBirthdayToday("1990-08-23", "2026-08-23"), true, "mesmo dia+mês → banner");
  assert.equal(isBirthdayToday("1985-08-23", "2026-08-23"), true, "ignora o ano");
  assert.equal(isBirthdayToday("1990-08-24", "2026-08-23"), false, "amanhã ainda não é");
  assert.equal(isBirthdayToday("1990-08-23", "2026-08-24"), false, "ontem já passou");
  assert.equal(isBirthdayToday(null, "2026-08-23"), false);
  assert.equal(isBirthdayToday(undefined, "2026-08-23"), false);
});

/* ── P.17  BANNER não altera nenhum cálculo ──────────────────────────────── */
check("P.17. aniversário hoje NÃO altera cálculos: dívidas idênticas com/sem Data de nascimento", () => {
  const calc = () => {
    const st = getAppData();
    return buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, st.companyCalendars, effectiveFaltas(st.faltas, TODAY));
  };
  reset(user);
  assert.equal(actions.addFalta("2026-08-18").ok, true);
  const before = calc();
  // Mesmo conteúdo, agora aniversariando HOJE (23/08):
  reset({ ...user, birthDate: "1990-08-23" });
  assert.equal(actions.addFalta("2026-08-18").ok, true);
  assert.ok(isBirthdayToday(getAppData().user.birthDate, TODAY));
  assert.deepEqual(calc(), before, "banner é SOMENTE VISUAL — cálculo central intocado");
  reset();
});

/* ── P.18/P.19  SUGESTÃO = aniversário do ciclo anual em questão ─────────── */
check("P.18/P.19. sugestão do Abono: 15/08 + ciclo 2026/2027 → 15/08/2026; 10/01 → 10/01/2027", () => {
  assert.equal(suggestedAbonoDate("1990-08-15", "2026-08-23"), "2026-08-15");
  assert.equal(suggestedAbonoDate("1990-01-10", "2026-08-23"), "2027-01-10", "nasc. antes de maio cai no 2º ano do ciclo");
  assert.equal(suggestedAbonoDate("1990-04-30", "2026-08-23"), "2027-04-30", "limite do ciclo");
  assert.equal(suggestedAbonoDate("1990-05-01", "2026-08-23"), "2026-05-01", "início do ciclo");
  // Referência no ciclo 2025/2026 muda o ano resolvido
  assert.equal(suggestedAbonoDate("1990-08-15", "2025-11-20"), "2025-08-15");
  // 29/02: ano do ciclo não bissexto → 01/03
  assert.equal(suggestedAbonoDate("2000-02-29", "2026-08-23"), "2027-03-01", "2027 não é bissexto → 01/03");
  assert.equal(suggestedAbonoDate(null, "2026-08-23"), null);
});

/* ── P.20/P.21/P.22  data LIVRE: distância do aniversário nunca bloqueia ── */
check("P.20/P.21/P.22. abono em data livre do ciclo (≠ aniversário): criado; jornada 0 / saldo 0 / déficit 0 / sem dívida", () => {
  // Nascimento 15/08 → sugestão seria 15/08/2026, mas a escolha é LIVRE
  reset({ ...user, birthDate: "1990-08-15" });
  assert.equal(suggestedAbonoDate(getAppData().user.birthDate, TODAY), "2026-08-15", "a sugestão vem do ciclo…");
  assert.equal(actions.addAbsence(abonoDraft("2026-09-15")).ok, true, "…mas a escolha final é livre (terça, 15/09)");
  // Jornada/saldo/déficit do dia do abono = ZERO (e marcador próprio no gráfico)
  const st = getAppData();
  const cctx = companyDayContext("2026-09-15", st.entries, st.absences, both, settings);
  assert.equal(cctx.effectiveExpected, 0, "jornada 0");
  assert.equal(cctx.adjustedBalance, 0, "saldo 0 (neutro)");
  assert.equal(cctx.adjustedDeficit, 0, "déficit 0");
  assert.equal(cctx.ctx.acordoMinutes, 0, "sem obrigação");
  const debts = buildDebtDays(st.entries, st.compensations, settings, BOUNDS, st.absences, both);
  assert.equal(debts.find((d) => d.date === "2026-09-15"), undefined, "nada a compensar");
  const data = buildStackedPeriodData({
    entries: st.entries, compensations: [], absences: st.absences, companyCalendars: both,
    settings, period: PERIOD_WIDE, faltas: [], today: TODAY,
  });
  const d = data.find((x) => x.date === "2026-09-15");
  assert.equal(d?.marker, "abono-aniversario");
  assert.equal(d?.markerLabel, "Abono de aniversário");
  assert.equal(d?.regularBalance, undefined, "data futura: tooltip neutro (sem saldo factual)");
  // Editar para outra data livre do ciclo também é permitido (ex.: quarta 16/09)
  const id = st.absences[0].id;
  assert.equal(actions.updateAbsence(id, abonoDraft("2026-09-16")).ok, true);
  assert.equal(getAppData().absences[0].startDate, "2026-09-16");
  // Distância NUNCA bloqueia: mesmo nascido em 15/08, pode ser em maio (longe)
  assert.equal(actions.updateAbsence(id, abonoDraft("2026-05-05")).ok, true, "distância do aniversário não bloqueia");
  assert.equal(getAppData().absences[0].startDate, "2026-05-05");
  reset();
});

/* ── P.23  UM Abono por ciclo anual (não ano-calendário) ─────────────────── */
check("P.23. segundo Abono no MESMO ciclo anual: bloqueado, mostrando a data existente; outro ciclo é livre", () => {
  reset();
  assert.equal(actions.addAbsence(abonoDraft("2026-09-15")).ok, true);
  const res = actions.addAbsence(abonoDraft("2027-02-23")); // mesmo ciclo 2026/2027
  assert.equal(res.ok, false);
  assert.equal(res.code, "overlap");
  assert.match(res.error ?? "", /Já existe um Abono de aniversário neste ciclo anual, em 15\/09\/2026/);
  assert.match(res.error ?? "", /Altere o evento existente/);
  assert.equal(getAppData().absences.length, 1, "nenhum segundo Abono criado");
  // Mesmo ANO-CALENDÁRIO não conta — o limite é o CICLO anual (01/05 → 30/04)
  const prev = actions.addAbsence(abonoDraft("2026-04-13")); // ciclo 2025/2026
  assert.equal(prev.ok, true, "abril/2026 pertence ao ciclo anterior → livre");
  assert.equal(abonoInCycle(getAppData().absences, "2026-09-15")?.startDate, "2026-09-15");
  assert.equal(abonoInCycle(getAppData().absences, "2025-11-20")?.startDate, "2026-04-13");
  // Editar o existente movendo a data dentro do ciclo continua permitido
  const keep = getAppData().absences.find((a) => a.startDate === "2026-09-15")!;
  assert.equal(actions.updateAbsence(keep.id, abonoDraft("2026-10-05")).ok, true);
  reset();
});

/* ── P.24  sábado/domingo: AVISO não bloqueante ───────────────────────────── */
check("P.24. abono em sábado (29/08) ou domingo (30/08): aviso orientando outro dia; criação NÃO bloqueada", () => {
  reset();
  assert.match(abonoDateAdvisory("2026-08-29", both) ?? "", /folga e não possui jornada regular/);
  assert.match(abonoDateAdvisory("2026-08-30", both) ?? "", /folga e não possui jornada regular/);
  assert.equal(actions.addAbsence(abonoDraft("2026-08-29")).ok, true, "aviso não bloqueia (sábado)");
  actions.deleteAbsence(getAppData().absences[0].id);
  assert.equal(actions.addAbsence(abonoDraft("2026-08-30")).ok, true, "aviso não bloqueia (domingo)");
  reset();
});

/* ── P.25  feriado integralmente abonado: AVISO não bloqueante ───────────── */
check("P.25. abono em 07/09 (Independência, ABONADO): aviso de dia já abonado; criação permitida", () => {
  reset();
  assert.match(
    abonoDateAdvisory("2026-09-07", both) ?? "",
    /Esta data já está abonada pelo calendário\. Como o dia já está dispensado, recomendamos escolher outra data/,
  );
  assert.equal(actions.addAbsence(abonoDraft("2026-09-07")).ok, true);
  const st = getAppData();
  // O dia permanece \"evento do calendário\" com jornada 0 — sem efeitos colaterais
  assert.equal(entryOnDate(both, "2026-09-07")?.tratamento, "ABONADO", "calendário intacto");
  const cctx = companyDayContext("2026-09-07", [], st.absences, both, settings);
  assert.equal(cctx.adjustedBalance, 0);
  assert.equal(cctx.adjustedDeficit, 0);
  reset();
});

/* ── P.26  folga a compensar do calendário: AVISO; obrigação NUNCA abatida ── */
check("P.26. abono em 25/08 (folga a compensar 8h): aviso explícito; obrigação de 8h permanece intacta", () => {
  reset();
  assert.match(
    abonoDateAdvisory("2026-08-25", both) ?? "",
    /obrigação de compensação do calendário/,
  );
  assert.match(abonoDateAdvisory("2026-08-25", both) ?? "", /abono NÃO abate a obrigação/);
  assert.equal(actions.addAbsence(abonoDraft("2026-08-25")).ok, true);
  const st = getAppData();
  const debts = buildDebtDays(st.entries, [], settings, BOUNDS, st.absences, both);
  const cal = debts.find((d) => d.date === "2026-08-25" && d.kind === "calendario");
  assert.equal(cal?.debtMinutes, 480, "obrigação do calendário NUNCA virou abono");
  assert.equal(debts.find((d) => d.date === "2026-08-25" && d.kind === "deficit"), undefined);
  reset();
});

/* ── P.27  férias/saúde integral no dia: CONFLITO (bloqueio) ─────────────── */
check("P.27. abono sobre férias (10–14/08) ou saúde integral (17/08): bloqueado por sobreposição", () => {
  reset();
  assert.equal(actions.addAbsence({ kind: "ferias", startDate: "2026-08-10", endDate: "2026-08-14", duration: "integral", note: null }).ok, true);
  const r1 = actions.addAbsence(abonoDraft("2026-08-12"));
  assert.equal(r1.ok, false);
  assert.equal(r1.code, "overlap");
  assert.match(r1.error ?? "", /Férias/);
  assert.equal(actions.addAbsence({ kind: "saude", startDate: "2026-08-17", endDate: "2026-08-17", duration: "integral", medicalCert: true, note: null }).ok, true);
  const r2 = actions.addAbsence(abonoDraft("2026-08-17"));
  assert.equal(r2.ok, false);
  assert.match(r2.error ?? "", /Afastamento por saúde/);
  assert.equal(getAppData().absences.filter((a) => a.kind === "abono").length, 0, "nenhum abono criado");
  reset();
});

/* ── P.28  acordo a compensar no dia: CONFLITO; obrigação preservada ─────── */
check("P.28. abono sobre acordo a compensar (13/08): bloqueado; o acordo NUNCA é apagado", () => {
  reset();
  assert.equal(actions.addAbsence({ kind: "acordado", startDate: "2026-08-13", endDate: "2026-08-13", duration: "integral", treatment: "compensar", note: null }).ok, true);
  const r = actions.addAbsence(abonoDraft("2026-08-13"));
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /Afastamento acordado — compensar posteriormente/);
  const acordos = activeAcordos([], [], settings, BOUNDS, getAppData().absences);
  assert.equal(acordos.length, 1);
  assert.equal(acordos[0].originalMinutes, 480, "obrigação do acordo intacta");
  reset();
});

/* ── P.29  dia com Falta (ou prevista): CONFLITO explícito ───────────────── */
check("P.29. abono em dia com falta registrada (18/08) ou prevista (28/08): bloqueado com orientação", () => {
  reset();
  assert.equal(actions.addFalta("2026-08-18").ok, true);
  assert.equal(actions.addFalta("2026-08-28").ok, true);
  const ERR = "Esta data possui uma falta registrada. Exclua a falta (ou a falta prevista) antes de usar o dia para o Abono de aniversário.";
  assert.equal(actions.addAbsence(abonoDraft("2026-08-18")).error, ERR);
  assert.equal(actions.addAbsence(abonoDraft("2026-08-28")).error, ERR);
  assert.equal(getAppData().absences.length, 0);
  reset();
});

/* ── P.30  dia com batidas: CONFLITO explícito (nunca abono silencioso) ───── */
check("P.30. abono em dia com batidas (20/08): bloqueado — exige resolução explícita", () => {
  reset();
  assert.equal(actions.addEntry({ date: "2026-08-20", time: "08:00", type: "entrada", note: null }).ok, true);
  assert.equal(actions.addEntry({ date: "2026-08-20", time: "12:00", type: "saida", note: null }).ok, true);
  const r = actions.addAbsence(abonoDraft("2026-08-20"));
  assert.equal(r.ok, false);
  assert.equal(
    r.error,
    "Esta data possui registros de ponto. Exclua os registros ou escolha outra data para o Abono de aniversário.",
  );
  assert.equal(getAppData().absences.filter((a) => a.kind === "abono").length, 0, "nunca abono sobre dia trabalhado");
  reset();
});

/* ── P.31  aniversário real e Abono em datas DIFERENTES: independentes ────── */
check("P.31. nascimento 15/08 + Abono usado em 15/09: funcionam independentemente (banner só no aniversário)", () => {
  reset({ ...user, birthDate: "1990-08-15" });
  assert.equal(actions.addAbsence(abonoDraft("2026-09-15")).ok, true);
  assert.equal(isBirthdayToday(getAppData().user.birthDate, "2026-09-15"), false, "no dia do Abono não há banner");
  assert.equal(isBirthdayToday(getAppData().user.birthDate, "2026-08-15"), true, "banner só no aniversário real");
  assert.equal(abonoInCycle(getAppData().absences, TODAY)?.startDate, "2026-09-15");
  reset();
});

/* ── Regras duras do tipo: nunca parcial, nunca mais de um dia ───────────── */
check("Extra. abono NUNCA parcial e NUNCA mais de um dia (regras duras de validação)", () => {
  reset();
  const parcial = actions.addAbsence({
    kind: "abono", startDate: "2026-09-15", endDate: "2026-09-15",
    duration: "parcial", partialStart: "13:00", partialEnd: "17:00", note: null,
  });
  assert.equal(parcial.ok, false);
  assert.equal(parcial.error, "O Abono de aniversário é sempre um dia inteiro.");
  const span = actions.addAbsence({ kind: "abono", startDate: "2026-09-15", endDate: "2026-09-16", duration: "integral", note: null });
  assert.equal(span.ok, false);
  assert.equal(span.error, "O Abono de aniversário é de um único dia — mantenha as datas inicial e final iguais.");
  const v = validateAbsence(
    { kind: "abono", startDate: "", endDate: "", duration: "integral", note: null }, [], [], undefined, [],
  );
  assert.equal(v.ok, false, "datas obrigatórias");
  assert.equal(getAppData().absences.length, 0);
  reset();
});

console.log(`\n✅ ${passed} verificações passaram: P.12 P.13 P.14 P.15 P.16 P.17 P.18 P.19 P.20 P.21 P.22 P.23 P.24 P.25 P.26 P.27 P.28 P.29 P.30 P.31 + extras`);
