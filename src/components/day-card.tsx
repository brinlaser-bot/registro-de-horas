"use client";

import { useState } from "react";
import {
  Ban,
  Cake,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Handshake,
  HeartPulse,
  Pencil,
  Plus,
  Timer,
  Trash2,
  Umbrella,
  Wrench,
} from "lucide-react";
import type { Compensation, DayResult, WorkSettings } from "@/lib/types";
import type { EntryType, TimeEntryLike } from "@/lib/time";
import { formatDateBR, formatDateShortBR, formatMinutes, isFutureDate, toMinutes, todayString, weekdayLong } from "@/lib/time";
import { predictedBreakWindow } from "@/lib/breaks";
import { Badge, Button, ConfirmDialog, Input, Select } from "@/components/ui";
import { CorrectPunchesModal } from "@/components/correct-punches-modal";
import { SmartExit } from "@/components/smart-exit";
import { SpecialExcessUseSummary } from "@/components/special-excess-use-summary";
import { SpecialExcessPlanSummary } from "@/components/special-excess-plan-summary";
import type { SpecialExcessDayView } from "@/lib/special-excess-day-view";
import type { SpecialExcessPlan } from "@/lib/special-excess-plan";
import { specialExcessPlanMinutes } from "@/lib/special-excess-plan";
import { actions } from "@/lib/store";
import { useSpecialPunchActions } from "@/components/special-release-confirm";
import { analyzePunches } from "@/lib/punches";
import { absenceLabel, type Absence, type DayBalanceView } from "@/lib/absences";
import { isIncompletePastPunch } from "@/lib/compensar";

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
  allComps?: Compensation[]; // todas (assistente de saída antecipada — 2º plano)
  nowMinutes?: number;
  isToday?: boolean;
  onAddEntry: (p: { date: string; time: string; type: EntryType; note: string | null; source?: "live" | "manual" }) => Promise<void>;
  onUpdateEntry: (id: number, patch: { time?: string; type?: EntryType; note?: string | null }) => Promise<void>;
  onDeleteEntry: (id: number) => Promise<void>;
  onCompleteComp: (id: number) => Promise<void>;
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
  /** Dia abonado/afastamento sem obrigação — só alerta visual se houver batidas. */
  abonadoHint?: { label: string } | null;
  /** Trabalho dentro da janela ABONADO_PARCIAL (alerta visual; sem crédito automático). */
  workedInAbonoMinutes?: number;
  /** Detalhe visual do ABONO PARCIAL (sem nova regra financeira). */
  abonoParcial?: { abonoStart: string; abonoEnd: string; expectedRegular: number } | null;
  /** Dia passado com jornada efetiva e zero batidas/justificativa — pendência operacional. */
  missingExpected?: boolean;
  /** Dia vazio anterior ao início do controle: lançamento histórico, sem pendência. */
  historicalEmpty?: boolean;
  /** Dia vazio sem alerta (folga, futuro, hoje não iniciado): card compacto. */
  compact?: boolean;
  /** Abre o fluxo existente de registrar falta (card Sem registro). */
  onRegisterFalta?: () => void;
  /** Abre o modal atômico Preencher registros do dia (Sem registro ou histórico). */
  onFillDayRecords?: () => void;
  /** NOVO [10+] (Etapa 3E): visão do dia derivada 3A/3C (null = sem bloco). */
  specialExcess?: SpecialExcessDayView | null;
  /** Abre o modal "Completar jornada com [10+]". */
  onCompleteJornada?: (date: string) => void;
  /** 4B: planos/reservas ATIVAS deste dia (activeSpecialPlansForDate). */
  specialPlans?: SpecialExcessPlan[];
  /** 4B: abre o modal "Planejar uso de [10+]" — só passado para dia FUTURO
   *  (a regra destinationDate > hoje continua soberana no store 4A). */
  onPlanSpecial?: () => void;
}

export function DayCard({
  result,
  settings,
  allComps,
  nowMinutes = 0,
  isToday,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  onCompleteComp,
  absence,
  falta,
  onRemoveFalta,
  effectiveExpected,
  balanceView,
  calendarLabel,
  abonadoHint,
  workedInAbonoMinutes,
  abonoParcial,
  missingExpected,
  historicalEmpty,
  compact,
  onRegisterFalta,
  onFillDayRecords,
  specialExcess,
  onCompleteJornada,
  specialPlans,
  onPlanSpecial,
}: Props) {
  const specialActions = useSpecialPunchActions();
  // Regra: todos os dias iniciam RECOLHIDOS — o usuário expande apenas o dia desejado.
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ type: EntryType; time: string; note: string }>({
    type: "entrada",
    time: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [busyFalta, setBusyFalta] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TimeEntryLike | null>(null);
  // O modal de batidas abre com intenção explícita do caller: "correct"
  // (banners de dia incompleto/inconsistente) ou "add" (botão "Adicionar
  // batida" de dia estruturalmente válido). Mesmo modal, mesma lógica.
  const [punchModal, setPunchModal] = useState<"correct" | "add" | null>(null);
  const [showInterval, setShowInterval] = useState(false);
  const [intOut, setIntOut] = useState("");
  const [intIn, setIntIn] = useState("");

  const d = result;
  // REGRA ABSOLUTA: batidas só em data <= hoje. Em card FUTURO nenhum controle
  // de ponto é oferecido (formulário, Smart Exit) — o card fica somente leitura
  // (Falta prevista, métricas e Cancelar falta permanecem).
  const futureDay = isFutureDate(d.date);
  // ABONO DE ANIVERSÁRIO: dia coberto pelo benefício é SOMENTE INFORMATIVO —
  // nenhum controle de batida (formulário de registro manual) é oferecido no card.
  // (Regra específica de kind === "abono" — NÃO generalizar para outros eventos.)
  const abonoDay = absence?.kind === "abono";
  const incompletePast = isIncompletePastPunch(d.date, d.open, todayString());
  const punchPending = d.financialPending;
  const inconsistent = !d.consistent && d.entries.length > 0;
  // Dia estruturalmente inválido → conteúdo expandido em modo de correção
  // (só banner + CTA de correção). Sem estado persistido: o status estrutural
  // controla a troca automaticamente.
  const invalidStructure = incompletePast || inconsistent;
  const noFacts = d.empty && !falta && !absence;

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

  const remove = (e: TimeEntryLike) => setPendingDelete(e);

  // Registro de saída em 1 clique + conclusão das compensações de saída antecipada
  const smartExit = async (time: string, compIds: number[]) => {
    await onAddEntry({ date: d.date, time, type: "saida", note: "Saída sugerida pelo assistente" });
    for (const id of compIds) await onCompleteComp(id);
  };

  // Confirmação manual de quitação (hora extra) — sem registrar saída
  const confirmComps = async (compIds: number[]) => {
    for (const id of compIds) await onCompleteComp(id);
  };

  // Visão central de apresentação do saldo regular do dia.
  const regularExpected = balanceView?.effectiveExpected ?? effectiveExpected ?? d.expectedMinutes;
  const regularBalance = balanceView?.adjustedBalance ?? d.balanceMinutes;

  const balanceTone = regularBalance > 0 ? "text-emerald-600" : regularBalance < 0 ? "text-rose-600" : "text-slate-500";
  /* Dia encerrado acima do limite diário: o excedente é um valor já realizado e
   * entra no banco paralelo [10+] (etapas 3A/3C). Nunca é pendência obrigatória
   * e não reescreve o que foi trabalhado no dia. */
  const excessOriginal = d.excessMinutes;
  const showSplit = !punchPending && !d.open && !d.empty && excessOriginal > 0;
  const predicted = !punchPending && d.open
    ? predictedBreakWindow(d.realizedEntries?.length ? d.realizedEntries : d.entries, settings, regularExpected)
    : null;
  const breakChip = d.derivedBreak ?? predicted;

  return (
    <section
      className={`overflow-hidden rounded-2xl border ${
        missingExpected
          ? "border-amber-300 bg-amber-50/40 shadow-sm"
          : compact
            ? "border-slate-200/80 bg-white shadow-none"
            : "border-slate-200 bg-white shadow-sm"
      }`}
    >
      {/* Cabeçalho */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`flex w-full items-center gap-3 text-left cursor-pointer hover:bg-slate-50/70 transition-colors ${
          compact || missingExpected ? "px-4 py-2.5" : "px-5 py-4"
        }`}
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
              d.empty ? <Badge tone="slate">Dia futuro</Badge> : <Badge tone="slate">Registro futuro</Badge>
            ) : isToday && d.empty && !falta ? (
              <Badge tone="slate">Jornada não iniciada</Badge>
            ) : missingExpected ? (
              <Badge tone="amber">⚠ Sem registro</Badge>
            ) : incompletePast ? (
              <Badge tone="amber">Registro incompleto</Badge>
            ) : inconsistent ? (
              <Badge tone="amber">Registro inconsistente</Badge>
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
            {/* 3G.3: destaque violeta quando o dia possui [10+] APLICADO (uso
                ativo). Deriva diretamente dos usos ativos (specialExcess,
                motores 3A/3C) a cada render — cancelar o uso remove o destaque
                automaticamente, sem estado visual separado. A situação real do
                dia permanece intocada e dominante ao lado. */}
            {specialExcess && specialExcess.usedActiveMinutes > 0 && (
              <Badge tone="violet" className="shrink-0 gap-1.5 py-1">
                <Timer size={13} className="shrink-0" aria-hidden />
                <span>
                  [10+] aplicado · {formatMinutes(specialExcess.usedActiveMinutes)}
                </span>
              </Badge>
            )}
            {/* 4B: destaque violeta quando o dia possui RESERVA [10+] ativa
                (plano). PLANEJADO NÃO É UTILIZADO — é uma SEGUNDA informação:
                o status real do dia ("Jornada não iniciada" etc.) permanece
                intocado e dominante ao lado. Deriva dos planos ativos a cada
                render (vários planos aparecem agregados no badge). */}
            {specialPlans && specialPlans.length > 0 && (
              <Badge tone="violet" className="shrink-0 gap-1.5 py-1">
                <CalendarClock size={13} className="shrink-0" aria-hidden />
                <span>
                  [10+] reservado ·{" "}
                  {formatMinutes(specialPlans.reduce((s, p) => s + specialExcessPlanMinutes(p), 0))}
                </span>
              </Badge>
            )}
            {d.open && isToday && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" /> em andamento</span>
            )}
            {d.lunchDeductedMinutes > 0 && (
              <span className="text-[11px] font-medium text-slate-400">
                intervalo automático ({formatMinutes(d.lunchDeductedMinutes)})
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {missingExpected ? (
            <p className="text-xs font-extrabold uppercase tracking-wide text-amber-700">Sem registro</p>
          ) : punchPending ? (
            <p className="text-xs font-bold text-amber-700">Pendente</p>
          ) : compact && d.empty ? (
            null
          ) : (
          <>
          <p className="text-lg font-extrabold tabular-nums text-slate-900">{formatMinutes(d.workedMinutes)}</p>
          {showSplit ? (
            <>
              <p className="text-xs font-bold tabular-nums text-emerald-600">+{formatMinutes(regularBalance)}</p>
              <p className="mt-0.5 text-[11px] font-extrabold text-violet-600">
                [10+] +{formatMinutes(excessOriginal)}
              </p>
            </>
          ) : (
            <p className={`text-xs font-bold tabular-nums ${balanceTone}`}>
              {regularBalance >= 0 ? "+" : ""}
              {formatMinutes(regularBalance)}
            </p>
          )}
          </>
          )}
        </div>
        {expanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4">
          {/* Dia estruturalmente inválido (incompleto/inconsistente) → CARD DE
              CORREÇÃO: somente banner + CTA de correção. As batidas seguem nos
              dados (e no modal); o layout normal volta automaticamente quando
              o dia volta a ser válido — sem estado persistido. */}
          {invalidStructure ? (
            <>
              {incompletePast && (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
                  <p className="font-extrabold uppercase tracking-wide">Registro incompleto</p>
                  <p className="mt-0.5">Há uma entrada sem a saída correspondente. Corrija as batidas para finalizar o registro.</p>
                  <Button size="sm" className="mt-2" onClick={() => setPunchModal("correct")}>
                    <Wrench size={13} /> Corrigir registros
                  </Button>
                </div>
              )}
              {inconsistent && (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
                  <p className="font-extrabold uppercase tracking-wide">Registro inconsistente</p>
                  <p className="mt-0.5">A sequência de registros deste dia não está correta. Corrija as batidas para finalizar o registro.</p>
                  <Button size="sm" className="mt-2" onClick={() => setPunchModal("correct")}>
                    <Wrench size={13} /> Corrigir registros
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
          {/* Assistente de saída (somente para o dia em andamento; nunca no futuro) */}
          {d.open && isToday && !punchPending && (
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

          {missingExpected && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
              <p className="font-extrabold uppercase tracking-wide">⚠ Sem registro</p>
              <p className="mt-0.5">Este dia tinha jornada prevista, mas não possui registros ou justificativa.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {onFillDayRecords && (
                  <Button size="sm" onClick={onFillDayRecords}>
                    Preencher registros do dia
                  </Button>
                )}
                {onRegisterFalta && (
                  <Button size="sm" variant="secondary" onClick={onRegisterFalta}>
                    <Ban size={13} /> Registrar falta
                  </Button>
                )}
              </div>
            </div>
          )}
          {historicalEmpty && !missingExpected && (
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-600">
              <p>Dia anterior ao início do controle. Você pode lançar a jornada historicamente.</p>
              {onFillDayRecords && (
                <Button size="sm" className="mt-2" onClick={onFillDayRecords}>
                  Preencher registros do dia
                </Button>
              )}
            </div>
          )}
          {workedInAbonoMinutes != null && workedInAbonoMinutes > 0 && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <p className="font-bold">Trabalho registrado na janela abonada</p>
              <p className="mt-0.5">
                {formatMinutes(workedInAbonoMinutes)} na manhã abonada. Essas horas não quitam a jornada da tarde.
              </p>
            </div>
          )}
          {abonoParcial && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <p className="font-extrabold uppercase tracking-wide">Abono parcial — calendário</p>
              <p className="mt-1">Período abonado: <b>{abonoParcial.abonoStart}–{abonoParcial.abonoEnd}</b> · 4h</p>
              <p>Jornada a cumprir: <b>13:00–17:00</b> · {formatMinutes(abonoParcial.expectedRegular)}</p>
              <p>Base regular: <b>{formatMinutes(abonoParcial.expectedRegular)}</b></p>
            </div>
          )}

          {abonadoHint && d.entries.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <p className="font-bold">Trabalho registrado em dia abonado</p>
              <p className="mt-0.5">
                {formatMinutes(d.workedMinutes)} trabalhados · {abonadoHint.label}
              </p>
              <p className="mt-1 text-[11px]">As batidas foram preservadas. Nenhuma regra financeira extra foi aplicada automaticamente.</p>
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

          {/* Métricas — ocultas enquanto o dia não for finalizável, sem fatos ou sem registro */}
          {!punchPending && !missingExpected && !noFacts && (
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
            <MiniStat
              label="Saldo regular"
              value={`${regularBalance >= 0 ? "+" : ""}${formatMinutes(regularBalance)}`}
              tone={balanceTone}
            />
            {showSplit && (
              <MiniStat
                label="[10+] gerado"
                value={`+${formatMinutes(excessOriginal)}`}
                tone="text-violet-600"
              />
            )}
            <MiniStat
              label={futureDay ? "Previsto no ponto" : "No ponto*"}
              value={formatMinutes(d.registrableMinutes)}
              tone="text-indigo-600"
              sub={futureDay ? "ainda não realizado" : d.excessMinutes > 0 ? "limitado a 10h" : undefined}
            />
          </div>
          )}

          {/* [10+] (3E/3E.2): bloco único de [10+] no card — o uso nunca altera
              trabalhado/saldo/batidas do card; botão, modal e projeção derivam dos
              motores 3A/3C (specialExcess), sem regra paralela. Linguagem do fluxo:
              [10+] gerado / utilizado / disponível (sem dívida nem realocação). */}
          {specialExcess && (
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
              <SpecialExcessUseSummary
                view={specialExcess}
                onOpen={specialExcess.canComplete && onCompleteJornada ? () => onCompleteJornada(d.date) : undefined}
              />
            </div>
          )}

          {/* 4B — [10+] PLANEJADO/RESERVADO (bloco separado do uso): detalhe
              dos planos ativos do dia + cancelamento individual. Quando a
              data chegou (hoje/passado) NADA é concluído/liberado — texto
              neutro e "Cancelar reserva" permanecem. "Concluir" NÃO existe
              nesta etapa (PLANO → USO é etapa posterior). */}
          {specialPlans && specialPlans.length > 0 && (
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
              <SpecialExcessPlanSummary
                plans={specialPlans}
                isFuture={futureDay}
                onPlan={onPlanSpecial}
              />
            </div>
          )}

          {/* 4B — ação discreta de planejamento, SOMENTE para dia FUTURO sem
              reserva (com reserva, o bloco acima oferece "Planejar mais").
              A regra destinationDate > hoje continua soberana no store 4A;
              aqui ela apenas oculta a ação em datas não elegíveis. */}
          {futureDay && onPlanSpecial && !(specialPlans && specialPlans.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
              <Badge tone="violet" className="shrink-0 py-1">
                <CalendarClock size={13} aria-hidden /> [10+]
              </Badge>
              <p className="min-w-0 flex-1 text-xs font-medium text-violet-800/80">
                Reserve saldo [10+] para este dia futuro.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="w-full !border-violet-300 !text-violet-700 hover:!bg-violet-50 sm:w-auto"
                onClick={onPlanSpecial}
              >
                <CalendarClock size={13} /> Planejar uso de [10+]
              </Button>
            </div>
          )}

          {/* Segmentos + intervalo automático/previsto (derivado — NÃO é batida) */}
          {(d.segments.length > 0 || breakChip) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {d.segments.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {s.start} → {s.end}
                  <span className="text-slate-400">· {formatMinutes(s.minutes)}</span>
                </span>
              ))}
              {breakChip && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                  {breakChip.start} → {breakChip.end}
                  <span className="text-amber-600">
                    · {d.derivedBreak ? "intervalo automático" : "intervalo previsto"} {formatMinutes(breakChip.minutes)}
                  </span>
                  {!futureDay && !abonoDay && (
                    <button
                      type="button"
                      className="rounded-md p-0.5 text-amber-700 hover:bg-amber-100 cursor-pointer"
                      aria-label="Editar intervalo automático"
                      onClick={() => {
                        setIntOut(breakChip.start);
                        setIntIn(breakChip.end);
                        setShowInterval(true);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                </span>
              )}
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
                  {(d.plannedEntries ?? []).some((p) => p.id === e.id) && (
                    <Badge tone="sky" className="!px-1.5 !py-0 text-[9px]">Prevista</Badge>
                  )}
                  <div className="ml-auto flex shrink-0 items-center opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                    <button onClick={() => startEdit(e)} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 cursor-pointer sm:p-1.5" aria-label="Editar">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => remove(e)} className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 cursor-pointer sm:p-1.5" aria-label="Excluir">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>

          {/* Registro manual — NUNCA em data futura, Abono, Sem registro,
              histórico vazio ou dia incompleto/inconsistente.
              Dia incompleto/inconsistente: a ÚNICA ação operacional do card é
              o CTA de correção dos alertas (mesmo modal, CorrectPunchesModal) —
              o usuário corrige primeiro; quando o dia volta a ser válido, estas
              ações reaparecem conforme as regras existentes.
              "Adicionar batida" abre o MESMO modal de sequência do dia
              (CorrectPunchesModal) — batida única, com tipo inferido pela
              sequência e observação opcional. Nenhum formulário inline. */}
          {!missingExpected && !historicalEmpty && !incompletePast && !inconsistent && (
          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {!futureDay && !abonoDay && (
              <button
                onClick={() => setPunchModal("add")}
                className="inline-flex w-auto items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-500 transition-colors hover:border-emerald-400 hover:text-emerald-600 cursor-pointer"
              >
                <Plus size={14} /> Adicionar batida
              </button>
            )}
            {!futureDay && !abonoDay && (showInterval ? (
              <div className="flex w-full min-w-0 flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3">
                <Input label="Saída para intervalo" type="time" className="w-36" value={intOut} onChange={(e) => setIntOut(e.target.value)} />
                <Input label="Retorno do intervalo" type="time" className="w-36" value={intIn} onChange={(e) => setIntIn(e.target.value)} />
                <Button size="sm" loading={busy} onClick={() => void (async () => {
                  if (busy || !intOut || !intIn || toMinutes(intIn) <= toMinutes(intOut)) return;
                  setBusy(true);
                  try {
                    const res = await specialActions.addEntries([
                      { date: d.date, time: intOut, type: "saida", note: null, source: "manual" },
                      { date: d.date, time: intIn, type: "entrada", note: null, source: "manual" },
                    ]);
                    // 3G: "Voltar" na confirmação de [10+] é aborto silencioso.
                    if (res.ok) { setShowInterval(false); setIntOut(""); setIntIn(""); }
                  } finally { setBusy(false); }
                })()}>Salvar intervalo</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowInterval(false)}>Cancelar</Button>
              </div>
            ) : (
              <button
                onClick={() => setShowInterval(true)}
                className="inline-flex w-auto items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-500 transition-colors hover:border-emerald-400 hover:text-emerald-600 cursor-pointer"
              >
                <Plus size={14} /> Registrar intervalo
              </button>
            ))}

          </div>
          )}

          {/* Rodapé explicativo do "No ponto" — em dia de Abono o card é
              SOMENTE INFORMATIVO e não exibe textos explicativos. */}
          {!abonoDay && !punchPending && !missingExpected && !noFacts && (
            <p className="mt-3 text-[11px] text-slate-400">
              * "No ponto" é o total que pode ser lançado no sistema da empresa (limitado a{" "}
              {formatMinutes(settings.maxDailyMinutes)}/dia). O excedente acima do limite é
              separado no banco [10+].
            </p>
          )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Excluir batida?"
        danger
        confirmLabel="Excluir"
        message={
          pendingDelete ? (
            <div className="space-y-2">
              <p>{formatDateBR(d.date)} · {pendingDelete.time} · {pendingDelete.type === "entrada" ? "Entrada" : "Saída"}</p>
              {(() => {
                const after = analyzePunches(d.entries.filter((e) => e.id !== pendingDelete.id));
                const wasBad = !d.consistent || d.financialPending;
                const nowOk = after.isConsistent && (after.isComplete || after.sorted.length === 0 || after.sorted[after.sorted.length - 1]?.type === "entrada");
                if (wasBad && after.isConsistent) {
                  return <p className="text-xs text-slate-600">Esta exclusão tende a regularizar a sequência deste dia.</p>;
                }
                if (!after.isConsistent || (after.sorted.length > 0 && !after.isComplete && d.date < todayString())) {
                  return (
                    <p className="text-xs text-amber-700">
                      Esta exclusão deixará a sequência de registros incompleta ou inconsistente. O saldo do dia ficará pendente até a correção.
                    </p>
                  );
                }
                void nowOk;
                return <p className="text-xs text-slate-600">Confirme para excluir esta batida.</p>;
              })()}
            </div>
          ) : null
        }
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const id = pendingDelete?.id;
          setPendingDelete(null);
          if (id != null) void onDeleteEntry(id);
        }}
      />
      {punchModal && (
        <CorrectPunchesModal
          open
          mode={punchModal}
          onClose={() => setPunchModal(null)}
          date={d.date}
          entries={d.entries}
        />
      )}
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
