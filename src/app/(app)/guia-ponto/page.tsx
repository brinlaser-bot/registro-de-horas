"use client";

/**
 * ETAPA 4I — GUIA DO PONTO (página READ-ONLY).
 *
 * Visão única para alimentar o sistema oficial: batidas reais + batidas
 * sugeridas, limitada pela projeção oficial CANÔNICA (3A). Esta página
 * NÃO possui nenhuma ação mutável: editar batida, registrar falta, criar
 * [10+], cancelar uso, consolidar, reabertura de período ou alteração de
 * calendário ficam fora daqui (links para Registros/Central/Resumo).
 *
 * Nenhum estado visual do Guia é persistido (filtros são locais).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Clock3,
  ExternalLink,
  Hourglass,
  Lock,
  TriangleAlert,
} from "lucide-react";
import { settingsOf, useAppData, useIsClient } from "@/lib/store";
import { formatMinutes, todayString } from "@/lib/time";
import {
  getNextPointPeriod,
  getPointPeriod,
  getPreviousPointPeriod,
  PERIOD_CONTEXT_LABEL,
  periodLabel,
  pointPeriodContext,
  samePointPeriod,
  type PointPeriod,
} from "@/lib/periods";
import {
  buildPointGuideView,
  guideLimitsOf,
  type PointGuideDayRow,
} from "@/lib/point-guide";
import { PERIOD_CONSOLIDATION_LABEL } from "@/lib/period-consolidation";
import { Badge, Skeleton } from "@/components/ui";
import { PeriodNavigator } from "@/components/period-navigator";

/* ── chips de batidas (mobile: quebram em linhas, sem overflow) ── */
function PunchChips({ times, tone }: { times: string[]; tone: "real" | "suggested" }) {
  if (times.length === 0) {
    return <p className="text-sm font-semibold text-slate-400">Nenhuma batida</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {times.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums ${
            tone === "real"
              ? "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200"
              : "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200"
          }`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function DayGuideCard({ day }: { day: PointGuideDayRow }) {
  const hasFacts = day.punchCount > 0;
  const hasSpecial =
    day.specialUsedMinutes > 0 || day.specialGeneratedMinutes > 0 || day.specialReservedMinutes > 0;
  const calendarInfo =
    day.calendarLabel ||
    (day.calendarEntry
      ? `${day.calendarEntry.tratamento} — ${day.calendarEntry.descricao}`
      : null);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* Cabeçalho do dia */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-extrabold tracking-tight text-slate-900">
            {day.date.slice(8, 10)}/{day.date.slice(5, 7)}/{day.date.slice(0, 4)}
          </h3>
          <span className="text-xs font-semibold capitalize text-slate-500">· {day.weekday}</span>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {day.consolidated && (
            <Badge tone="violet">
              <Lock size={11} aria-hidden /> Consolidado
            </Badge>
          )}
          <Badge tone={day.attention ? "rose" : day.ready ? "emerald" : "amber"}>
            {day.situacao}
          </Badge>
        </div>
      </div>

      {/* PRECISA DE ATENÇÃO */}
      {day.attention && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-rose-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-rose-700">
              Precisa de atenção
            </p>
            {day.suggestion.message && (
              <p className="mt-0.5 break-words text-xs font-medium text-rose-800">
                {day.suggestion.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Batidas reais × Sugestão */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            Batidas reais
          </p>
          <div className="mt-1.5">
            <PunchChips times={day.realPunches} tone="real" />
          </div>
          <div className="mt-2 space-y-1 text-xs text-slate-600">
            <p className="break-words">
              <b className="text-slate-800">Jornada real:</b>{" "}
              {hasFacts ? formatMinutes(day.jornadaRealMinutes) : "—"}
            </p>
            {hasFacts && !day.attentionCategories.includes("incompleto") && (
              <p className="break-words">
                <b className="text-slate-800">Saldo do dia:</b>{" "}
                <span className={day.saldoRegularMinutes < 0 ? "font-bold text-rose-600" : "font-bold text-slate-800"}>
                  {day.saldoLabel}
                </span>
              </p>
            )}
            {day.missingExpected && (
              <p className="break-words font-semibold text-amber-700">Sem registro no dia</p>
            )}
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">
            Sugestão para o ponto
          </p>
          <div className="mt-1.5">
            {day.suggestion.punches.length > 0 ? (
              <PunchChips times={day.suggestion.punches} tone="suggested" />
            ) : (
              <p className="break-words text-sm font-semibold text-emerald-900">
                {day.suggestion.message ?? "Sem orientação automática."}
              </p>
            )}
          </div>
          {day.suggestion.representableMinutes > 0 && (
            <p className="mt-1.5 break-words text-[11px] font-semibold text-emerald-800">
              Representado nas batidas sugeridas: {formatMinutes(day.suggestion.representableMinutes)}
            </p>
          )}
          <p className="mt-1.5 break-words text-xs font-bold text-emerald-900">
            Total considerado no ponto:{" "}
            <span className="tabular-nums">{formatMinutes(day.totalNoPontoMinutes)}</span>
          </p>
          {day.suggestion.remainingMinutes > 0 && (
            <p className="mt-1 break-words text-[11px] font-semibold text-amber-800">
              Ainda a representar: {formatMinutes(day.suggestion.remainingMinutes)}
            </p>
          )}
        </div>
      </div>

      {/* [10+] — utilização / geração / reserva */}
      {hasSpecial && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {day.specialUsedMinutes > 0 && (
            <Badge tone="amber">[10+] utilizado: {formatMinutes(day.specialUsedMinutes)}</Badge>
          )}
          {day.specialGeneratedMinutes > 0 && (
            <Badge tone="indigo">[10+] gerado: {formatMinutes(day.specialGeneratedMinutes)}</Badge>
          )}
          {day.specialReservedMinutes > 0 && (
            <Badge tone="sky">
              [10+] reservado/planejado: {formatMinutes(day.specialReservedMinutes)}
            </Badge>
          )}
        </div>
      )}

      {/* Calendário/ausência (contexto canônico) */}
      {(calendarInfo || day.calendarCreditMinutes > 0 || day.calendarRequiredWorkMinutes > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
            <CalendarDays size={13} aria-hidden /> {calendarInfo ?? "Calendário da empresa"}
          </span>
          {day.calendarCreditMinutes > 0 && (
            <span>Crédito calendário: {formatMinutes(day.calendarCreditMinutes)}</span>
          )}
          {day.calendarRequiredWorkMinutes > 0 && (
            <span>Obrigação: {formatMinutes(day.calendarRequiredWorkMinutes)}</span>
          )}
        </div>
      )}
      {day.absenceLabel && !calendarInfo && (
        <p className="mt-2 break-words text-xs font-semibold text-slate-500">
          {day.absenceLabel} — tratamento próprio no sistema oficial.
        </p>
      )}

      {/* Links de leitura (nunca ações) */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <Link
          href={`/registros?data=${day.date}&escopo=ciclo`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200"
        >
          <CalendarClock size={13} aria-hidden /> Abrir em Registros
          <ExternalLink size={11} aria-hidden />
        </Link>
        <Link
          href={`/resumo?data=${day.date}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200"
        >
          <ArrowRight size={13} aria-hidden /> Ver no Resumo
        </Link>
      </div>
    </article>
  );
}

function GuideSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-40" />
      <Skeleton className="h-24" />
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-64" />
      ))}
    </div>
  );
}

export default function GuiaPontoPage() {
  return <GuiaPontoBody />;
}

function GuiaPontoBody() {
  const mounted = useIsClient();
  const { user, entries, absences, companyCalendars, faltas, specialExcessUses, specialExcessPlans, periodConsolidations } =
    useAppData();
  const today = todayString();
  const currentPeriod = getPointPeriod(today);
  const [period, setPeriod] = useState<PointPeriod>(() => currentPeriod);
  // Filtro visual LOCAL — nunca persistido (§19).
  const [filter, setFilter] = useState<"todos" | "prontos" | "atencao">("todos");

  const view = useMemo(
    () =>
      buildPointGuideView({
        period,
        today,
        entries,
        absences,
        calendars: companyCalendars,
        settings: settingsOf(user),
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
        consolidations: periodConsolidations,
        limits: guideLimitsOf(user),
      }),
    [period, today, entries, absences, companyCalendars, user, faltas, specialExcessUses, specialExcessPlans, periodConsolidations],
  );

  const viewingCurrentPeriod = samePointPeriod(period, currentPeriod);
  const contextoPeriodo = pointPeriodContext(period, currentPeriod);

  const filteredDays = view.days.filter((d) => {
    if (filter === "prontos") return d.realized && d.ready;
    if (filter === "atencao") return d.realized && d.attention;
    return true;
  });

  if (!mounted) return <GuideSkeleton />;

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">GUIA DO PONTO</h1>
          <Badge tone="slate" className="shrink-0">
            <BookOpen size={12} aria-hidden /> Leitura
          </Badge>
        </div>
        <p className="mt-0.5 text-sm font-medium text-slate-500">
          Veja suas batidas e o que considerar ao lançar o período no sistema oficial.
        </p>
      </div>

      {/* Período + status (mesma semântica canônica dos períodos do ponto) */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigator
            fullLabel={`Período do ponto: ${periodLabel(period)}`}
            shortLabel={`${period.from.slice(8)}/${period.from.slice(5, 7)} → ${period.to.slice(8)}/${period.to.slice(5, 7)}`}
            onPrev={() => setPeriod(getPreviousPointPeriod(period))}
            onNext={() => setPeriod(getNextPointPeriod(period))}
            contextLabel={PERIOD_CONTEXT_LABEL[contextoPeriodo]}
            onBackToCurrent={viewingCurrentPeriod ? undefined : () => setPeriod(currentPeriod)}
          />
          <Badge
            tone={
              view.state === "consolidado"
                ? "violet"
                : view.state === "reaberto-para-ajustes"
                  ? "amber"
                  : view.state === "encerrado-com-pendencias"
                    ? "rose"
                    : view.state === "pronto-para-consolidar"
                      ? "indigo"
                      : "emerald"
            }
          >
            {PERIOD_CONSOLIDATION_LABEL[view.state]}
          </Badge>
        </div>
        <p className="break-words text-xs font-bold text-slate-500">
          Período: {periodLabel(period)}
          <span className="font-semibold text-slate-400">
            {" "}
            · limites de sugestão: entrada ≥ {view.limits.minEntry} · saída ≤ {view.limits.maxExit}
          </span>
        </p>
        {view.consolidation && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-violet-300 bg-violet-50/60 px-4 py-2.5">
            <Lock size={14} className="shrink-0 text-violet-600" aria-hidden />
            <p className="min-w-0 flex-1 break-words text-xs font-bold text-violet-900">
              Período consolidado — leitura somente. Revisão {view.consolidation.revision}.
            </p>
            <Link href="/resumo" className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-700 hover:underline">
              Ver detalhes no Resumo <ExternalLink size={11} aria-hidden />
            </Link>
          </div>
        )}
      </div>

      {/* Resumo compacto */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600">
            Dias prontos
          </p>
          <p className="mt-0.5 text-xl font-extrabold tabular-nums text-emerald-900">
            {view.summary.readyDays}
          </p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-3">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600">
            Atenção
          </p>
          <p className="mt-0.5 text-xl font-extrabold tabular-nums text-rose-900">
            {view.summary.attentionDays}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            Futuros
          </p>
          <p className="mt-0.5 text-xl font-extrabold tabular-nums text-slate-700">
            {view.summary.futureDays}
          </p>
        </div>
      </div>

      {/* Filtros (somente locais) */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-sm font-extrabold uppercase tracking-wider text-slate-500">
          Dias do período
        </h2>
        {(
          [
            ["todos", "Todos"],
            ["prontos", "Prontos"],
            ["atencao", "Atenção"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`inline-flex h-8 items-center rounded-lg px-3 text-xs font-bold transition-colors ${
              filter === id
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Dias (cronológicos) */}
      <div className="space-y-3">
        {filteredDays.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-semibold text-slate-400">
            Nenhum dia neste filtro.
          </div>
        ) : (
          filteredDays.map((d) => <DayGuideCard key={d.date} day={d} />)
        )}
      </div>

      {/* Rodapé informativo */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <Clock3 size={14} className="shrink-0 text-slate-400" aria-hidden />
        <p className="min-w-0 flex-1 break-words">
          O Guia é somente orientação de lançamento: as batidas sugeridas não são batidas reais, não
          alteram saldo factual nem criam jornada. Confirme o tratamento com o sistema oficial.
          <span className="block font-semibold text-slate-600">
            <Hourglass size={11} className="mr-1 inline" aria-hidden />
            Horários configurados em CONFIGURAÇÕES → Guia do Ponto.
          </span>
        </p>
      </div>
    </div>
  );
}
