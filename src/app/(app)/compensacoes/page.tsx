"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Pencil,
  PlusCircle,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { actions, enrichComp, settingsOf, useAppData, useIsClient } from "@/lib/store";
import { compDayLineView } from "@/lib/company-calendar";
import { computeDay, formatDateBR, formatDateShortBR, formatMinutes, todayString } from "@/lib/time";
import type { CompKind, CompWithDays } from "@/lib/types";
import type { CompFormData } from "@/components/compensation-form";
import {
  activeAcordos,
  activeCalendarObligations,
  canCompleteComp,
  extraCapacityForDate,
  kindOf,
  usesHourExtra,
} from "@/lib/debt";
import {
  dayCreditView,
  excessReasonLabel,
  excessReasonObservation,
  excessReasonOnDate,
  futureCompStatus,
  hourBankSummary,
  deficitViews,
  specialExcessLedger,
  type FutureCompView,
} from "@/lib/hour-bank";
import { annualCycleBounds, getAnnualPointCycle } from "@/lib/periods";
import { Badge, Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { CompensationForm } from "@/components/compensation-form";
import { ExcessReasonModal } from "@/components/excess-reason-modal";
import { AllocateExcessModal } from "@/components/allocate-excess-modal";
import { useToast } from "@/components/toast";

export default function CompensacoesPage() {
  const toast = useToast();
  const mounted = useIsClient();
  const { user, entries, compensations, absences, companyCalendars, faltas, excessReasons } = useAppData();
  const settings = settingsOf(user);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  // §10: modal do motivo do excedente a partir da lista de reservas >10h
  const [reasonDate, setReasonDate] = useState<string | null>(null);
  const [allocateDate, setAllocateDate] = useState<string | null>(null);
  // §21: grupos finais recolhidos (Concluídas/Canceladas) — estado local visual
  const [doneOpen, setDoneOpen] = useState(false);
  const [canceledOpen, setCanceledOpen] = useState(false);

  const list = useMemo(
    () =>
      [...compensations]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((c) => enrichComp(c, entries, settings)),
    [compensations, entries, settings],
  );

  const pendingEditing = editing !== null ? compensations.find((c) => c.id === editing) : null;

  // Acordos a compensar ativos do ciclo anual atual
  const todayStr = todayString();
  const cycle = getAnnualPointCycle(todayStr);
  const cycleBounds = useMemo(() => annualCycleBounds(cycle), [cycle]);

  const acordosAtivos = useMemo(
    () => activeAcordos(entries, compensations, settings, cycleBounds, absences),
    [entries, compensations, absences, settings, cycleBounds],
  );

  // Obrigações DERIVADAS do calendário da empresa (somente o ciclo anual atual).
  // Futuras ficam visíveis para planejamento; nada é persistido no store.
  const calObligations = useMemo(
    () =>
      activeCalendarObligations(
        entries,
        compensations,
        settings,
        cycleBounds,
        companyCalendars,
        todayStr,
      ),
    [entries, compensations, settings, cycleBounds, companyCalendars, todayStr],
  );

  // UX: a seção "Calendário a compensar" inicia RECOLHIDA (são muitas
  // obrigações) — as compensações do usuário têm prioridade visual. Estado
  // LOCAL de apresentação (não persiste); a lista expandida é exatamente a atual.
  const [calOpen, setCalOpen] = useState(false);

  const [formKind, setFormKind] = useState<CompKind>("excedente");
  const [formInitial, setFormInitial] = useState<CompFormData | undefined>();
  const [formPlanning, setFormPlanning] = useState<{
    originalMinutes: number;
    compensatedMinutes: number;
    plannedMinutes: number;
    openMinutes: number;
    unplannedMinutes: number;
  } | undefined>();

  /* ── §4/§9 Banco de horas consultável (topo §22) ─────────────── */
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
        cycleBounds,
        todayStr,
      ),
    [entries, compensations, absences, companyCalendars, faltas, excessReasons, settings, cycleBounds, todayStr],
  );

  const deficitsCiclo = useMemo(
    () =>
      deficitViews(
        entries,
        compensations,
        absences,
        companyCalendars,
        faltas,
        settings,
        cycleBounds,
        todayStr,
      ),
    [entries, compensations, absences, companyCalendars, faltas, settings, cycleBounds, todayStr],
  );
  const unplannedDeficitTotal = deficitsCiclo.reduce((s, d) => s + d.unplannedMinutes, 0);

  /* ── §21 GRUPO 1: reservas de excedente >10h (prioridade) ────── */
  const excessReserves = useMemo(() => {
    const dates = [...new Set(entries.map((e) => e.date))]
      .filter((d) => d >= cycleBounds.from && d <= cycleBounds.to)
      .sort((a, b) => b.localeCompare(a)); // mais próxima/recente primeiro
    return dates
      .map((d) =>
        dayCreditView(d, entries, compensations, absences, companyCalendars, settings, excessReasons),
      )
      .filter((v) => v.excessSpecial > 0 && !v.day.open && !v.day.empty);
  }, [entries, compensations, absences, companyCalendars, settings, excessReasons, cycleBounds]);

  /* ── §21 GRUPOS 2–4: status derivado das parcelas pendentes ──── */
  const pendingViews = useMemo(
    () =>
      list
        .filter((c) => c.status === "pendente")
        .map((c) => ({
          c,
          future: futureCompStatus(c, entries, compensations, settings, todayStr, { companyCalendars }),
        })),
    [list, entries, compensations, settings, todayStr, companyCalendars],
  );

  const atrasadas = useMemo(
    () =>
      pendingViews
        .filter((v) => v.future.status === "atrasada")
        .sort((a, b) => b.c.targetDate.localeCompare(a.c.targetDate) || a.c.createdAt - b.c.createdAt),
    [pendingViews],
  );
  const parciais = useMemo(
    () =>
      pendingViews
        .filter((v) => v.future.status === "parcial")
        .sort((a, b) => a.c.targetDate.localeCompare(b.c.targetDate) || a.c.createdAt - b.c.createdAt),
    [pendingViews],
  );
  const programadas = useMemo(
    () =>
      pendingViews
        .filter((v) => v.future.status === "pendente" || v.future.status === "meta-atingida")
        .sort((a, b) => a.c.targetDate.localeCompare(b.c.targetDate) || a.c.createdAt - b.c.createdAt),
    [pendingViews],
  );

  /** §22 topo: programadas = parcelas pendentes (sem chamar de "a compensar"). */
  const pendenteStats = useMemo(
    () => ({
      count: pendingViews.length,
      minutes: pendingViews.reduce((s, v) => s + v.c.minutes, 0),
    }),
    [pendingViews],
  );

  const concluidas = useMemo(
    () =>
      list
        .filter((c) => c.status === "concluida")
        .sort((a, b) => b.targetDate.localeCompare(a.targetDate) || b.createdAt - a.createdAt),
    [list],
  );
  const canceladas = useMemo(
    () =>
      list
        .filter((c) => c.status === "cancelada")
        .sort((a, b) => b.targetDate.localeCompare(a.targetDate) || b.createdAt - a.createdAt),
    [list],
  );

  /** Abre o modal de compensação pré-preenchido para um acordo */
  const openAcordoForm = (
    sourceDate: string,
    planning: {
      originalMinutes: number;
      compensatedMinutes: number;
      plannedMinutes: number;
      remainingMinutes: number;
      unplannedMinutes: number;
    },
  ) => {
    const cap = extraCapacityForDate(todayStr, entries, compensations, settings, { companyCalendars });
    const prefill = Math.max(0, Math.min(planning.unplannedMinutes, cap.available));
    if (prefill <= 0) {
      toast.show("Não há minutos sem programação (ou capacidade) para nova compensação.", "error");
      return;
    }
    setFormKind("acordo");
    setFormInitial({
      sourceDate,
      targetDate: todayStr,
      minutes: prefill,
      note: `Acordo de ${formatDateShortBR(sourceDate)}`,
    });
    setFormPlanning({
      originalMinutes: planning.originalMinutes,
      compensatedMinutes: planning.compensatedMinutes,
      plannedMinutes: planning.plannedMinutes,
      openMinutes: planning.remainingMinutes,
      unplannedMinutes: planning.unplannedMinutes,
    });
    setModalOpen(true);
  };

  /** Abre o modal pré-preenchido para uma obrigação do calendário da empresa */
  const openCalendarioForm = (sourceDate: string, remainingMinutes: number) => {
    setFormKind("calendario");
    setFormInitial({
      sourceDate,
      targetDate: todayStr,
      minutes: remainingMinutes,
      note: `Obrigação de calendário de ${formatDateShortBR(sourceDate)}`,
    });
    setModalOpen(true);
  };

  const openNewCompForm = () => {
    setEditing(null);
    setFormKind("excedente");
    setFormInitial(undefined);
    setFormPlanning(undefined);
    setModalOpen(true);
  };

  const save = async (payload: {
    sourceDate: string;
    targetDate: string;
    minutes: number;
    note: string;
    status?: string;
    kind?: CompKind;
  }) => {
    if (pendingEditing) {
      const res = actions.updateComp(pendingEditing.id, {
        sourceDate: payload.sourceDate,
        targetDate: payload.targetDate,
        minutes: payload.minutes,
        note: payload.note || null,
        kind: payload.kind ?? (pendingEditing.kind ?? "excedente"),
        ...(payload.status ? { status: payload.status as "pendente" | "concluida" | "cancelada" } : {}),
      });
      if (!res.ok) throw new Error(res.error); // modal exibe a mensagem, permanece aberto e libera o botão
    } else {
      // CAUSA RAIZ: sem `kind` explícito, addComp assumia "excedente" e a
      // compensação de acordo deixava de abater o acordo de origem.
      const res = actions.addComp({
        sourceDate: payload.sourceDate,
        targetDate: payload.targetDate,
        minutes: payload.minutes,
        note: payload.note || null,
        kind: payload.kind ?? formKind,
      });
      if (!res.ok) throw new Error(res.error);
    }
    setModalOpen(false);
    setEditing(null);
  };

  const setStatus = async (id: number, status: string) => {
    // Conclusão passa pela validação central (hora extra real + data alcançada)
    const res =
      status === "concluida"
        ? actions.completeComp(id)
        : actions.updateComp(id, { status: status as "pendente" | "concluida" | "cancelada" });
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível atualizar.", "error");
      return;
    }
    toast.show(status === "concluida" ? "Compensação concluída!" : "Compensação cancelada.");
  };

  /** §16 Registrar parcial: confirma só a parte já realizada; resto permanece pendente. */
  const registerPartial = async (id: number) => {
    const res = actions.registerPartialComp(id);
    if (!res.ok) {
      toast.show(res.error ?? "Não foi possível registrar a parte realizada.", "error");
      return;
    }
    toast.show("Parte realizada registrada — o restante continua planejado.");
  };

  /** §14/§17 Reprogramar: move a DATA planejada mantendo o vínculo (mesma obrigação). */
  const reprogram = (id: number) => {
    setEditing(id);
    setModalOpen(true);
  };

  const remove = async (id: number) => {
    if (!window.confirm("Excluir esta compensação?")) return;
    actions.deleteComp(id);
    toast.show("Compensação excluída.");
  };

  if (!mounted) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  /** Chip de ORIGEM da compensação (§21) — nunca confunde planejado com realizado. */
  const originChip = (c: CompWithDays) => {
    const k = kindOf(c);
    if (c.portion === "especial") {
      return (
        <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
          {"Excedente do limite diário realocado"}
        </span>
      );
    }
    const cls =
      k === "deficit"
        ? "bg-emerald-50 text-emerald-700"
        : k === "acordo"
          ? "bg-violet-50 text-violet-700"
          : k === "calendario"
            ? "bg-amber-50 text-amber-700"
            : "bg-sky-50 text-sky-700";
    const label =
      k === "deficit"
        ? "↗ Déficit · hora extra"
        : k === "acordo"
          ? "↗ Acordo · hora extra"
          : k === "calendario"
            ? "↗ Calendário"
            : "↘ Excedente do limite diário";
    return (
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>
    );
  };

  /**
   * Item de compensação — markup único; as AÇÕES variam por grupo (§21):
   * pendentes ganham Registrar parcial / Reprogramar / Confirmar quitação;
   * históricas (concluída/cancelada) ficam somente consultáveis/excluíveis.
   */
  const renderComp = (c: CompWithDays, future: FutureCompView | null) => {
    const k = kindOf(c);
    const isExtra = usesHourExtra(k);
    const check =
      c.status === "pendente" && isExtra
        ? canCompleteComp(c, entries, compensations, settings, todayStr, { companyCalendars })
        : { ok: true as const };
    return (
      <div
        key={c.id}
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-600/10">
            <ArrowLeftRight size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-slate-900">
              {formatMinutes(c.minutes)}{" "}
              <span className="font-medium text-slate-400">
                — {formatDateBR(c.sourceDate)} → {formatDateBR(c.targetDate)}
              </span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {c.sourceDay && (
                <span>
                  origem: <b>{formatMinutes(c.sourceDay.workedMinutes)}</b> trabalhados
                  {c.sourceDay.excessMinutes > 0 && (
                    <span className="text-rose-500">
                      ({formatMinutes(c.sourceDay.excessMinutes)} excedente)
                    </span>
                  )}
                </span>
              )}
              {(() => {
                // Saldo do dia-destino pela RESOLUÇÃO CENTRAL (apresentação):
                // folga/abonado com trabalho → +trabalhado, nunca "−8h".
                const line = c.targetDay
                  ? compDayLineView(c.targetDate, entries, absences, companyCalendars, settings)
                  : null;
                if (!line) return null;
                return (
                  <span>
                    destino: <b>{formatMinutes(line.workedMinutes)}</b> trabalhados
                    {line.contextSuffix ? ` ${line.contextSuffix}` : ""}
                    {line.balanceMinutes !== 0 && (
                      <span className={line.balanceMinutes > 0 ? "text-emerald-600" : "text-amber-600"}>
                        ({line.balanceMinutes > 0 ? "+" : ""}{formatMinutes(line.balanceMinutes)} de saldo)
                      </span>
                    )}
                  </span>
                );
              })()}
              {future && future.realizedMinutes > 0 && (
                <span>
                  realizado: <b className="text-emerald-600">{formatMinutes(future.realizedMinutes)}</b>
                  {future.remainingMinutes > 0 && (
                    <>
                      {" "}· restante: <b className="text-amber-600">{formatMinutes(future.remainingMinutes)}</b>
                    </>
                  )}
                </span>
              )}
              {c.note && <span className="italic">“{c.note}”</span>}
              {originChip(c)}
            </div>
          </div>
          {c.status === "concluida" && (
            <Badge tone="emerald">
              <CheckCircle2 size={12} /> Concluída
            </Badge>
          )}
          {c.status === "cancelada" && <Badge tone="slate">Cancelada</Badge>}
          {c.status === "pendente" && future?.status === "atrasada" && (
            <Badge tone="rose">
              <TriangleAlert size={12} /> Atrasada
            </Badge>
          )}
          {c.status === "pendente" && future?.status === "parcial" && (
            <Badge tone="amber">
              <Clock3 size={12} /> Parcial
            </Badge>
          )}
          {c.status === "pendente" && future?.status === "meta-atingida" && (
            <Badge tone="emerald">Meta de compensação atingida ✓</Badge>
          )}
          {c.status === "pendente" && future?.status === "pendente" && (
            <Badge tone="indigo">Pendente</Badge>
          )}
          <div className="flex items-center gap-1">
            {c.status === "pendente" && (
              <>
                {/* §16 Registrar parcial: só quando JÁ existe realização no destino */}
                {isExtra && future && future.realizedMinutes > 0 && (
                  <Button size="sm" variant="subtle" onClick={() => registerPartial(c.id)}>
                    <Clock3 size={13} /> Registrar parcial ({formatMinutes(future.realizedMinutes)})
                  </Button>
                )}
                {isExtra && !check.ok && (
                  <span className="mr-1 max-w-[240px] text-[11px] font-semibold text-amber-600">
                    {check.error}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={!check.ok}
                  onClick={() => setStatus(c.id, "concluida")}
                >
                  <CheckCircle2 size={13} />
                  {isExtra ? "Confirmar quitação" : "Concluir"}
                </Button>
                {/* §17: atrasadas pedem reprogramação mantendo o vínculo */}
                {future?.status === "atrasada" && (
                  <Button size="sm" variant="secondary" onClick={() => reprogram(c.id)}>
                    <CalendarClock size={13} /> Reprogramar compensação
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setStatus(c.id, "cancelada")}>
                  <XCircle size={13} /> Cancelar
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(c.id);
                setModalOpen(true);
              }}
              aria-label="Editar"
            >
              <Pencil size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove(c.id)}
              aria-label="Excluir"
              className="!text-rose-500 hover:!bg-rose-50"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const nothingAtAll =
    list.length === 0 &&
    excessReserves.length === 0 &&
    calObligations.length === 0 &&
    acordosAtivos.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900">Compensações de horas</h2>
          <p className="text-sm text-slate-500">
            Banco de horas em tempo real: só fatos alteram o saldo realizado — planejamentos ficam separados.
          </p>
        </div>
        <Button onClick={openNewCompForm}>
          <PlusCircle size={15} /> Nova compensação
        </Button>
      </div>

      {/* §22 TOPO: somente números factuais — "programadas" nunca é chamado de
          "a compensar"; o que já foi concluído aparece separado. */}
      {(pendenteStats.count > 0 ||
        unplannedDeficitTotal > 0 ||
        bank.excessSpecialFreeTotal > 0 ||
        concluidas.length > 0 ||
        calObligations.length > 0 ||
        acordosAtivos.length > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700">
          {pendenteStats.count > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <ArrowLeftRight size={15} /> Programadas: {pendenteStats.count} · {formatMinutes(pendenteStats.minutes)}
            </span>
          )}
          {unplannedDeficitTotal > 0 && (
            <>
              {pendenteStats.count > 0 && <span>·</span>}
              <span className="text-amber-600">
                Déficits ainda sem programação: {formatMinutes(unplannedDeficitTotal)}
              </span>
            </>
          )}
          {bank.excessSpecialFreeTotal > 0 && (
            <>
              {(pendenteStats.count > 0 || unplannedDeficitTotal > 0) && <span>·</span>}
              <span className="text-rose-600">
                Excedente &gt;10h a realocar: {formatMinutes(bank.excessSpecialFreeTotal)}
                {bank.excessWithoutReason > 0 && ` (⚠ ${formatMinutes(bank.excessWithoutReason)} sem motivo)`}
              </span>
            </>
          )}
          {concluidas.length > 0 && (
            <>
              {(pendenteStats.count > 0 || unplannedDeficitTotal > 0 || bank.excessSpecialFreeTotal > 0) && <span>·</span>}
              <span className="text-emerald-600">Concluídas: {concluidas.length}</span>
            </>
          )}
          {calObligations.length > 0 && (
            <>
              <span>·</span>
              <span className="text-amber-600">
                Calendário a compensar: {calObligations.length} obrigação(ões) ·{" "}
                {formatMinutes(calObligations.reduce((s, o) => s + o.remainingMinutes, 0))} restantes
              </span>
            </>
          )}
          {acordosAtivos.length > 0 && (
            <>
              <span>·</span>
              <span className="text-violet-600">
                Acordos a compensar: {acordosAtivos.length} ·{" "}
                {formatMinutes(acordosAtivos.reduce((s, a) => s + a.remainingMinutes, 0))} restantes
              </span>
            </>
          )}
        </div>
      )}

      {/* ── §21 GRUPO 1: EXCEDENTES >10h — PRIORIDADE ──────────── */}
      {excessReserves.length > 0 && (
        <div id="excedentes-prioridade" className="scroll-mt-20">
        <Card
          title={
            <>
              Excedentes acima de 10h <span className="text-rose-600">— prioridade</span>
            </>
          }
          subtitle="Reserva especial de dias que passaram do limite diário — o motivo é obrigatório antes de realocar (§10); a realocação usa a prioridade do banco (Visão geral → Dias com saldo negativo)"
        >
          <ul className="space-y-3">
            {excessReserves.map((v) => {
              const led = specialExcessLedger(v.date, compensations, v.excessSpecial);
              const statusBadge =
                led.status === "tratado" ? (
                  <Badge tone="emerald">Tratado ✓</Badge>
                ) : led.status === "parcial" ? (
                  <Badge tone="sky">Parcialmente realocado</Badge>
                ) : led.status === "programado" ? (
                  <Badge tone="indigo">Programado</Badge>
                ) : (
                  <Badge tone="amber">Livre</Badge>
                );
              return (
                <li
                  key={v.date}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-100 bg-rose-50/50 p-3"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 ring-1 ring-inset ring-rose-600/10">
                    <TriangleAlert size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">
                      {formatDateBR(v.date)} — {formatMinutes(v.excessSpecial)} de excedente do limite diário
                      {statusBadge}
                      {!v.reason && <Badge tone="amber">⚠ Motivo não informado</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Trabalhado: <b>{formatMinutes(v.day.workedMinutes)}</b> · Realocado:{" "}
                      <b className="text-emerald-600">{formatMinutes(led.realized)}</b> · Programado:{" "}
                      <b className="text-sky-600">{formatMinutes(led.planned)}</b> · Livre:{" "}
                      <b className="text-amber-600">{formatMinutes(led.free)}</b>
                      {v.reason && (
                        <>
                          {" "}· Motivo: <b>{excessReasonLabel(v.reason)}</b>
                          {excessReasonObservation(v.reason) && (
                            <span className="italic"> — {excessReasonObservation(v.reason)}</span>
                          )}
                        </>
                      )}
                    </p>
                    {(led.realizedTo.length > 0 || led.plannedTo.length > 0) && (
                      <div className="mt-1.5 text-[11px] text-slate-600">
                        {led.realizedTo.map((t, i) => (
                          <p key={`r${i}`}>Realizado: {formatMinutes(t.minutes)} → déficit de {formatDateBR(t.date)}</p>
                        ))}
                        {led.plannedTo.map((t, i) => (
                          <p key={`p${i}`}>Programado: {formatMinutes(t.minutes)} → {formatDateBR(t.date)}</p>
                        ))}
                      </div>
                    )}
                  </div>
                  {!v.reason && (
                    <Button size="sm" variant="danger" onClick={() => setReasonDate(v.date)}>
                      Registrar motivo
                    </Button>
                  )}
                  {v.reason && (
                    <Button size="sm" variant="ghost" onClick={() => setReasonDate(v.date)}>
                      Alterar motivo
                    </Button>
                  )}
                  {v.reason && led.free > 0 && (
                    <Button size="sm" variant="danger" onClick={() => setAllocateDate(v.date)}>
                      Alocar excedente
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        </div>
      )}

      {/* ── §21 GRUPO 2: ATRASADAS ──────────────────────────────── */}
      {atrasadas.length > 0 && (
        <Card
          title={`Atrasadas (${atrasadas.length})`}
          subtitle="A data programada passou e ainda existe saldo não realizado — reprograme mantendo o vínculo com a obrigação original"
        >
          <div className="space-y-3">
            {atrasadas.map(({ c, future }) => renderComp(c, future))}
          </div>
        </Card>
      )}

      {/* ── §21 GRUPO 3: PARCIAIS ───────────────────────────────── */}
      {parciais.length > 0 && (
        <Card
          title={`Parciais (${parciais.length})`}
          subtitle="Houve realização no dia de destino, mas menor que a obrigação — registre a parte realizada ou complete a quitação"
        >
          <div className="space-y-3">
            {parciais.map(({ c, future }) => renderComp(c, future))}
          </div>
        </Card>
      )}

      {/* ── §21 GRUPO 4: PENDENTES/PROGRAMADAS ──────────────────── */}
      {programadas.length > 0 && (
        <Card
          title={`Pendentes e programadas (${programadas.length})`}
          subtitle="Planejadas para o futuro — ainda NÃO alteram o saldo realizado do banco de horas"
        >
          <div className="space-y-3">
            {programadas.map(({ c, future }) => renderComp(c, future))}
          </div>
        </Card>
      )}

      {/* ── §21 GRUPO 5: CONCLUÍDAS (recolhível) ────────────────── */}
      {concluidas.length > 0 && (
        <Card
          title={`Concluídas (${concluidas.length})`}
          subtitle="Histórico de quitações efetivadas — somente consulta"
          actions={
            <Button size="sm" variant="subtle" onClick={() => setDoneOpen((v) => !v)} aria-expanded={doneOpen}>
              {doneOpen ? (
                <>Ocultar <ChevronUp size={14} /></>
              ) : (
                <>Ver concluídas <ChevronDown size={14} /></>
              )}
            </Button>
          }
        >
          {doneOpen ? (
            <div className="space-y-3">{concluidas.map((c) => renderComp(c, null))}</div>
          ) : (
            <p className="text-xs text-slate-500">
              {concluidas.length} compensação(ões) concluída(s) ·{" "}
              {formatMinutes(concluidas.reduce((s, c) => s + c.minutes, 0))} efetivados — clique em{" "}
              <b>Ver concluídas</b> para expandir.
            </p>
          )}
        </Card>
      )}

      {/* ── §21 GRUPO 6: CANCELADAS (recolhível) ────────────────── */}
      {canceladas.length > 0 && (
        <Card
          title={`Canceladas (${canceladas.length})`}
          subtitle="Registros cancelados — não afetam o banco de horas"
          actions={
            <Button size="sm" variant="subtle" onClick={() => setCanceledOpen((v) => !v)} aria-expanded={canceledOpen}>
              {canceledOpen ? (
                <>Ocultar <ChevronUp size={14} /></>
              ) : (
                <>Ver canceladas <ChevronDown size={14} /></>
              )}
            </Button>
          }
        >
          {canceledOpen ? (
            <div className="space-y-3">{canceladas.map((c) => renderComp(c, null))}</div>
          ) : (
            <p className="text-xs text-slate-500">
              {canceladas.length} compensação(ões) cancelada(s) — clique em <b>Ver canceladas</b> para expandir.
            </p>
          )}
        </Card>
      )}

      {/* Seção de obrigações do Calendário da empresa (derivadas; ciclo anual atual).
          UX: inicia RECOLHIDA — faixa-resumo compacta + "Ver obrigações" expande
          exatamente a lista atual (cards, badge Próxima, ações, ordenação). */}
      {calObligations.length > 0 && (
        <Card
          title="Calendário a compensar"
          subtitle={`Obrigações do calendário da empresa no ciclo anual ${cycle} — visíveis antes da data para planejamento; somente compensações concluídas abatem o restante`}
          actions={
            <Button
              size="sm"
              variant="subtle"
              onClick={() => setCalOpen((v) => !v)}
              aria-expanded={calOpen}
            >
              {calOpen ? (
                <>Ocultar <ChevronUp size={14} /></>
              ) : (
                <>Ver obrigações <ChevronDown size={14} /></>
              )}
            </Button>
          }
        >
          {/* Card-resumo compacto — sempre visível, sem recalcular nada */}
          <p className="mb-3 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
              {calObligations.length} obrigação(ões)
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 font-bold text-rose-600 ring-1 ring-inset ring-rose-200">
              {formatMinutes(calObligations.reduce((s, o) => s + o.remainingMinutes, 0))} restantes
            </span>
            {!calOpen && (
              <span>
                · clique em <b>Ver obrigações</b> para expandir a lista
              </span>
            )}
          </p>
          {calOpen && (
            <ul className="space-y-3">
              {calObligations.map((d) => (
                <li key={d.date} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">
                      Calendário a compensar — {formatMinutes(d.originalMinutes)}
                      {d.future && <Badge tone="sky">Próxima</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Origem: {formatDateShortBR(d.date)} · Ciclo: {d.cycleLabel} · Compensado:{" "}
                      <b className="text-emerald-600">{formatMinutes(d.compensatedMinutes)}</b> ·
                      Restante: <b className="text-amber-600">{formatMinutes(d.remainingMinutes)}</b>
                      {d.plannedMinutes > 0 && (
                        <> · Planejado: <b className="text-sky-600">{formatMinutes(d.plannedMinutes)}</b></>
                      )}
                    </p>
                  </div>
                  {d.remainingMinutes > 0 && (
                    <Button size="sm" variant="subtle" onClick={() => openCalendarioForm(d.date, d.remainingMinutes)}>
                      Compensar com hora extra
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Seção de Acordos a compensar ativos (origem do ciclo anual atual) */}
      {acordosAtivos.length > 0 && (
        <Card
          title="Acordos a compensar"
          subtitle={`Pendências ativas do ciclo anual ${cycle} — permanecem visíveis até quitação ou fechamento anual (30/04), independentemente do período 21→20`}
        >
          <ul className="space-y-3">
            {acordosAtivos.map((d) => (
              <li key={d.date} className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800">
                    Acordo a compensar — {formatMinutes(d.originalMinutes)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Origem: {formatDateShortBR(d.date)} · Ciclo anual:{" "}
                    {getAnnualPointCycle(d.date)} · Original:{" "}
                    <b>{formatMinutes(d.originalMinutes)}</b> · Compensado:{" "}
                    <b className="text-emerald-600">{formatMinutes(d.compensatedMinutes)}</b> ·
                    Planejado: <b className="text-sky-600">{formatMinutes(d.plannedMinutes)}</b> ·
                    Em aberto: <b className="text-amber-600">{formatMinutes(d.remainingMinutes)}</b> ·
                    Sem programação: <b>{formatMinutes(d.unplannedMinutes)}</b>
                  </p>
                </div>
                {d.unplannedMinutes > 0 && (
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() =>
                      openAcordoForm(d.date, {
                        originalMinutes: d.originalMinutes,
                        compensatedMinutes: d.compensatedMinutes,
                        plannedMinutes: d.plannedMinutes,
                        remainingMinutes: d.remainingMinutes,
                        unplannedMinutes: d.unplannedMinutes,
                      })
                    }
                  >
                    Programar hora extra
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {nothingAtAll && (
        <EmptyState
          icon={<ArrowLeftRight size={26} />}
          title="Nenhuma compensação registrada"
          description="Quando um dia passar do limite de 10h, crie uma compensação para registrar as horas em outro dia."
          action={
            <Button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              <PlusCircle size={15} /> Criar primeira compensação
            </Button>
          }
        />
      )}

      <CompensationForm
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
          setFormInitial(undefined);
          setFormPlanning(undefined);
        }}
        editingId={editing}
        kind={editing !== null ? (pendingEditing?.kind ?? "excedente") : formKind}
        initial={
          editing !== null
            ? pendingEditing
              ? {
                  sourceDate: pendingEditing.sourceDate,
                  targetDate: pendingEditing.targetDate,
                  minutes: pendingEditing.minutes,
                  note: pendingEditing.note ?? "",
                  status: pendingEditing.status,
                  kind: pendingEditing.kind,
                }
              : undefined
            : formInitial
        }
        getCapacity={(targetDate) =>
          extraCapacityForDate(targetDate, entries, compensations, settings, {
            excludeCompId: editing ?? undefined,
            companyCalendars,
          })
        }
        pendingDebtMinutes={editing === null && formInitial ? formInitial.minutes : undefined}
        onSave={save}
      />

      {/* §10 Modal de motivo do excedente — fecha livremente; sem motivo o dia
          mantém "⚠ Motivo não informado" e a reserva fica indisponível. */}
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
      {reasonDate &&
        (() => {
          const day = computeDay(
            entries.filter((e) => e.date === reasonDate),
            settings,
          );
          return (
            <ExcessReasonModal
              open
              onClose={() => setReasonDate(null)}
              date={reasonDate}
              workedMinutes={day.workedMinutes}
              excessMinutes={day.excessMinutes}
              existing={excessReasonOnDate(excessReasons, reasonDate)}
            />
          );
        })()}
    </div>
  );
}
