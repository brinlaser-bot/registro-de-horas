"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Download, ExternalLink, Hourglass, TriangleAlert, TrendingUp, Wallet } from "lucide-react";
import { actions, settingsOf, useAppData, useIsClient } from "@/lib/store";
import { formatMinutes, todayString, weekdayShort } from "@/lib/time";
import {
  getNextPointPeriod,
  getPointPeriod,
  getPreviousPointPeriod,
  periodLabel,
  samePointPeriod,
  getAnnualPointCycle,
  type PointPeriod,
} from "@/lib/periods";
import {
  buildResumoPeriodView,
  resumoDayPending,
  resumoPeriodPendencies,
  resumoProjectionVisible,
  resumoSpecialPeriodMovement,
  resumoCalendarPeriodRows,
  type ResumoDetailRow,
} from "@/lib/resumo-period-view";
import { resumoFinancialFrozen } from "@/lib/resumo-days";
import { Badge, Button, Card, EmptyState, Input, Modal, Skeleton, StatCard } from "@/components/ui";
import { StackedPeriodChart } from "@/components/stacked-period-chart";
import { PeriodNavigator } from "@/components/period-navigator";
import { useToast } from "@/components/toast";
import {
  activeConsolidationForPeriod,
  PERIOD_CONSOLIDATION_LABEL,
  periodConsolidationState,
  type PeriodConsolidation,
} from "@/lib/period-consolidation";

/** +30min / -1h30 / 0min — convenção de sinal do Resumo. */
function fmtSigned(v: number): string {
  return `${v > 0 ? "+" : ""}${formatMinutes(v)}`;
}

/** 4G — dd/mm/aaaa hh:mm para a fotografia consolidada. */
function formatDateTimeBR(ts: number): string {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

export default function ResumoPage() {
  const mounted = useIsClient();
  const { user, entries, compensations, absences, companyCalendars, faltas, specialExcessUses, specialExcessPlans, periodConsolidations } = useAppData();
  const settings = settingsOf(user);
  const toast = useToast();
  const todayStr = todayString();
  const currentPeriod = getPointPeriod(todayStr);
  const [period, setPeriod] = useState<PointPeriod>(() => getPointPeriod(todayString()));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [consolidarOpen, setConsolidarOpen] = useState(false);
  const [reabrirOpen, setReabrirOpen] = useState(false);
  const [reopenNote, setReopenNote] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const viewingCurrentPeriod = samePointPeriod(period, currentPeriod);

  // ETAPA 3F — derivação ÚNICA do Resumo (fatos + 2A + 3A + 3B + 3C):
  // cards, composição, projeção e linhas do detalhamento.
  const view = useMemo(
    () =>
      buildResumoPeriodView({
        period,
        today: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
      }),
    [entries, absences, companyCalendars, settings, faltas, period, todayStr, user.controlStartDate, specialExcessUses, specialExcessPlans],
  );

  // 4F — PENDÊNCIAS DE APURAÇÃO: mesmo classificador canônico da atenção
  // agora (4D.5), recortado no período 21→20.
  const pend = useMemo(
    () =>
      resumoPeriodPendencies({
        today: todayStr,
        period,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        plans: specialExcessPlans ?? [],
      }),
    [entries, absences, companyCalendars, settings, faltas, period, todayStr, user.controlStartDate, specialExcessPlans],
  );

  // 4G — ESTADO DO PERÍODO + CONSOLIDAÇÃO ATIVA (sem status manual:
  // derivação temporal + pendências bloqueantes + revisão ativa).
  const estadoPeriodo = periodConsolidationState({
    today: todayStr,
    periodStart: period.from,
    periodEnd: period.to,
    consolidations: periodConsolidations,
    blockedCount: pend.total,
  });
  const consolidacaoAtiva = activeConsolidationForPeriod(periodConsolidations, period.from, period.to);
  const revisoesDoPeriodo = (periodConsolidations ?? [])
    .filter((c) => c.periodStart === period.from && c.periodEnd === period.to)
    .sort((a, b) => b.revision - a.revision);

  // 4F — MOVIMENTAÇÃO [10+] DO PERÍODO (origens/destinos em 21→20;
  // ≠ saldo total do ciclo, que é da Central).
  const cicloDoPeriodo = getAnnualPointCycle(period.from);
  const movement = useMemo(
    () =>
      resumoSpecialPeriodMovement({
        period,
        today: todayStr,
        cycle: cicloDoPeriodo,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
      }),
    [entries, absences, companyCalendars, settings, faltas, period, todayStr, cicloDoPeriodo, user.controlStartDate, specialExcessUses, specialExcessPlans],
  );

  // 4F — CALENDÁRIO NO PERÍODO: mesma derivação canônica da Central
  // (forecast p/ futuro; companyDayContext p/ realizado), recorte 21→20.
  const calendario = useMemo(
    () =>
      resumoCalendarPeriodRows({
        today: todayStr,
        cycle: cicloDoPeriodo,
        period,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
      }),
    [entries, absences, companyCalendars, settings, faltas, period, todayStr, cicloDoPeriodo, user.controlStartDate],
  );

  const detailStats = useMemo(() => {
    let faltaDays = 0, faltaPrevistaDays = 0;
    for (const f of faltas) {
      if (f.date < period.from || f.date > period.to) continue;
      if (f.date <= todayStr) faltaDays += 1;
      else faltaPrevistaDays += 1;
    }
    return { faltaDays, faltaPrevistaDays };
  }, [faltas, period, todayStr]);

  const exportCsv = () => {
    const rows = [
      ["data", "dia_semana", "situacao", "trabalhado_min", "jornada_min", "saldo_regular_min", "no_ponto_min", "[10+]_gerado_min", "[10+]_utilizado_min", "projecao_no_ponto_min", "saldo_projetado_min"],
      ...view.days.map((r) => {
        const d = r.day;
        const frozen = resumoFinancialFrozen(d); // dia inválido/futuro: sem valores financeiros
        const p = r.projection;
        return [
          d.date,
          weekdayShort(d.date),
          r.situation === "—" ? "" : r.situation,
          d.workedMinutes,
          d.expectedMinutes,
          frozen ? "" : d.balanceMinutes,
          frozen || d.entryCount <= 0 ? "" : d.registrableMinutes,
          r.specialGenerated,
          r.specialUsed,
          frozen ? "" : p.projectedWorkedMinutes,
          frozen ? "" : p.projectedBalanceMinutes,
        ];
      }),
    ];
    const csv = rows.map((r) => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resumo-${period.from}_${period.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const { cards, composition, totals } = view;
  const projection = cards.projection;
  const projApplied = projection.appliedSpecialMinutes;
  const semMovimentacao10 = movement.generatedMinutes === 0 && movement.usedMinutes === 0 && movement.reservedMinutes === 0;
  const semRegistros = !view.days.some((r) => r.day.entryCount > 0);
  const encerrado = period.to < todayStr;
  const pendCategorias: { id: string; label: string; dates: string[]; hrefBase: string }[] = [
    { id: "inconsistente", label: "Registro inconsistente", dates: pend.inconsistente, hrefBase: "/registros?situacao=registro-inconsistente&escopo=ciclo" },
    { id: "incompleto", label: "Registro incompleto", dates: pend.incompleto, hrefBase: "/registros?situacao=registro-incompleto&escopo=ciclo" },
    { id: "sem-registro", label: "Dia sem registro", dates: pend.semRegistro, hrefBase: "/registros?situacao=sem-registro&escopo=ciclo" },
    { id: "plano-10", label: "Planejamento [10+] aguardando", dates: pend.plano10, hrefBase: "/registros?atencao=plano-10&escopo=ciclo" },
  ];
  /** CTA 4D.5 validado: filtro + escopo ciclo; com exatamente 1 item,
   *  inclui data= e o foco global da 4E.1 leva ao card. */
  const ctaPendencia = (c: { dates: string[]; hrefBase: string }) =>
    c.dates.length === 1 ? `${c.hrefBase}&data=${c.dates[0]}` : c.hrefBase;
  const pendSub =
    pend.total === 0
      ? "Nenhuma pendência de apuração neste período."
      : [
          pend.inconsistente.length > 0 ? `${pend.inconsistente.length} inconsistente${pend.inconsistente.length > 1 ? "s" : ""}` : null,
          pend.incompleto.length > 0 ? `${pend.incompleto.length} incompleto${pend.incompleto.length > 1 ? "s" : ""}` : null,
          pend.semRegistro.length > 0 ? `${pend.semRegistro.length} sem registro` : null,
          pend.plano10.length > 0 ? `${pend.plano10.length} planejamento${pend.plano10.length > 1 ? "s" : ""} aguardando` : null,
        ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      {/* ── CABEÇALHO (4F) ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Resumo do período</h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500">
            Veja como o período se formou, o saldo factual e a projeção considerando o uso do [10+].
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={exportCsv}>
          <Download size={14} /> Exportar CSV
        </Button>
      </div>

      {/* 4G — navegação compacta (mobile [‹][21/08 → 20/09][›] numa linha) +
          status derivado + ação de consolidação quando elegível. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigator
            fullLabel={`Período do ponto: ${periodLabel(period)}`}
            shortLabel={`${period.from.slice(8)}/${period.from.slice(5, 7)} → ${period.to.slice(8)}/${period.to.slice(5, 7)}`}
            onPrev={() => setPeriod(getPreviousPointPeriod(period))}
            onNext={() => setPeriod(getNextPointPeriod(period))}
          />
          {!viewingCurrentPeriod && (
            <Button variant="secondary" size="sm" onClick={() => setPeriod(currentPeriod)}>
              Período atual
            </Button>
          )}
          {/* Status derivado — nunca um fechamento manual. */}
          <Badge
            tone={
              estadoPeriodo === "consolidado" ? "violet"
              : estadoPeriodo === "reaberto-para-ajustes" ? "amber"
              : estadoPeriodo === "encerrado-com-pendencias" ? "rose"
              : estadoPeriodo === "pronto-para-consolidar" ? "indigo"
              : "emerald"
            }
          >
            {PERIOD_CONSOLIDATION_LABEL[estadoPeriodo]}
          </Badge>
        </div>
        {estadoPeriodo === "pronto-para-consolidar" && (
          <Button variant="primary" size="md" className="w-full sm:w-auto" onClick={() => setConsolidarOpen(true)}>
            Consolidar período
          </Button>
        )}
        {estadoPeriodo === "encerrado-com-pendencias" && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5">
            <p className="min-w-0 flex-1 text-sm font-bold text-amber-900">
              Resolva as pendências antes de consolidar este período.
            </p>
            <Link href="/registros?pendentes=1">
              <Button size="sm" variant="warning">Revisar em Registros</Button>
            </Link>
          </div>
        )}
      </div>

      {/* ── BLOCO 1 — VISÃO DO PERÍODO (mobile 2×2 · desktop 4 em linha) ── */}
      <div className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4">
        <StatCard
          label="Saldo factual"
          value={fmtSigned(consolidacaoAtiva ? consolidacaoAtiva.factualBalanceMinutes : cards.regularBalanceMinutes)}
          sub={consolidacaoAtiva ? "jornada real preservada — sem [10+]" : "saldo regular real do período — sem [10+]"}
          tone={cards.regularBalanceMinutes > 0 ? "emerald" : cards.regularBalanceMinutes < 0 ? "rose" : "slate"}
          icon={<Wallet size={16} />}
        />
        {consolidacaoAtiva ? (
          /* 4G — consolidado: a fotografia substitui a projeção viva
              (factual ≠ consolidado, SEMPRE explícito). */
          <StatCard
            label="Resultado consolidado no ponto"
            value={fmtSigned(consolidacaoAtiva.projectedBalanceMinutes)}
            sub={`consolidado em ${formatDateTimeBR(consolidacaoAtiva.consolidatedAt)}`}
            tone={consolidacaoAtiva.projectedBalanceMinutes > 0 ? "indigo" : consolidacaoAtiva.projectedBalanceMinutes < 0 ? "rose" : "slate"}
            icon={<TrendingUp size={16} />}
          />
        ) : (
          <StatCard
            label="Projeção no ponto"
            value={fmtSigned(projection.projectedBalanceMinutes)}
            sub={
              projApplied > 0
                ? `considera [10+] já utilizado (${formatMinutes(projApplied)})`
                : "sem ajustes [10+] aplicados"
            }
            tone={projection.projectedBalanceMinutes > 0 ? "indigo" : projection.projectedBalanceMinutes < 0 ? "rose" : "slate"}
            icon={<TrendingUp size={16} />}
          />
        )}
        <StatCard
          label="Dias com registro"
          value={String(totals.trackedDays)}
          sub="dias realizados com batidas"
          icon={<Clock3 size={16} />}
        />
        <StatCard
          label="Pendências de apuração"
          value={String(pend.total)}
          sub={pendSub}
          tone={pend.total > 0 ? "amber" : "emerald"}
          icon={<TriangleAlert size={16} />}
        />
      </div>

      {/* ── 4G — BANNER DE CONSOLIDAÇÃO (bloco discreto) ── */}
      {consolidacaoAtiva && (
        <div className="rounded-2xl border border-violet-300 bg-violet-50/60 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-extrabold text-violet-900">Período consolidado</p>
            <Badge tone="violet">Revisão {consolidacaoAtiva.revision}</Badge>
          </div>
          <p className="mt-1 text-xs font-medium text-slate-600">
            Resultado no ponto: <b className="tabular-nums">{fmtSigned(consolidacaoAtiva.projectedBalanceMinutes)}</b> · Saldo factual:{" "}
            <b className="tabular-nums">{fmtSigned(consolidacaoAtiva.factualBalanceMinutes)}</b> · [10+] utilizado:{" "}
            <b className="tabular-nums">{formatMinutes(consolidacaoAtiva.specialExcessUsedMinutes)}</b> · consolidado em{" "}
            {formatDateTimeBR(consolidacaoAtiva.consolidatedAt)}.
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            O factual preserva a jornada real; a consolidação salva o resultado considerado no ponto.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setHistOpen((v) => !v)}>
              Ver histórico
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setReopenNote(""); setReabrirOpen(true); }}>
              Reabrir período
            </Button>
          </div>
        </div>
      )}

      {/* ── 4G — HISTÓRICO DE CONSOLIDAÇÕES (recolhível; só se existir) ── */}
      {revisoesDoPeriodo.length > 0 && histOpen && (
        <Card title="Histórico de consolidações" subtitle={`Revisões do período ${periodLabel(period)}`}>
          <ul className="space-y-2">
            {revisoesDoPeriodo.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
                <p className="text-sm font-bold text-slate-800">
                  R{c.revision} — consolidado em {formatDateTimeBR(c.consolidatedAt)}
                </p>
                <p className="text-xs font-medium text-slate-600">
                  Resultado no ponto <b className="tabular-nums">{fmtSigned(c.projectedBalanceMinutes)}</b> · Factual{" "}
                  <b className="tabular-nums">{fmtSigned(c.factualBalanceMinutes)}</b> · [10+] utilizado{" "}
                  <b className="tabular-nums">{formatMinutes(c.specialExcessUsedMinutes)}</b>
                  {c.status === "active" ? (
                    <Badge tone="violet">Ativa</Badge>
                  ) : (
                    <Badge tone="slate">Reaberta{c.reopenedAt ? ` em ${formatDateTimeBR(c.reopenedAt)}` : ""}</Badge>
                  )}
                </p>
                {c.reopenNote && <p className="basis-full text-xs text-slate-500">Motivo da reabertura: {c.reopenNote}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── BLOCO 2 — COMO O PERÍODO SE FORMOU ── */}
      <Card title="Como o período se formou" subtitle="Apuração derivada dos dias financeiramente VÁLIDOS do período (21→20)">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Horas positivas regulares</p>
            <p className="mt-1 text-xl font-extrabold tabular-nums text-emerald-600">+{formatMinutes(composition.generatedCreditMinutes)}</p>
            <p className="mt-0.5 text-xs text-slate-500">soma dos saldos positivos até o limite de {formatMinutes(settings.maxDailyMinutes)}/dia</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Horas negativas regulares</p>
            <p className="mt-1 text-xl font-extrabold tabular-nums text-rose-600">-{formatMinutes(composition.generatedDeficitMinutes)}</p>
            <p className="mt-0.5 text-xs text-slate-500">soma absoluta dos déficits factuais válidos</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Saldo factual</p>
            <p className={`mt-1 text-xl font-extrabold tabular-nums ${cards.regularBalanceMinutes >= 0 ? "text-slate-900" : "text-rose-600"}`}>
              {fmtSigned(cards.regularBalanceMinutes)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">positivas − negativas · sem [10+] nesta conta</p>
          </div>
        </div>
        <p className="mt-3 text-xs font-medium text-slate-500">
          Dias pendentes não entram no saldo até que possam ser apurados corretamente.
        </p>
        {/* Fatos da jornada em barras (componente compartilhado com a Visão
            geral, modo factualOnly — sem camada legada). */}
        <div className="mt-4">
          <StackedPeriodChart
            entries={entries}
            compensations={compensations}
            absences={absences}
            companyCalendars={companyCalendars}
            settings={settings}
            period={period}
            faltas={faltas}
            today={todayStr}
            height={210}
            factualOnly
          />
        </div>
        {detailStats.faltaDays > 0 && (
          <p className="mt-2 text-xs text-slate-500">Faltas efetivadas no período: {detailStats.faltaDays} · previstas: {detailStats.faltaPrevistaDays}.</p>
        )}
      </Card>

      {/* ── BLOCO 3 — [10+] NESTE PERÍODO (movimentação, ≠ banco do ciclo) ── */}
      <Card title="[10+] neste período" subtitle="Movimentação com origem/destino dentro do período — o saldo total do ciclo fica na Central de Horas">
        {semMovimentacao10 ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-500">Nenhuma movimentação [10+] neste período.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">Gerado no período</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-violet-700">{formatMinutes(movement.generatedMinutes)}</p>
              <p className="mt-0.5 text-xs text-slate-500">origens dentro de 21→20</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Utilizado no período</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-800">{formatMinutes(movement.usedMinutes)}</p>
              <p className="mt-0.5 text-xs text-slate-500">destinos dentro de 21→20 ({movement.usesWithDestination} uso{movement.usesWithDestination === 1 ? "" : "s"})</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Reservado para o período</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-amber-600">{formatMinutes(movement.reservedMinutes)}</p>
              <p className="mt-0.5 text-xs text-slate-500">reservas em aberto com destino no período</p>
            </div>
          </div>
        )}
        {movement.usesOriginOutsidePeriod && (
          <p className="mt-3 text-xs font-medium text-slate-500">
            Parte do utilizado tem origem em outro período do mesmo ciclo — rastreável na Central de Horas.
          </p>
        )}
        <div className="mt-3">
          <Link href="/compensacoes" className="inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 underline underline-offset-2 hover:text-indigo-800">
            <ExternalLink size={14} aria-hidden /> Ver detalhes na Central de Horas
          </Link>
        </div>
      </Card>

      {/* ── BLOCO 4 — CALENDÁRIO DA EMPRESA NO PERÍODO ── */}
      <Card title="Calendário da empresa no período" subtitle={`Eventos do calendário em 21→20${calendario.label ? ` · ciclo ${calendario.label}` : ""}`}>
        {!calendario.hasCalendar ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-500">
            Não há calendário da empresa disponível para este ciclo.
          </p>
        ) : (
          <div className="space-y-4">
            <section aria-label="Eventos realizados no período" className="space-y-2">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">Realizados</h3>
              {calendario.realized.length === 0 ? (
                <p className="text-xs font-medium text-slate-500">Nenhum evento realizado neste período.</p>
              ) : (
                calendario.realized.map((e) => (
                  <div key={e.date} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-sm font-bold text-slate-800">
                      {formatDateShort(e.date)} — {e.descricao}
                      <Badge tone="slate">{e.tratamento}</Badge>
                      {e.preControlStartDate && <Badge tone="slate">pré-início do controle</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      Base referência <b className="text-slate-700">{formatMinutes(e.baseReferenciaMinutes)}</b> · Crédito calendário{" "}
                      <b className="text-slate-700">{formatMinutes(e.creditoCalendarioMinutes)}</b> · Jornada a cumprir{" "}
                      <b className="text-slate-700">{formatMinutes(e.jornadaACumprirMinutes)}</b>
                      {e.trabalhadoMinutes !== undefined && (
                        <> · Trabalhado <b className="text-slate-700">{formatMinutes(e.trabalhadoMinutes)}</b> · Saldo factual do dia{" "}
                        <b className={e.saldoFactualMinutes !== undefined && e.saldoFactualMinutes < 0 ? "text-rose-600" : "text-emerald-600"}>{formatMinutes(e.saldoFactualMinutes ?? 0)}</b></>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">Efeito já refletido no saldo factual.</p>
                  </div>
                ))
              )}
            </section>
            <section aria-label="Eventos futuros no período" className="space-y-2">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">Futuros</h3>
              {calendario.future.length === 0 ? (
                <p className="text-xs font-medium text-slate-500">Nenhum evento futuro neste período.</p>
              ) : (
                calendario.future.map((e) => (
                  <div key={e.date} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-sm font-bold text-slate-800">
                      <CalendarClock size={14} aria-hidden className="mr-1 inline text-slate-400" />
                      {formatDateShort(e.date)} — {e.descricao}
                      <Badge tone="slate">{e.tratamento}</Badge>
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      Base referência <b className="text-slate-700">{formatMinutes(e.baseReferenciaMinutes)}</b> · Crédito calendário{" "}
                      <b className="text-slate-700">{formatMinutes(e.creditoCalendarioMinutes)}</b> · Jornada a cumprir{" "}
                      <b className="text-slate-700">{formatMinutes(e.jornadaACumprirMinutes)}</b>
                    </p>
                    <p className="text-xs font-medium text-slate-500">
                      {e.tratamento === "ABONADO" && "Dia abonado — neutro (sem impacto)."}
                      {e.tratamento === "ABONADO_PARCIAL" && "Parcial: crédito do calendário + jornada regular a cumprir — sem impacto automático."}
                      {e.tratamento === "COMPENSAR" &&
                        (e.jornadaParcial
                          ? "Jornada parcial — sem impacto futuro automático."
                          : "Folga integral a compensar — impacto conhecido no futuro.")}
                      {e.impactoFuturoConhecidoMinutes !== null && !e.jornadaParcial && (
                        <span className="ml-1 font-bold text-amber-700">Impacto conhecido: {formatMinutes(e.impactoFuturoConhecidoMinutes)}</span>
                      )}
                    </p>
                  </div>
                ))
              )}
            </section>
          </div>
        )}
      </Card>

      {/* ── BLOCO 5 — PENDÊNCIAS DO PERÍODO (somente quando existirem) ── */}
      {pend.total > 0 && (
        <Card title="Pendências do período" subtitle="Itens que impedem uma leitura completa do período">
          <div className="space-y-2">
            {pendCategorias.filter((c) => c.dates.length > 0).map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5">
                <p className="text-sm font-bold text-amber-900">
                  {c.label}: {c.dates.length}
                </p>
                <Link href={ctaPendencia(c)} className="text-sm font-bold text-amber-800 underline underline-offset-2 hover:text-amber-900">
                  Revisar em Registros
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── 4G — CONFIRMAÇÃO DA CONSOLIDAÇÃO (fotografia exata) ── */}
      <Modal
        open={consolidarOpen}
        onClose={() => setConsolidarOpen(false)}
        title="Consolidar período"
        subtitle={periodLabel(period)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConsolidarOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={() => {
                const r = actions.consolidatePeriod({ periodStart: period.from, periodEnd: period.to });
                if (r.ok) {
                  setConsolidarOpen(false);
                  toast.show("Período consolidado — fotografia salva no histórico.");
                } else {
                  setConsolidarOpen(false);
                  toast.show(r.error ?? "Não foi possível consolidar o período.");
                }
              }}
            >
              Consolidar período
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-slate-700">
          <p className="font-bold text-slate-800">A fotografia exata que será salva:</p>
          <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div><dt className="font-semibold text-slate-400">Saldo factual</dt><dd className="text-base font-extrabold tabular-nums">{fmtSigned(cards.regularBalanceMinutes)}</dd></div>
            <div><dt className="font-semibold text-slate-400">Resultado no ponto</dt><dd className="text-base font-extrabold tabular-nums text-indigo-600">{fmtSigned(projection.projectedBalanceMinutes)}</dd></div>
            <div><dt className="font-semibold text-slate-400">[10+] utilizado no período</dt><dd className="text-base font-extrabold tabular-nums">{formatMinutes(movement.usedMinutes)}</dd></div>
            <div><dt className="font-semibold text-slate-400">Dias com registro</dt><dd className="text-base font-extrabold tabular-nums">{totals.trackedDays}</dd></div>
            <div><dt className="font-semibold text-slate-400">Horas positivas regulares</dt><dd className="font-extrabold tabular-nums text-emerald-600">+{formatMinutes(composition.generatedCreditMinutes)}</dd></div>
            <div><dt className="font-semibold text-slate-400">Horas negativas regulares</dt><dd className="font-extrabold tabular-nums text-rose-600">-{formatMinutes(composition.generatedDeficitMinutes)}</dd></div>
            <div className="col-span-2"><dt className="font-semibold text-slate-400">Calendário relevante</dt><dd className="font-medium">{calendario.realized.length} realizado(s) · {calendario.future.length} futuro(s) — efeitos já contidos no saldo factual dos dias.</dd></div>
          </dl>
          <p className="text-xs font-medium text-slate-600">
            O saldo factual continuará preservando a jornada real. A consolidação salva o resultado considerado no ponto
            e protege os dados que formaram esse fechamento.
          </p>
        </div>
      </Modal>

      {/* ── 4G — CONFIRMAÇÃO DA REABERTURA ── */}
      <Modal
        open={reabrirOpen}
        onClose={() => setReabrirOpen(false)}
        title="Reabrir período"
        subtitle={periodLabel(period)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReabrirOpen(false)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                const r = actions.reopenPeriod({ periodStart: period.from, periodEnd: period.to, note: reopenNote.trim() || null });
                if (r.ok) {
                  setReabrirOpen(false);
                  toast.show("Período reaberto para ajustes — a consolidação permanece no histórico.");
                } else {
                  setReabrirOpen(false);
                  toast.show(r.error ?? "Não foi possível reabrir o período.");
                }
              }}
            >
              Reabrir período
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            Reabrir permite alterar registros e decisões deste período. A consolidação atual permanecerá no histórico,
            mas deixará de ser o resultado ativo.
          </p>
          <Input
            label="Motivo (opcional)"
            value={reopenNote}
            onChange={(e) => setReopenNote(e.target.value)}
            placeholder="Ex.: corrigir batida de 26/08"
          />
        </div>
      </Modal>

      {/* ── BLOCO 6 — DETALHAMENTO DO PERÍODO (compacto/recolhível) ── */}
      <Card title="Detalhamento do período" subtitle="Um resumo por dia relevante — as batidas completas ficam em Registros">
        {semRegistros ? (
          <EmptyState icon={<BarChart3 size={24} />} title="Nenhum registro neste período." />
        ) : (
          <>
            <button
              type="button"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-left text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 cursor-pointer"
            >
              <span>{detailsOpen ? "Ocultar detalhamento do período" : "Ver detalhamento do período"}</span>
              {detailsOpen ? <ChevronUp size={18} className="shrink-0 text-slate-500" /> : <ChevronDown size={18} className="shrink-0 text-slate-500" />}
            </button>
            {detailsOpen && (
              <ul className="mt-3 space-y-2">
                {view.days.map((r) => (
                  <PeriodDayRow key={r.day.date} row={r} />
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/** 4F — Linha compacta do detalhamento (ordem cronológica crescente 21→20):
 *  data · trabalhado · saldo factual · projeção (se diferente) · indicador
 *  calendário · [10+] (quando houver) · pendência (quando houver) · CTA
 *  "Ver dia" (escopo ciclo + data= — o foco global da 4E.1 leva ao card). */
function PeriodDayRow({ row }: { row: ResumoDetailRow }) {
  const d = row.day;
  const frozen = resumoFinancialFrozen(d);
  const showProj = resumoProjectionVisible(row);
  const pendente = resumoDayPending(row) || (!!d.missingExpected && d.entryCount === 0);
  const mov10 = row.specialGenerated > 0 || row.specialUsed > 0;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-slate-800">
          {weekdayShort(d.date).replace(".", "")}
          <span className="font-medium text-slate-400">{d.date.slice(8)}/{d.date.slice(5, 7)}</span>
          {row.situation !== "—" && <Badge tone="slate">{row.situation}</Badge>}
          {pendente && <Badge tone="amber">Pendente</Badge>}
        </p>
        <p className="mt-0.5 text-xs font-medium text-slate-500">
          Trabalhado <b className="tabular-nums text-slate-700">{frozen ? "—" : formatMinutes(d.workedMinutes)}</b> · Saldo factual{" "}
          <b className={`tabular-nums ${frozen ? "text-slate-400" : d.balanceMinutes > 0 ? "text-emerald-600" : d.balanceMinutes < 0 ? "text-rose-600" : "text-slate-400"}`}>
            {frozen ? "—" : fmtSigned(d.balanceMinutes)}
          </b>
          {showProj && (
            <> · Projeção <b className="tabular-nums text-indigo-600">{fmtSigned(row.projection.projectedBalanceMinutes)}</b></>
          )}
          {mov10 && (
            <> · <span className="font-bold text-violet-600">[10+] gerado {formatMinutes(row.specialGenerated)}</span>{" "}
            <span className="font-semibold text-slate-600">usado {formatMinutes(row.specialUsed)}</span></>
          )}
        </p>
      </div>
      <Link
        href={`/registros?escopo=ciclo&data=${d.date}`}
        className="shrink-0 text-xs font-bold text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
      >
        Ver dia
      </Link>
    </li>
  );
}

/** dd/mm — formato curto do Resumo (evita dependência de helper externo). */
function formatDateShort(date: string): string {
  return `${date.slice(8)}/${date.slice(5, 7)}`;
}
