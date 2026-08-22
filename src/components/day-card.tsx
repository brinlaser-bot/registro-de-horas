"use client";

import { useState } from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coffee,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { Compensation, DayResult, WorkSettings } from "@/lib/types";
import type { EntryType, TimeEntryLike } from "@/lib/time";
import { formatDateShortBR, formatMinutes, nextWorkday, nowTimeString, weekdayLong } from "@/lib/time";
import { Badge, Button, Input, Select } from "@/components/ui";
import { CompensationForm, type CompFormData } from "@/components/compensation-form";
import { SmartExit } from "@/components/smart-exit";
import { allocatedForSource, overflowForSource } from "@/lib/debt";
import { absenceLabel, type Absence } from "@/lib/absences";
import type { CompKind } from "@/lib/types";

export function statusBadge(d: DayResult) {
  if (d.status === "excess") return <Badge tone="rose">Acima do limite</Badge>;
  if (d.status === "deficit") return <Badge tone="amber">Abaixo da base</Badge>;
  if (d.status === "in-progress") return <Badge tone="indigo">Em andamento</Badge>;
  if (d.status === "empty") return <Badge tone="slate">Sem registros</Badge>;
  return <Badge tone="emerald">Dia ok</Badge>;
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
  /** Jornada esperada efetiva do dia (com ausência descontada). */
  effectiveExpected?: number;
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
  effectiveExpected,
}: Props) {
  // Regra: todos os dias iniciam RECOLHIDOS — o usuário expande apenas o dia desejado.
  const [expanded, setExpanded] = useState(false);
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

  // Detecção de overflow: compensação vinculada acima da dívida atual (após correção)
  const deficitHere = Math.max(0, d.expectedMinutes - d.workedMinutes);
  const excessOverflow = allComps ? overflowForSource(allComps, d.date, "excedente", d.excessMinutes) : 0;
  const deficitOverflow = allComps ? overflowForSource(allComps, d.date, "deficit", deficitHere) : 0;

  const adjustOverflow = async (kind: CompKind) => {
    const max = kind === "excedente" ? d.excessMinutes : deficitHere;
    await onCapComp?.(d.date, kind, max);
  };

  const balanceTone = d.balanceMinutes > 0 ? "text-emerald-600" : d.balanceMinutes < 0 ? "text-rose-600" : "text-slate-500";

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
              <Badge tone={absence.kind === "ferias" ? "sky" : "indigo"}>{absenceLabel(absence)}</Badge>
            ) : (
              statusBadge(d)
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
            {d.balanceMinutes >= 0 ? "+" : ""}
            {formatMinutes(d.balanceMinutes)}
          </p>
        </div>
        {expanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4">
          {/* Assistente de saída (somente para o dia em andamento) */}
          {d.open && (
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

          {/* Ausência cobrindo o dia */}
          {absence && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs font-medium text-sky-800">
              <span className="font-bold">{absenceLabel(absence)}</span>
              {absence.duration === "parcial" ? (
                <span>parcial {absence.partialStart}–{absence.partialEnd}</span>
              ) : (
                <span>dia integral</span>
              )}
              {absence.kind === "saude" && (
                <span>· atestado {absence.medicalCert ? "apresentado" : "não apresentado"}</span>
              )}
              {absence.note && <span className="text-sky-600">· {absence.note}</span>}
              {effectiveExpected !== undefined && effectiveExpected < d.expectedMinutes && (
                <span className="text-sky-600">
                  · jornada esperada reduzida para {formatMinutes(effectiveExpected)}
                </span>
              )}
            </div>
          )}

          {/* Métricas */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Trabalhado" value={formatMinutes(d.workedMinutes)} tone="text-slate-900" />
            <MiniStat
              label="Base diária"
              value={formatMinutes(effectiveExpected ?? d.expectedMinutes)}
              tone="text-slate-500"
            />
            <MiniStat label="Saldo" value={`${d.balanceMinutes >= 0 ? "+" : ""}${formatMinutes(d.balanceMinutes)}`} tone={balanceTone} />
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
              <Button variant="danger" size="sm" onClick={() => setCompOpen(true)}>
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

            {/* Formulário adicionar */}
            {showAdd ? (
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
            )}
          </div>

          {/* Atalhos */}
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

          <p className="mt-3 text-[11px] text-slate-400">
            * "No ponto" é o total que pode ser lançado no sistema da empresa (limitado a{" "}
            {formatMinutes(settings.maxDailyMinutes)}/dia). O excedente deve ser compensado em outro dia.
          </p>
        </div>
      )}

      <CompensationForm
        open={compOpen}
        onClose={() => setCompOpen(false)}
        initial={
          d.excessMinutes > 0
            ? { sourceDate: d.date, targetDate: nextWorkday(d.date), minutes: d.excessMinutes, note: `Compensação do dia ${formatDateShortBR(d.date)}` }
            : undefined
        }
        onSave={onCreateComp}
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
