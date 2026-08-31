"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Download, TrendingUp, TriangleAlert, Wallet } from "lucide-react";
import { settingsOf, useAppData, useIsClient } from "@/lib/store";
import { formatMinutes, todayString, weekdayShort } from "@/lib/time";
import {
  getNextPointPeriod,
  getPointPeriod,
  getPreviousPointPeriod,
  periodLabel,
  samePointPeriod,
  type PointPeriod,
} from "@/lib/periods";
import { pendingPunchDates } from "@/lib/pending-punches";
import {
  buildResumoPeriodView,
  resumoDayPending,
  resumoProjectionVisible,
  type ResumoBankPanel,
  type ResumoDetailRow,
} from "@/lib/resumo-period-view";
import { resumoEventKind, resumoFinancialFrozen } from "@/lib/resumo-days";
import { Badge, Button, Card, EmptyState, Skeleton, StatCard } from "@/components/ui";
import { StackedPeriodChart } from "@/components/stacked-period-chart";

/** +30min / -1h30 / 0min — convenção de sinal do Resumo. */
function fmtSigned(v: number): string {
  return `${v > 0 ? "+" : ""}${formatMinutes(v)}`;
}

export default function ResumoPage() {
  const mounted = useIsClient();
  const { user, entries, compensations, absences, companyCalendars, faltas, specialExcessUses } = useAppData();
  const settings = settingsOf(user);
  const todayStr = todayString();
  const currentPeriod = getPointPeriod(todayStr);
  const [period, setPeriod] = useState<PointPeriod>(() => getPointPeriod(todayString()));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const viewingCurrentPeriod = samePointPeriod(period, currentPeriod);

  // ETAPA 3F — derivação ÚNICA do Resumo (fatos + 2A + 3A + 3B + 3C):
  // cards, composição, banco anual [10+], projeção e linhas do detalhamento
  // (mesma fonte para tabela desktop, cards mobile e CSV).
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
      }),
    [entries, absences, companyCalendars, settings, faltas, period, todayStr, user.controlStartDate, specialExcessUses],
  );

  // Pendências OPERACIONAIS (não representam dívida financeira) + contagens
  // factuais de ausências — a apuração financeira vive na `view` acima.
  const detailStats = useMemo(() => {
    let vacationDays = 0, healthDays = 0, waivedDays = 0;
    for (const r of view.days) {
      if (r.day.absence?.kind === "ferias") vacationDays += 1;
      if (r.day.absence?.kind === "saude") healthDays += 1;
      if (r.day.absence && (r.day.absence.kind === "outro" || (r.day.absence.kind === "acordado" && r.day.absence.treatment === "dispensado"))) {
        waivedDays += 1;
      }
    }
    let faltaDays = 0, faltaPrevistaDays = 0;
    for (const f of faltas) {
      if (f.date < period.from || f.date > period.to) continue;
      if (f.date <= todayStr) faltaDays += 1;
      else faltaPrevistaDays += 1;
    }
    return {
      vacationDays,
      healthDays,
      waivedDays,
      faltaDays,
      faltaPrevistaDays,
      pendingPunches: pendingPunchDates(entries, settings, todayStr, period).length,
      missingRecords: view.days.filter((r) => r.day.missingExpected).length,
    };
  }, [view, entries, settings, period, todayStr, faltas]);

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
  const projAppliedDays = projection.days.filter((d) => d.appliedSpecialMinutes > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPeriod(getPreviousPointPeriod(period))} aria-label="Período anterior">
            <ChevronLeft size={16} />
          </Button>
          <div className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-extrabold text-slate-800">
            Período do ponto: {periodLabel(period)}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setPeriod(getNextPointPeriod(period))} aria-label="Próximo período">
            <ChevronRight size={16} />
          </Button>
          {!viewingCurrentPeriod && (
            <Button variant="secondary" size="sm" onClick={() => setPeriod(currentPeriod)}>
              Período atual
            </Button>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={exportCsv}>
          <Download size={14} /> Exportar CSV
        </Button>
      </div>

      {(() => {
        const n = pendingPunchDates(entries, settings, todayStr, period).length;
        if (n <= 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-amber-800">Registros pendentes: {n}</p>
              <p className="mt-0.5 text-xs text-amber-700">O saldo pode sofrer alteração após a correção dos registros pendentes.</p>
            </div>
            <Link href="/registros?pendentes=1">
              <Button size="sm" variant="warning">Ver pendências</Button>
            </Link>
          </div>
        );
      })()}
      {detailStats.missingRecords > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-amber-800">Dias sem registro: {detailStats.missingRecords}</p>
            <p className="mt-0.5 text-xs text-amber-700">Existem dias de expediente sem registro ou justificativa.</p>
          </div>
          <Link href="/registros?semRegistro=1">
            <Button size="sm" variant="warning">Ver dias sem registro</Button>
          </Link>
        </div>
      )}

      {/* QUATRO CARDS PRINCIPAIS — leitura rápida do período (3F):
          A) Horas registradas (fato registrado) · B) Saldo regular factual
          C) [10+] gerado no período · D) Projeção no ponto (3A, usos ativos) */}
      <div className="grid grid-cols-2 items-stretch gap-4 lg:grid-cols-4">
        <StatCard
          label="Horas registradas"
          value={formatMinutes(cards.registeredMinutes)}
          sub={cards.hasPendingRegisteredDays ? "Inclui horas registradas em dias pendentes." : "no período"}
          icon={<Clock3 size={16} />}
        />
        <StatCard
          label="Saldo regular"
          value={fmtSigned(cards.regularBalanceMinutes)}
          sub="Saldo factual dentro do limite diário de 10h."
          tone={cards.regularBalanceMinutes > 0 ? "emerald" : cards.regularBalanceMinutes < 0 ? "rose" : "slate"}
          icon={<Wallet size={16} />}
        />
        <StatCard
          label="[10+] gerado no período"
          value={formatMinutes(cards.specialGeneratedMinutes)}
          sub="Excedente factual acima de 10h/dia."
          tone={cards.specialGeneratedMinutes > 0 ? "violet" : "slate"}
          icon={<TriangleAlert size={16} />}
        />
        <StatCard
          label="Projeção no ponto"
          value={fmtSigned(projection.projectedBalanceMinutes)}
          sub={
            projApplied > 0
              ? `Inclui ${formatMinutes(projApplied)} de [10+] aplicado em ${projAppliedDays} dia(s).`
              : "Igual ao saldo factual (sem usos [10+] ativos)."
          }
          tone={projection.projectedBalanceMinutes > 0 ? "indigo" : projection.projectedBalanceMinutes < 0 ? "rose" : "slate"}
          icon={<TrendingUp size={16} />}
        />
      </div>

      {/* BANCO ANUAL [10+] (3C) — um painel por ciclo anual intersectado.
          Período que cruza 30/04 mostra ciclos SEPARADOS (nunca um único
          banco atravessando o fechamento). Distinto do "[10+] gerado no
          período" do card acima (escopo: ciclo × período). */}
      <Card
        title="Banco [10+]"
        subtitle="Banco anual do ciclo — atravessa os períodos do ponto (≠ gerado no período)"
      >
        <div className={view.banks.length > 1 ? "space-y-3" : undefined}>
          {view.banks.map((panel) => (
            <BankPanel key={panel.cycle} panel={panel} />
          ))}
        </div>
      </Card>

      <div>
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-left text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 cursor-pointer"
        >
          <span>{detailsOpen ? "Ocultar detalhes do período" : "Ver mais detalhes do período"}</span>
          {detailsOpen ? <ChevronUp size={18} className="shrink-0 text-slate-500" /> : <ChevronDown size={18} className="shrink-0 text-slate-500" />}
        </button>
        {detailsOpen && (
          <div className="mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
            {/* Composição do saldo regular (2A) — puramente explicativa:
                soma factual dos saldos positivos × negativos do período.
                Não há vínculo "qual crédito cobriu qual déficit". */}
            <DetailColumn title="Composição do saldo regular">
              <DetailRow label="Créditos regulares" value={fmtSigned(composition.generatedCreditMinutes)} />
              <DetailRow
                label="Jornadas abaixo da base"
                value={composition.generatedDeficitMinutes > 0 ? `-${formatMinutes(composition.generatedDeficitMinutes)}` : "0min"}
              />
              <DetailRow label="Saldo regular" value={fmtSigned(composition.netBalanceMinutes)} />
            </DetailColumn>
            <DetailColumn title="Ausências e abonos">
              <DetailRow label="Férias" value={String(detailStats.vacationDays)} />
              <DetailRow label="Saúde" value={String(detailStats.healthDays)} />
              <DetailRow label="Dispensados" value={String(detailStats.waivedDays)} />
              <DetailRow label="Faltas" value={String(detailStats.faltaDays)} />
              <DetailRow label="Faltas previstas" value={String(detailStats.faltaPrevistaDays)} />
            </DetailColumn>
          </div>
        )}
      </div>

      <Card
        title="Barras empilhadas do período"
        subtitle="Fatos da jornada: base · extra regular · [10+] acima de 10h — férias/afastamentos reduzem a base"
      >
        {/* Preparação + componente COMPARTILHADOS (src/components/stacked-period-chart):
            mesmo componente da Visão geral; aqui no modo factualOnly (3F),
            sem a camada legada de horas compensadas. */}
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
      </Card>

      <Card title="Detalhamento diário" subtitle="Clique em um dia na aba Registros para ver as batidas">
        {view.days.length === 0 ? (
          <EmptyState icon={<BarChart3 size={24} />} title="Sem registros neste período" />
        ) : (
          <>
            {/* DESKTOP / TABLET LARGO: tabela (base histórica) + colunas [10+] e Projeção */}
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="pb-2 pr-3">Dia</th>
                    <th className="pb-2 pr-3">Situação</th>
                    <th className="pb-2 pr-3 text-right">Trabalhado</th>
                    <th className="pb-2 pr-3 text-right">Jornada</th>
                    <th className="pb-2 pr-3 text-right">Saldo regular</th>
                    <th className="pb-2 pr-3 text-right">No ponto*</th>
                    <th className="pb-2 pr-3 text-right">[10+]</th>
                    <th className="pb-2 pr-3 text-right">Projeção**</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {view.days.map((r) => (
                    <DetailRowDesktop key={r.day.date} row={r} />
                  ))}
                  <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-extrabold text-slate-900">
                    <td className="py-3 pr-3">Total</td>
                    <td className="py-3 pr-3 text-slate-500">{totals.trackedDays} dia(s)</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{formatMinutes(cards.registeredMinutes)}</td>
                    <td className="py-3 pr-3" />
                    <td
                      className={`py-3 pr-3 text-right tabular-nums ${
                        cards.regularBalanceMinutes >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {fmtSigned(cards.regularBalanceMinutes)}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums text-indigo-600">
                      {formatMinutes(totals.noPontoValidMinutes)}
                    </td>
                    <td className="py-3 pr-3 text-right text-xs tabular-nums leading-tight">
                      <span className="block text-violet-600">Gerado {formatMinutes(totals.specialGeneratedMinutes)}</span>
                      <span className="block text-slate-600">Usado {formatMinutes(totals.specialUsedMinutes)}</span>
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums text-indigo-600">
                      {fmtSigned(projection.projectedBalanceMinutes)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* MOBILE: lista vertical compacta por dia — MESMA derivação
                (view.days); sem scroll horizontal para campos essenciais. */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {view.days.map((r) => (
                <DetailRowMobile key={r.day.date} row={r} />
              ))}
              <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 py-3 font-extrabold text-slate-900">
                <span>Total · {totals.trackedDays} dia(s)</span>
                <span className="text-right text-xs leading-tight">
                  <span className="block tabular-nums">Registradas {formatMinutes(cards.registeredMinutes)} · Saldo {fmtSigned(cards.regularBalanceMinutes)}</span>
                  <span className="block tabular-nums text-violet-600">
                    [10+] gerado {formatMinutes(totals.specialGeneratedMinutes)} · usado {formatMinutes(totals.specialUsedMinutes)}
                  </span>
                  <span className="block tabular-nums text-indigo-600">Projeção {fmtSigned(projection.projectedBalanceMinutes)}</span>
                </span>
              </li>
            </ul>

            <p className="mt-2 text-[11px] text-slate-400">
              * &quot;No ponto&quot; = total que pode ser lançado no sistema da empresa (limitado a{" "}
              {formatMinutes(settings.maxDailyMinutes)}/dia); o total soma apenas dias financeiramente
              válidos. Férias e afastamentos reduzem a jornada esperada do dia.
              ** Projeção = no ponto considerando usos [10+] ativos (3A); &quot;—&quot; quando não agrega
              informação. Dias com registro incompleto/inconsistente não recebem valores financeiros
              até a correção.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

/* ── Blocos de apoio ─────────────────────────────────────────────────── */

/** Banco anual [10+] de UM ciclo (3C): Gerado / Utilizado / Disponível. */
function BankPanel({ panel }: { panel: ResumoBankPanel }) {
  const { cycle, bank } = panel;
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3">
      <p className="text-xs font-extrabold uppercase tracking-wide text-violet-700">Ciclo {cycle}</p>
      <dl className="mt-2 grid grid-cols-3 gap-3">
        <div>
          <dt className="text-[11px] font-medium text-slate-500">Gerado</dt>
          <dd className="text-base font-extrabold tabular-nums text-slate-800">{formatMinutes(bank.generatedMinutes)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium text-slate-500">Utilizado</dt>
          <dd className="text-base font-extrabold tabular-nums text-slate-800">{formatMinutes(bank.usedMinutes)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium text-slate-500">Disponível</dt>
          <dd className="text-base font-extrabold tabular-nums text-violet-700">{formatMinutes(bank.availableMinutes)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Linha da tabela desktop (md+) — factual + [10+] + projeção 3A. */
function DetailRowDesktop({ row }: { row: ResumoDetailRow }) {
  const d = row.day;
  const frozen = resumoFinancialFrozen(d);
  const showProj = resumoProjectionVisible(row);
  return (
    <tr className="transition-colors hover:bg-slate-50/70">
      <td className="py-2.5 pr-3 font-bold text-slate-800">
        {weekdayShort(d.date).replace(".", "")}
        <span className="ml-1.5 font-medium text-slate-400">
          {d.date.slice(8)}/{d.date.slice(5, 7)}
        </span>
      </td>
      <td className="py-2.5 pr-3">
        <ResumoEventBadge day={d} />
      </td>
      <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-slate-900">
        {frozen ? "—" : formatMinutes(d.workedMinutes)}
      </td>
      <td className="py-2.5 pr-3 text-right tabular-nums text-slate-400">{formatMinutes(d.expectedMinutes)}</td>
      <td
        className={`py-2.5 pr-3 text-right font-bold tabular-nums ${
          frozen
            ? "text-slate-400"
            : d.balanceMinutes > 0
              ? "text-emerald-600"
              : d.balanceMinutes < 0
                ? "text-rose-600"
                : "text-slate-400"
        }`}
      >
        {frozen || d.faltaStatus === "prevista" || !(d.entryCount > 0 || d.eventLabel)
          ? "—"
          : fmtSigned(d.balanceMinutes)}
      </td>
      <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-indigo-600">
        {frozen || d.entryCount <= 0 ? "—" : formatMinutes(d.registrableMinutes)}
      </td>
      <td className="py-2.5 pr-3 text-right text-xs tabular-nums leading-tight">
        {row.specialGenerated > 0 || row.specialUsed > 0 ? (
          <span>
            {row.specialGenerated > 0 && (
              <span className="block font-bold text-violet-600">Gerado +{formatMinutes(row.specialGenerated)}</span>
            )}
            {row.specialUsed > 0 && <span className="block text-slate-600">Usado {formatMinutes(row.specialUsed)}</span>}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="py-2.5 pr-3 text-right text-xs font-bold tabular-nums">
        {showProj ? (
          <span className="text-indigo-600">
            {formatMinutes(row.projection.projectedWorkedMinutes)} / {fmtSigned(row.projection.projectedBalanceMinutes)}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}

/** Card/bloco vertical compacto por dia (mobile < md) — MESMA derivação.
    Sem scroll horizontal: grid de duas colunas com labels textuais. */
function DetailRowMobile({ row }: { row: ResumoDetailRow }) {
  const d = row.day;
  const pending = resumoDayPending(row);
  const frozen = resumoFinancialFrozen(d);
  const showProj = resumoProjectionVisible(row);
  return (
    <li className="px-1 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-800">
          {weekdayShort(d.date).replace(".", "")}
          <span className="ml-1.5 font-medium text-slate-400">
            {d.date.slice(8)}/{d.date.slice(5, 7)}
          </span>
        </span>
        <ResumoEventBadge day={d} />
      </div>
      {pending ? (
        <p className="mt-1.5 text-xs text-slate-500">
          Registro pendente. Os valores financeiros serão definidos após a correção.
        </p>
      ) : !frozen ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          <DetailField label="Trabalhado" value={d.workedMinutes > 0 ? formatMinutes(d.workedMinutes) : "—"} />
          <DetailField label="Jornada" value={formatMinutes(d.expectedMinutes)} className="text-slate-500" />
          <DetailField
            label="Saldo regular"
            value={fmtSigned(d.balanceMinutes)}
            className={d.balanceMinutes > 0 ? "text-emerald-600" : d.balanceMinutes < 0 ? "text-rose-600" : "text-slate-500"}
          />
          <DetailField label="No ponto" value={formatMinutes(d.registrableMinutes)} className="text-indigo-600" />
          {row.specialGenerated > 0 && (
            <DetailField label="[10+] gerado" value={`+${formatMinutes(row.specialGenerated)}`} className="text-violet-600" />
          )}
          {row.specialUsed > 0 && <DetailField label="[10+] usado" value={formatMinutes(row.specialUsed)} />}
          {showProj && (
            <DetailField
              label="Projeção"
              value={`${formatMinutes(row.projection.projectedWorkedMinutes)} / ${fmtSigned(row.projection.projectedBalanceMinutes)}`}
              className="text-indigo-600"
            />
          )}
        </dl>
      ) : null}
    </li>
  );
}

/** Campo label+valor do layout mobile (texto explícito — não depende de cor). */
function DetailField({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
      <dd className={`text-sm font-extrabold tabular-nums leading-snug ${className ?? "text-slate-800"}`}>{value}</dd>
    </div>
  );
}

function ResumoEventBadge({ day }: { day: ResumoDetailRow["day"] }) {
  const kind = resumoEventKind(day);
  if (kind === "—") return <span className="text-xs text-slate-300">—</span>;
  const tone =
    kind === "Sem registro" || kind === "Registro inconsistente" || kind === "Registro incompleto"
      ? "amber"
      : kind === "Jornada abaixo do previsto"
        ? "rose"
        : kind === "Acima do limite [10+]"
          ? "violet"
          : kind === "Folga"
            ? "sky"
            : kind === "Ok"
              ? "emerald"
              : kind === "Em andamento"
                ? "indigo"
                : kind === "Falta"
                  ? "rose"
                  : "sky";
  return <Badge tone={tone}>{kind}</Badge>;
}

function DetailColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-slate-50/80 px-3.5 py-3 ring-1 ring-slate-100">
      <h3 className="mb-3 text-[13px] font-bold text-slate-800">{title}</h3>
      <dl className="space-y-2">{children}</dl>
    </section>
  );
}

function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="min-w-0 shrink text-xs text-slate-500">
        {label}
        {hint ? <span className="mt-0.5 block text-[11px] font-medium text-slate-400">{hint}</span> : null}
      </dt>
      <dd className="ml-auto shrink-0 text-right text-sm font-extrabold tabular-nums leading-snug text-slate-800">{value}</dd>
    </div>
  );
}
