"use client";

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import { actions, getAppData, settingsOf } from "@/lib/store";
import {
  ALLOCATE_NO_REASON_MSG,
  dayCreditView,
  eligibleDeficitsForSpecialAllocation,
  excessReasonLabel,
  previewAllocateSpecialExcess,
} from "@/lib/hour-bank";
import { formatDateBR, formatMinutes, todayString } from "@/lib/time";
import { useToast } from "@/components/toast";
import type { Absence } from "@/lib/absences";
import type { CompanyCalendars } from "@/lib/company-calendar";
import type { Compensation, ExcessReason, Falta, TimeEntry, WorkSettings } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  excessDate: string;
  entries: TimeEntry[];
  compensations: Compensation[];
  absences: Absence[];
  companyCalendars: CompanyCalendars | undefined;
  faltas: Falta[];
  excessReasons: ExcessReason[] | undefined;
  settings: WorkSettings;
}

/**
 * Fluxo PRÓPRIO de alocação do excedente ESPECIAL já realizado.
 * Não reutiliza o modal de programação futura.
 */
export function AllocateExcessModal({
  open,
  onClose,
  excessDate,
  entries,
  compensations,
  absences,
  companyCalendars,
  faltas,
  excessReasons,
  settings,
}: Props) {
  const toast = useToast();
  const today = todayString();
  const credit = useMemo(
    () => dayCreditView(excessDate, entries, compensations, absences, companyCalendars, settings, excessReasons),
    [excessDate, entries, compensations, absences, companyCalendars, settings, excessReasons],
  );
  const deficits = useMemo(
    () =>
      eligibleDeficitsForSpecialAllocation(
        excessDate, entries, compensations, absences, companyCalendars, faltas, settings, today,
      ),
    [excessDate, entries, compensations, absences, companyCalendars, faltas, settings, today],
  );

  const [picked, setPicked] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = deficits.find((d) => d.date === picked) ?? deficits[0];
  const cap = selected ? Math.min(credit.freeSpecial, selected.openMinutes) : 0;
  const alloc = minutes > 0 ? minutes : cap;
  const preview = selected
    ? previewAllocateSpecialExcess(
        excessDate, selected.date, alloc,
        entries, compensations, absences, companyCalendars, faltas,
        settings, excessReasons, today,
      )
    : null;

  const pick = (date: string) => {
    setPicked(date);
    const d = deficits.find((x) => x.date === date);
    const nextCap = d ? Math.min(credit.freeSpecial, d.openMinutes) : 0;
    setMinutes(nextCap);
    setError(null);
  };

  const confirm = () => {
    if (!selected || busy) return;
    const snap = getAppData();
    const s = settingsOf(snap.user);
    const pre = previewAllocateSpecialExcess(
      excessDate, selected.date, alloc,
      snap.entries, snap.compensations, snap.absences, snap.companyCalendars, snap.faltas,
      s, snap.excessReasons, todayString(),
    );
    if (!pre.ok) {
      setError(pre.error ?? ALLOCATE_NO_REASON_MSG);
      return;
    }
    setBusy(true);
    try {
      const res = actions.allocateSpecialExcess({
        excessDate,
        deficitDate: selected.date,
        minutes: pre.minutes,
      });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível alocar o excedente.");
        return;
      }
      toast.show(res.warning ?? "Excedente alocado.");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Alocar excedente"
      subtitle="Vincula o excedente já realizado a um déficit factual — não cria programação futura."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} loading={busy} disabled={!selected || !preview?.ok}>
            Confirmar alocação
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <p><span className="font-bold uppercase tracking-wide text-[11px] text-rose-500">Origem</span> · {formatDateBR(excessDate)}</p>
          <p className="mt-1">Excedente disponível: <b>{formatMinutes(credit.freeSpecial)}</b></p>
          <p className="mt-0.5">
            Motivo:{" "}
            {credit.reason ? <b>{excessReasonLabel(credit.reason)}</b> : <b className="text-amber-700">⚠ não informado</b>}
          </p>
        </div>

        {!credit.reason && credit.excessSpecial > 0 && (
          <p className="flex items-start gap-2 text-sm font-semibold text-amber-700">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            {ALLOCATE_NO_REASON_MSG}
          </p>
        )}

        <div>
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Déficits em aberto</p>
          {deficits.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum déficit factual em aberto para alocar.</p>
          ) : (
            <ul className="space-y-2">
              {deficits.map((d) => {
                const active = (picked ?? deficits[0]?.date) === d.date;
                const rowCap = Math.min(credit.freeSpecial, d.openMinutes);
                return (
                  <li key={d.date}>
                    <button
                      type="button"
                      onClick={() => pick(d.date)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left cursor-pointer ${
                        active ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200" : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-sm font-bold text-slate-800">{formatDateBR(d.date)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Déficit original: <b>{formatMinutes(d.originalMinutes)}</b> · Já compensado:{" "}
                        <b className="text-emerald-600">{formatMinutes(d.compensatedMinutes)}</b> · Restante factual:{" "}
                        <b className="text-amber-700">{formatMinutes(d.openMinutes)}</b>
                        {d.plannedMinutes > 0 && (
                          <> · Planejado: <b className="text-sky-600">{formatMinutes(d.plannedMinutes)}</b></>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                        Máximo alocável agora: {formatMinutes(rowCap)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selected && (
          <Input
            label="Minutos a alocar"
            type="number"
            min={1}
            max={cap}
            value={alloc || ""}
            onChange={(ev) => {
              setMinutes(Number(ev.target.value));
              setError(null);
            }}
            hint={`Teto: ${formatMinutes(cap)} (mínimo entre excedente especial livre e restante factual)`}
          />
        )}

        {preview && preview.ok && preview.plannedToRelease > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-bold">Este déficit possui {formatMinutes(preview.plannedNow)} planejados para compensação futura.</p>
            <p className="mt-1">
              Ao usar o excedente já realizado agora, essa programação será liberada/cancelada
              na mesma proporção para evitar dupla compensação.
            </p>
            <ul className="mt-2 space-y-0.5 text-xs">
              <li>Vai alocar agora: <b>{formatMinutes(preview.minutes)}</b></li>
              <li>Planejamento que será liberado: <b>{formatMinutes(preview.plannedToRelease)}</b></li>
              <li>Restante do déficit: <b>{formatMinutes(preview.remainingDeficitAfter)}</b></li>
              <li>Excedente que restará: <b>{formatMinutes(preview.remainingSpecialAfter)}</b></li>
            </ul>
          </div>
        )}

        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}
