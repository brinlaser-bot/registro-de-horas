"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeftRight, CalendarClock, Sparkles } from "lucide-react";
import { Button, Input, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatDateBR, formatMinutes, todayString, weekdayShort } from "@/lib/time";
import type { CompKind, TargetSuggestion } from "@/lib/types";

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
} as const;

export function CompensationForm({
  open,
  onClose,
  initial,
  editingId,
  kind = "excedente",
  suggestions = [],
  smartHint,
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

  const submit = async () => {
    if (!form.sourceDate || !form.targetDate) {
      toast.show("Informe os dois dias.", "error");
      return;
    }
    if (form.sourceDate === form.targetDate) {
      toast.show("Origem e destino devem ser dias diferentes.", "error");
      return;
    }
    if (!Number.isFinite(form.minutes) || form.minutes < 5 || form.minutes > 720) {
      toast.show("As horas devem ficar entre 5min e 12h.", "error");
      return;
    }
    setBusy(true);
    try {
      await onSave({ ...form, minutes: Math.round(form.minutes), kind });
      toast.show(editingId ? "Compensação atualizada." : "Compensação criada!");
    } catch {
      toast.show("Não foi possível salvar.", "error");
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
          : "Quitação de saldo negativo com hora extra, respeitando o teto diário."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={busy}>
            <ArrowLeftRight size={15} /> {editingId ? "Salvar alterações" : copy.cta}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
          <b>Como funciona:</b> {copy.explain}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={copy.sourceLabel}
            type="date"
            value={form.sourceDate}
            max={todayString()}
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Horas a compensar (min)"
            type="number"
            min={5}
            max={720}
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
