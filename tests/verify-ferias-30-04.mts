/**
 * VERIFICAÇÃO — FÉRIAS × FECHAMENTO ANUAL 30/04 + REGRESSÕES SAÚDE/ACORDO
 * (rodada consolidada, testes P.1–P.11)
 *
 *  A) FÉRIAS nunca atravessam 30/04 — bloqueadas na criação E na edição, SEM
 *     oferecer divisão e SEM criar continuação automática (outros tipos podem
 *     ser divididos; férias não).
 *  B) Saúde atravessando 30/04 segue sendo dividida em 2 registros — e quando
 *     o PRIMEIRO trecho falha (conflito real), nada é salvo e o segundo trecho
 *     nunca é preparado.
 *  C) Acordo integral atravessando 30/04 continua FUNCIONANDO: 2 eventos
 *     independentes — editar/excluir um não afeta o outro (regressão).
 *  D) Acordo parcial dispensado: 13–17 → 4h dispensadas (base 4h); editado
 *     15–17 → 2h dispensadas (base 6h) — preservado.
 *  E) Acordo parcial a compensar SEM batidas: acordo 4h + déficit comum 4h
 *     COEXISTEM (nunca 8h única); o card mostra os DOIS atalhos.
 *
 * Executar: npx tsx tests/verify-ferias-30-04.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateAbsence, dayContext, type Absence } from "../src/lib/absences.ts";
import {
  buildCompanyCalendar,
  companyDayContext,
  parseCompanyCalendarCsv,
} from "../src/lib/company-calendar.ts";
import { activeAcordos, buildDebtDays } from "../src/lib/debt.ts";
import { annualCycleBounds, getAnnualPointCycle } from "../src/lib/periods.ts";
import { actions, getAppData } from "../src/lib/store.ts";
import type { User, WorkSettings } from "../src/lib/types.ts";

const settings: WorkSettings = {
  workStart: "08:00", workEnd: "17:00", lunchStart: "12:00", lunchEnd: "13:00",
  maxDailyMinutes: 600, autoDeductLunch: true,
};
const user: User = {
  id: 1, name: "Teste", email: "t@t.com", workStart: "08:00", workEnd: "17:00",
  lunchStart: "12:00", lunchEnd: "13:00", maxDailyMinutes: 600, autoDeductLunch: true,
  birthDate: null,
};

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const cal2526 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-sebrae-2025-2026.csv"), settings).entries);
const cal2627 = buildCompanyCalendar(parseCompanyCalendarCsv(read("calendario-ficticio-2026-2027.csv"), settings).entries);
const both = [cal2526, cal2627];

const TODAY = "2026-08-23";
const BOUNDS = annualCycleBounds(getAnnualPointCycle(TODAY)); // 2026-05-01 → 2027-04-30

const reset = () =>
  actions.replaceAll({ user, entries: [], compensations: [], absences: [], companyCalendars: both, faltas: [] });

const FERIAS_MSG =
  "As férias não podem ultrapassar o fechamento do ciclo anual em 30/04. Ajuste a data final para até 30/04. A partir de 01/05 inicia-se um novo ciclo anual.";

let passed = 0;
const check = (id: string, fn: () => void) => { fn(); passed++; console.log(`✔ ${id}`); };

/* ── P.1  férias 29/04→30/04 (dentro do ciclo) são permitidas ─────────── */
check("P.1. férias 2027-04-29→2027-04-30 (até o fechamento): permitidas, sem split", () => {
  reset();
  const v = validateAbsence(
    { kind: "ferias", startDate: "2027-04-29", endDate: "2027-04-30", duration: "integral", note: null },
    [], [], undefined, [],
  );
  assert.equal(v.ok, true);
  assert.equal(v.split, undefined);
  const res = actions.addAbsence({ kind: "ferias", startDate: "2027-04-29", endDate: "2027-04-30", duration: "integral", note: null });
  assert.equal(res.ok, true);
  assert.equal(getAppData().absences.length, 1);
});

/* ── P.2  férias 29/04→03/05 BLOQUEADAS, sem divisão oferecida ─────────── */
check("P.2. férias 2027-04-29→2027-05-03: bloqueadas (mensagem da regra), SEM split, nada criado", () => {
  reset();
  const v = validateAbsence(
    { kind: "ferias", startDate: "2027-04-29", endDate: "2027-05-03", duration: "integral", note: null },
    [], [], undefined, [],
  );
  assert.equal(v.ok, false);
  assert.equal(v.code, "cross-cycle");
  assert.equal(v.error, FERIAS_MSG);
  assert.equal(v.split, undefined, "férias NUNCA oferecem divisão");
  const res = actions.addAbsence({ kind: "ferias", startDate: "2027-04-29", endDate: "2027-05-03", duration: "integral", note: null });
  assert.equal(res.ok, false);
  assert.equal(res.error, FERIAS_MSG);
  assert.equal(res.split, undefined);
  assert.equal(getAppData().absences.length, 0, "nenhum evento criado");
});

/* ── P.3  EDIÇÃO de férias para atravessar 30/04: bloqueada ────────────── */
check("P.3. editar férias 2027-04-20→25 p/ final 2027-05-03: bloqueado; evento permanece intacto", () => {
  reset();
  assert.equal(actions.addAbsence({ kind: "ferias", startDate: "2027-04-20", endDate: "2027-04-25", duration: "integral", note: null }).ok, true);
  const id = getAppData().absences[0].id;
  const res = actions.updateAbsence(id, { endDate: "2027-05-03" });
  assert.equal(res.ok, false);
  assert.equal(res.error, FERIAS_MSG);
  assert.equal(res.split, undefined, "edição também não oferece divisão");
  const atual = getAppData().absences[0];
  assert.equal(atual.startDate, "2027-04-20");
  assert.equal(atual.endDate, "2027-04-25", "rascunho antigo preservado");
});

/* ── P.4/P.5  período do NOVO ciclo como evento separado; nada automático ─ */
check("P.4/P.5. férias 2027-05-01→03 como NOVO evento: permitido; após erro anterior nada foi criado automaticamente", () => {
  reset();
  // Tentativa bloqueada primeiro (P.2)
  assert.equal(actions.addAbsence({ kind: "ferias", startDate: "2027-04-29", endDate: "2027-05-03", duration: "integral", note: null }).ok, false);
  assert.equal(getAppData().absences.length, 0, "nenhuma continuação automática criada");
  // Dois registros separados, um por ciclo
  assert.equal(actions.addAbsence({ kind: "ferias", startDate: "2027-04-29", endDate: "2027-04-30", duration: "integral", note: null }).ok, true);
  assert.equal(actions.addAbsence({ kind: "ferias", startDate: "2027-05-01", endDate: "2027-05-03", duration: "integral", note: null }).ok, true);
  assert.equal(getAppData().absences.length, 2);
});

/* ── P.6  SAÚDE 29/04→03/05 sem conflito: divisão preservada ───────────── */
check("P.6. saúde 2027-04-29→2027-05-03: split sugerido; dois registros salvos (29–30/04 e 01–03/05)", () => {
  reset();
  const draft = { kind: "saude", startDate: "2027-04-29", endDate: "2027-05-03", duration: "integral", medicalCert: true, note: null } as const;
  const v = validateAbsence(draft, [], [], undefined, []);
  assert.equal(v.ok, false);
  assert.equal(v.code, "cross-cycle");
  assert.ok(v.split, "saúde oferece divisão");
  assert.deepEqual(v.split, {
    first: { startDate: "2027-04-29", endDate: "2027-04-30" },
    second: { startDate: "2027-05-01", endDate: "2027-05-03" },
  });
  // Fluxo do modal: salva o 1º, depois o 2º (registros independentes)
  assert.equal(actions.addAbsence({ ...draft, ...v.split!.first }).ok, true);
  assert.equal(actions.addAbsence({ ...draft, ...v.split!.second }).ok, true);
  const abs = getAppData().absences;
  assert.equal(abs.length, 2);
  assert.deepEqual(abs.map((a) => [a.startDate, a.endDate]), [["2027-04-29", "2027-04-30"], ["2027-05-01", "2027-05-03"]]);
});

/* ── P.7  SAÚDE: primeiro trecho com conflito → NADA salvo (sem 2ª etapa) ─ */
check("P.7. saúde atravessando 30/04 c/ férias em 29–30/04: 1º trecho falha (overlap), nada é salvo", () => {
  reset();
  assert.equal(actions.addAbsence({ kind: "ferias", startDate: "2027-04-29", endDate: "2027-04-30", duration: "integral", note: null }).ok, true);
  const draft = { kind: "saude", startDate: "2027-04-29", endDate: "2027-05-03", duration: "integral", medicalCert: true, note: null } as const;
  // A validação do período inteiro ainda sugere a divisão...
  const v = validateAbsence(draft, getAppData().absences, [], undefined, []);
  assert.ok(v.split, "o período atravessa 30/04: divisão sugerida");
  // ...mas o SAVE REAL do primeiro trecho falha (overlap com as férias)
  const first = actions.addAbsence({ ...draft, ...v.split!.first });
  assert.equal(first.ok, false);
  assert.equal(first.code, "overlap");
  assert.match(first.error ?? "", /Férias/);
  // Consequência (Parte B): sem sucesso → SEM segunda etapa; estado intacto
  assert.equal(getAppData().absences.length, 1, "apenas as férias permanecem — o trecho de saúde não foi salvo");
  assert.equal(getAppData().absences[0].kind, "ferias");
});

/* ── P.8  ACORDO integral atravessando 30/04: FUNCIONA (2 independentes) ─ */
check("P.8. acordo integral 2027-04-29→2027-05-03 (compensar): split → dois registros salvos (não alterar)", () => {
  reset();
  const draft = { kind: "acordado", startDate: "2027-04-29", endDate: "2027-05-03", duration: "integral", treatment: "compensar", note: null } as const;
  const res = actions.addAbsence(draft);
  assert.equal(res.ok, false, "atravessa 30/04: precisa dividir");
  assert.ok(res.split);
  assert.equal(actions.addAbsence({ ...draft, ...res.split!.first }).ok, true);
  assert.equal(actions.addAbsence({ ...draft, ...res.split!.second }).ok, true);
  const abs = getAppData().absences;
  assert.equal(abs.length, 2);
  // Obrigações independentes por ciclo — expandem por dia (2 dias + 3 dias × 8h)
  const acordos = activeAcordos([], [], settings, { from: "2026-05-01", to: "2028-04-30" }, abs);
  assert.equal(acordos.length, 5, "o acordo integral gera 8h por dia");
  const ciclo1 = acordos.filter((a) => a.date <= "2027-04-30");
  const ciclo2 = acordos.filter((a) => a.date >= "2027-05-01");
  assert.deepEqual(ciclo1.map((a) => a.date).sort(), ["2027-04-29", "2027-04-30"]);
  assert.deepEqual(ciclo2.map((a) => a.date).sort(), ["2027-05-01", "2027-05-02", "2027-05-03"]);
  assert.equal(ciclo1.reduce((s, a) => s + a.originalMinutes, 0), 960, "2 dias × 8h");
  assert.equal(ciclo2.reduce((s, a) => s + a.originalMinutes, 0), 1440, "3 dias × 8h");
});

/* ── P.9  ACORDO dividido: editar/excluir um não afeta o outro ─────────── */
check("P.9. acordo dividido em 2: editar datas do 2º e excluir o 1º — o outro nunca é alterado", () => {
  reset();
  assert.equal(actions.addAbsence({ kind: "acordado", startDate: "2027-04-29", endDate: "2027-04-30", duration: "integral", treatment: "compensar", note: null }).ok, true);
  assert.equal(actions.addAbsence({ kind: "acordado", startDate: "2027-05-01", endDate: "2027-05-03", duration: "integral", treatment: "compensar", note: null }).ok, true);
  const [a1, a2] = getAppData().absences;
  // Edita o 2º (dentro do mesmo ciclo) → 1º intocado
  assert.equal(actions.updateAbsence(a2.id, { endDate: "2027-05-05" }).ok, true);
  let st = getAppData().absences;
  assert.deepEqual([st[0].startDate, st[0].endDate], ["2027-04-29", "2027-04-30"]);
  assert.deepEqual([st[1].startDate, st[1].endDate], ["2027-05-01", "2027-05-05"]);
  // Exclui o 1º → 2º permanece
  assert.equal(actions.deleteAbsence(a1.id).ok, true);
  st = getAppData().absences;
  assert.equal(st.length, 1);
  assert.deepEqual([st[0].startDate, st[0].endDate], ["2027-05-01", "2027-05-05"]);
});

/* ── P.10  ACORDO parcial dispensado: base reduzida (13–17 → 4h; 15–17 → 6h) ─ */
check("P.10. acordo parcial dispensado 13:00–17:00 em 10/08: base 4h; editado 15–17: base 6h (preservado)", () => {
  reset();
  const draft = {
    kind: "acordado", startDate: "2026-08-10", endDate: "2026-08-10",
    duration: "parcial", partialStart: "13:00", partialEnd: "17:00",
    treatment: "dispensado", note: null,
  } as const;
  assert.equal(actions.addAbsence(draft).ok, true);
  const id = getAppData().absences[0].id;
  let ctx = companyDayContext("2026-08-10", [], getAppData().absences, both, settings);
  assert.equal(ctx.effectiveExpected, 240, "4h dispensadas → base restante 4h");
  assert.equal(ctx.adjustedDeficit, 240, "sem batidas: as 4h restantes ficam devendo");
  assert.equal(ctx.ctx.acordoMinutes, 0, "dispensado não gera acordo");
  // Edição para 15–17 → 2h dispensadas → base 6h
  assert.equal(actions.updateAbsence(id, { partialStart: "15:00", partialEnd: "17:00" }).ok, true);
  ctx = companyDayContext("2026-08-10", [], getAppData().absences, both, settings);
  assert.equal(ctx.effectiveExpected, 360, "2h dispensadas → base restante 6h");
  assert.equal(ctx.adjustedDeficit, 360);
});

/* ── P.11  ACORDO parcial COMPENSAR sem batidas: acordo 4h + déficit 4h ── */
check("P.11. acordo parcial a compensar 13–17 em 11/08 sem batidas: acordo 4h + déficit comum 4h (NUNCA 8h única)", () => {
  reset();
  const absences: Omit<Absence, "id" | "createdAt"> = {
    kind: "acordado", startDate: "2026-08-11", endDate: "2026-08-11",
    duration: "parcial", partialStart: "13:00", partialEnd: "17:00",
    treatment: "compensar", note: null,
  };
  assert.equal(actions.addAbsence(absences).ok, true);
  const st = getAppData();
  const ctx = dayContext("2026-08-11", [], st.absences, settings);
  assert.equal(ctx.effectiveExpected, 240, "base restante 4h");
  assert.equal(ctx.adjustedBalance, -240, "déficit comum do dia −4h");
  assert.equal(ctx.adjustedDeficit, 240);
  assert.equal(ctx.acordoMinutes, 240, "acordo próprio 4h");
  const debts = buildDebtDays([], [], settings, BOUNDS, st.absences, st.companyCalendars);
  const onDay = debts.filter((d) => d.date === "2026-08-11");
  assert.deepEqual(onDay.map((d) => d.kind).sort(), ["acordo", "deficit"], "as DUAS dívidas coexistem");
  assert.equal(onDay.find((d) => d.kind === "acordo")?.debtMinutes, 240);
  assert.equal(onDay.find((d) => d.kind === "deficit")?.debtMinutes, 240);
  assert.equal(onDay.reduce((s, d) => s + d.debtMinutes, 0), 480, "4+4 — nunca 8h única");
  // 3E.2: os atalhos legados de dívida (acordo/déficit + "Programar hora extra")
  // saíram completamente do card — o que o visual guarda agora é apenas a
  // apresentação factual (trabalhado/saldo); a separação engine 4+4 (nunca
  // 8h única) segue assercionada acima.
  const src = readFileSync(new URL("../src/components/day-card.tsx", import.meta.url), "utf8");
  assert.ok(!src.includes("Programar hora extra"), "sem atalhos de dívida no card (3E.2)");
  assert.ok(!src.includes("shortcuts?.canCompensate"), "sem guardas legadas de acordo no card (3E.2)");
});

console.log(`\n✅ ${passed} verificações passaram: P.1 P.2 P.3 P.4 P.5 P.6 P.7 P.8 P.9 P.10 P.11`);
