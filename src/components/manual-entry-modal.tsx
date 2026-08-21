"use client";

import { useEffect, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatMinutes, toMinutes, todayString } from "@/lib/time";

export interface ManualPairData {
  date: string;
  entrada: string;
  saida: string;
  note: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: ManualPairData) => void | Promise<void>;
}

/** Modal para lançar/corrigir registros de hoje ou de dias anteriores. */
export function ManualEntryModal({ open, onClose, onSave }: Props) {
  const toast = useToast();
  const today = todayString();
  const [form, setForm] = useState<ManualPairData>({
    date: today,
    entrada: "",
    saida: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ date: today, entrada: "", saida: "", note: "" });
    }
  }, [open, today]);

  const duration =
    form.entrada && form.saida && toMinutes(form.saida) > toMinutes(form.entrada)
      ? toMinutes(form.saida) - toMinutes(form.entrada)
      : null;

  const submit = async () => {
    if (!form.date) return toast.show("Informe a data.", "error");
    if (form.date > today) {
      return toast.show("Não é permitido registrar data futura.", "error");
    }
    if (!form.entrada || !form.saida) {
      return toast.show("Informe a hora de entrada e a hora de saída.", "error");
    }
    if (toMinutes(form.saida) <= toMinutes(form.entrada)) {
      return toast.show("A hora de saída deve ser depois da entrada.", "error");
    }
    setBusy(true);
    try {
      await onSave(form);
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
      title="Adicionar registro manual"
      subtitle="Lance entradas e saídas de hoje ou de dias anteriores."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={busy}>
            <CalendarPlus size={15} /> Adicionar registro
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Data"
          type="date"
          value={form.date}
          max={today}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          hint="Hoje ou qualquer data anterior — datas futuras não são permitidas."
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Hora de entrada"
            type="time"
            value={form.entrada}
            onChange={(e) => setForm({ ...form, entrada: e.target.value })}
          />
          <Input
            label="Hora de saída"
            type="time"
            value={form.saida}
            onChange={(e) => setForm({ ...form, saida: e.target.value })}
          />
        </div>

        {duration !== null && (
          <p className="text-xs text-slate-500">
            Período registrado: <b className="text-slate-700">{formatMinutes(duration)}</b>. O
            almoço é descontado automaticamente se o intervalo cruzar o horário de almoço.
          </p>
        )}

        <Input
          label="Observação (opcional)"
          value={form.note}
          maxLength={160}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </div>
    </Modal>
  );
}
