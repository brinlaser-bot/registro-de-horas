"use client";

import { useState } from "react";
import {
  ArrowLeftRight,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coffee,
  Handshake,
  HeartPulse,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  Umbrella,
  Zap,
} from "lucide-react";
import type { Compensation, DayResult, WorkSettings } from "@/lib/types";
import type { EntryType, TimeEntryLike } from "@/lib/time";
import { formatDateShortBR, formatMinutes, isFutureDate, nextWorkday, nowTimeString, todayString, weekdayLong } from "@/lib/time";
import { Badge, Button, Input, Select } from "@/components/ui";
import { CompensationForm, type CompFormData } from "@/components/compensation-form";
import { SmartExit } from "@/components/smart-exit";
import { allocatedForSource, overflowForSource, type ExtraCapacity } from "@/lib/debt";
import { absenceLabel, type Absence, type DayBalanceView } from "@/lib/absences";
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
  return <CalendarDays size={size} className={cls} aria-hidden />;
}

/** Badge do card recolhido: ícone perceptível + texto completo. */
function absenceBadge(absence: Absence) {
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
  const [compOpen, setCompOpen] = useState(false);

  const d = result;
  const pendingComp = compsForDate.find((c) => c.status === "pendente");
  // REGRA ABSOLUTA: batidas só em data <= hoje. Em card FUTURO nenhum controle
  // de ponto é oferecido (formulário, atalhos, Smart Exit) — o card fica
  // somente leitura (Falta prevista, métricas e Cancelar falta permanecem).
  const futureDay = isFutureDate(d.date);

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
        <div className="text-right">
          <p className="text-lg font-extrabold tabular-nums text-slate-900">{formatMinutes(d.workedMinutes)}</p>
          <p className={`text-xs font-bold tabular-nums ${balanceTone}`}>
            {regularBalance >= 0 ? "+" : ""}
            {formatMinutes(regularBalance)}
          </p>
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
                  onClick={() => {
                    const isPrevista = falta.status === "prevista";
                    if (
                      !window.confirm(
                        isPrevista
                          ? `Cancelar a falta prevista de ${formatDateShortBR(d.date)}?`
                          : `Excluir a falta de ${formatDateShortBR(d.date)}?\nO déficit gerado por ela será removido.`,
                      )
                    ) {
                      return;
                    }
                    void onRemoveFalta?.(falta.id);
                  }}
                >
                  <Trash2 size={13} /> {falta.status === "prevista" ? "Cancelar falta" : "Excluir falta"}
                </Button>
              </div>
            </div>
          )}

          {/* Métricas */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Trabalhado" value={formatMinutes(d.workedMinutes)} tone="text-slate-900" />
            <MiniStat
              label="Base regular"
              value={formatMinutes(regularExpected)}
              tone="text-slate-500"
            />
            <MiniStat label="Saldo regular" value={`${regularBalance >= 0 ? "+" : ""}${formatMinutes(regularBalance)}`} tone={balanceTone} />
            <MiniStat
              label="No ponto*"
              value={formatMinutes(d.registrableMinutes)}
              tone="text-indigo-600"
              sub={d.excessMinutes > 0 ? "limitado a 10h" : undefined}
            />
          </div>

          {/* Aviso de excedente */}
          {d.excessMinutes > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
              <TriangleAlert size={16} className="text-rose-500 shrink-0" />
              <p className="flex-1 text-xs font-medium text-rose-700">
                Você trabalhou <b>{formatMinutes(d.workedMinutes)}</b>, acima do limite de{" "}
                <b>{formatMinutes(settings.maxDailyMinutes)}</b>. Registre apenas{" "}
                <b>{formatMinutes(d.registrableMinutes)}</b> no ponto
                {remainingExcess > 0 ? (
                  <>
                    {" "}e compense <b>{formatMinutes(remainingExcess)}</b> em outro dia.
                  </>
                ) : (
                  ". Excedente totalmente alocado. ✔"
                )}
                {allocatedHere > 0 && (
                  <span className="block text-rose-500">
                    (excedente original {formatMinutes(d.excessMinutes)} · {formatMinutes(allocatedHere)} já
                    alocado{remainingExcess > 0 ? ` · restam ${formatMinutes(remainingExcess)}` : ""})
                  </span>
                )}
              </p>
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  openComp("excedente", d.excessMinutes, `Compensação do dia ${formatDateShortBR(d.date)}`)
                }
              >
                <ArrowLeftRight size={13} /> Compensar horas
              </Button>
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
          {shortcuts?.canCompensate && shortcuts.acordoRemaining > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
              {/* Detalhamento completo fica no banner acima — aqui só o convite à ação */}
              <p className="flex-1 text-xs font-medium text-violet-800">
                Há <b>{formatMinutes(shortcuts.acordoRemaining)}</b> do acordo ainda a compensar com
                hora extra.
              </p>
              <Button
                size="sm"
                variant="subtle"
                onClick={() =>
                  openComp("acordo", shortcuts.acordoRemaining, `Acordo de ${formatDateShortBR(d.date)}`)
                }
              >
                <ArrowLeftRight size={13} /> Compensar acordo
              </Button>
            </div>
          )}

          {/* Atalho: déficit comum pendente → quitar com hora extra */}
          {shortcuts?.canCompensate && shortcuts.acordoMinutes === 0 && shortcuts.deficitRemaining > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="flex-1 text-xs font-medium text-amber-800">
                Déficit pendente: <b>{formatMinutes(shortcuts.deficitRemaining)}</b> ainda pendentes
              </p>
              <Button
                size="sm"
                variant="subtle"
                onClick={() =>
                  openComp("deficit", shortcuts.deficitRemaining, `Déficit de ${formatDateShortBR(d.date)}`)
                }
              >
                <Zap size={13} /> Quitar com hora extra
              </Button>
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

          {/* Registros */}
          <div className="mt-4 space-y-2">
            {d.entries.map((e) =>
              editingId === e.id ? (
                <div key={e.id} className="flex flex-wrap items-end gap-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
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
                <div key={e.id} className="group flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${e.type === "entrada" ? "bg-emerald-500" : "bg-indigo-500"}`} />
                  <span className="w-14 text-sm font-extrabold tabular-nums text-slate-900">{e.time}</span>
                  <Badge tone={e.type === "entrada" ? "emerald" : "indigo"}>{e.type === "entrada" ? "Entrada" : "Saída"}</Badge>
                  {e.note && <span className="hidden truncate text-xs text-slate-400 sm:block">· {e.note}</span>}
                  {e.source === "manual" && <Badge tone="amber">Lançamento manual</Badge>}
                  {e.edited && <Badge tone="slate">Editado manualmente</Badge>}
                  <div className="ml-auto flex items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                    <button onClick={() => startEdit(e)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700 cursor-pointer" aria-label="Editar">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => remove(e.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 cursor-pointer" aria-label="Excluir">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ),
            )}

            {/* Formulário adicionar — NUNCA em data futura (card vira somente leitura) */}
            {!futureDay && (showAdd ? (
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3">
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
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-xs font-bold text-slate-500 transition-colors hover:border-emerald-400 hover:text-emerald-600 cursor-pointer"
              >
                <Plus size={14} /> Adicionar registro manual
              </button>
            ))}
          </div>

          {/* Atalhos — NUNCA em data futura */}
          {!futureDay && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Atalhos:</span>
              <Button variant="ghost" size="sm" onClick={() => add("entrada", nowTimeString())}>
                <LogIn size={13} /> Entrada agora
              </Button>
              <Button variant="ghost" size="sm" onClick={() => add("saida", nowTimeString())}>
                <LogOut size={13} /> Saída agora
              </Button>
              <Button variant="ghost" size="sm" onClick={() => add("saida", settings.lunchStart)}>
                <Coffee size={13} /> Almoço {settings.lunchStart}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => add("entrada", settings.lunchEnd)}>
                <Zap size={13} /> Volta {settings.lunchEnd}
              </Button>
            </div>
          )}

          <p className="mt-3 text-[11px] text-slate-400">
            * "No ponto" é o total que pode ser lançado no sistema da empresa (limitado a{" "}
            {formatMinutes(settings.maxDailyMinutes)}/dia). O excedente deve ser compensado em outro dia.
          </p>
        </div>
      )}

      <CompensationForm
        open={compOpen}
        onClose={() => setCompOpen(false)}
        kind={compKind}
        initial={compInitial}
        getCapacity={getCapacity}
        pendingDebtMinutes={compInitial?.minutes}
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
