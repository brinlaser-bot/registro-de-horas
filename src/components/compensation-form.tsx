"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, CalendarClock, Sparkles } from "lucide-react";
import { Button, Input, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatDateBR, formatMinutes, todayString, weekdayShort } from "@/lib/time";
import type { CompKind, TargetSuggestion } from "@/lib/types";
import { maxOperationMinutes, usesHourExtra, type ExtraCapacity } from "@/lib/debt";
import { getAnnualPointCycle, sameAnnualCycle } from "@/lib/periods";

export interface CompFormData {
  sourceDate: string;
  targetDate: string;
  minutes: number;
  note: string;
  status?: string;
  kind?: CompKind;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: CompFormData;
  editingId?: number | null;
  /** excedente = sair mais cedo no destino | deficit = fazer hora extra no destino */
  kind?: CompKind;
  /** Dias sugeridos para receber a compensação (sugestão inteligente) */
  suggestions?: TargetSuggestion[];
  smartHint?: ReactNode;
  /**
   * FUNÇÃO CENTRAL de capacidade (extraCapacityForDate) fornecida pelo chamador,
   * já vinculada a entries/comps/settings (e excludeCompId ao editar).
   * Usada para limitar compensações por hora extra ao teto do dia de destino.
   */
  getCapacity?: (targetDate: string) => ExtraCapacity;
  /** Minutos ainda SEM PROGRAMAÇÃO da dívida de origem (teto da nova parcela). */
  pendingDebtMinutes?: number;
  /** Detalhamento da dívida (acordo/déficit) para o modal. */
  planning?: {
    originalMinutes: number;
    compensatedMinutes: number;
    plannedMinutes: number;
    openMinutes: number;
    unplannedMinutes: number;
  };
  onSave: (data: CompFormData) => Promise<void>;
}

const COPY = {
  excedente: {
    sourceLabel: "Dia de origem (excedente)",
    targetLabel: "Dia de compensação (sair mais cedo)",
    minutesHint: "Quanto você vai sair mais cedo no dia de destino",
    explain:
      "No dia de origem você trabalhou além do limite e não pôde registrar tudo. No dia de destino, você compensa saindo mais cedo (ou entrando mais tarde).",
    cta: "Criar compensação",
  },
  deficit: {
    sourceLabel: "Dia devedor (abaixo da base)",
    targetLabel: "Dia em que vai fazer hora extra",
    minutesHint: "Quanto de hora extra você fará para quitar (respeitando o teto de 10h)",
    explain:
      "O dia de origem ficou abaixo da base e gerou saldo negativo. Você quita essa dívida trabalhando além da jornada em outro dia, sem ultrapassar o limite diário.",
    cta: "Criar compensação por hora extra",
  },
  acordo: {
    sourceLabel: "Dia do acordo (folga/abono acordado)",
    targetLabel: "Dia em que vai fazer hora extra",
    minutesHint: "Quanto de hora extra você fará para quitar o acordo (respeitando o teto de 10h)",
    explain:
      "As horas do afastamento acordado devem ser compensadas com hora extra em outro dia do MESMO ciclo anual, sem ultrapassar o limite diário de 10h.",
    cta: "Criar compensação do acordo",
  },
  calendario: {
    sourceLabel: "Dia da obrigação do calendário",
    targetLabel: "Dia em que vai fazer hora extra",
    minutesHint: "Quanto de hora extra você fará para quitar a obrigação de calendário",
    explain:
      "Obrigações do calendário da empresa devem ser compensadas com hora extra no mesmo ciclo anual, respeitando o teto diário de 10h.",
    cta: "Criar compensação do calendário",
  },
} as const;

export function CompensationForm({
  open,
  onClose,
  initial,
  editingId,
  kind = "excedente",
  suggestions = [],
  smartHint,
  getCapacity,
  pendingDebtMinutes,
  planning,
  onSave,
}: Props) {
  const toast = useToast();
  const [form, setForm] = useState<CompFormData>({
    sourceDate: todayString(),
    targetDate: todayString(),
    minutes: 60,
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const copy = COPY[kind];

  const prefillOf = (targetDate: string, fallback?: number) => {
    const unplanned = planning?.unplannedMinutes;
    const capAvail = getCapacity?.(targetDate)?.available;
    if (!editingId && unplanned != null) {
      return capAvail != null ? maxOperationMinutes(unplanned, capAvail) : Math.max(0, unplanned);
    }
    let minutes = fallback ?? 60;
    if (unplanned != null) minutes = Math.min(minutes, Math.max(0, unplanned));
    if (capAvail != null) minutes = Math.min(minutes, capAvail);
    return minutes;
  };

  useEffect(() => {
    if (!open) return;
    const targetDate = initial?.targetDate ?? todayString();
    setForm({
      sourceDate: initial?.sourceDate ?? todayString(),
      targetDate,
      minutes: prefillOf(targetDate, initial?.minutes),
      note: initial?.note ?? "",
      status: initial?.status,
      kind: initial?.kind ?? kind,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill ao abrir/trocar contexto
  }, [open, initial, kind, planning]);

  // ── Validação visual (não substitui a validação central do store) ──
  const usesCapacity = usesHourExtra(kind);
  const cap = usesCapacity && getCapacity ? getCapacity(form.targetDate) : null;
  const crossCycle =
    !!form.sourceDate && !!form.targetDate && !sameAnnualCycle(form.sourceDate, form.targetDate);
  const missingFields =
    !form.sourceDate || !form.targetDate || form.sourceDate === form.targetDate;
  const invalidMinutes = !Number.isFinite(form.minutes) || form.minutes < 5 || form.minutes > 720;
  const overCapacity = cap !== null && form.minutes > cap.available;
  const unplannedCap = planning?.unplannedMinutes ?? pendingDebtMinutes;
  const overUnplanned = unplannedCap !== undefined && form.minutes > unplannedCap;

  const invalidReason = crossCycle
    ? "Esta compensação não pode ser realizada porque a origem e o destino pertencem a ciclos anuais diferentes. As compensações devem ocorrer dentro do mesmo ciclo anual."
    : missingFields
      ? "Informe origem e destino (dias diferentes)."
      : invalidMinutes
        ? "As horas devem ficar entre 5min e 12h."
        : overCapacity && cap && cap.available <= 0
          ? "Este dia já foi encerrado e não possui hora extra disponível para compensação. Escolha outro dia."
          : overCapacity && cap
            ? `Neste dia você pode compensar no máximo ${formatMinutes(cap.available)}.`
            : overUnplanned && unplannedCap !== undefined
              ? `Só é possível programar ${formatMinutes(unplannedCap)} (ainda sem programação).`
              : null;

  const submit = async () => {
    if (inflight.current || busy) return;
    if (invalidReason) {
      toast.show(invalidReason, "error");
      return;
    }
    // Regra central: hora extra limitada à capacidade real do dia de destino
    if (usesCapacity && getCapacity) {
      const cap = getCapacity(form.targetDate);
      if (form.minutes > cap.available) {
        toast.show(
          `Neste dia você pode compensar no máximo ${formatMinutes(cap.available)}, pois o limite diário é de ${formatMinutes(cap.limitMinutes)}. Divida o restante em outro dia.`,
          "error",
        );
        return;
      }
    }
    inflight.current = true;
    setBusy(true);
    try {
      await onSave({ ...form, minutes: Math.round(form.minutes), kind });
      toast.show(editingId ? "Compensação atualizada." : "Compensação criada!");
      onClose();
    } catch (err) {
      toast.show(
        err instanceof Error && err.message ? err.message : "Não foi possível salvar.",
        "error",
      );
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editingId ? "Editar compensação" : "Nova compensação de horas"}
      subtitle={
        kind === "excedente"
          ? "Regra da empresa: excedente acima do limite diário deve ser compensado em outro dia."
          : kind === "acordo"
            ? "Compensação de horas de afastamento acordado, respeitando o teto diário."
            : kind === "calendario"
              ? "Quitação de obrigação do calendário da empresa com hora extra, respeitando o teto diário."
              : "Quitação de saldo negativo com hora extra, respeitando o teto diário."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={busy} disabled={!!invalidReason || busy}>
            {busy ? (editingId ? "Salvando…" : "Criando…") : <><ArrowLeftRight size={15} /> {editingId ? "Salvar alterações" : copy.cta}</>}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
          <b>Como funciona:</b> {copy.explain}
        </div>

        {planning && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs text-violet-800">
            <p>
              Original: <b>{formatMinutes(planning.originalMinutes)}</b> · Compensado:{" "}
              <b className="text-emerald-700">{formatMinutes(planning.compensatedMinutes)}</b> · Planejado:{" "}
              <b className="text-sky-700">{formatMinutes(planning.plannedMinutes)}</b> · Em aberto:{" "}
              <b>{formatMinutes(planning.openMinutes)}</b> · Sem programação:{" "}
              <b>{formatMinutes(planning.unplannedMinutes)}</b>
            </p>
            <p className="mt-1">
              Restam {formatMinutes(planning.openMinutes)}: {formatMinutes(planning.plannedMinutes)} já
              programadas e {formatMinutes(planning.unplannedMinutes)} ainda sem programação.
            </p>
          </div>
        )}

        {/* Barreira do fechamento anual (30/04) */}
        {crossCycle && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700">
            Origem ({getAnnualPointCycle(form.sourceDate)}) e destino (
            {getAnnualPointCycle(form.targetDate)}) pertencem a <b>ciclos anuais diferentes</b>. O
            fechamento anual ocorre em 30/04 e as compensações não podem atravessá-lo.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={copy.sourceLabel}
            type="date"
            value={form.sourceDate}
            // Obrigações de calendário podem ser futuras (planejamento antecipado)
            max={kind === "calendario" ? undefined : todayString()}
            onChange={(e) => setForm({ ...form, sourceDate: e.target.value })}
          />
          <Input
            label={copy.targetLabel}
            type="date"
            value={form.targetDate}
            onChange={(e) => {
              const targetDate = e.target.value;
              setForm({ ...form, targetDate, minutes: prefillOf(targetDate, form.minutes) });
            }}
          />
        </div>

        {/* Sugestão inteligente de dias-destino */}
        {suggestions.length > 0 && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-indigo-700">
              {smartHint ?? (
                <>
                  <Sparkles size={12} /> Sugestão inteligente
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => {
                const active = form.targetDate === s.date;
                return (
                  <button
                    key={s.date}
                    type="button"
                    onClick={() => setForm({ ...form, targetDate: s.date })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                      active
                        ? "border-indigo-500 bg-indigo-600 text-white"
                        : "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-100"
                    }`}
                  >
                    <CalendarClock size={11} />
                    {s.isToday ? "Hoje" : weekdayShort(s.date).replace(".", "")} {formatDateBR(s.date).slice(0, 5)}
                    <span className={active ? "text-indigo-100" : "text-indigo-400"}>
                      {formatMinutes(s.workedMinutes)}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-indigo-600/80">
              Dias recentes com saldo negativo (menos de 8h). Clique para usar como destino.
            </p>
          </div>
        )}

        {/* Capacidade do dia de destino (hora extra) — regra central */}
        {usesCapacity && getCapacity && (() => {
          const cap = getCapacity(form.targetDate);
          const maxOp =
            unplannedCap !== undefined ? maxOperationMinutes(unplannedCap, cap.available) : cap.available;
          const restante =
            pendingDebtMinutes !== undefined
              ? Math.max(0, pendingDebtMinutes - Math.min(form.minutes, maxOp))
              : null;
          return (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
              <div className="grid gap-1 sm:grid-cols-2">
                {unplannedCap !== undefined && (
                  <p>
                    <b>Ainda sem programação:</b> {formatMinutes(unplannedCap)}
                  </p>
                )}
                {pendingDebtMinutes !== undefined && unplannedCap === undefined && (
                  <p>
                    <b>{kind === "acordo" ? "Acordo pendente:" : kind === "calendario" ? "Obrigação de calendário:" : "Déficit pendente:"}</b>{" "}
                    {formatMinutes(pendingDebtMinutes)}
                  </p>
                )}
                <p>
                  <b>Capacidade disponível no dia:</b> {formatMinutes(cap.available)}
                </p>
                <p>
                  <b>Máximo nesta operação:</b>{" "}
                  <span className={maxOp < form.minutes ? "font-bold text-rose-600" : "font-bold text-emerald-600"}>
                    {formatMinutes(maxOp)}
                  </span>
                </p>
                {cap.realExtra !== null && (
                  <p className="sm:col-span-2">
                    <b>Dia encerrado:</b> existem {formatMinutes(cap.realExtra)} de hora extra real
                    nesta data — não é possível alocar mais do que isso.
                  </p>
                )}
                {restante !== null && restante > 0 && (
                  <p className="sm:col-span-2 text-amber-700">
                    Restará <b>{formatMinutes(restante)}</b> depois desta compensação — divida em
                    outro dia.
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Horas a compensar (min)"
            type="number"
            min={5}
            max={Math.max(5, Math.min(cap ? cap.available : 720, unplannedCap ?? 720))}
            step={5}
            value={form.minutes}
            onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })}
            hint={
              form.minutes > 0
                ? `≈ ${formatMinutes(form.minutes)} · ${copy.minutesHint}`
                : copy.minutesHint
            }
          />
          <Input
            label="Observação (opcional)"
            value={form.note}
            maxLength={200}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>

        {editingId && (
          <Select
            label="Status"
            value={form.status ?? "pendente"}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="pendente">Pendente</option>
            <option value="concluida">Concluída</option>
            <option value="cancelada">Cancelada</option>
          </Select>
        )}

        {form.minutes > 0 && form.targetDate && (
          <p className="text-xs text-slate-500">
            {kind === "excedente" ? (
              <>
                Para compensar <b>{formatMinutes(form.minutes)}</b> no dia{" "}
                <b>{formatDateBR(form.targetDate)}</b>, saia <b>1h antes</b> do previsto para cada
                hora compensada.
              </>
            ) : (
              <>
                Trabalhe <b>{formatMinutes(form.minutes)}</b> além da jornada em{" "}
                <b>{formatDateBR(form.targetDate)}</b> para quitar essa pendência — sempre dentro do
                teto diário.
              </>
            )}
          </p>
        )}
      </div>
    </Modal>
  );
}
