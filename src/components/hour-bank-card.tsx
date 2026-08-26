"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, TrendingDown, TriangleAlert, Wallet, Zap } from "lucide-react";
import { hourBankSummary, excessReasonOnDate, futureCommitmentsSummary } from "@/lib/hour-bank";
import { annualCycleClose, getAnnualPointCycle } from "@/lib/periods";
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
  /** Abre o modal de motivo do excedente da data informada. */
  onRegisterReason?: (date: string) => void;
}

function Row({
  icon,
  label,
  value,
  tone,
  title,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
  title?: string;
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
  range,
  today,
  onRegisterReason,
}: Props) {
  const [futureOpen, setFutureOpen] = useState(false);
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
        range,
        today,
      ),
    [entries, compensations, absences, companyCalendars, faltas, excessReasons, settings, range, today],
  );

  // Dias do período com excedente >10h SEM motivo — aviso §10.1 (não bloqueia)
  const missingReasons = useMemo(() => {
    const dates = new Set<string>();
    for (const e of entries) {
      if (e.date >= range.from && e.date <= range.to) dates.add(e.date);
    }
    return [...dates].filter(
      (date) =>
        computeDay(
          entries.filter((e) => e.date === date),
          settings,
        ).excessMinutes > 0 && !excessReasonOnDate(excessReasons, date),
    );
  }, [entries, range, settings, excessReasons]);

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

  return (
    <Card
      title="Banco de horas"
      subtitle="Somente fatos já realizados — planejamentos futuros não alteram este saldo"
      actions={
        <Link href="/compensacoes">
          <Badge tone="indigo" className="cursor-pointer hover:bg-indigo-100">
            Gerenciar em Compensações
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
          label="Déficits em aberto"
          value={bank.openDeficitTotal > 0 ? `−${formatMinutes(bank.openDeficitTotal)}` : "0min"}
          tone="bg-indigo-100 text-indigo-600"
          title="Original menos o já CONCLUÍDO — o só planejado NÃO quita o déficit"
        />

        <Row
          icon={<TriangleAlert size={17} />}
          label="Excedente do limite diário a realocar"
          value={formatMinutes(bank.excessSpecialFreeTotal)}
          tone="bg-rose-100 text-rose-600"
          title="Reserva especial: precisa de motivo registrado antes da realocação"
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
              Total previstas: {formatMinutes(future.totalOriginal)}
            </p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Até {formatDateBR(annualCycleClose(getAnnualPointCycle(today)))} · não altera o saldo realizado
          </p>
          <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
            <p className="sm:col-span-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Origem
            </p>
            <p>Calendário: <b>{formatMinutes(future.calendarMinutes)}</b></p>
            <p>Faltas: <b>{formatMinutes(future.faltaMinutes)}</b></p>
            <p>Registros futuros: <b>{formatMinutes(future.otherMinutes)}</b></p>
            <p>Acordos futuros: <b>{formatMinutes(future.acordoMinutes)}</b></p>
          </div>
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
