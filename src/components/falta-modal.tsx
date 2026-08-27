"use client";

import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import { formatDateBR, formatMinutes } from "@/lib/time";
import { canRegisterFalta, faltaStatusOf } from "@/lib/faltas";
import type { Absence } from "@/lib/absences";
import type { CompanyCalendars } from "@/lib/company-calendar";
import type { Falta, TimeEntry, WorkSettings } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  entries: TimeEntry[];
  absences: Absence[];
  companyCalendars?: CompanyCalendars;
  settings: WorkSettings;
  faltas: Falta[];
  todayStr: string;
  onSave: (date: string) => Promise<void>;
}

/**
 * Registrar falta (integral — esta versão). Fluxo de confirmação simples:
 * uma data (passada, hoje ou futura) + a jornada efetiva calculada pela
 * resolução central. Falta futura vira "Falta prevista" (sem déficit ainda).
 */
export function FaltaModal({
  open,
  onClose,
  entries,
  absences,
  companyCalendars,
  settings,
  faltas,
  todayStr,
  onSave,
}: Props) {
  const [date, setDate] = useState(todayStr);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setDate(todayStr);
  }, [open, todayStr]);

  const gate = canRegisterFalta(date, entries, absences, companyCalendars, settings, faltas);
  const jornada = gate.jornadaMinutes ?? 0;
  const prevista = gate.ok && faltaStatusOf(date, todayStr) === "prevista";

  const submit = async () => {
    if (!gate.ok || busy) return;
    setBusy(true);
    try {
      await onSave(date);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar falta"
      subtitle="Falta integral de um dia que tinha jornada a cumprir e não foi trabalhado."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={!gate.ok}>
            <Ban size={15} /> Registrar falta
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
          <b>Como funciona:</b> a falta vale apenas para um dia com jornada efetiva. Dias de
          folga, feriados abonados, folgas a compensar, férias e afastamentos integrais não
          aceitam falta. Se houver trabalho parcial, o déficit já é calculado pelas horas
          trabalhadas — sem falta integral.
        </div>

        <Input
          label="Data da falta"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />

        {gate.ok ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700">
            {prevista ? (
              <>
                Falta prevista em <b>{formatDateBR(date)}</b> — jornada prevista:{" "}
                <b>{formatMinutes(jornada)}</b>. Ainda não afeta o saldo: o déficit passa a
                valer quando a data chegar.
              </>
            ) : (
              <>
                Registrar falta em <b>{formatDateBR(date)}</b>? Jornada prevista:{" "}
                <b>{formatMinutes(jornada)}</b>. Será gerado um déficit de{" "}
                <b>{formatMinutes(jornada)}</b>.
              </>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-600">
            {gate.error}
          </div>
        )}
      </div>
    </Modal>
  );
}
