"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button, Input, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatDateBR, formatMinutes, todayString } from "@/lib/time";

export interface CompFormData {
  sourceDate: string;
  targetDate: string;
  minutes: number;
  note: string;
  status?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: CompFormData;
  editingId?: number | null;
  onSave: (data: CompFormData & { status?: string }) => Promise<void>;
}

export function CompensationForm({ open, onClose, initial, editingId, onSave }: Props) {
  const toast = useToast();
  const [form, setForm] = useState<CompFormData>({
    sourceDate: todayString(),
    targetDate: todayString(),
    minutes: 60,
    note: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        sourceDate: initial?.sourceDate ?? todayString(),
        targetDate: initial?.targetDate ?? todayString(),
        minutes: initial?.minutes ?? 60,
        note: initial?.note ?? "",
      });
    }
  }, [open, initial]);

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
      await onSave({ ...form, minutes: Math.round(form.minutes) });
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
      title={editingId ? "Editar compensação" : "Nova compensação de horas"}
      subtitle="Regra da empresa: excedente acima de 10h/dia deve ser compensado em outro dia."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={busy}>
            <ArrowLeftRight size={15} /> {editingId ? "Salvar alterações" : "Criar compensação"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
          <b>Como funciona:</b> no dia de origem você trabalhou além do limite e não pôde registrar
          tudo. No dia de destino, você compensa saindo mais cedo (ou entrando mais tarde) o valor
          indicado.
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Dia de origem (excedente)"
            type="date"
            value={form.sourceDate}
            max={todayString()}
            onChange={(e) => setForm({ ...form, sourceDate: e.target.value })}
          />
          <Input
            label="Dia de compensação"
            type="date"
            value={form.targetDate}
            onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Horas a compensar (min)"
            type="number"
            min={5}
            max={720}
            step={5}
            value={form.minutes}
            onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })}
            hint={form.minutes > 0 ? `≈ ${formatMinutes(form.minutes)}` : undefined}
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
            Dica: para compensar {formatMinutes(form.minutes)} no dia {formatDateBR(form.targetDate)},
            saia do trabalho <b>1h antes do previsto</b> para cada hora compensada.
          </p>
        )}
      </div>
    </Modal>
  );
}
