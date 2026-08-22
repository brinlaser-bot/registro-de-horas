"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Sparkles,
  TriangleAlert,
  TrendingDown,
  Zap,
} from "lucide-react";
import {
  acordoViewOf,
  activeAcordos,
  buildDebtDays,
  extraCapacityForDate,
  openDebtFor,
  suggestTargets,
  totalsOf,
} from "@/lib/debt";
import { formatDateShortBR, formatMinutes, todayString, weekdayShort } from "@/lib/time";
import type { Absence } from "@/lib/absences";
import { annualCycleBounds, getAnnualPointCycle } from "@/lib/periods";
import type { CompanyCalendar } from "@/lib/company-calendar";
import type { CompKind, Compensation, TimeEntry, WorkSettings } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ProgressBar, StatCard } from "@/components/ui";
import { CompensationForm, type CompFormData } from "@/components/compensation-form";

interface Props {
  entries: TimeEntry[];
  compensations: Compensation[];
  absences?: Absence[];
  companyCalendar?: CompanyCalendar;
  settings: WorkSettings;
  range: { from: string; to: string };
  monthLabel: string;
  onCreateComp: (payload: CompFormData & { kind?: CompKind }) => Promise<void>;
}

export function ExcessPanel({
  entries,
  compensations,
  absences = [],
  companyCalendar,
  settings,
  range,
  monthLabel,
  onCreateComp,
}: Props) {
  const today = todayString();
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<(CompFormData & { kind?: CompKind }) | undefined>();
  const [draftDebt, setDraftDebt] = useState<number | undefined>();

  const { excessDays, deficitDays, excessTotals, deficitTotals } = useMemo(() => {
    const all = buildDebtDays(entries, compensations, settings, range, absences, companyCalendar);
    const ex = all.filter((d) => d.kind === "excedente");
    const df = all.filter((d) => d.kind === "deficit");
    return {
      excessDays: ex.reverse(),
      deficitDays: df.reverse(),
      excessTotals: totalsOf(ex),
      deficitTotals: totalsOf(df),
    };
  }, [entries, compensations, absences, settings, range]);

  // Acordos a compensar: escopo = CICLO ANUAL (não o período 21→20).
  // Um acordo continua ativo até ser quitado, cancelado ou chegar o fechamento anual.
  const acordoDays = useMemo(() => {
    const bounds = annualCycleBounds(getAnnualPointCycle(today));
    return activeAcordos(entries, compensations, settings, bounds, absences);
  }, [entries, compensations, absences, settings, today]);

  const calendarioDays = useMemo(() => {
    const bounds = annualCycleBounds(getAnnualPointCycle(today));
    return buildDebtDays(entries, compensations, settings, bounds, absences, companyCalendar)
      .filter((d) => d.kind === "calendario")
      .map(acordoViewOf)
      .filter((d) => d.remainingMinutes > 0)
      .reverse();
  }, [entries, compensations, absences, companyCalendar, settings, today]);

  const openFor = (date: string, kind: CompKind) => {
    const minutes = openDebtFor(entries, compensations, settings, date, kind);
    // Para hora extra o destino é um dia de trabalho futuro/hoje (não um dia com déficit);
    // para excedente sugerimos dias recentes com saldo negativo (sair mais cedo).
    const target =
      kind === "excedente"
        ? suggestTargets(entries, compensations, settings, date, today)[0]?.date ?? today
        : today;
    // Pré-preenche respeitando a capacidade real do dia de destino
    const cap = extraCapacityForDate(target, entries, compensations, settings);
    const prefill =
      kind === "deficit" ? Math.max(5, Math.min(minutes, Math.max(5, cap.available))) : minutes;
    setDraft({
      kind,
      sourceDate: date,
      targetDate: target,
      minutes: prefill > 0 ? prefill : 30,
      note: kind === "excedente" ? `Compensação do dia ${formatDateShortBR(date)}` : "",
    });
    setDraftDebt(minutes);
    setModalOpen(true);
  };

  const excessOpen = excessDays.filter((d) => d.remainingMinutes > 0 || d.pendingMinutes > 0);
  const deficitOpen = deficitDays.filter((d) => d.remainingMinutes > 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Excedente do mês"
          value={formatMinutes(excessTotals.debtTotal)}
          sub={`acima de ${formatMinutes(settings.maxDailyMinutes)}/dia · ${monthLabel}`}
          tone={excessTotals.debtTotal > 0 ? "rose" : "slate"}
          icon={<TriangleAlert size={16} />}
        />
        <StatCard
          label="Já compensado"
          value={formatMinutes(excessTotals.concluded)}
          sub={`${Math.round(excessTotals.percent)}% do excedente quitado`}
          tone="emerald"
          icon={<CheckCircle2 size={16} />}
        />
        <StatCard
          label="Ainda a compensar"
          value={formatMinutes(excessTotals.remaining)}
          sub={`${excessOpen.length} dia(s) com excedente em aberto`}
          tone={excessTotals.remaining > 0 ? "amber" : "slate"}
          icon={<ArrowLeftRight size={16} />}
        />
        <StatCard
          label="Déficit do mês"
          value={formatMinutes(deficitTotals.debtTotal)}
          sub={`abaixo da base · ${formatMinutes(deficitTotals.remaining)} em aberto`}
          tone={deficitTotals.remaining > 0 ? "indigo" : "slate"}
          icon={<TrendingDown size={16} />}
        />
      </div>

      {/* Barra de progresso */}
      <Card title="Progresso de compensação de excedentes" subtitle={`${monthLabel} · excedente vs. compensado`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700">
            <b className="text-emerald-600">{formatMinutes(excessTotals.concluded)}</b> compensados
            {excessTotals.pending > 0 && (
              <>
                {" · "}
                <b className="text-amber-600">{formatMinutes(excessTotals.pending)}</b> planejados
              </>
            )}
            {" · "}
            <b className="text-slate-500">{formatMinutes(excessTotals.remaining)}</b> restantes
          </p>
          <p className="text-xs font-bold text-slate-400">
            total {formatMinutes(excessTotals.debtTotal)}
          </p>
        </div>
        <div className="mt-2">
          <ProgressBar
            concluded={excessTotals.concluded}
            pending={excessTotals.pending}
            total={excessTotals.debtTotal}
          />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Dias com excedente pendente */}
        <Card
          title="Dias com excedente pendente"
          subtitle="Acima do limite — origem da dívida de horas"
        >
          {excessOpen.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={24} />}
              title="Nenhum excedente deste período em aberto"
              description={`Nenhum excedente originado no período ${monthLabel} está pendente. Compensações de outros períodos/ciclos permanecem visíveis na página Compensações.`}
            />
          ) : (
            <ul className="space-y-3">
              {excessOpen.map((d) => (
                <li key={d.date} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-900">
                      {weekdayShort(d.date).replace(".", "")}
                      <span className="ml-1.5 font-medium text-slate-400">
                        {formatDateShortBR(d.date)}
                      </span>
                    </span>
                    <Badge tone="rose">
                      excedente {formatMinutes(d.debtMinutes)}
                    </Badge>
                    {d.remainingMinutes > 0 ? (
                      <Badge tone="amber">restam {formatMinutes(d.remainingMinutes)}</Badge>
                    ) : (
                      <Badge tone="sky">{formatMinutes(d.pendingMinutes)} planejado</Badge>
                    )}
                    <div className="ml-auto">
                      <Button size="sm" variant="danger" onClick={() => openFor(d.date, "excedente")}>
                        <ArrowLeftRight size={13} /> Compensar agora
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {formatMinutes(d.workedMinutes)} trabalhados ·{" "}
                    {formatMinutes(d.allocatedMinutes)} alocados ·{" "}
                    {formatMinutes(d.concludedMinutes)} concluídos
                  </p>
                  <div className="mt-2">
                    <ProgressBar
                      concluded={d.concludedMinutes}
                      pending={d.pendingMinutes}
                      total={d.debtMinutes}
                      height={6}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Dias com déficit (dívida) */}
        <Card
          title="Dias com saldo negativo"
          subtitle="Abaixo da base — podem ser quitados com hora extra (até 10h)"
        >
          {deficitOpen.length === 0 ? (
            <EmptyState
              icon={<TrendingDown size={24} />}
              title="Nenhum déficit em aberto"
              description="Todos os dias abaixo da base já foram compensados com hora extra."
            />
          ) : (
            <ul className="space-y-3">
              {deficitOpen.map((d) => (
                <li key={d.date} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-900">
                      {weekdayShort(d.date).replace(".", "")}
                      <span className="ml-1.5 font-medium text-slate-400">
                        {formatDateShortBR(d.date)}
                      </span>
                    </span>
                    <Badge tone="indigo">déficit {formatMinutes(d.debtMinutes)}</Badge>
                    <Badge tone="amber">restam {formatMinutes(d.remainingMinutes)}</Badge>
                    <div className="ml-auto">
                      <Button size="sm" variant="subtle" onClick={() => openFor(d.date, "deficit")}>
                        <Zap size={13} /> Quitar com hora extra
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {formatMinutes(d.workedMinutes)} trabalhados de {formatMinutes(d.expectedMinutes)}{" "}
                    · {formatMinutes(d.allocatedMinutes)} alocados
                  </p>
                  <div className="mt-2">
                    <ProgressBar
                      concluded={d.concludedMinutes}
                      pending={d.pendingMinutes}
                      total={d.debtMinutes}
                      height={6}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Calendário a compensar */}
      {calendarioDays.length > 0 && (
        <Card
          title="Calendário a compensar"
          subtitle={`Obrigações ativas do calendário da empresa no ciclo anual ${getAnnualPointCycle(today)}`}
        >
          <ul className="space-y-3">
            {calendarioDays.map((d) => (
              <li key={d.date} className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-extrabold text-slate-900">{formatDateShortBR(d.date)}</span>
                  <Badge tone="amber">calendário {formatMinutes(d.originalMinutes)}</Badge>
                  <Badge tone="slate">compensado {formatMinutes(d.compensatedMinutes)}</Badge>
                  {d.plannedMinutes > 0 && <Badge tone="sky">planejado {formatMinutes(d.plannedMinutes)}</Badge>}
                  <Badge tone="rose">restam {formatMinutes(d.remainingMinutes)}</Badge>
                  <div className="ml-auto">
                    <Button size="sm" variant="subtle" onClick={() => openFor(d.date, "calendario")}>
                      <Zap size={13} /> Compensar com hora extra
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Acordo a compensar (folga/abono acordado — compensar posteriormente) */}
      {acordoDays.length > 0 && (
        <Card
          title="Acordo a compensar"
          subtitle={`Pendências ativas do ciclo anual ${getAnnualPointCycle(today)} — permanecem até quitação ou fechamento anual (30/04), independentemente do período 21→20`}
        >
          {acordoDays.length === 0 ? (
            <p className="text-xs text-slate-400">Todos os acordos deste ciclo já foram quitados. ✔</p>
          ) : (
            <ul className="space-y-3">
              {acordoDays
                .map((d) => (
                  <li key={d.date} className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold text-slate-900">
                        {weekdayShort(d.date).replace(".", "")}
                        <span className="ml-1.5 font-medium text-slate-400">
                          {formatDateShortBR(d.date)}
                        </span>
                      </span>
                      <Badge tone="indigo">acordo {formatMinutes(d.originalMinutes)}</Badge>
                      <Badge tone="amber">restam {formatMinutes(d.remainingMinutes)}</Badge>
                      {d.plannedMinutes > 0 && (
                        <Badge tone="sky">{formatMinutes(d.plannedMinutes)} planejado</Badge>
                      )}
                      <div className="ml-auto">
                        <Button size="sm" variant="subtle" onClick={() => openFor(d.date, "acordo")}>
                          <Zap size={13} /> Compensar com hora extra
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2">
                      <ProgressBar
                        concluded={d.compensatedMinutes}
                        pending={d.plannedMinutes}
                        total={d.originalMinutes}
                        height={6}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      )}

      <CompensationForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={draft}
        kind={draft?.kind ?? "excedente"}
        suggestions={
          draft && draft.kind === "excedente"
            ? suggestTargets(entries, compensations, settings, draft.sourceDate, today)
            : []
        }
        getCapacity={(targetDate) =>
          extraCapacityForDate(targetDate, entries, compensations, settings)
        }
        pendingDebtMinutes={draftDebt}
        onSave={async (payload) => {
          await onCreateComp({ ...payload, kind: draft?.kind ?? "excedente" });
          setModalOpen(false);
        }}
        smartHint={
          draft ? (
            <span className="inline-flex items-center gap-1.5">
              <Sparkles size={12} /> Sugestão inteligente: dias com saldo negativo, do mais recente
              para o mais antigo
            </span>
          ) : undefined
        }
      />
    </>
  );
}
