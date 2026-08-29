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
  activeAcordos,
  buildDebtDays,
  extraCapacityForDate,
  openDebtFor,
  suggestTargets,
  totalsOf,
} from "@/lib/debt";
import { excessReasonOnDate, hasEligibleSpecialExcessInCycle, negativeBalanceViews, pendingSpecialExcessDays, specialExcessBook } from "@/lib/hour-bank";
import { quitacaoLine } from "@/lib/compensar";
import { useToast } from "@/components/toast";
import { formatDateBR, formatDateShortBR, formatMinutes, todayString, weekdayShort } from "@/lib/time";
import type { Absence } from "@/lib/absences";
import { annualCycleBounds, getAnnualPointCycle } from "@/lib/periods";
import type { CompanyCalendars } from "@/lib/company-calendar";
import { effectiveFaltas } from "@/lib/faltas";
import type { CompKind, Compensation, ExcessReason, Falta, TimeEntry, WorkSettings } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ProgressBar, StatCard } from "@/components/ui";
import { CompensationForm, type CompFormData } from "@/components/compensation-form";
import { AllocateExcessModal } from "@/components/allocate-excess-modal";

interface Props {
  entries: TimeEntry[];
  compensations: Compensation[];
  absences?: Absence[];
  companyCalendars?: CompanyCalendars;
  /** Faltas registradas — só as EFETIVAS (date ≤ hoje) geram déficit. */
  faltas?: Falta[];
  /** Motivos de excedente >10h registrados (§10/§11). */
  excessReasons?: ExcessReason[];
  /** Abre o modal para registrar o motivo do excedente da data. */
  onRegisterReason?: (date: string) => void;
  settings: WorkSettings;
  range: { from: string; to: string };
  monthLabel: string;
  onCreateComp: (payload: CompFormData & { kind?: CompKind }) => Promise<void>;
}

export function ExcessPanel({
  entries,
  compensations,
  absences = [],
  companyCalendars,
  faltas = [],
  excessReasons,
  onRegisterReason,
  settings,
  range,
  monthLabel,
  onCreateComp,
}: Props) {
  const toast = useToast();
  const today = todayString();
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<(CompFormData & { kind?: CompKind }) | undefined>();
  const [draftDebt, setDraftDebt] = useState<number | undefined>();
  const [draftPlanning, setDraftPlanning] = useState<{
    originalMinutes: number;
    compensatedMinutes: number;
    plannedMinutes: number;
    openMinutes: number;
    unplannedMinutes: number;
  } | undefined>();
  const [allocateDate, setAllocateDate] = useState<string | null>(null);
  const [allocateFromDeficit, setAllocateFromDeficit] = useState<{ date: string; kind?: CompKind } | null>(null);

  const cycleBounds = useMemo(() => annualCycleBounds(getAnnualPointCycle(today)), [today]);

  const { deficitTotals, deficits } = useMemo(() => {
    const all = buildDebtDays(
      entries,
      compensations,
      settings,
      range,
      absences,
      companyCalendars,
      effectiveFaltas(faltas, today),
      today,
    );
    const df = all.filter((d) => d.kind === "deficit");
    return {
      deficitTotals: totalsOf(df),
      // Lista de pendências: CICLO ANUAL (01/05→30/04), não o período 21→20.
      deficits: negativeBalanceViews(
        entries,
        compensations,
        absences,
        companyCalendars,
        faltas,
        settings,
        cycleBounds,
        today,
      ),
    };
  }, [entries, compensations, absences, companyCalendars, faltas, settings, range, cycleBounds, today]);

  // Acordos a compensar: escopo = CICLO ANUAL (não o período 21→20).
  // Um acordo continua ativo até ser quitado, cancelado ou chegar o fechamento anual.
  const acordoDays = useMemo(() => {
    const bounds = annualCycleBounds(getAnnualPointCycle(today));
    return activeAcordos(entries, compensations, settings, bounds, absences);
  }, [entries, compensations, absences, settings, today]);

  // UX: a seção "Calendário a compensar" foi REMOVIDA da Visão geral — as
  // obrigações do calendário têm área própria em Compensações. Nada aqui
  // apaga dados/cálculos (companias, obrigações e totais seguem nos libs).

  const openFor = (date: string, kind: CompKind) => {
    const minutes = openDebtFor(entries, compensations, settings, date, kind, companyCalendars, absences);
    const target =
      kind === "excedente"
        ? suggestTargets(entries, compensations, settings, date, today, undefined, companyCalendars)[0]?.date ?? today
        : today;
    const cap = extraCapacityForDate(target, entries, compensations, settings, { companyCalendars });
    const prefill = Math.max(0, Math.min(minutes, cap.available));
    if (prefill <= 0) {
      toast.show("Não há minutos sem programação (ou capacidade) para nova compensação.", "error");
      return;
    }
    const dv = deficits.find((x) => x.date === date && x.kind === kind);
    if (dv) {
      setDraftPlanning({
        originalMinutes: dv.originalMinutes,
        compensatedMinutes: dv.compensatedMinutes,
        plannedMinutes: dv.plannedMinutes,
        openMinutes: dv.openMinutes,
        unplannedMinutes: dv.unplannedMinutes,
      });
    } else if (kind === "acordo") {
      const av = acordoDays.find((x) => x.date === date);
      setDraftPlanning(
        av
          ? {
              originalMinutes: av.originalMinutes,
              compensatedMinutes: av.compensatedMinutes,
              plannedMinutes: av.plannedMinutes,
              openMinutes: av.remainingMinutes,
              unplannedMinutes: av.unplannedMinutes,
            }
          : undefined,
      );
    } else {
      setDraftPlanning(undefined);
    }
    setDraft({
      kind,
      sourceDate: date,
      targetDate: target,
      minutes: prefill,
      note: kind === "excedente" ? `Compensação do dia ${formatDateShortBR(date)}` : "",
    });
    setDraftDebt(minutes);
    setModalOpen(true);
  };

  // Pendências do CICLO: déficit factual em aberto (planejado NÃO quita).
  const deficitOpen = deficits.filter((d) => d.openMinutes > 0 && d.date <= today);
  const openDeficitTotal = deficitOpen.reduce((s, d) => s + d.openMinutes, 0);
  const cycleHasSpecial = useMemo(
    () =>
      hasEligibleSpecialExcessInCycle(
        entries, compensations, absences, companyCalendars, settings, excessReasons, today,
      ),
    [entries, compensations, absences, companyCalendars, settings, excessReasons, today],
  );
  /* fonte: specialExcessLedger via specialExcessBook (período 21→20). */
  const specialBook = useMemo(
    () =>
      specialExcessBook(
        entries, compensations, absences, companyCalendars, settings, excessReasons, range, today,
      ),
    [entries, compensations, absences, companyCalendars, settings, excessReasons, range, today],
  );
  const cycleBook = useMemo(
    () =>
      specialExcessBook(
        entries, compensations, absences, companyCalendars, settings, excessReasons, cycleBounds, today,
      ),
    [entries, compensations, absences, companyCalendars, settings, excessReasons, cycleBounds, today],
  );
  const excessOpen = pendingSpecialExcessDays(cycleBook);
  // §19: expansão das parcelas de um déficit consolidado (estado local, visual).
  const [expandedDeficit, setExpandedDeficit] = useState<string | null>(null);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          /* §5: cálculo usa o período oficial 21→20 — rótulo alinhado (era "do mês") */
          label="Excedente do período"
          value={formatMinutes(specialBook.original)}
          sub={`excedente do limite diário · ${monthLabel}`}
          tone={specialBook.original > 0 ? "rose" : "slate"}
          icon={<TriangleAlert size={16} />}
        />
        <StatCard
          label="Já realocado"
          value={formatMinutes(specialBook.realized)}
          sub={specialBook.original > 0 ? `${formatMinutes(specialBook.realized)} de ${formatMinutes(specialBook.original)} realocados` : "nenhum excedente do limite diário"}
          tone="emerald"
          icon={<CheckCircle2 size={16} />}
        />
        <StatCard
          label="Ainda a realocar"
          value={formatMinutes(specialBook.free)}
          sub="reserva especial livre (planejado não conta como realocado)"
          tone={specialBook.free > 0 ? "amber" : "slate"}
          icon={<ArrowLeftRight size={16} />}
        />
        <StatCard
          label="Déficit do período"
          value={formatMinutes(deficitTotals.debtTotal)}
          sub={`abaixo da base · ${formatMinutes(openDeficitTotal)} em aberto`}
          tone={openDeficitTotal > 0 ? "indigo" : "slate"}
          icon={<TrendingDown size={16} />}
        />
      </div>

      {/* Barra de progresso */}
      <Card title="Progresso de realocação do excedente" subtitle={`${monthLabel} · excedente do limite diário`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700">
            <b className="text-emerald-600">{formatMinutes(specialBook.realized)}</b> realocados
            {specialBook.planned > 0 && (
              <>
                {" · "}
                <b className="text-amber-600">{formatMinutes(specialBook.planned)}</b> programados
              </>
            )}
            {" · "}
            <b className="text-slate-500">{formatMinutes(specialBook.free)}</b> ainda a realocar
          </p>
          <p className="text-xs font-bold text-slate-400">
            total {formatMinutes(specialBook.original)}
          </p>
        </div>
        <div className="mt-2">
          <ProgressBar
            concluded={specialBook.realized}
            pending={specialBook.planned}
            total={specialBook.original}
          />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Dias com excedente pendente */}
        <Card
          title="Dias com excedente pendente"
          subtitle={`${excessOpen.length} dia(s) do ciclo anual com minutos [10+] ainda sem destino`}
        >
          {excessOpen.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={24} />}
              title="Nenhum excedente livre no ciclo anual"
              description="Não há minutos de excedente do limite diário [10+] ainda sem destino neste ciclo (01/05 → 30/04)."
            />
          ) : (
            <ul className="space-y-3">
              {excessOpen.map((d) => {
                const reason = excessReasonOnDate(excessReasons, d.date);
                return (
                  <li key={d.date} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold text-slate-900">
                        {weekdayShort(d.date).replace(".", "")}
                        <span className="ml-1.5 font-medium text-slate-400">
                          {formatDateShortBR(d.date)}
                        </span>
                      </span>
                      <Badge tone="rose">
                        excedente {formatMinutes(d.original)}
                      </Badge>
                      {reason ? (
                        <Badge tone="slate">motivo registrado</Badge>
                      ) : (
                        <Badge tone="amber">Motivo pendente</Badge>
                      )}
                      <Badge tone="amber">Livre {formatMinutes(d.free)}</Badge>
                      <div className="ml-auto flex items-center gap-1.5">
                        {!reason && onRegisterReason && (
                          <Button size="sm" variant="ghost" onClick={() => onRegisterReason(d.date)}>
                            Registrar motivo
                          </Button>
                        )}
                        {reason && onRegisterReason && (
                          <Button size="sm" variant="ghost" onClick={() => onRegisterReason(d.date)}>
                            Alterar motivo
                          </Button>
                        )}
                        <Button size="sm" variant="danger" onClick={() => setAllocateDate(d.date)} disabled={!reason}
                          title={reason ? undefined : "Registre o motivo do excedente antes de alocá-lo."}>
                          <ArrowLeftRight size={13} /> Realocar excedente
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {formatMinutes(d.worked)} trabalhados ·{" "}
                      {formatMinutes(d.realized)} realocados ·{" "}
                      {formatMinutes(d.planned)} programados ·{" "}
                      Livre {formatMinutes(d.free)}
                    </p>
                    <div className="mt-2">
                      <ProgressBar
                        concluded={d.realized}
                        pending={d.planned}
                        total={d.original}
                        height={6}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Dias com déficit (dívida) — visão consolidada §19/§32 */}
        <Card
          title="Dias com saldo negativo"
          subtitle={`Ciclo anual ${getAnnualPointCycle(today)} — déficit, acordo e calendário COMPENSAR (planejado não quita)`}
        >
          {deficitOpen.length === 0 ? (
            <EmptyState
              icon={<TrendingDown size={24} />}
              title="Nenhum déficit em aberto"
              description="Todos os déficits realizados do ciclo anual já foram quitados."
            />
          ) : (
            <ul className="space-y-3">
              {deficitOpen.map((d) => {
                const programmed = d.unplannedMinutes <= 0 && d.openMinutes > 0;
                return (
                <li key={`${d.kind}-${d.date}`} className={`rounded-xl border p-3 ${programmed ? "border-slate-100 bg-slate-50/40" : "border-slate-100 bg-slate-50/60"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-900">
                      {weekdayShort(d.date).replace(".", "")}
                      <span className="ml-1.5 font-medium text-slate-400">
                        {formatDateShortBR(d.date)}
                      </span>
                    </span>
                    <Badge tone="indigo">{d.originLabel} {formatMinutes(d.originalMinutes)}</Badge>
                    <Badge tone={programmed ? "slate" : "amber"}>em aberto {formatMinutes(d.openMinutes)}</Badge>
                    {programmed ? (
                      <Badge tone="sky">Programado</Badge>
                    ) : d.status === "parcial" ? (
                      <Badge tone="sky">Parcial</Badge>
                    ) : (
                      <Badge tone="amber">Pendente</Badge>
                    )}
                    <div className="ml-auto flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                      {cycleHasSpecial && (
                        <Button size="sm" variant="danger" onClick={() => setAllocateFromDeficit({ date: d.date, kind: d.kind })}>
                          <ArrowLeftRight size={13} /> Usar excedente disponível
                        </Button>
                      )}
                      {d.unplannedMinutes > 0 && (
                        <Button size="sm" variant="subtle" onClick={() => openFor(d.date, d.kind)}>
                          <Zap size={13} /> Programar hora extra
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* §32 nomenclatura: compensado (concluído) · planejado · sem programação */}
                  <p className="mt-1.5 text-xs text-slate-500">
                    Original: <b>{formatMinutes(d.originalMinutes)}</b>
                    {d.kind !== "deficit" && (
                      <> · Trabalhado no próprio dia: <b>{formatMinutes(d.workedOnOriginDateMinutes)}</b> · Obrigação efetiva: <b>{formatMinutes(d.effectiveObligationMinutes)}</b></>
                    )}
                    {" "}· Compensado:{" "}
                    <b className="text-emerald-600">{formatMinutes(d.compensatedMinutes)}</b> · Planejado:{" "}
                    <b className="text-sky-600">{formatMinutes(d.plannedMinutes)}</b> · Em aberto:{" "}
                    <b>{formatMinutes(d.openMinutes)}</b> · Sem programação:{" "}
                    <b>{formatMinutes(d.unplannedMinutes)}</b>
                  </p>
                  <div className="mt-2">
                    <ProgressBar
                      concluded={d.compensatedMinutes}
                      pending={d.plannedMinutes}
                      total={d.originalMinutes}
                      height={6}
                    />
                  </div>
                  {/* §19: parcelas vinculadas ao mesmo déficit (expansível) */}
                  {d.parcels.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="text-[11px] font-bold text-indigo-500 hover:underline cursor-pointer"
                        onClick={() => setExpandedDeficit((cur) => (cur === `${d.kind}-${d.date}` ? null : `${d.kind}-${d.date}`))}
                      >
                        {expandedDeficit === `${d.kind}-${d.date}`
                          ? "Ocultar detalhes"
                          : "Como foi quitado"}
                      </button>
                      {expandedDeficit === `${d.kind}-${d.date}` && (
                        <ul className="mt-1.5 space-y-1 rounded-lg bg-white/70 p-2 text-xs text-slate-600">
                          {d.parcels.filter((p) => p.comp.status === "concluida").length === 0 ? (
                            <li>Ainda não há quitação realizada.</li>
                          ) : (
                            d.parcels.filter((p) => p.comp.status === "concluida").map(({ comp }) => (
                              <li key={comp.id}>{quitacaoLine(comp)}</li>
                            ))
                          )}
                          {d.parcels.filter((p) => p.comp.status === "pendente").map(({ comp, future }) => (
                            <li key={comp.id} className="flex flex-wrap items-center gap-1.5">
                              Planejado {formatMinutes(comp.minutes)} em {formatDateBR(comp.targetDate)} ·{" "}
                              {future.status === "atrasada" ? "Atrasada" : "Pendente"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
              })}
            </ul>
          )}
        </Card>
      </div>

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
                      <Badge tone="amber">em aberto {formatMinutes(d.remainingMinutes)}</Badge>
                      {d.plannedMinutes > 0 && (
                        <Badge tone="sky">{formatMinutes(d.plannedMinutes)} planejado</Badge>
                      )}
                      <div className="ml-auto">
                        {d.unplannedMinutes > 0 && (
                          <Button size="sm" variant="subtle" onClick={() => openFor(d.date, "acordo")}>
                            <Zap size={13} /> Programar hora extra
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-violet-800">
                      Original: <b>{formatMinutes(d.originalMinutes)}</b> · Trabalhado no próprio dia:{" "}
                      <b>{formatMinutes(d.workedOnOriginDateMinutes)}</b> · Obrigação efetiva:{" "}
                      <b>{formatMinutes(d.effectiveObligationMinutes)}</b> · Compensado:{" "}
                      <b className="text-emerald-700">{formatMinutes(d.compensatedMinutes)}</b> · Planejado:{" "}
                      <b className="text-sky-700">{formatMinutes(d.plannedMinutes)}</b> · Em aberto:{" "}
                      <b>{formatMinutes(d.remainingMinutes)}</b> · Sem programação:{" "}
                      <b>{formatMinutes(d.unplannedMinutes)}</b>
                    </p>
                    <p className="mt-0.5 text-[11px] text-violet-700">
                      Restam {formatMinutes(d.remainingMinutes)} do acordo: {formatMinutes(d.plannedMinutes)} já
                      programadas e {formatMinutes(d.unplannedMinutes)} ainda sem programação.
                    </p>
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
            ? suggestTargets(entries, compensations, settings, draft.sourceDate, today, undefined, companyCalendars)
            : []
        }
        getCapacity={(targetDate) =>
          extraCapacityForDate(targetDate, entries, compensations, settings, { companyCalendars })
        }
        pendingDebtMinutes={draftDebt}
        planning={draftPlanning}
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

      {allocateDate && (
        <AllocateExcessModal
          open
          onClose={() => setAllocateDate(null)}
          excessDate={allocateDate}
          entries={entries}
          compensations={compensations}
          absences={absences}
          companyCalendars={companyCalendars}
          faltas={faltas}
          excessReasons={excessReasons}
          settings={settings}
        />
      )}
      {allocateFromDeficit && (
        <AllocateExcessModal
          open
          onClose={() => setAllocateFromDeficit(null)}
          deficitDate={allocateFromDeficit.date}
          deficitKind={allocateFromDeficit.kind}
          entries={entries}
          compensations={compensations}
          absences={absences}
          companyCalendars={companyCalendars}
          faltas={faltas}
          excessReasons={excessReasons}
          settings={settings}
        />
      )}
    </>
  );
}
