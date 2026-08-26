"use client";

import { useMemo, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import { actions, getAppData, settingsOf } from "@/lib/store";
import {
  ALLOCATE_NO_REASON_MSG,
  dayCreditView,
  eligibleDeficitsForSpecialAllocation,
  eligibleSpecialSourcesForDeficit,
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
  /** Origem do excedente (fluxo clássico: escolher o déficit). */
  excessDate?: string;
  /** Déficit de partida (fluxo inverso: escolher a origem do excedente). */
  deficitDate?: string;
  entries: TimeEntry[];
  compensations: Compensation[];
  absences: Absence[];
  companyCalendars: CompanyCalendars | undefined;
  faltas: Falta[];
  excessReasons: ExcessReason[] | undefined;
  settings: WorkSettings;
}

/**
 * Fluxo PRÓPRIO de alocação do excedente do limite diário já realizado.
 * Serve nos dois sentidos: origem→déficit ou déficit→origem.
 * Reutiliza allocateSpecialExcess (nenhum ledger paralelo).
 */
export function AllocateExcessModal({
  open,
  onClose,
  excessDate,
  deficitDate,
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
  const inverse = !!deficitDate && !excessDate;

  const sources = useMemo(
    () =>
      inverse && deficitDate
        ? eligibleSpecialSourcesForDeficit(
            deficitDate, entries, compensations, absences, companyCalendars, settings, excessReasons, today,
          )
        : [],
    [inverse, deficitDate, entries, compensations, absences, companyCalendars, settings, excessReasons, today],
  );

  const [pickedExcess, setPickedExcess] = useState<string | null>(null);
  const [pickedDeficit, setPickedDeficit] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  const originDate = inverse ? (pickedExcess ?? sources[0]?.date) : excessDate;
  const credit = useMemo(
    () =>
      originDate
        ? dayCreditView(originDate, entries, compensations, absences, companyCalendars, settings, excessReasons)
        : null,
    [originDate, entries, compensations, absences, companyCalendars, settings, excessReasons],
  );

  const deficits = useMemo(
    () =>
      originDate
        ? eligibleDeficitsForSpecialAllocation(
            originDate, entries, compensations, absences, companyCalendars, faltas, settings, today,
          )
        : [],
    [originDate, entries, compensations, absences, companyCalendars, faltas, settings, today],
  );

  const selectedDeficit = inverse
    ? deficits.find((d) => d.date === deficitDate)
    : (deficits.find((d) => d.date === pickedDeficit) ?? deficits[0]);

  const cap = credit && selectedDeficit ? Math.min(credit.freeSpecial, selectedDeficit.openMinutes) : 0;
  const alloc = minutes > 0 ? minutes : cap;
  const preview =
    originDate && selectedDeficit
      ? previewAllocateSpecialExcess(
          originDate, selectedDeficit.date, alloc,
          entries, compensations, absences, companyCalendars, faltas,
          settings, excessReasons, today,
        )
      : null;

  const pickDeficit = (date: string) => {
    setPickedDeficit(date);
    const d = deficits.find((x) => x.date === date);
    const nextCap = credit && d ? Math.min(credit.freeSpecial, d.openMinutes) : 0;
    setMinutes(nextCap);
    setError(null);
  };

  const pickExcess = (date: string) => {
    setPickedExcess(date);
    const v = sources.find((x) => x.date === date);
    const nextCap = v && selectedDeficit ? Math.min(v.freeSpecial, selectedDeficit.openMinutes) : 0;
    setMinutes(nextCap);
    setError(null);
  };

  const confirm = () => {
    if (!originDate || !selectedDeficit || busy || inflight.current) return;
    const snap = getAppData();
    const s = settingsOf(snap.user);
    const pre = previewAllocateSpecialExcess(
      originDate, selectedDeficit.date, alloc,
      snap.entries, snap.compensations, snap.absences, snap.companyCalendars, snap.faltas,
      s, snap.excessReasons, todayString(),
    );
    if (!pre.ok) {
      setError(pre.error ?? ALLOCATE_NO_REASON_MSG);
      return;
    }
    inflight.current = true;
    setBusy(true);
    try {
      const res = actions.allocateSpecialExcess({
        excessDate: originDate,
        deficitDate: selectedDeficit.date,
        minutes: pre.minutes,
      });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível alocar o excedente.");
        return;
      }
      toast.show(res.warning ?? "Excedente alocado.");
      onClose();
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={inverse ? "Quitar déficit com excedente realizado" : "Alocar excedente"}
      /* title="Alocar excedente" — fluxo clássico preservado */
      subtitle="Vincula o excedente do limite diário já realizado a um déficit factual — não cria programação futura."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} loading={busy} disabled={!selectedDeficit || !preview?.ok || busy}>
            {busy ? "Alocando…" : "Confirmar alocação"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {inverse && selectedDeficit && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p><span className="font-bold uppercase tracking-wide text-[11px] text-amber-500">Déficit</span> · {formatDateBR(selectedDeficit.date)}</p>
            <p className="mt-1">Restante factual: <b>{formatMinutes(selectedDeficit.openMinutes)}</b></p>
          </div>
        )}

        {!inverse && credit && originDate && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <p><span className="font-bold uppercase tracking-wide text-[11px] text-rose-500">Origem</span> · {formatDateBR(originDate)}</p>
            <p className="mt-1">Excedente disponível: <b>{formatMinutes(credit.freeSpecial)}</b></p>
            <p className="mt-0.5">
              Motivo:{" "}
              {credit.reason ? <b>{excessReasonLabel(credit.reason)}</b> : <b className="text-amber-700">⚠ não informado</b>}
            </p>
          </div>
        )}

        {credit && !credit.reason && credit.excessSpecial > 0 && (
          <p className="flex items-start gap-2 text-sm font-semibold text-amber-700">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            {ALLOCATE_NO_REASON_MSG}
          </p>
        )}

        {inverse ? (
          <div>
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Excedente do limite diário disponível</p>
            {sources.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum excedente realizado com motivo no mesmo ciclo anual.</p>
            ) : (
              <ul className="space-y-2">
                {sources.map((v) => {
                  const active = originDate === v.date;
                  return (
                    <li key={v.date}>
                      <button
                        type="button"
                        onClick={() => pickExcess(v.date)}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left cursor-pointer ${
                          active ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200" : "border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                      >
                        <p className="text-sm font-bold text-slate-800">{formatDateBR(v.date)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Livre: <b className="text-amber-700">{formatMinutes(v.freeSpecial)}</b>
                          {v.reason && <> · Motivo: <b>{excessReasonLabel(v.reason)}</b></>}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <div>
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Déficits em aberto</p>
            {deficits.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum déficit factual em aberto para alocar.</p>
            ) : (
              <ul className="space-y-2">
                {deficits.map((d) => {
                  const active = (pickedDeficit ?? deficits[0]?.date) === d.date;
                  const rowCap = credit ? Math.min(credit.freeSpecial, d.openMinutes) : 0;
                  return (
                    <li key={d.date}>
                      <button
                        type="button"
                        onClick={() => pickDeficit(d.date)}
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
        )}

        {selectedDeficit && cap > 0 && (
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
            hint={`Teto: ${formatMinutes(cap)} (mínimo entre excedente livre e restante factual)`}
          />
        )}

        {preview && preview.ok && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${preview.plannedToRelease > 0 ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
            <p className="font-bold">Prévia da alocação</p>
            {preview.plannedToRelease > 0 && (
              <p className="mt-1">
                Este déficit possui {formatMinutes(preview.plannedNow)} planejados. A programação
                será liberada na parte que ultrapassar o novo restante factual.
              </p>
            )}
            <ul className="mt-2 space-y-0.5 text-xs">
              <li>Vai alocar agora: <b>{formatMinutes(preview.minutes)}</b> ≈ {formatMinutes(preview.minutes)}</li>
              <li>Excedente disponível antes: <b>{formatMinutes(preview.freeSpecial)}</b></li>
              <li>Excedente que restará: <b>{formatMinutes(preview.remainingSpecialAfter)}</b></li>
              <li>Déficit factual antes: <b>{formatMinutes(preview.openDeficit)}</b></li>
              <li>Déficit factual depois: <b>{formatMinutes(preview.remainingDeficitAfter)}</b></li>
              <li>Planejado atual: <b>{formatMinutes(preview.plannedNow)}</b></li>
              <li>Planejamento que será liberado: <b>{formatMinutes(preview.plannedToRelease)}</b></li>
              <li>Planejamento que continuará ativo: <b>{formatMinutes(preview.plannedAfter)}</b></li>
              <li>Sem programação depois: <b>{formatMinutes(Math.max(0, preview.remainingDeficitAfter - preview.plannedAfter))}</b></li>
            </ul>
          </div>
        )}

        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}
