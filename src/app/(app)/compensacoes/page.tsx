"use client";

/**
 * CENTRAL DE HORAS — 4E: GESTÃO DETALHADA + RASTREABILIDADE CANÔNICA.
 *
 * A Central é a página de rastreabilidade: de onde vieram as horas [10+],
 * onde foram reservadas/usadas, o que ainda existe e como o calendário da
 * empresa afeta o ciclo. NÃO compete com Visão Geral (situação + decisão),
 * Registros (fatos do dia + ações) nem Resumo (análise do período).
 *
 * SEM o fluxo legado de compensação manual e sem nenhum vocabulário de
 * pendência do modelo antigo; [10+] permanece paralelo ao saldo regular
 * (nunca offset automático). Motores/dados antigos continuam internos
 * (compatibilidade); registros antigos aparecem — se existirem — como
 * HISTÓRICO LEGADO read-only, no fim da página.
 *
 * Fontes canônicas (nenhuma matemática aqui — ver src/lib/central-view.ts):
 *   Banco [10+] → buildSpecialExcessBank · Reservas/Usos → Plan/Use
 *   Calendário  → central-view (companyDayContext + buildCalendarForecast)
 *   Navegação   → mecanismo 4D.5 (/registros?escopo=ciclo&data=…)
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarClock,
  CalendarOff,
  ChevronDown,
  Clock3,
  Database,
  Hourglass,
  Landmark,
  Lock,
  Settings,
  Timer,
} from "lucide-react";
import { settingsOf, useAppData, useIsClient } from "@/lib/store";
import { consolidationLockForDate } from "@/lib/period-consolidation";
import { annualCycleBounds, getAnnualPointCycle } from "@/lib/periods";
import { formatDateShortBR, formatMinutes, todayString } from "@/lib/time";
import {
  buildSpecialExcessBank,
  type SpecialExcessLotDestination,
  type SpecialExcessOriginLot,
} from "@/lib/special-excess-bank";
import { specialExcessPlanMinutes } from "@/lib/special-excess-plan";
import { specialExcessUseMinutes } from "@/lib/special-excess-use";
import { excessReasonOnDate } from "@/lib/hour-bank";
import { centralCalendarEvents, centralCalendarSummary, centralCycles, tratamentoLabel } from "@/lib/central-view";
import { closureForCycle, carriedSlicesIntoCycle } from "@/lib/annual-cycle-closure";
import { checkCycleClose, computeClosingExcess } from "@/lib/annual-cycle-close";
import { eligibleSpecialExcessDestinationsForOrigin } from "@/lib/special-excess-destinations";
import { CloseCycleButton } from "@/components/close-cycle-modal";
import { SpecialExcessDestineModal } from "@/components/special-excess-destine-modal";
import { Badge, Button, EmptyState, Skeleton, StatCard } from "@/components/ui";

const modoDaEstrategia = (strategy: string) => (strategy === "fifo" || strategy === "automatic" ? "Seleção automática" : "Seleção manual");

const STATUS_PLANO: Record<string, string> = { planned: "Reservado", cancelled: "Cancelado", concluded: "Concluído" };
const STATUS_USO: Record<string, string> = { utilizado: "Utilizado", cancelado: "Cancelado" };

/** Rótulo do ciclo a partir de um 01/05 (ex.: "2026-05-01" → "2026/2027"). */
const cycleLabelOf = (start: string) => {
  const y = Number(start.slice(0, 4));
  return Number.isFinite(y) ? `${y}/${y + 1}` : "";
};

export default function CompensacoesPage() {
  const mounted = useIsClient();
  const { user, entries, absences, companyCalendars, faltas, excessReasons, specialExcessUses, specialExcessPlans, compensations, periodConsolidations, annualCycleClosures } = useAppData();
  const settings = settingsOf(user);
  const todayStr = todayString();

  /* Ciclo selecionado (default: ciclo anual atual). Navegável entre os
   * ciclos existentes nos dados — sem persistência nenhuma. */
  const ciclos = useMemo(
    () =>
      centralCycles({
        today: todayStr,
        calendars: companyCalendars ?? [],
        planDates: (specialExcessPlans ?? []).map((p) => p.destinationDate),
        useDates: (specialExcessUses ?? []).map((u) => u.destinationDate),
      }),
    [todayStr, companyCalendars, specialExcessPlans, specialExcessUses],
  );
  const [ciclo, setCiclo] = useState<string | null>(null);
  const cicloAtivo = ciclo && ciclos.includes(ciclo) ? ciclo : getAnnualPointCycle(todayStr);
  const bounds = useMemo(() => annualCycleBounds(cicloAtivo), [cicloAtivo]);

  /* ABA 1 — Banco [10+]: fonte única buildSpecialExcessBank. */
  const bank = useMemo(
    () =>
      buildSpecialExcessBank({
        cycle: cicloAtivo,
        asOfDate: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? "",
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
        // 4H — saldo formalmente TRANSPORTADO para este ciclo (fechamento
        // anterior); aparece como lotes `carried`/`carriedMinutes` sem somar
        // em "Gerado neste ciclo".
        carried: carriedSlicesIntoCycle(annualCycleClosures ?? [], cicloAtivo),
      }),
    [cicloAtivo, todayStr, entries, absences, companyCalendars, settings, faltas, user.controlStartDate, specialExcessUses, specialExcessPlans, annualCycleClosures],
  );

  /* 4H.2 — LOTES reorganizados em DOIS blocos (responde "quais horas [10+]
   * ainda tenho para usar?"). A classificação é 100% DERIVADA do banco
   * canônico 3C a cada render — NADA persistido: cancelada uma reserva ou
   * um uso, o lote volta sozinho para "disponíveis". */
  const lotesDisponiveis = bank.lots.filter((l) => l.availableMinutes > 0);
  const lotesTotalmenteDestinados = bank.lots.filter((l) => l.availableMinutes === 0);
  /* 4H.2 — fluxO INVERSO: dias elegíveis a receber [10+] neste ciclo (fonte
   * única do modal "Destinar horas" — MESMA lista para todas as origens do
   * ciclo; derivado 4H.2 sobre 3A/3E + guards 4G/4H). */
  const destinosElegiveis = useMemo(
    () =>
      eligibleSpecialExcessDestinationsForOrigin({
        cycle: cicloAtivo,
        asOfDate: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
        periodConsolidations,
        annualCycleClosures,
      }),
    [cicloAtivo, todayStr, entries, absences, companyCalendars, settings, faltas, user.controlStartDate, specialExcessUses, specialExcessPlans, periodConsolidations, annualCycleClosures],
  );
  /* 4H.2 — modal origem→destino com o lote pré-selecionado (o MESMO
   * componente aberto pelo DayCard de Registros). */
  const [destineLot, setDestineLot] = useState<SpecialExcessOriginLot | null>(null);

  /* 4H — SITUAÇÃO DO CICLO SELECIONADO. Fontes puras (a página é somente
   * leitura — a mutação de encerramento vive no componente CloseCycleButton):
   *   active        → em andamento (hoje dentro do ciclo);
   *   awaiting-close→ terminou no calendário mas ainda NÃO foi encerrado;
   *   closed        → fechamento formal registrado (irreversível);
   *   future        → ciclo futuro (sem geração/transporte inventados). */
  const closures = annualCycleClosures ?? [];
  const closureDoCiclo = closureForCycle(closures, cicloAtivo);
  const situation: "active" | "awaiting-close" | "closed" | "future" = closureDoCiclo
    ? "closed"
    : bounds.from > todayStr
      ? "future"
      : todayStr > bounds.to
        ? "awaiting-close"
        : "active";

  /* Preview do fechamento (somente para ciclo que aguarda encerrar) — fontes
   * canônicas `checkCycleClose` (blockers/eligibilidade) e
   * `computeClosingExcess` (saldo final [10+] a destinar). */
  const closePreview = useMemo(() => {
    if (situation !== "awaiting-close") return null;
    const cl = annualCycleClosures ?? [];
    const el = checkCycleClose({
      today: todayStr,
      label: cicloAtivo,
      closures: cl,
      entries,
      absences,
      calendars: companyCalendars,
      settings,
      faltas,
      controlStartDate: user.controlStartDate,
      plans: specialExcessPlans ?? [],
      consolidations: periodConsolidations,
    });
    const comp = computeClosingExcess({
      label: cicloAtivo,
      closures: cl,
      entries,
      absences,
      calendars: companyCalendars,
      settings,
      faltas,
      controlStartDate: user.controlStartDate,
      uses: specialExcessUses ?? [],
      plans: specialExcessPlans ?? [],
    });
    return {
      cycleLabel: cicloAtivo,
      eligible: el.ok,
      blockers: el.blockers,
      closingMinutes: comp.closingMinutes,
      consolidados: (periodConsolidations ?? []).filter(
        (c) => c.status === "active" && c.periodStart >= bounds.from && c.periodEnd <= bounds.to,
      ).length,
      pendencias: el.blockingPendencyDates.length,
    };
  }, [situation, cicloAtivo, todayStr, bounds.from, bounds.to, annualCycleClosures, entries, absences, companyCalendars, settings, faltas, user.controlStartDate, specialExcessPlans, specialExcessUses, periodConsolidations]);

  const noCiclo = (d: string) => d >= bounds.from && d <= bounds.to;

  /* Reservas em aberto (planned) e usos realizados (utilizado) do ciclo —
   * decisão/resolução continua SEMPRE no fluxo canônico de Registros. */
  const reservas = (specialExcessPlans ?? [])
    .filter((p) => p.status === "planned" && noCiclo(p.destinationDate))
    .sort((a, b) => a.destinationDate.localeCompare(b.destinationDate));
  const usos = (specialExcessUses ?? [])
    .filter((u) => u.status === "utilizado" && noCiclo(u.destinationDate))
    .sort((a, b) => b.destinationDate.localeCompare(a.destinationDate));
  const canceladosPlanos = (specialExcessPlans ?? []).filter((p) => p.status === "cancelled" && noCiclo(p.destinationDate));
  const canceladosUsos = (specialExcessUses ?? []).filter((u) => u.status === "cancelado" && noCiclo(u.destinationDate));

  const reservasAbertasHref = (destino: string, chegou: boolean) =>
    chegou ? `/registros?atencao=plano-10&escopo=ciclo&data=${destino}` : `/registros?escopo=ciclo&data=${destino}`;

  /* ABA 2 — Calendário da empresa: central-view (companyDayContext +
   * buildCalendarForecast). Realizado ⇒ efeito no saldo factual (nunca
   * pendência adicional); futuro ⇒ apenas impacto conhecido (previsão). */
  const calResumo = useMemo(() => centralCalendarSummary(companyCalendars, cicloAtivo), [companyCalendars, cicloAtivo]);
  const calEventos = useMemo(
    () =>
      centralCalendarEvents({
        today: todayStr,
        cycle: cicloAtivo,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
      }),
    [todayStr, cicloAtivo, entries, absences, companyCalendars, settings, faltas, user.controlStartDate],
  );
  const impactoFuturo = calEventos.future.reduce((s, e) => s + (e.impactoFuturoConhecidoMinutes ?? 0), 0);

  const [tab, setTab] = useState<"banco" | "calendario">("banco");

  if (!mounted) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  const linkDia = (date: string) => `/registros?escopo=ciclo&data=${date}`;

  /* 4H.2 — linha de destino (uso) de uma origem — MESMA rastreabilidade
   * canônica nos dois blocos (disponíveis e totalmente destinadas). */
  const destinoLine = (d: SpecialExcessLotDestination) => (
    <div key={`${d.useId}-${d.destinationDate}-${d.minutes}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="font-semibold text-slate-700">
        <ArrowRight size={12} aria-hidden className="mr-1 inline text-slate-400" />
        {formatDateShortBR(d.destinationDate)} → <b className="tabular-nums">{formatMinutes(d.minutes)}</b>{" "}
        {d.status === "utilizado" ? "utilizado" : "cancelado"}
        <span className="ml-1.5 font-medium text-slate-400">· {modoDaEstrategia(d.allocationStrategy)}</span>
      </span>
      <Link href={linkDia(d.destinationDate)} className="font-bold text-indigo-600 underline underline-offset-2 hover:text-indigo-800">
        Ver dia
      </Link>
    </div>
  );
  /* Reservas ATIVAS lastreadas numa origem (junção canônica por allocations
   * — sem nova matemática; o banco rastreia usos, a reserva é exibida pelo
   * plano). */
  const reservasDaOrigem = (lot: SpecialExcessOriginLot) =>
    (specialExcessPlans ?? []).filter((pl) => pl.status === "planned" && pl.allocations.some((a) => a.originDate === lot.originDate));

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900">Central de Horas</h2>
          <p className="text-sm text-slate-500">
            Acompanhe o banco [10+], suas reservas e usos, e os impactos do calendário da empresa.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
          Ciclo
          <select
            value={cicloAtivo}
            onChange={(e) => setCiclo(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-extrabold text-slate-800"
            aria-label="Ciclo anual"
          >
            {ciclos.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Abas (desktop e mobile) */}
      <div role="tablist" aria-label="Áreas da Central" className="flex gap-2">
        <button
          role="tab"
          aria-selected={tab === "banco"}
          onClick={() => setTab("banco")}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-extrabold ${
            tab === "banco" ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Landmark size={15} aria-hidden /> Banco [10+]
        </button>
        <button
          role="tab"
          aria-selected={tab === "calendario"}
          onClick={() => setTab("calendario")}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-extrabold ${
            tab === "calendario" ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          <CalendarClock size={15} aria-hidden /> Calendário da empresa
        </button>
      </div>

      {tab === "banco" && (
        <>
          {/* 4H — SITUAÇÃO DO CICLO + FECHAMENTO ANUAL DEFINITIVO.
              active   → sem banner (Central normal abaixo).
              awaiting → terminou; Encerrar ciclo quando elegível.
              closed   → saldo final + destinação (sem "Disponível" operacional).
              future   → "Ciclo futuro" (nunca inventa geração/transporte). */}
          {situation === "awaiting-close" && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50/70 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-extrabold text-amber-900">
                  <Hourglass size={15} aria-hidden className="mr-1 inline" /> Ciclo aguardando encerramento
                  <span className="ml-2 text-xs font-semibold text-amber-700">{formatDateShortBR(bounds.from)} → {formatDateShortBR(bounds.to)}</span>
                </p>
                {closePreview && <CloseCycleButton preview={closePreview} />}
              </div>
              {closePreview && closePreview.blockers.length > 0 ? (
                <div className="mt-2">
                  <p className="text-xs font-bold text-amber-800">Faltam resolver para encerrar:</p>
                  <ul className="mt-1 space-y-1">
                    {closePreview.blockers.map((b) => (
                      <li key={b} className="flex items-start gap-1.5 text-xs font-medium text-amber-700">
                        <ChevronDown size={13} aria-hidden className="mt-0.5 shrink-0 -rotate-90" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : closePreview ? (
                <p className="mt-1.5 text-xs font-medium text-amber-800">Ciclo terminado e pronto para o encerramento definitivo.</p>
              ) : null}
            </div>
          )}

          {situation === "closed" && closureDoCiclo && (
            <div className="rounded-2xl border border-violet-300 bg-violet-50/60 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-extrabold text-violet-900">
                  <Lock size={14} aria-hidden className="mr-1 inline" /> Ciclo encerrado
                  <span className="ml-2 text-xs font-semibold text-violet-700">{formatDateShortBR(closureDoCiclo.cycleStart)} → {formatDateShortBR(closureDoCiclo.cycleEnd)}</span>
                </p>
                <Badge tone="violet">Definitivo</Badge>
              </div>
              <dl className="mt-2 grid gap-2 grid-cols-2 sm:grid-cols-4">
                <div className="rounded-xl border border-violet-200 bg-white px-3 py-2"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Gerado no ciclo</dt><dd className="text-base font-extrabold tabular-nums text-slate-900">{formatMinutes(bank.generatedMinutes)}</dd></div>
                {bank.carriedMinutes > 0 && (
                  <div className="rounded-xl border border-sky-200 bg-white px-3 py-2"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Trazido do ciclo anterior</dt><dd className="text-base font-extrabold tabular-nums text-sky-700">{formatMinutes(bank.carriedMinutes)}</dd></div>
                )}
                <div className="rounded-xl border border-violet-200 bg-white px-3 py-2"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Utilizado</dt><dd className="text-base font-extrabold tabular-nums text-emerald-600">{formatMinutes(bank.usedMinutes)}</dd></div>
                <div className="rounded-xl border border-violet-200 bg-white px-3 py-2"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Saldo final [10+]</dt><dd className="text-base font-extrabold tabular-nums text-indigo-600">{formatMinutes(closureDoCiclo.closingSpecialExcessMinutes)}</dd></div>
              </dl>
              <p className="mt-2 text-xs font-bold text-violet-800">
                Destinação:{" "}
                {closureDoCiclo.disposition === "liquidated" && "Liquidado no encerramento"}
                {closureDoCiclo.disposition === "carried" &&
                  `Transportado para o ciclo ${closureDoCiclo.destinationCycleStart ? cycleLabelOf(closureDoCiclo.destinationCycleStart) : "seguinte"}`}
                {closureDoCiclo.disposition === "none" && "Sem saldo [10+] a destinar"}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                Este ciclo não pode mais ser alterado: registros protegidos e períodos sem reabertura.
              </p>
            </div>
          )}

          {situation === "future" && (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm font-extrabold text-slate-700">
                <CalendarClock size={15} aria-hidden className="mr-1 inline" /> Ciclo futuro
                <span className="ml-2 text-xs font-semibold text-slate-400">{formatDateShortBR(bounds.from)} → {formatDateShortBR(bounds.to)}</span>
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">Este ciclo ainda não começou — sem geração ou saldo transportado até aqui.</p>
            </div>
          )}

          {/* Métricas operacionais do banco — somente ciclo em andamento ou
              aguardando encerramento (ciclo fechado/futuro tratados acima). */}
          {situation === "active" || situation === "awaiting-close" ? (
          <>
          {/* Quatro métricas — mesma fonte; DISPONÍVEL com prioridade visual. */}
          {/* 4E.1 — MOBILE: grid 2×2 (linha 1: Disponível | Gerado — indicador
              de decisão + dimensão total; linha 2: Reservado | Utilizado —
              consumo). DESKTOP (lg): inalterado, 4 cards em uma única linha. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              className="order-1 lg:order-1"
              label="Disponível [10+]"
              value={formatMinutes(bank.availableMinutes)}
              sub="gerado − reservado − utilizado"
              tone={bank.availableMinutes > 0 ? "indigo" : "slate"}
            />
            <StatCard compact className="order-3 lg:order-2" label="Reservado" value={formatMinutes(bank.reservedMinutes)} sub="reservas em aberto" tone={bank.reservedMinutes > 0 ? "amber" : "slate"} />
            <StatCard compact className="order-4 lg:order-3" label="Utilizado" value={formatMinutes(bank.usedMinutes)} sub="aplicado em jornadas" tone="emerald" />
            <StatCard compact className="order-2 lg:order-4" label="Gerado" value={formatMinutes(bank.generatedMinutes)} sub={`excedente acima de 10h · ciclo ${cicloAtivo}`} tone="slate" />
          </div>

          {/* 4H — Trazido do ciclo anterior: NUNCA dentro de "Gerado neste
              ciclo". Disponível reflete a capacidade (gerado + transportado). */}
          {bank.carriedMinutes > 0 && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5">
              <p className="text-sm font-bold text-sky-900">
                <ArrowLeftRight size={14} aria-hidden className="mr-1 inline" />
                Trazido do ciclo anterior: <b className="tabular-nums">{formatMinutes(bank.carriedMinutes)}</b>
                <span className="ml-2 text-xs font-semibold text-sky-700">operacional neste ciclo · não entra em “Gerado neste ciclo”</span>
              </p>
            </div>
          )}

          {/* 4H.2 — REORGANIZAÇÃO DOS LOTES: responde imediatamente
              "quais horas [10+] ainda tenho para usar?".
              A. HORAS [10+] DISPONÍVEIS (available > 0) — o valor em
                 destaque é o DISPONÍVEL; contexto/estatísticas ficam
                 secundárias; ação "Destinar horas" (fluxo inverso).
              B. HORAS [10+] TOTALMENTE DESTINADAS (available = 0) — 100%
                 comprometido (utilizado e/ou reservado); recolhido por
                 padrão; NADA é apagado/ocultado — apenas movido.
              Classificação DERIVADA do banco canônico 3C a cada render —
              NADA persistido (cancelada a reserva, o lote volta sozinho
              para "disponíveis"). */}
          {bank.lots.length === 0 ? (
            <EmptyState icon={<Database size={26} />} title="Nenhuma hora [10+] gerada neste ciclo." description="Dias com jornada acima de 10h aparecem aqui como origens rastreáveis." />
          ) : (
            <>
              {/* A — Disponíveis */}
              <section aria-label="Horas [10+] disponíveis" className="space-y-2">
                <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">Horas [10+] disponíveis</h3>
                <p className="-mt-1 text-[11px] font-medium text-slate-400">
                  Origens do [10+] com saldo para usar neste ciclo — o que ainda pode ser destinado.
                </p>
                {lotesDisponiveis.length === 0 ? (
                  <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-500">
                    Nenhuma hora [10+] disponível agora — todos os lotes estão totalmente destinados.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {lotesDisponiveis.map((lot) => {
                      const motivo = excessReasonOnDate(excessReasons, lot.originDate);
                      const reservas = reservasDaOrigem(lot);
                      return (
                        <article key={lot.originDate} className="rounded-2xl border border-indigo-100 bg-white px-4 py-3">
                          {/* 1) data/origem + 2) DISPONÍVEL em destaque + 6) ação */}
                          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-sm font-extrabold text-slate-800">{formatDateShortBR(lot.originDate)}</span>
                                {lot.carried && <Badge tone="sky">Trazido · origem factual {formatDateShortBR(lot.originDate)} ({lot.originCycle ?? "ciclo anterior"})</Badge>}
                                {motivo && <Badge tone="amber">{motivo.reason}</Badge>}
                                {lot.needsReview && <Badge tone="rose">Revisar</Badge>}
                              </div>
                              <p className="mt-0.5 text-lg font-extrabold tabular-nums text-indigo-600">
                                {formatMinutes(lot.availableMinutes)}{" "}
                                <span className="text-xs font-bold text-indigo-400">disponíveis</span>
                              </p>
                            </div>
                            {destinosElegiveis.length > 0 ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="w-full !border-violet-300 !text-violet-700 hover:!bg-violet-50 sm:w-auto"
                                onClick={() => setDestineLot(lot)}
                              >
                                <Timer size={13} /> Destinar horas
                              </Button>
                            ) : (
                              <div className="w-full sm:w-auto">
                                <Button size="sm" variant="secondary" disabled className="w-full sm:w-auto">
                                  <Timer size={13} /> Destinar horas
                                </Button>
                                <p className="text-[11px] font-medium text-slate-400">
                                  Não há dias abaixo da base disponíveis para receber estas horas.
                                </p>
                              </div>
                            )}
                          </div>
                          {/* 3) contexto + 4) Gerado / Utilizado / Reservado (secundário) */}
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            {lot.carried ? (
                              <>
                                Trazido do ciclo <b className="text-slate-700">{lot.originCycle ?? "anterior"}</b> · Trazido{" "}
                                <b className="text-slate-700">{formatMinutes(lot.carriedInMinutes ?? lot.availableMinutes)}</b> · Utilizado neste ciclo{" "}
                                <b className="text-slate-700">{formatMinutes(lot.usedMinutes)}</b> · Reservado{" "}
                                <b className="text-slate-700">{formatMinutes(lot.reservedMinutes)}</b>
                              </>
                            ) : (
                              <>
                                Gerado <b className="text-slate-700">{formatMinutes(lot.generatedMinutes)}</b> · Utilizado{" "}
                                <b className="text-slate-700">{formatMinutes(lot.usedMinutes)}</b> · Reservado{" "}
                                <b className="text-slate-700">{formatMinutes(lot.reservedMinutes)}</b>
                              </>
                            )}
                          </p>
                          {/* 5) destinos/rastreabilidade (expansão) */}
                          <details className="mt-2 border-t border-slate-100 pt-2">
                            <summary className="cursor-pointer text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                              Destinos das horas desta origem ({lot.destinations.length + reservas.length})
                            </summary>
                            <div className="mt-1.5 space-y-1.5">
                              {lot.destinations.length === 0 && reservas.length === 0 ? (
                                <p className="text-xs text-slate-500">Nenhum destino ainda — horas inteiramente disponíveis.</p>
                              ) : (
                                <>
                                  {lot.destinations.map((d) => destinoLine(d))}
                                  {reservas.map((pl) => (
                                    <div key={`pl-${pl.id}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                      <span className="font-semibold text-slate-700">
                                        <ArrowRight size={12} aria-hidden className="mr-1 inline text-amber-400" />
                                        {pl.allocations.filter((a) => a.originDate === lot.originDate).map((a) => (
                                          <span key={a.originDate}>
                                            {formatDateShortBR(pl.destinationDate)} → <b className="tabular-nums">{formatMinutes(a.minutes)}</b> reservado
                                          </span>
                                        ))}
                                        <span className="ml-1.5 font-medium text-slate-400">· {modoDaEstrategia(pl.selectionMode)}</span>
                                      </span>
                                      <Link href={reservasAbertasHref(pl.destinationDate, pl.destinationDate <= todayStr)} className="font-bold text-indigo-600 underline underline-offset-2 hover:text-indigo-800">
                                        Ver dia
                                      </Link>
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          </details>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* B — Totalmente destinadas (recolhido por padrão) */}
              {lotesTotalmenteDestinados.length > 0 && (
                <details className="rounded-2xl border border-slate-200 bg-white">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-extrabold uppercase tracking-wider text-slate-400">
                    Horas [10+] totalmente destinadas ({lotesTotalmenteDestinados.length})
                    <span className="ml-2 font-medium normal-case text-xs text-slate-400">100% comprometido · histórico preservado</span>
                  </summary>
                  <div className="space-y-2 border-t border-slate-100 px-4 pb-4 pt-3">
                    {lotesTotalmenteDestinados.map((lot) => {
                      const motivo = excessReasonOnDate(excessReasons, lot.originDate);
                      const reservas = reservasDaOrigem(lot);
                      return (
                        <div key={lot.originDate} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-sm font-extrabold text-slate-700">{formatDateShortBR(lot.originDate)}</span>
                              {lot.carried && <Badge tone="sky">Trazido ({lot.originCycle ?? "ciclo anterior"})</Badge>}
                              {motivo && <Badge tone="amber">{motivo.reason}</Badge>}
                              {lot.needsReview && <Badge tone="rose">Revisar</Badge>}
                            </span>
                            <Badge tone="slate">Totalmente destinado</Badge>
                          </div>
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            {lot.carried ? (
                              <>
                                Trazido <b className="text-slate-700">{formatMinutes(lot.carriedInMinutes ?? 0)}</b> · Utilizado neste ciclo{" "}
                                <b className="text-slate-700">{formatMinutes(lot.usedMinutes)}</b> · Reservado{" "}
                                <b className="text-slate-700">{formatMinutes(lot.reservedMinutes)}</b>
                              </>
                            ) : (
                              <>
                                Gerado <b className="text-slate-700">{formatMinutes(lot.generatedMinutes)}</b> · Utilizado{" "}
                                <b className="text-slate-700">{formatMinutes(lot.usedMinutes)}</b> · Reservado{" "}
                                <b className="text-slate-700">{formatMinutes(lot.reservedMinutes)}</b>
                              </>
                            )}{" "}
                            · Disponível <b className="text-slate-700">{formatMinutes(0)}</b>
                          </p>
                          {/* rastreabilidade ao expandir — nada é apagado */}
                          <details className="mt-1.5">
                            <summary className="cursor-pointer text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                              Destinos e rastreabilidade ({lot.destinations.length + reservas.length})
                            </summary>
                            <div className="mt-1.5 space-y-1.5">
                              {lot.destinations.length === 0 && reservas.length === 0 ? (
                                <p className="text-xs text-slate-500">Nenhum destino registrado.</p>
                              ) : (
                                <>
                                  {lot.destinations.map((d) => destinoLine(d))}
                                  {reservas.map((pl) => (
                                    <div key={`pl-${pl.id}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                      <span className="font-semibold text-slate-700">
                                        <ArrowRight size={12} aria-hidden className="mr-1 inline text-amber-400" />
                                        {pl.allocations.filter((a) => a.originDate === lot.originDate).map((a) => (
                                          <span key={a.originDate}>
                                            {formatDateShortBR(pl.destinationDate)} → <b className="tabular-nums">{formatMinutes(a.minutes)}</b> reservado
                                          </span>
                                        ))}
                                        <span className="ml-1.5 font-medium text-slate-400">· {modoDaEstrategia(pl.selectionMode)}</span>
                                      </span>
                                      <Link href={reservasAbertasHref(pl.destinationDate, pl.destinationDate <= todayStr)} className="font-bold text-indigo-600 underline underline-offset-2 hover:text-indigo-800">
                                        Ver dia
                                      </Link>
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </>
          )}

          {/* Reservas em aberto */}
          <section aria-label="Reservas em aberto" className="space-y-2">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">Reservas em aberto</h3>
            {reservas.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-500">Não há reservas em aberto.</p>
            ) : (
              reservas.map((p) => {
                const chegou = p.destinationDate <= todayStr;
                return (
                  <div key={p.id} className="flex flex-col gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-amber-900">
                        <Hourglass size={14} aria-hidden className="mr-1 inline" />
                        {formatDateShortBR(p.destinationDate)} → <b className="tabular-nums">{formatMinutes(specialExcessPlanMinutes(p))}</b>
                        <span className="ml-1.5 font-medium text-amber-700/80">· {modoDaEstrategia(p.selectionMode)} · {STATUS_PLANO[p.status] ?? p.status}</span>
                      </p>
                      <p className="text-xs font-medium text-amber-700">
                        Origem: {p.allocations.map((a, i) => (
                          <span key={a.originDate}>{i > 0 && ", "}<b className="tabular-nums">{formatDateShortBR(a.originDate)}</b> ({formatMinutes(a.minutes)})</span>
                        ))}
                        {chegou ? " · chegou ao dia — aguardando confirmação" : " · reserva para o dia indicado"}
                      </p>
                    </div>
                    <Link
                      href={reservasAbertasHref(p.destinationDate, chegou)}
                      className="shrink-0 text-sm font-bold text-amber-800 underline underline-offset-2 hover:text-amber-900"
                    >
                      {chegou ? "Gerenciar no dia" : "Abrir em Registros"}
                    </Link>
                  </div>
                );
              })
            )}
          </section>

          {/* Usos realizados */}
          <section aria-label="Usos realizados" className="space-y-2">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">Usos realizados</h3>
            {usos.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-500">Não há usos realizados.</p>
            ) : (
              <div className="space-y-2">
                {usos.map((u) => (
                  <div key={u.id} className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-emerald-900">
                        <ArrowLeftRight size={14} aria-hidden className="mr-1 inline" />
                        {formatDateShortBR(u.destinationDate)} → <b className="tabular-nums">{formatMinutes(specialExcessUseMinutes(u))}</b>
                        <span className="ml-1.5 font-medium text-emerald-700/80">· {modoDaEstrategia(u.allocationStrategy)} · {STATUS_USO[u.status] ?? u.status}</span>
                        {/* 4G — rastreabilidade: uso com destino em período consolidado */}
                        {consolidationLockForDate(periodConsolidations, u.destinationDate) && (
                          <span className="ml-1.5 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-violet-800">Consolidado</span>
                        )}
                      </p>
                      <p className="text-xs font-medium text-emerald-700">
                        Origem: {u.allocations.map((a, i) => (
                          <span key={a.originDate}>{i > 0 && ", "}<b className="tabular-nums">{formatDateShortBR(a.originDate)}</b> ({formatMinutes(a.minutes)})</span>
                        ))}
                        <span className="ml-1 font-medium text-emerald-600/80">· uso é projeção oficial; não altera a jornada real nem o saldo factual</span>
                      </p>
                    </div>
                    <Link href={linkDia(u.destinationDate)} className="shrink-0 text-sm font-bold text-emerald-800 underline underline-offset-2 hover:text-emerald-900">
                      Abrir em Registros
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Histórico cancelado (recolhível, somente se houver) */}
          {(canceladosPlanos.length > 0 || canceladosUsos.length > 0) && (
            <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <summary className="cursor-pointer text-sm font-extrabold text-slate-600">
                Histórico cancelado ({canceladosPlanos.length + canceladosUsos.length})
                <span className="ml-1.5 text-xs font-medium text-slate-400">não soma no banco atual — rastreabilidade</span>
              </summary>
              <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5">
                {canceladosPlanos.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span>
                      Reserva {formatDateShortBR(p.destinationDate)} → <b className="tabular-nums">{formatMinutes(specialExcessPlanMinutes(p))}</b>
                      {" · origem "}{p.allocations.map((a) => formatDateShortBR(a.originDate)).join(", ")}
                    </span>
                    <Badge tone="slate">{STATUS_PLANO[p.status] ?? p.status}</Badge>
                  </div>
                ))}
                {canceladosUsos.map((u) => (
                  <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span>
                      Uso {formatDateShortBR(u.destinationDate)} → <b className="tabular-nums">{formatMinutes(specialExcessUseMinutes(u))}</b>
                      {" · origem "}{u.allocations.map((a) => formatDateShortBR(a.originDate)).join(", ")}
                    </span>
                    <Badge tone="slate">{STATUS_USO[u.status] ?? u.status}</Badge>
                  </div>
                ))}
              </div>
            </details>
          )}
          </>
          ) : null}
        </>
      )}

      {tab === "calendario" && (
        <>
          {!calResumo.hasCalendar ? (
            <EmptyState
              icon={<CalendarOff size={26} />}
              title="Calendário da empresa não carregado"
              description="Adicione o calendário da empresa em Configurações para acompanhar os impactos do ciclo."
              action={<Link href="/configuracoes"><Button variant="secondary" size="sm"><Settings size={15} /> Ir para Configurações</Button></Link>}
            />
          ) : (
            <>
              {/* Dados cadastrados do ciclo — configuração ORIGINAL, não pendência atual. */}
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="Datas no calendário" value={String(calResumo.dateCount)} sub={`ciclo ${calResumo.label ?? cicloAtivo}`} tone="slate" />
                <StatCard compact label="Carga COMPENSAR cadastrada" value={formatMinutes(calResumo.compLoadMinutes)} sub="configuração original do calendário" tone="slate" />
                <StatCard compact label="Horas ABONADAS cadastradas" value={formatMinutes(calResumo.abonadasMinutes)} sub="configuração original do calendário" tone="slate" />
              </div>

              {/* Impacto futuro conhecido — fonte: buildCalendarForecast */}
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
                <p className="text-sm font-bold text-amber-900">
                  <CalendarClock size={15} aria-hidden className="mr-1 inline" />
                  Impacto futuro conhecido (previsão): {impactoFuturo < 0 ? "" : "+"}{formatMinutes(impactoFuturo)}
                  <span className="ml-1.5 font-medium text-amber-700/80">
                    · {calEventos.future.filter((e) => (e.impactoFuturoConhecidoMinutes ?? 0) !== 0).length} evento(s) futuro(s) com impacto · {calEventos.future.length} evento(s) futuro(s) no total
                  </span>
                </p>
                <p className="mt-0.5 text-xs font-medium text-amber-700">
                  Eventos já realizados estão refletidos no saldo factual — nunca somados aqui.
                </p>
              </div>

              {/* Próximos eventos (crescente) */}
              <section aria-label="Próximos eventos" className="space-y-2">
                <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">Próximos eventos</h3>
                {calEventos.future.length === 0 ? (
                  <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-500">Nenhum evento futuro neste ciclo.</p>
                ) : (
                  calEventos.future.map((e) => (
                    <div key={e.date} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800">
                          {formatDateShortBR(e.date)} — {e.descricao}
                          <Badge tone="slate">{tratamentoLabel(e.tratamento)}</Badge>
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-slate-500">
                          Base referência <b className="text-slate-700">{formatMinutes(e.baseReferenciaMinutes)}</b> · Crédito calendário{" "}
                          <b className="text-slate-700">{formatMinutes(e.creditoCalendarioMinutes)}</b> · Jornada a cumprir{" "}
                          <b className="text-slate-700">{formatMinutes(e.jornadaACumprirMinutes)}</b>
                        </p>
                        <p className="text-xs font-medium text-slate-500">
                          {e.tratamento === "ABONADO" && "Dia abonado — neutro (sem impacto)."}
                          {e.tratamento === "ABONADO_PARCIAL" && "Parcial: crédito do calendário + jornada regular a cumprir — sem impacto automático."}
                          {/* 4E.1: a classificação vem do contexto canônico
                              (jornadaParcial) — COMPENSAR parcial (ex.: Cinzas
                              4h+4h) NUNCA é "folga integral" nem recebe impacto
                              futuro automático; integral mantém o rótulo. */}
                          {e.tratamento === "COMPENSAR" &&
                            (e.jornadaParcial
                              ? "Jornada parcial — sem impacto futuro automático."
                              : "Folga integral a compensar — impacto conhecido no futuro.")}
                          {e.impactoFuturoConhecidoMinutes !== null && !e.jornadaParcial && (
                            <span className="ml-1 font-bold text-amber-700">Impacto conhecido: {formatMinutes(e.impactoFuturoConhecidoMinutes)}</span>
                          )}
                        </p>
                      </div>
                      <Link href={linkDia(e.date)} className="shrink-0 text-xs font-bold text-indigo-600 underline underline-offset-2 hover:text-indigo-800">
                        Ver dia
                      </Link>
                    </div>
                  ))
                )}
              </section>

              {/* Eventos realizados (mais recente primeiro) */}
              <section aria-label="Eventos realizados" className="space-y-2">
                <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">Eventos realizados</h3>
                <p className="text-xs font-medium text-slate-500">Efeito já refletido no saldo factual — esta é a história do ciclo, não cobrança extra.</p>
                {calEventos.past.length === 0 ? (
                  <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-500">Nenhum evento realizado ainda neste ciclo.</p>
                ) : (
                  calEventos.past.map((e) => (
                    <div key={e.date} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800">
                          {formatDateShortBR(e.date)} — {e.descricao}
                          <Badge tone="slate">{tratamentoLabel(e.tratamento)}</Badge>
                          {e.preControlStartDate && <Badge tone="slate">pré-início do controle</Badge>}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-slate-500">
                          Base referência <b className="text-slate-700">{formatMinutes(e.baseReferenciaMinutes)}</b> · Crédito calendário{" "}
                          <b className="text-slate-700">{formatMinutes(e.creditoCalendarioMinutes)}</b> · Jornada a cumprir{" "}
                          <b className="text-slate-700">{formatMinutes(e.jornadaACumprirMinutes)}</b>
                          {e.trabalhadoMinutes !== undefined && (
                            <> · Trabalhado real <b className="text-slate-700">{formatMinutes(e.trabalhadoMinutes)}</b> · Saldo factual do dia{" "}
                            <b className={e.saldoFactualMinutes && e.saldoFactualMinutes < 0 ? "text-rose-600" : "text-emerald-600"}>{formatMinutes(e.saldoFactualMinutes ?? 0)}</b></>
                          )}
                        </p>
                        {e.trabalhoEmAbonado && (
                          <p className="mt-0.5 text-xs font-semibold text-amber-700">
                            Há trabalho registrado neste dia abonado. Consulte a regra da empresa antes de considerar qualquer efeito.
                          </p>
                        )}
                      </div>
                      <Link href={linkDia(e.date)} className="shrink-0 text-xs font-bold text-indigo-600 underline underline-offset-2 hover:text-indigo-800">
                        Ver dia
                      </Link>
                    </div>
                  ))
                )}
              </section>
            </>
          )}
        </>
      )}

      {/* Histórico legado (read-only) — apenas se houver registros legados. */}
      {(compensations ?? []).length > 0 && (
        <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-extrabold text-slate-600">
            Histórico legado — compensações externas ({(compensations ?? []).length})
            <span className="ml-1.5 text-xs font-medium text-slate-400">somente leitura · os fluxos atuais são o calendário e o banco [10+]</span>
          </summary>
          <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5">
            {(compensations ?? []).slice().sort((a, b) => b.createdAt - a.createdAt).map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>
                  {c.kind === "calendario" && <Badge tone="slate">Compensação externa registrada</Badge>}
                  {formatDateShortBR(c.sourceDate)} → {formatDateShortBR(c.targetDate)} · <b className="tabular-nums">{formatMinutes(c.minutes)}</b>
                </span>
                <Badge tone={c.status === "concluida" ? "emerald" : c.status === "cancelada" ? "slate" : "amber"}>{c.status}</Badge>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 4H.2 — FLUXO INVERSO: modal "Destinar horas [10+]" com a origem fixa
          no lote escolhido (o MESMO componente do DayCard de Registros; o
          resultado é o MESMO SpecialExcessUse do fluxo destino→origem). */}
      {destineLot && (
        <SpecialExcessDestineModal
          origin={{
            originDate: destineLot.originDate,
            cycle: cicloAtivo,
            ...(destineLot.carried
              ? { carried: true as const, carriedInMinutes: destineLot.carriedInMinutes, originCycle: destineLot.originCycle }
              : {}),
          }}
          onClose={() => setDestineLot(null)}
        />
      )}
    </div>
  );
}
