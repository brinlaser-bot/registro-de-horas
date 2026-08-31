"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Timer, TrendingDown, TriangleAlert, Wallet, Zap } from "lucide-react";
import { hourBankSummary, excessReasonOnDate, futureCommitmentsSummary } from "@/lib/hour-bank";
import { buildSpecialExcessBank } from "@/lib/special-excess-bank";
import type { SpecialExcessUse } from "@/lib/special-excess-use";
import { annualCycleBounds, annualCycleClose, getAnnualPointCycle } from "@/lib/periods";
import { computeDay, formatDateBR, formatDateShortBR, formatMinutes } from "@/lib/time";
import type { Absence } from "@/lib/absences";
import type { CompanyCalendars } from "@/lib/company-calendar";
import type { Compensation, ExcessReason, Falta, TimeEntry, WorkSettings } from "@/lib/types";
import { Badge, Card } from "@/components/ui";

interface Props {
  entries: TimeEntry[];
  compensations: Compensation[];
  absences: Absence[];
  companyCalendars: CompanyCalendars | undefined;
  faltas: Falta[];
  excessReasons: ExcessReason[] | undefined;
  settings: WorkSettings;
  /** Período atual do ponto (21→20). */
  range: { from: string; to: string };
  today: string;
  /** 3H: usos ativos do banco [10+] (fonte canônica 3C). */
  specialExcessUses?: SpecialExcessUse[];
  /** 3H: início do controle do usuário (insumo do banco canônico). */
  controlStartDate?: string | null;
  /** Abre o modal de motivo do excedente da data informada. */
  onRegisterReason?: (date: string) => void;
}

function Row({
  icon,
  label,
  value,
  tone,
  title,
  sub,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
  title?: string;
  /** 3H: informação secundária discreta (ex.: gerado · utilizado). */
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400" title={title}>
          {label}
        </p>
        <p className="text-lg font-extrabold tabular-nums text-slate-900">{value}</p>
        {sub != null && <p className="mt-0.5 text-[11px] font-medium text-slate-500">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * BANCO DE HORAS (§2/§4): visão de CONSULTA do próprio banco — saldo
 * realizado somente com FATOS (batidas/faltas efetivas), horas positivas
 * regulares livres, déficits em aberto e a reserva especial >10h a realocar.
 * Planejado aparece como informação secundária e NUNCA entra no realizado.
 */
export function HourBankCard({
  entries,
  compensations,
  absences,
  companyCalendars,
  faltas,
  excessReasons,
  settings,
  range: _periodRange,
  today,
  specialExcessUses = [],
  controlStartDate = null,
  onRegisterReason,
}: Props) {
  const [futureOpen, setFutureOpen] = useState(false);
  // Banco e “Dias com saldo negativo” usam o MESMO ciclo anual (01/05→30/04).
  const cycleRange = useMemo(() => annualCycleBounds(getAnnualPointCycle(today)), [today]);
  const bank = useMemo(
    () =>
      hourBankSummary(
        entries,
        compensations,
        absences,
        companyCalendars,
        faltas,
        excessReasons,
        settings,
        cycleRange,
        today,
      ),
    [entries, compensations, absences, companyCalendars, faltas, excessReasons, settings, cycleRange, today],
  );

  // Dias do ciclo com excedente >10h SEM motivo — aviso §10.1 (não bloqueia)
  const missingReasons = useMemo(() => {
    const dates = new Set<string>();
    for (const e of entries) {
      if (e.date >= cycleRange.from && e.date <= cycleRange.to) dates.add(e.date);
    }
    return [...dates].filter(
      (date) =>
        computeDay(
          entries.filter((e) => e.date === date),
          settings,
        ).excessMinutes > 0 && !excessReasonOnDate(excessReasons, date),
    );
  }, [entries, cycleRange, settings, excessReasons]);

  const future = useMemo(
    () =>
      futureCommitmentsSummary(
        entries,
        compensations,
        absences,
        companyCalendars,
        faltas,
        settings,
        today,
      ),
    [entries, compensations, absences, companyCalendars, faltas, settings, today],
  );

  const realizedTone =
    bank.realizedBalance > 0 ? "text-emerald-600" : bank.realizedBalance < 0 ? "text-rose-600" : "text-slate-900";

  // 3H — BANCO [10+] DO CICLO ATUAL: fonte CANÔNICA 3C (a mesma do Resumo
  // e da reconciliação 3G/3G.4 — nenhuma segunda matemática). O valor
  // principal é o DISPONÍVEL (gerado − utilizado ativo); gerado/utilizado
  // aparecem como informação secundária discreta.
  const specialBank = useMemo(
    () =>
      buildSpecialExcessBank({
        cycle: getAnnualPointCycle(today),
        asOfDate: today,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: controlStartDate ?? "",
        uses: specialExcessUses,
      }),
    [today, entries, absences, companyCalendars, settings, faltas, controlStartDate, specialExcessUses],
  );

  return (
    <Card
      title="Banco de horas"
      subtitle="Somente fatos já realizados — planejamentos futuros não alteram este saldo"
      actions={
        <Link href="/compensacoes">
          <Badge tone="indigo" className="cursor-pointer hover:bg-indigo-100">
            Gerenciar na Central de Horas
          </Badge>
        </Link>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Row
          icon={<Wallet size={17} />}
          label="Saldo realizado"
          value={`${bank.realizedBalance >= 0 ? "+" : ""}${formatMinutes(bank.realizedBalance)}`}
          tone="bg-emerald-100 text-emerald-600"
          title="Soma das batidas e faltas efetivas do período (folga/abonado nunca geram déficit)"
        >
          <span className={`text-sm font-extrabold ${realizedTone}`}>
            {bank.realizedBalance >= 0 ? "a seu favor" : "em débito"}
          </span>
        </Row>

        <Row
          icon={<Zap size={17} />}
          label="Horas positivas regulares livres"
          value={`+${formatMinutes(bank.freeRegularTotal)}`}
          tone="bg-sky-100 text-sky-600"
          title="Crédito realizado até o limite de 10h/dia e ainda sem destinação"
        />

        <Row
          icon={<TrendingDown size={17} />}
          label="Saldo negativo em aberto"
          value={(bank.openNegativeTotal ?? bank.openDeficitTotal) > 0 ? `−${formatMinutes(bank.openNegativeTotal ?? bank.openDeficitTotal)}` : "0min"}
          tone="bg-indigo-100 text-indigo-600"
          title="Déficit comum + obrigações COMPENSAR já ocorridas ainda em aberto — planejado NÃO quita"
        />

        <Row
          icon={<Timer size={17} />}
          label="BANCO [10+] DISPONÍVEL"
          value={formatMinutes(specialBank.availableMinutes)}
          tone="bg-violet-100 text-violet-600"
          title="Saldo [10+] do ciclo anual atual: gerado menos o utilizado ativo (a mesma fonte do Resumo)"
          sub={`${formatMinutes(specialBank.generatedMinutes)} gerado · ${formatMinutes(specialBank.usedMinutes)} utilizado`}
        >
          {bank.excessWithoutReason > 0 && (
            <Badge tone="amber">⚠ {formatMinutes(bank.excessWithoutReason)} sem motivo</Badge>
          )}
        </Row>
      </div>

      {missingReasons.length > 0 && onRegisterReason && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <TriangleAlert size={15} className="shrink-0 text-amber-500" />
          <p className="flex-1 text-xs font-semibold text-amber-700">
            ⚠ Motivo não informado em {missingReasons.length === 1 ? "1 dia" : `${missingReasons.length} dias`} com excedente
            acima de 10h — registre o motivo para realocar.
          </p>
          {missingReasons.map((date) => (
            <button
              key={date}
              type="button"
              onClick={() => onRegisterReason(date)}
              className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700 cursor-pointer"
            >
              Registrar motivo · {date.slice(8)}/{date.slice(5, 7)}
            </button>
          ))}
        </div>
      )}

      {future.totalOriginal > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              Previsão de horas a compensar
            </p>
            <p className="text-sm font-extrabold tabular-nums text-slate-800">
              {formatMinutes(future.totalOriginal)} previstas
            </p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Até {formatDateBR(annualCycleClose(getAnnualPointCycle(today)))} · não altera o saldo realizado
          </p>
          <p className="mt-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Origem da previsão
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-600">
            <span>Calendário <b>{formatMinutes(future.calendarMinutes)}</b></span>
            <span className="text-slate-300">·</span>
            <span>Faltas <b>{formatMinutes(future.faltaMinutes)}</b></span>
            <span className="text-slate-300">·</span>
            <span>Registros futuros <b>{formatMinutes(future.otherMinutes)}</b></span>
            <span className="text-slate-300">·</span>
            <span>Acordos futuros <b>{formatMinutes(future.acordoMinutes)}</b></span>
          </p>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setFutureOpen((v) => !v)}
              className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
            >
              {futureOpen ? "Ocultar detalhes" : "Ver detalhes"}
            </button>
          </div>
          {futureOpen && (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {[...future.lines]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((l) => (
                <li key={`${l.kind}-${l.date}`}>
                  {formatDateShortBR(l.date)} —{" "}
                  {l.kind === "calendario"
                    ? "Calendário da empresa"
                    : l.kind === "falta"
                      ? "Faltas"
                      : l.kind === "acordo"
                        ? "Acordos futuros"
                        : "Registros futuros"}
                  {" "}— {formatMinutes(l.originalMinutes)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Planejado: informação secundária/opcional — nunca somado ao realizado */}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <CalendarClock size={13} />
        Planejado (não altera o saldo realizado):{" "}
        <b className="text-sky-600">{formatMinutes(bank.plannedTotal)}</b> em compensações futuras pendentes
        {bank.plannedTotal === 0 && " · nada programado"}
      </p>
    </Card>
  );
}
