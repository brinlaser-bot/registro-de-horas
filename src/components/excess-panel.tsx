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
import { deficitViews, excessReasonOnDate } from "@/lib/hour-bank";
import { actions } from "@/lib/store";
import { useToast } from "@/components/toast";
import { formatDateBR, formatDateShortBR, formatMinutes, todayString, weekdayShort } from "@/lib/time";
import type { Absence } from "@/lib/absences";
import { annualCycleBounds, getAnnualPointCycle } from "@/lib/periods";
import type { CompanyCalendars } from "@/lib/company-calendar";
import { effectiveFaltas } from "@/lib/faltas";
import type { CompKind, Compensation, ExcessReason, Falta, TimeEntry, WorkSettings } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ProgressBar, StatCard } from "@/components/ui";
import { CompensationForm, type CompFormData } from "@/components/compensation-form";

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

  const { excessDays, excessTotals, deficitTotals, deficits } = useMemo(() => {
    const all = buildDebtDays(
      entries,
      compensations,
      settings,
      range,
      absences,
      companyCalendars,
      effectiveFaltas(faltas, today),
    );
    const ex = all.filter((d) => d.kind === "excedente");
    const df = all.filter((d) => d.kind === "deficit");
    return {
      excessDays: ex.reverse(),
      excessTotals: totalsOf(ex),
      deficitTotals: totalsOf(df),
      // §19 visão consolidada do déficit (original/compensado/planejado/sem
      // programação/status) com as parcelas para expansão.
      deficits: deficitViews(
        entries,
        compensations,
        absences,
        companyCalendars,
        faltas,
        settings,
        range,
        today,
      ).reverse(),
    };
  }, [entries, compensations, absences, companyCalendars, faltas, settings, range, today]);

  /** §6–§8: quita déficit com crédito JÁ REALIZADO (prioridade do excedente >10h).
   *  (nome sem prefixo "use" — não é hook; regra react-hooks/rules-of-hooks) */
  const applyRealizedCredit = (sourceDate: string) => {
    const res = actions.useRealizedCreditForDeficit(sourceDate);
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível usar horas realizadas.", "error");
      return;
    }
    toast.show(res.warning ?? "Crédito vinculado ao déficit.");
  };

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
    const minutes = openDebtFor(entries, compensations, settings, date, kind, companyCalendars);
    // Para hora extra o destino é um dia de trabalho futuro/hoje (não um dia com déficit);
    // para excedente sugerimos dias recentes com saldo negativo (sair mais cedo).
    const target =
      kind === "excedente"
        ? suggestTargets(entries, compensations, settings, date, today, undefined, companyCalendars)[0]?.date ?? today
        : today;
    // Pré-preenche respeitando a capacidade real do dia de destino
    const cap = extraCapacityForDate(target, entries, compensations, settings, { companyCalendars });
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

  // §20 "EM ABERTO" = original − CONCLUÍDO (planejamento integral NÃO quita).
  // Enquanto houver valor ainda não REALIZADO, o déficit/excedente permanece.
  const excessOpen = excessDays.filter((d) => d.openMinutes > 0);
  const deficitOpen = deficits.filter((d) => d.openMinutes > 0);
  const openDeficitTotal = deficitOpen.reduce((s, d) => s + d.openMinutes, 0);
  const openExcessTotal = excessOpen.reduce((s, d) => s + d.openMinutes, 0);
  // §19: expansão das parcelas de um déficit consolidado (estado local, visual).
  const [expandedDeficit, setExpandedDeficit] = useState<string | null>(null);

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
          value={formatMinutes(openExcessTotal)}
          sub={`${excessOpen.length} dia(s) com excedente em aberto (>10h)`}
          tone={openExcessTotal > 0 ? "amber" : "slate"}
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
                        excedente {formatMinutes(d.debtMinutes)}
                      </Badge>
                      {reason ? (
                        <Badge tone="slate">motivo registrado</Badge>
                      ) : (
                        <Badge tone="amber">⚠ Motivo não informado</Badge>
                      )}
                      {d.remainingMinutes > 0 ? (
                        <Badge tone="amber">restam {formatMinutes(d.remainingMinutes)}</Badge>
                      ) : (
                        <Badge tone="sky">{formatMinutes(d.pendingMinutes)} planejado</Badge>
                      )}
                      <div className="ml-auto flex items-center gap-1.5">
                        {!reason && onRegisterReason && (
                          <Button size="sm" variant="ghost" onClick={() => onRegisterReason(d.date)}>
                            Registrar motivo
                          </Button>
                        )}
                        <Button size="sm" variant="danger" onClick={() => openFor(d.date, "excedente")} disabled={!reason}
                          title={reason ? undefined : "Registre o motivo antes de realocar (regra central)"}>
                          <ArrowLeftRight size={13} /> Compensar agora
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {formatMinutes(d.workedMinutes)} trabalhados ·{" "}
                      {formatMinutes(d.concludedMinutes)} compensados ·{" "}
                      {formatMinutes(d.pendingMinutes)} planejados
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
                );
              })}
            </ul>
          )}
        </Card>

        {/* Dias com déficit (dívida) — visão consolidada §19/§32 */}
        <Card
          title="Dias com saldo negativo"
          subtitle="Abaixo da base — quite com horas já realizadas (imediato) ou programe hora extra (até 10h)"
        >
          {deficitOpen.length === 0 ? (
            <EmptyState
              icon={<TrendingDown size={24} />}
              title="Nenhum déficit em aberto"
              description="Todos os dias abaixo da base já tiveram o déficit efetivamente compensado."
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
                    <Badge tone="indigo">déficit {formatMinutes(d.originalMinutes)}</Badge>
                    {/* §20: enquanto houver valor não REALIZADO, o déficit aparece */}
                    <Badge tone="amber">em aberto {formatMinutes(d.openMinutes)}</Badge>
                    {d.status === "parcial" && <Badge tone="sky">Parcial</Badge>}
                    <div className="ml-auto flex items-center gap-1.5">
                      {/* §6/§7: quitação imediata com crédito JÁ realizado */}
                      <Button size="sm" variant="secondary" onClick={() => applyRealizedCredit(d.date)}>
                        <CheckCircle2 size={13} /> Usar horas livres
                      </Button>
                      <Button size="sm" variant="subtle" onClick={() => openFor(d.date, "deficit")}>
                        <Zap size={13} /> Programar hora extra
                      </Button>
                    </div>
                  </div>
                  {/* §32 nomenclatura: compensado (concluído) · planejado · sem programação */}
                  <p className="mt-1.5 text-xs text-slate-500">
                    Déficit original: <b>{formatMinutes(d.originalMinutes)}</b> · Compensado:{" "}
                    <b className="text-emerald-600">{formatMinutes(d.compensatedMinutes)}</b> · Planejado:{" "}
                    <b className="text-sky-600">{formatMinutes(d.plannedMinutes)}</b> · Sem programação:{" "}
                    <b>{formatMinutes(d.unplannedMinutes)}</b> · Status:{" "}
                    <b>{d.status === "quitada" ? "Quitada" : d.status === "parcial" ? "Parcial" : "Pendente"}</b>
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
                        onClick={() => setExpandedDeficit((cur) => (cur === d.date ? null : d.date))}
                      >
                        {expandedDeficit === d.date
                          ? "Ocultar parcelas"
                          : `Ver ${d.parcels.length} parcela(s) vinculadas`}
                      </button>
                      {expandedDeficit === d.date && (
                        <ul className="mt-1.5 space-y-1 rounded-lg bg-white/70 p-2 text-xs text-slate-600">
                          {d.parcels.map(({ comp, future }) => (
                            <li key={comp.id} className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold">{formatDateBR(comp.targetDate)}</span>·{" "}
                              {formatMinutes(comp.minutes)} ·{" "}
                              {comp.status === "concluida"
                                ? "Concluída"
                                : comp.status === "cancelada"
                                  ? "Cancelada"
                                  : future.status === "meta-atingida"
                                    ? "Meta atingida"
                                    : future.status === "parcial"
                                      ? `Parcial (${formatMinutes(future.realizedMinutes)} realizados)`
                                      : future.status === "atrasada"
                                        ? "Atrasada"
                                        : "Planejada/Pendente"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
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
            ? suggestTargets(entries, compensations, settings, draft.sourceDate, today, undefined, companyCalendars)
            : []
        }
        getCapacity={(targetDate) =>
          extraCapacityForDate(targetDate, entries, compensations, settings, { companyCalendars })
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
