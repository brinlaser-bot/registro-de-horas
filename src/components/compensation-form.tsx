"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeftRight, CalendarClock, Sparkles } from "lucide-react";
import { Button, Input, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatDateBR, formatMinutes, todayString, weekdayShort } from "@/lib/time";
import type { CompKind, TargetSuggestion } from "@/lib/types";
import { usesHourExtra, type ExtraCapacity } from "@/lib/debt";
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
  /** Déficit pendente do dia de origem (para exibição informativa). */
  pendingDebtMinutes?: number;
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
  const copy = COPY[kind];

  useEffect(() => {
    if (open) {
      setForm({
        sourceDate: initial?.sourceDate ?? todayString(),
        targetDate: initial?.targetDate ?? todayString(),
        minutes: initial?.minutes ?? 60,
        note: initial?.note ?? "",
        status: initial?.status,
        kind: initial?.kind ?? kind,
      });
    }
  }, [open, initial, kind]);

  // ── Validação visual (não substitui a validação central do store) ──
  const usesCapacity = usesHourExtra(kind);
  const cap = usesCapacity && getCapacity ? getCapacity(form.targetDate) : null;
  const crossCycle =
    !!form.sourceDate && !!form.targetDate && !sameAnnualCycle(form.sourceDate, form.targetDate);
  const missingFields =
    !form.sourceDate || !form.targetDate || form.sourceDate === form.targetDate;
  const invalidMinutes = !Number.isFinite(form.minutes) || form.minutes < 5 || form.minutes > 720;
  const overCapacity = cap !== null && form.minutes > cap.available;

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
            : null;

  const submit = async () => {
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
    setBusy(true);
    try {
      await onSave({ ...form, minutes: Math.round(form.minutes), kind });
      toast.show(editingId ? "Compensação atualizada." : "Compensação criada!");
    } catch (err) {
      toast.show(
        err instanceof Error && err.message ? err.message : "Não foi possível salvar.",
        "error",
      );
    } finally {
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
          <Button onClick={submit} loading={busy} disabled={!!invalidReason}>
            <ArrowLeftRight size={15} /> {editingId ? "Salvar alterações" : copy.cta}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
          <b>Como funciona:</b> {copy.explain}
        </div>

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
            onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
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
          const restante =
            pendingDebtMinutes !== undefined
              ? Math.max(0, pendingDebtMinutes - Math.min(form.minutes, cap.available))
              : null;
          return (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
              <div className="grid gap-1 sm:grid-cols-2">
                {pendingDebtMinutes !== undefined && (
                  <p>
                    <b>{kind === "acordo" ? "Acordo pendente:" : kind === "calendario" ? "Obrigação de calendário:" : "Déficit pendente:"}</b>{" "}
                    {formatMinutes(pendingDebtMinutes)}
                  </p>
                )}
                <p>
                  <b>Já planejado neste dia:</b> {formatMinutes(cap.alreadyAllocated)}
                </p>
                <p>
                  <b>Máximo disponível para esta compensação:</b>{" "}
                  <span className={cap.available < form.minutes ? "font-bold text-rose-600" : "font-bold text-emerald-600"}>
                    {formatMinutes(cap.available)}
                  </span>
                </p>
                <p>
                  <b>Capacidade até o limite de {formatMinutes(cap.limitMinutes)}:</b>{" "}
                  {formatMinutes(Math.max(0, cap.limitMinutes - cap.baseMinutes - cap.alreadyAllocated))}
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
            max={cap ? Math.max(5, cap.available) : 720}
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
