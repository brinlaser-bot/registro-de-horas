"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Ban,
  Cake,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Handshake,
  HeartPulse,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  Umbrella,
  Zap,
} from "lucide-react";
import type { Compensation, DayResult, WorkSettings } from "@/lib/types";
import type { EntryType, TimeEntryLike } from "@/lib/time";
import { formatDateBR, formatDateShortBR, formatMinutes, isFutureDate, nextWorkday, nowTimeString, todayString, weekdayLong } from "@/lib/time";
import { Badge, Button, ExcessTenBadge, Input, Select } from "@/components/ui";
import { CompensationForm, type CompFormData } from "@/components/compensation-form";
import { SmartExit } from "@/components/smart-exit";
import { allocatedForSource, overflowForSource, type ExtraCapacity } from "@/lib/debt";
import { absenceLabel, type Absence, type DayBalanceView } from "@/lib/absences";
import { excessReasonLabel, excessReasonObservation, specialExcessLedger, type DayCreditView } from "@/lib/hour-bank";
import type { CompKind } from "@/lib/types";

export function statusBadge(d: DayResult) {
  if (d.status === "excess") return <Badge tone="rose">Acima do limite</Badge>;
  if (d.status === "deficit") return <Badge tone="amber">Abaixo da base</Badge>;
  if (d.status === "in-progress") return <Badge tone="indigo">Em andamento</Badge>;
  if (d.status === "empty") return <Badge tone="slate">Sem registros</Badge>;
  return <Badge tone="emerald">Dia ok</Badge>;
}

/**
 * Ícone da situação do dia. O `shrink-0` é essencial: sem ele o <svg> é um
 * flex-item que pode colapsar para largura 0 dentro do badge, tornando o
 * ícone invisível mesmo presente no DOM.
 */
function absenceIcon(absence: Absence, size: number) {
  const cls = "shrink-0";
  if (absence.kind === "ferias") return <Umbrella size={size} className={cls} aria-hidden />;
  if (absence.kind === "saude") return <HeartPulse size={size} className={cls} aria-hidden />;
  if (absence.kind === "acordado") return <Handshake size={size} className={cls} aria-hidden />;
  if (absence.kind === "abono") return <Cake size={size} className={cls} aria-hidden />;
  return <CalendarDays size={size} className={cls} aria-hidden />;
}

/** Badge do card recolhido: ícone perceptível + texto completo. */
function absenceBadge(absence: Absence) {
  if (absence.kind === "abono") {
    return (
      <Badge tone="amber" className="shrink-0 gap-1.5 py-1">
        {absenceIcon(absence, 14)}
        <span>Abono de aniversário 🎂</span>
      </Badge>
    );
  }
  if (absence.kind === "ferias") {
    return (
      <Badge tone="sky" className="shrink-0 gap-1.5 py-1">
        {absenceIcon(absence, 14)}
        <span>Férias</span>
      </Badge>
    );
  }
  if (absence.kind === "saude") {
    return (
      <Badge tone="rose" className="shrink-0 gap-1.5 py-1">
        {absenceIcon(absence, 14)}
        <span>Afastamento por saúde</span>
      </Badge>
    );
  }
  if (absence.kind === "acordado" && absence.treatment === "compensar") {
    return (
      <Badge tone="indigo" className="shrink-0 gap-1.5 py-1">
        {absenceIcon(absence, 14)}
        <span>Afastamento acordado — compensar posteriormente</span>
      </Badge>
    );
  }
  if (absence.kind === "acordado") {
    return (
      <Badge tone="emerald" className="shrink-0 gap-1.5 py-1">
        {absenceIcon(absence, 14)}
        <span>Afastamento acordado — horas dispensadas</span>
      </Badge>
    );
  }
  return (
    <Badge tone="slate" className="shrink-0 gap-1.5 py-1">
      {absenceIcon(absence, 14)}
      <span>Outro afastamento justificado</span>
    </Badge>
  );
}

interface Props {
  result: DayResult;
  settings: WorkSettings;
  compsForDate: Compensation[]; // compensações com destino neste dia
  allComps?: Compensation[]; // todas (para o abatimento fracionado)
  nowMinutes?: number;
  isToday?: boolean;
  onAddEntry: (p: { date: string; time: string; type: EntryType; note: string | null; source?: "live" | "manual" }) => Promise<void>;
  onUpdateEntry: (id: number, patch: { time?: string; type?: EntryType; note?: string | null }) => Promise<void>;
  onDeleteEntry: (id: number) => Promise<void>;
  onCompleteComp: (id: number) => Promise<void>;
  onCreateComp: (data: CompFormData) => Promise<void>;
  onCapComp?: (date: string, kind: CompKind, maxMinutes: number) => void | Promise<void>;
  /** Ausência (férias/afastamento) que cobre o dia, se houver. */
  absence?: Absence;
  /** Falta registrada no dia (ocorrência de ponto — não é afastamento). */
  falta?: { id: number; status: "efetiva" | "prevista"; jornadaMinutes: number };
  /** Remove/cancela a falta (exclusão com guarda de compensação vinculada). */
  onRemoveFalta?: (id: number) => Promise<void>;
  /** Jornada esperada efetiva do dia (com ausência descontada). */
  effectiveExpected?: number;
  /** Visão central de saldo regular / déficit / acordo a compensar. */
  balanceView?: DayBalanceView;
  /** Situação de calendário/folga do dia, quando não houver ausência manual. */
  calendarLabel?: string | null;
  /** Atalhos de compensação do dia (calculados pela página com as funções centrais). */
  shortcuts?: {
    deficitRemaining: number;
    /** Original do acordo. */
    acordoMinutes: number;
    /** Já concluído (compensado). */
    acordoCompensated: number;
    /** Planejado e ainda não concluído. */
    acordoPlanned: number;
    /** Original − Compensado. */
    acordoRemaining: number;
    canCompensate: boolean; // ciclo anual ainda ativo
  };
  /** Capacidade de hora extra por dia de destino (função central). */
  getCapacity?: (targetDate: string) => ExtraCapacity;
  /** Decomposição central (dayCreditView) — crédito regular × excedente especial. */
  creditView?: DayCreditView;
  /** Abre o modal existente de motivo do excedente >10h. */
  onRegisterReason?: (date: string) => void;
  /** Abre o fluxo próprio de alocação do excedente especial já realizado. */
  onAllocateExcess?: (date: string) => void;
  /** Fluxo inverso: quitar o déficit DESTE dia com excedente realizado. */
  onUseAvailableExcess?: (date: string) => void;
  /** Há excedente do limite diário elegível no ciclo (motivo + livre). */
  hasAvailableSpecialExcess?: boolean;
}

export function DayCard({
  result,
  settings,
  compsForDate,
  allComps,
  nowMinutes = 0,
  isToday,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  onCompleteComp,
  onCreateComp,
  onCapComp,
  absence,
  falta,
  onRemoveFalta,
  effectiveExpected,
  balanceView,
  calendarLabel,
  shortcuts,
  getCapacity,
  creditView,
  onRegisterReason,
  onAllocateExcess,
  onUseAvailableExcess,
  hasAvailableSpecialExcess,
}: Props) {
  // Regra: todos os dias iniciam RECOLHIDOS — o usuário expande apenas o dia desejado.
  const [expanded, setExpanded] = useState(false);
  const [compKind, setCompKind] = useState<CompKind>("excedente");
  const [compInitial, setCompInitial] = useState<CompFormData | undefined>();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<{ type: EntryType; time: string; note: string }>({
    type: "entrada",
    time: nowTimeString(),
    note: "",
  });
  const [editForm, setEditForm] = useState<{ type: EntryType; time: string; note: string }>({
    type: "entrada",
    time: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [busyFalta, setBusyFalta] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [compPlanning, setCompPlanning] = useState<{
    originalMinutes: number;
    compensatedMinutes: number;
    plannedMinutes: number;
    openMinutes: number;
    unplannedMinutes: number;
  } | undefined>();

  const d = result;
  const pendingComp = compsForDate.find((c) => c.status === "pendente");
  // REGRA ABSOLUTA: batidas só em data <= hoje. Em card FUTURO nenhum controle
  // de ponto é oferecido (formulário, Smart Exit) — o card fica somente leitura
  // (Falta prevista, métricas e Cancelar falta permanecem).
  const futureDay = isFutureDate(d.date);
  // ABONO DE ANIVERSÁRIO: dia coberto pelo benefício é SOMENTE INFORMATIVO —
  // nenhum controle de batida (formulário de registro manual) é oferecido no card.
  // (Regra específica de kind === "abono" — NÃO generalizar para outros eventos.)
  const abonoDay = absence?.kind === "abono";

  const add = async (type?: EntryType, time?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await onAddEntry({ date: d.date, time: time ?? form.time, type: type ?? form.type, note: form.note || null, source: "manual" });
      setForm((f) => ({ ...f, note: "" }));
      setShowAdd(false);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (e: TimeEntryLike) => {
    setEditingId(e.id);
    setEditForm({ type: e.type, time: e.time, note: e.note ?? "" });
  };

  const saveEdit = async (id: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await onUpdateEntry(id, editForm);
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("Remover este registro?")) return;
    await onDeleteEntry(id);
  };

  const finishComp = async (id: number) => {
    if (!window.confirm("Marcar esta compensação como concluída?")) return;
    await onCompleteComp(id);
  };

  /** Abre o formulário central de compensação já preenchido (atalho do card). */
  const openComp = (kind: CompKind, minutes: number, note: string) => {
    setCompKind(kind);
    if (kind === "acordo" && shortcuts) {
      setCompPlanning({
        originalMinutes: shortcuts.acordoMinutes,
        compensatedMinutes: shortcuts.acordoCompensated,
        plannedMinutes: shortcuts.acordoPlanned,
        openMinutes: shortcuts.acordoRemaining,
        unplannedMinutes: Math.max(0, shortcuts.acordoRemaining - shortcuts.acordoPlanned),
      });
    } else if (kind === "deficit") {
      setCompPlanning({
        originalMinutes: deficitOriginal,
        compensatedMinutes: deficitConcluded,
        plannedMinutes: deficitPlanned,
        openMinutes: deficitOpen,
        unplannedMinutes: Math.max(0, deficitOpen - deficitPlanned),
      });
    } else {
      setCompPlanning(undefined);
    }
    setCompInitial({
      sourceDate: d.date,
      // excedente → sair mais cedo (próximo dia útil); hora extra → usuário escolhe o dia
      targetDate: kind === "excedente" ? nextWorkday(d.date) : todayString(),
      minutes,
      note,
    });
    setCompOpen(true);
  };

  // Registro de saída em 1 clique + conclusão das compensações de saída antecipada
  const smartExit = async (time: string, compIds: number[]) => {
    await onAddEntry({ date: d.date, time, type: "saida", note: "Saída sugerida pelo assistente" });
    for (const id of compIds) await onCompleteComp(id);
  };

  // Confirmação manual de quitação (hora extra) — sem registrar saída
  const confirmComps = async (compIds: number[]) => {
    for (const id of compIds) await onCompleteComp(id);
  };

  const allocatedHere = allComps
    ? allocatedForSource(allComps, d.date, "excedente")
    : 0;
  const remainingExcess = Math.max(0, d.excessMinutes - allocatedHere);

  // Visão central de apresentação do saldo regular do dia.
  const regularExpected = balanceView?.effectiveExpected ?? effectiveExpected ?? d.expectedMinutes;
  const regularBalance = balanceView?.adjustedBalance ?? d.balanceMinutes;
  const commonDeficit = balanceView?.adjustedDeficit ?? Math.max(0, d.expectedMinutes - d.workedMinutes);
  const acordoMinutes = balanceView?.acordoMinutes ?? shortcuts?.acordoMinutes ?? 0;

  // Detecção de overflow: compensação vinculada acima da dívida atual (após correção)
  const deficitHere = commonDeficit;
  const excessOverflow = allComps ? overflowForSource(allComps, d.date, "excedente", d.excessMinutes) : 0;
  const deficitOverflow = allComps ? overflowForSource(allComps, d.date, "deficit", deficitHere) : 0;

  const adjustOverflow = async (kind: CompKind) => {
    const max = kind === "excedente" ? d.excessMinutes : deficitHere;
    await onCapComp?.(d.date, kind, max);
  };

  const balanceTone = regularBalance > 0 ? "text-emerald-600" : regularBalance < 0 ? "text-rose-600" : "text-slate-500";
  /* Dia encerrado acima de 10h: NÃO misturar o excedente especial com o
   * crédito regular. A decomposição vem de dayCreditView (fonte única). */
  const excessOriginal = creditView?.excessSpecial ?? d.excessMinutes;
  const excessAllocated = creditView
    ? creditView.usedSpecialViaTarget + creditView.usedSpecialViaSource
    : allocatedHere;
  const excessRemaining = creditView?.freeSpecial ?? remainingExcess;
  const showSplit = !d.open && !d.empty && excessOriginal > 0;
  const specialLed = showSplit ? specialExcessLedger(d.date, allComps ?? [], excessOriginal) : null;
  const excessTreated = showSplit && (specialLed?.status === "tratado");
  const deficitParcels = (allComps ?? []).filter(
    (c) => c.sourceDate === d.date && (c.kind ?? "excedente") === "deficit" && c.status !== "cancelada",
  );
  const deficitConcluded = deficitParcels.filter((c) => c.status === "concluida").reduce((s, c) => s + c.minutes, 0);
  const deficitPlanned = deficitParcels.filter((c) => c.status === "pendente").reduce((s, c) => s + c.minutes, 0);
  const deficitOriginal = commonDeficit;
  const deficitOpen = Math.max(0, deficitOriginal - deficitConcluded);
  const showDeficitFollow =
    deficitOriginal > 0 && !d.open && (!d.empty || !!falta) && !showSplit;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Cabeçalho */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left cursor-pointer hover:bg-slate-50/70 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-900">
            {weekdayLong(d.date).replace(/^./, (c) => c.toUpperCase())}
            <span className="ml-2 font-medium text-slate-400">{formatDateShortBR(d.date)}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {absence ? (
              absenceBadge(absence)
            ) : calendarLabel ? (
              <Badge tone="slate" className="shrink-0 gap-1.5 py-1">
                <CalendarDays size={14} className="shrink-0" aria-hidden />
                <span>{calendarLabel}</span>
              </Badge>
            ) : falta ? (
              <Badge
                tone={falta.status === "prevista" ? "sky" : "rose"}
                className="shrink-0 gap-1.5 py-1"
              >
                <Ban size={14} className="shrink-0" aria-hidden />
                <span>{falta.status === "prevista" ? "Falta prevista" : "Falta"}</span>
              </Badge>
            ) : futureDay ? (
              d.empty ? <Badge tone="slate">—</Badge> : <Badge tone="slate">Registro futuro</Badge>
            ) : isToday && d.empty && !falta ? (
              <Badge tone="slate">Jornada não iniciada</Badge>
            ) : (
              statusBadge(d)
            )}
            {/* Jornada calendada + falta (ex.: Cinzas 4h): mostra os dois rótulos */}
            {falta && (absence || calendarLabel) && (
              <Badge
                tone={falta.status === "prevista" ? "sky" : "rose"}
                className="shrink-0 gap-1.5 py-1"
              >
                <Ban size={14} className="shrink-0" aria-hidden />
                <span>{falta.status === "prevista" ? "Falta prevista" : "Falta"}</span>
              </Badge>
            )}
            {/* Acordo: indicação curta do que ainda falta (sem duplicar no badge) */}
            {absence?.kind === "acordado" &&
              absence.treatment === "compensar" &&
              (shortcuts?.acordoRemaining ?? 0) > 0 && (
                <span
                  className="inline-flex shrink-0 items-center rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-700"
                  title={`Acordo original ${formatMinutes(shortcuts?.acordoMinutes ?? 0)} · compensado ${formatMinutes(shortcuts?.acordoCompensated ?? 0)}`}
                >
                  Restante: {formatMinutes(shortcuts?.acordoRemaining ?? 0)}
                </span>
              )}
            {d.open && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" /> em andamento</span>}
            {d.lunchDeductedMinutes > 0 && (
              <span className="text-[11px] font-medium text-slate-400">
                almoço descontado ({formatMinutes(d.lunchDeductedMinutes)})
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-extrabold tabular-nums text-slate-900">{formatMinutes(d.workedMinutes)}</p>
          {showSplit ? (
            <>
              <p className="text-xs font-bold tabular-nums text-emerald-600">
                +{formatMinutes(creditView?.regularExtra ?? 0)} regular
              </p>
              {excessTreated ? (
                <p className="mt-0.5 text-[11px] font-semibold text-emerald-700">✓ Excedente tratado</p>
              ) : (
                <p className="mt-0.5 inline-flex items-center justify-end gap-1 text-[11px] font-extrabold text-rose-600">
                  <TriangleAlert size={11} aria-hidden /> {formatMinutes(excessRemaining)} a realocar
                </p>
              )}
            </>
          ) : (
            <>
              <p className={`text-xs font-bold tabular-nums ${balanceTone}`}>
                {regularBalance >= 0 ? "+" : ""}
                {formatMinutes(regularBalance)}
              </p>
              {showDeficitFollow && (
                deficitOpen <= 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold text-emerald-700">✓ Déficit quitado</p>
                ) : deficitConcluded > 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold text-amber-700">Parcial · restam {formatMinutes(deficitOpen)}</p>
                ) : (
                  <p className="mt-0.5 text-[11px] font-semibold text-rose-600">Em aberto · {formatMinutes(deficitOpen)}</p>
                )
              )}
            </>
          )}
        </div>
        {expanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4">
          {/* Assistente de saída (somente para o dia em andamento; nunca no futuro) */}
          {d.open && !futureDay && (
            <div className="mb-4">
              <SmartExit
                date={d.date}
                day={d}
                settings={settings}
                comps={allComps ?? []}
                nowMinutes={nowMinutes}
                onSmartExit={smartExit}
                onConfirmComps={confirmComps}
                isToday={isToday}
                effectiveExpected={effectiveExpected}
                faltaRegistrada={!!falta && falta.status === "efetiva"}
                contextLabel={calendarLabel ?? (absence ? absenceLabel(absence) : null)}
                punchBlocked={
                  absence?.kind === "ferias" ||
                  absence?.kind === "saude" ||
                  absence?.kind === "abono"
                }
              />
            </div>
          )}

          {/* Ausência cobrindo o dia: ícone + tipo + detalhamento do acordo */}
          {absence && (
            <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs font-medium text-sky-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex shrink-0 text-sky-600" aria-hidden>
                  {absenceIcon(absence, 16)}
                </span>
                <span className="font-bold">{absenceLabel(absence)}</span>
                {absence.duration === "parcial" ? (
                  <span>· parcial {absence.partialStart}–{absence.partialEnd}</span>
                ) : (
                  <span>· dia integral</span>
                )}
                {absence.kind === "saude" && (
                  <span>· atestado {absence.medicalCert ? "apresentado" : "não apresentado"}</span>
                )}
                {absence.note && <span className="text-sky-600">· {absence.note}</span>}
                {regularExpected < d.expectedMinutes && (
                  <span className="text-sky-600">
                    · jornada regular exigida reduzida para {formatMinutes(regularExpected)}
                  </span>
                )}
              </div>

              {/* Detalhamento do acordo — valores vindos das funções centrais */}
              {absence.kind === "acordado" &&
                absence.treatment === "compensar" &&
                (shortcuts?.acordoMinutes ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-semibold text-violet-800">
                    <span>
                      Acordo original:{" "}
                      <b>{formatMinutes(shortcuts?.acordoMinutes ?? 0)}</b>
                    </span>
                    <span>
                      · Compensado:{" "}
                      <b className="text-emerald-700">
                        {formatMinutes(shortcuts?.acordoCompensated ?? 0)}
                      </b>
                    </span>
                    {(shortcuts?.acordoPlanned ?? 0) > 0 && (
                      <span>
                        · Planejado:{" "}
                        <b className="text-sky-700">{formatMinutes(shortcuts?.acordoPlanned ?? 0)}</b>
                      </span>
                    )}
                    <span>
                      · Restante:{" "}
                      <b className="text-amber-700">
                        {formatMinutes(shortcuts?.acordoRemaining ?? 0)}
                      </b>
                    </span>
                  </div>
                )}
            </div>
          )}

          {/* Falta registrada no dia (ocorrência de ponto — integral) */}
          {falta && (
            <div
              className={`mb-3 rounded-xl border px-3 py-2.5 text-xs font-medium ${
                falta.status === "prevista"
                  ? "border-sky-200 bg-sky-50 text-sky-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Ban size={16} className="shrink-0" aria-hidden />
                <span className="font-bold">
                  {falta.status === "prevista" ? "Falta prevista" : "Falta registrada"}
                </span>
                <span>
                  · Jornada {falta.status === "prevista" ? "prevista" : "do dia"}:{" "}
                  {formatMinutes(falta.jornadaMinutes)}
                </span>
                {falta.status === "prevista" ? (
                  <span>· Esta falta ainda não afeta o saldo.</span>
                ) : d.entries.length === 0 ? (
                  <span>· Nenhuma batida registrada — déficit gerado pela jornada do dia.</span>
                ) : null}
              </div>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="!text-rose-600 hover:!bg-rose-100"
                  disabled={busyFalta}
                  onClick={() => {
                    if (busyFalta) return;
                    setBusyFalta(true);
                    void Promise.resolve(onRemoveFalta?.(falta.id)).finally(() => setBusyFalta(false));
                  }}
                >
                  <Trash2 size={13} /> {falta.status === "prevista" ? "Cancelar falta" : "Excluir falta"}
                </Button>
              </div>
            </div>
          )}

          {/* Métricas */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat
              label={futureDay ? "Registro previsto" : "Trabalhado"}
              value={formatMinutes(d.workedMinutes)}
              tone="text-slate-900"
            />
            <MiniStat
              label="Base regular"
              value={formatMinutes(regularExpected)}
              tone="text-slate-500"
            />
            {showSplit ? (
              <MiniStat
                label="Hora extra regular"
                value={`+${formatMinutes(creditView?.regularExtra ?? 0)}`}
                tone="text-emerald-600"
                sub={
                  creditView && creditView.usedRegular > 0
                    ? `livre ${formatMinutes(creditView.freeRegular)}`
                    : undefined
                }
              />
            ) : (
              <MiniStat label="Saldo regular" value={`${regularBalance >= 0 ? "+" : ""}${formatMinutes(regularBalance)}`} tone={balanceTone} />
            )}
            <MiniStat
              label={futureDay ? "Previsto no ponto" : "No ponto*"}
              value={formatMinutes(d.registrableMinutes)}
              tone="text-indigo-600"
              sub={futureDay ? "ainda não realizado" : d.excessMinutes > 0 ? "limitado a 10h" : undefined}
            />
          </div>

          {showDeficitFollow && (
            <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-amber-700">
                Situação do déficit
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-700">
                <span>Original: <b>{formatMinutes(deficitOriginal)}</b></span>
                <span>Quitado: <b className="text-emerald-700">{formatMinutes(deficitConcluded)}</b></span>
                <span>Planejado: <b className="text-sky-700">{formatMinutes(deficitPlanned)}</b></span>
                <span>Em aberto: <b className="text-amber-800">{formatMinutes(deficitOpen)}</b></span>
                <span>
                  Sem programação:{" "}
                  <b>{formatMinutes(Math.max(0, deficitOpen - deficitPlanned))}</b>
                </span>
              </div>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-amber-700">
                  Como foi quitado
                </p>
                {deficitParcels.filter((c) => c.status === "concluida").length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">Ainda não há quitação realizada.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                    {deficitParcels
                      .filter((c) => c.status === "concluida")
                      .map((c) => (
                        <li key={c.id}>
                          {formatMinutes(c.minutes)}{" "}
                          {c.portion === "especial" ? "de excedente do limite diário" : "de crédito regular"}{" "}
                          em {formatDateBR(c.targetDate)}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Faixa PRIORITÁRIA do excedente especial — restante a realocar em destaque. */}
          {showSplit && (
            <div
              className={`mt-3 flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:flex-wrap sm:items-start ${
                excessTreated
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-rose-300 bg-rose-50 ring-1 ring-rose-200"
              }`}
            >
              <TriangleAlert
                size={18}
                className={`shrink-0 ${excessTreated ? "text-emerald-600" : "text-rose-600"}`}
              />
              <div className={`min-w-0 w-full flex-1 text-xs font-medium sm:w-auto ${excessTreated ? "text-emerald-800" : "text-rose-800"}`}>
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider">
                  {excessTreated ? "Excedente tratado ✓" : <>⚠ Excedente do limite diário <ExcessTenBadge /></>}
                </p>
                <div className="mt-1.5 flex flex-wrap items-end gap-x-4 gap-y-1">
                  <span>
                    Original: <b>{formatMinutes(excessOriginal)}</b>
                  </span>
                  {excessAllocated > 0 && (
                    <span>
                      Realocado: <b>{formatMinutes(excessAllocated)}</b>
                    </span>
                  )}
                  <span className={excessTreated ? "" : "text-sm font-extrabold text-rose-700"}>
                    Restante a realocar:{" "}
                    <b className="tabular-nums">{formatMinutes(excessRemaining)}</b>
                  </span>
                </div>
                {creditView?.reason ? (
                  <p className="mt-1">
                    Motivo: {excessReasonLabel(creditView.reason)}
                    {excessReasonObservation(creditView.reason) && (
                      <span className="italic"> — {excessReasonObservation(creditView.reason)}</span>
                    )}
                  </p>
                ) : !excessTreated ? (
                  <p className="mt-1 font-bold text-amber-700">⚠ Motivo não informado</p>
                ) : null}
                {specialLed && (specialLed.realizedTo.length > 0 || specialLed.plannedTo.length > 0) && (
                  <div className="mt-1.5 space-y-0.5 text-[11px]">
                    {specialLed.realizedTo.map((t, i) => (
                      <p key={`r${i}`}>Realizado: {formatMinutes(t.minutes)} → déficit de {formatDateBR(t.date)}</p>
                    ))}
                    {specialLed.plannedTo.map((t, i) => (
                      <p key={`p${i}`}>Programado: {formatMinutes(t.minutes)} → {formatDateBR(t.date)}</p>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap">
              {!creditView?.reason && onRegisterReason && (
                <Button size="sm" variant="secondary" className="w-full sm:w-auto" onClick={() => onRegisterReason(d.date)}>
                  Registrar motivo
                </Button>
              )}
              {creditView?.reason && onRegisterReason && (
                <Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={() => onRegisterReason(d.date)}>
                  Alterar motivo
                </Button>
              )}
              {creditView?.reason && !excessTreated && onAllocateExcess && (
                <Button size="sm" variant="danger" className="w-full sm:w-auto" onClick={() => onAllocateExcess(d.date)}>
                  <ArrowLeftRight size={13} /> Realocar excedente
                </Button>
              )}
              <Link href="/compensacoes#excedentes-prioridade" className="w-full sm:w-auto">
                <Button variant={excessTreated ? "secondary" : "danger"} size="sm" className="w-full sm:w-auto">
                  <ArrowLeftRight size={13} /> Gerenciar excedente
                </Button>
              </Link>
              </div>
            </div>
          )}

          {/* Aviso: compensação vinculada ficou acima da dívida atual */}
          {(excessOverflow > 0 || deficitOverflow > 0) && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <TriangleAlert size={16} className="shrink-0 text-amber-600" />
                <p className="flex-1 text-xs font-medium text-amber-800">
                  {excessOverflow > 0 && (
                    <>
                      Há <b>{formatMinutes(excessOverflow)}</b> de compensação vinculada acima do novo
                      excedente deste dia ({formatMinutes(d.excessMinutes)}).
                    </>
                  )}
                  {deficitOverflow > 0 && (
                    <>
                      Há <b>{formatMinutes(deficitOverflow)}</b> de compensação vinculada acima do novo
                      déficit deste dia ({formatMinutes(deficitHere)}).
                    </>
                  )}{" "}
                  O histórico foi preservado — ajuste para manter consistência.
                </p>
                {excessOverflow > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => adjustOverflow("excedente")}>
                    Revisar compensação
                  </Button>
                )}
                {deficitOverflow > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => adjustOverflow("deficit")}>
                    Revisar compensação
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Atalho: Acordo a compensar (afastamento acordado — compensar posteriormente) */}
          {shortcuts?.canCompensate && Math.max(0, shortcuts.acordoRemaining - shortcuts.acordoPlanned) > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
              {/* Detalhamento completo fica no banner acima — aqui só o convite à ação */}
              <p className="flex-1 text-xs font-medium text-violet-800">
                Há <b>{formatMinutes(Math.max(0, shortcuts.acordoRemaining - shortcuts.acordoPlanned))}</b> do acordo ainda sem programação.
              </p>
              <Button
                size="sm"
                variant="subtle"
                onClick={() =>
                  openComp(
                    "acordo",
                    Math.max(0, shortcuts.acordoRemaining - shortcuts.acordoPlanned),
                    `Acordo de ${formatDateShortBR(d.date)}`,
                  )
                }
              >
                <ArrowLeftRight size={13} /> Programar hora extra
              </Button>
            </div>
          )}

          {/* Atalho: déficit comum pendente → quitar com hora extra.
              Coexiste com o atalho do acordo: quando o dia tem acorda parcial a
              compensar SEM batidas, o restante da jornada é déficit comum
              (acordo 4h + déficit 4h — nunca uma dívida única de 8h). */}
          {!futureDay && shortcuts?.canCompensate && deficitOpen > 0 && (
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center">
              <p className="min-w-0 flex-1 text-xs font-medium text-amber-800">
                Déficit em aberto: <b>{formatMinutes(deficitOpen)}</b>
                {deficitPlanned > 0 && <> · planejado {formatMinutes(deficitPlanned)}</>}
                {" "}· sem programação <b>{formatMinutes(Math.max(0, deficitOpen - deficitPlanned))}</b>
              </p>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {hasAvailableSpecialExcess && onUseAvailableExcess && (
                <Button size="sm" variant="danger" className="w-full sm:w-auto" onClick={() => onUseAvailableExcess(d.date)}>
                  <ArrowLeftRight size={13} /> Usar excedente disponível
                </Button>
              )}
              {Math.max(0, deficitOpen - deficitPlanned) > 0 && (
                <Button
                  size="sm"
                  variant="subtle"
                  className="w-full sm:w-auto"
                  onClick={() =>
                    openComp("deficit", Math.max(0, deficitOpen - deficitPlanned), `Déficit de ${formatDateShortBR(d.date)}`)
                  }
                >
                  <Zap size={13} /> Programar hora extra
                </Button>
              )}
              </div>
            </div>
          )}

          {/* Compensação programada para este dia */}
          {pendingComp && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5">
              <CheckCircle2 size={16} className="text-indigo-500 shrink-0" />
              <p className="flex-1 text-xs font-medium text-indigo-700">
                Compensação programada para hoje: <b>−{formatMinutes(pendingComp.minutes)}</b>{" "}
                (de {formatDateShortBR(pendingComp.sourceDate)})
                {pendingComp.note ? ` · ${pendingComp.note}` : ""}
              </p>
              <Button variant="secondary" size="sm" onClick={() => finishComp(pendingComp.id)}>
                <CheckCircle2 size={13} /> Concluir compensação
              </Button>
            </div>
          )}

          {/* Segmentos */}
          {d.segments.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {d.segments.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {s.start} → {s.end}
                  <span className="text-slate-400">· {formatMinutes(s.minutes)}</span>
                </span>
              ))}
            </div>
          )}

          {/* Registros — chips em fluxo horizontal (desktop) / 2 colunas (mobile) */}
          <div className="mt-4 grid grid-cols-1 gap-1.5 overflow-x-hidden min-[360px]:grid-cols-2 sm:flex sm:flex-wrap">
            {d.entries.map((e) =>
              editingId === e.id ? (
                <div key={e.id} className="col-span-full flex w-full min-w-0 flex-wrap items-end gap-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                  <Select
                    label="Tipo"
                    className="w-32"
                    value={editForm.type}
                    onChange={(ev) => setEditForm({ ...editForm, type: ev.target.value as EntryType })}
                  >
                    <option value="entrada">Entrada</option>
                    <option value="saida">Saída</option>
                  </Select>
                  <Input label="Horário" type="time" className="w-32" value={editForm.time} onChange={(ev) => setEditForm({ ...editForm, time: ev.target.value })} />
                  <Input label="Observação" className="min-w-[160px] flex-1" value={editForm.note} onChange={(ev) => setEditForm({ ...editForm, note: ev.target.value })} />
                  <Button size="sm" loading={busy} onClick={() => saveEdit(e.id)}>Salvar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
                </div>
              ) : (
                <div
                  key={e.id}
                  className="group flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 rounded-lg border border-slate-100 bg-slate-50/70 px-1.5 py-1.5 sm:w-auto sm:min-w-[11.5rem] sm:gap-1.5 sm:px-2"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${e.type === "entrada" ? "bg-emerald-500" : "bg-indigo-500"}`} />
                  <span className="shrink-0 text-sm font-extrabold tabular-nums text-slate-900">{e.time}</span>
                  <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-600">{e.type === "entrada" ? "Entrada" : "Saída"}</span>
                  <div className="ml-auto flex shrink-0 items-center opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                    <button onClick={() => startEdit(e)} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 cursor-pointer sm:p-1.5" aria-label="Editar">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => remove(e.id)} className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 cursor-pointer sm:p-1.5" aria-label="Excluir">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>

          {/* Registro manual — NUNCA em data futura nem em dia de Abono (card vira somente leitura) */}
          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {!futureDay && !abonoDay && (showAdd ? (
              <div className="flex w-full min-w-0 flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3">
                <Select
                  label="Tipo"
                  className="w-32"
                  value={form.type}
                  onChange={(ev) => setForm({ ...form, type: ev.target.value as EntryType })}
                >
                  <option value="entrada">Entrada</option>
                  <option value="saida">Saída</option>
                </Select>
                <Input label="Horário" type="time" className="w-32" value={form.time} onChange={(ev) => setForm({ ...form, time: ev.target.value })} />
                <Input label="Observação (opcional)" className="min-w-[160px] flex-1" value={form.note} onChange={(ev) => setForm({ ...form, note: ev.target.value })} />
                <Button size="sm" loading={busy} onClick={() => add()}>
                  <Plus size={13} /> Adicionar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancelar</Button>
              </div>
            ) : (
              <button
                onClick={() => { setShowAdd(true); setForm((f) => ({ ...f, time: nowTimeString() })); }}
                className="inline-flex w-auto items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-500 transition-colors hover:border-emerald-400 hover:text-emerald-600 cursor-pointer"
              >
                <Plus size={14} />
                <span className="sm:hidden">Registro manual</span>
                <span className="hidden sm:inline">Adicionar registro manual</span>
              </button>
            ))}
          </div>

          {/* Rodapé explicativo do "No ponto" — em dia de Abono o card é
              SOMENTE INFORMATIVO e não exibe textos explicativos. */}
          {!abonoDay && (
            <p className="mt-3 text-[11px] text-slate-400">
              * "No ponto" é o total que pode ser lançado no sistema da empresa (limitado a{" "}
              {formatMinutes(settings.maxDailyMinutes)}/dia). Horas acima de 10h precisam ser realocadas
              antes do lançamento no sistema oficial.
            </p>
          )}
        </div>
      )}

      <CompensationForm
        open={compOpen}
        onClose={() => setCompOpen(false)}
        kind={compKind}
        initial={compInitial}
        getCapacity={getCapacity}
        pendingDebtMinutes={compPlanning?.unplannedMinutes ?? compInitial?.minutes}
        planning={compPlanning}
        onSave={async (payload) => {
          await onCreateComp({ ...payload, kind: compKind });
        }}
      />
    </section>
  );
}

function MiniStat({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-base font-extrabold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] font-medium text-slate-400">{sub}</p>}
    </div>
  );
}
