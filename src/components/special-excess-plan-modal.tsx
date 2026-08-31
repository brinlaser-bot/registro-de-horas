"use client";

import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Badge, Button, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import { actions, settingsOf, useAppData } from "@/lib/store";
import { allocateSpecialExcessFifo, buildSpecialExcessBank } from "@/lib/special-excess-bank";
import { getAnnualPointCycle } from "@/lib/periods";
import type { SpecialExcessAllocation } from "@/lib/special-excess-use";
// 4B: o LIMITE DINÂMICO da seleção manual reutiliza o MESMO helper canônico
// do modal de uso (3G.2) — nenhuma segunda matemática na UI.
import { manualMaxForOrigin } from "@/components/special-excess-use-modal";
import { formatDateShortBR, formatMinutes, todayString } from "@/lib/time";

interface Props {
  /** Data FUTURA escolhida (destino da reserva). */
  date: string;
  onClose: () => void;
}

/** Traduz os codes da ação 4A para mensagens simples (sem código técnico). */
function translatePlanError(code: string | undefined, fallback?: string): string {
  switch (code) {
    case "destination-not-future":
      return "Só é possível reservar [10+] para um dia futuro.";
    case "insufficient-special-balance":
      return "Não há saldo [10+] disponível suficiente neste ciclo para essa reserva.";
    case "cross-cycle":
      return "A reserva não pode atravessar o fechamento anual (30/04): origem e destino devem estar no mesmo ciclo.";
    case "origin-not-realized":
      return "Essa origem ainda não está disponível para reserva.";
    case "origin-not-found":
      return "Essa origem não está disponível no banco [10+].";
    case "origin-outside-cycle":
      return "Essa origem pertence a outro ciclo anual; o [10+] não atravessa 30/04.";
    case "period-closed":
      return "Este período já está fechado e não pode mais ser alterado.";
    case "invalid-manual-allocation":
      return "Confira a seleção de origens.";
    default:
      return fallback ?? "Não foi possível criar a reserva de [10+].";
  }
}

const QUICK_OPTIONS = [15, 30, 45, 60];

/**
 * Modal "Planejar uso de [10+]" (Etapa 4B) — interface do motor 4A.
 *
 * - Criação usa SOMENTE createSpecialExcessPlan (o store é o gate final;
 *   nenhuma persistência paralela e nenhum plano parcial: se a reserva
 *   não couber no disponível, o store rejeita inteira).
 * - BANCO [10+] DISPONÍVEL vem da fonte canônica 4A/4A.1
 *   (buildSpecialExcessBank com usos + reservas ativas).
 * - Automático: preview das origens pelo FIFO canônico existente (3C) —
 *   o componente NÃO recalcula FIFO; o store revalida ao confirmar.
 * - Manual: somente lotes com capacidade realmente líquida; limite
 *   dinâmico 3G.2 (capacidade da origem ∩ quantidade ainda não atingida);
 *   quando o total selecionado alcança a quantidade, as demais origens
 *   ficam indisponíveis para seleção adicional.
 * - A reserva NÃO altera jornada, saldo regular, projeção ou qualquer
 *   fato — apenas SEPARA saldo [10+] para uma decisão futura.
 */
export function SpecialExcessPlanModal({ date, onClose }: Props) {
  const { user, entries, absences, companyCalendars, faltas, specialExcessUses, specialExcessPlans } = useAppData();
  const toast = useToast();
  const todayStr = todayString();
  const settings = settingsOf(user);

  // Fonte canônica 4A/4A.1: disponível JÁ líquida usos ativos E reservas
  // ativas (outras reservas reduzem o que esta seleção pode usar).
  const bank = useMemo(
    () =>
      buildSpecialExcessBank({
        cycle: getAnnualPointCycle(date),
        asOfDate: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? "",
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
      }),
    [date, todayStr, entries, absences, companyCalendars, settings, faltas, user.controlStartDate, specialExcessUses, specialExcessPlans],
  );
  const available = bank.availableMinutes;

  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [wantDraft, setWantDraft] = useState<string>("");
  const [manualSel, setManualSel] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const want = Math.max(0, Math.floor(Number(wantDraft) || 0));
  const wantOver = want > available;

  // Preview automático — motor 3C (a UI só exibe; o store revalida no gate).
  const autoPreview = useMemo(() => {
    if (mode !== "auto" || want <= 0 || wantOver) return null;
    return allocateSpecialExcessFifo({ bank, destinationDate: date, requestedMinutes: want });
  }, [mode, want, wantOver, bank, date]);

  const manualAllocations: SpecialExcessAllocation[] = Object.entries(manualSel)
    .filter(([, m]) => m > 0)
    .map(([originDate, minutes]) => ({ originDate, minutes }));
  const manualTotal = manualAllocations.reduce((s, a) => s + a.minutes, 0);

  const selectedTotal = mode === "auto" ? want : manualTotal;

  const confirm = async () => {
    if (busy) return;
    if (want < 1) {
      setError("Informe quanto deseja reservar.");
      return;
    }
    if (wantOver) {
      setError(`O Banco [10+] deste ciclo tem apenas ${formatMinutes(available)} disponíveis.`);
      return;
    }
    if (mode === "manual") {
      if (manualTotal < 1) {
        setError("Escolha ao menos uma origem.");
        return;
      }
      for (const a of manualAllocations) {
        const lot = bank.lots.find((l) => l.originDate === a.originDate);
        if (!lot || a.minutes > lot.availableMinutes) {
          setError(`Essa origem não tem ${formatMinutes(a.minutes)} disponíveis para reserva.`);
          return;
        }
      }
      if (manualTotal > want) {
        setError("A seleção passou da quantidade escolhida.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = actions.createSpecialExcessPlan({
        destinationDate: date,
        minutes: selectedTotal,
        selectionMode: mode === "auto" ? "automatic" : "manual",
        ...(mode === "manual" ? { manualAllocations } : {}),
        asOfDate: todayStr,
      });
      if (!res.ok) {
        setError(translatePlanError(res.code, res.error));
        return;
      }
      toast.show(`${formatMinutes(selectedTotal)} de [10+] reservados para ${formatDateShortBR(date)}.`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Planejar uso de [10+]"
      subtitle={`Dia ${formatDateShortBR(date)} · ciclo ${bank.cycle}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={confirm}
            loading={busy}
            disabled={selectedTotal < 1 || (mode === "auto" && wantOver)}
            className="!bg-violet-600 hover:!bg-violet-700 active:!bg-violet-800"
          >
            <CalendarClock size={15} /> Reservar [10+]
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Cabeçalho — a reserva NÃO altera o dia (nem o factual, nem o futuro) */}
        <p className="rounded-xl bg-violet-50 px-3.5 py-2.5 text-xs font-medium text-violet-900">
          Esta ação apenas reserva saldo [10+] para este dia. Sua jornada e seu saldo regular não serão alterados.
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-slate-50 px-3.5 py-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Data</dt>
            <dd className="font-bold text-slate-900">{formatDateShortBR(date)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Ciclo anual</dt>
            <dd className="font-bold text-slate-900">{bank.cycle}</dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-slate-500">
              Banco <span className="font-semibold">[10+]</span> disponível
            </dt>
            {available > 0 ? (
              <dd className="font-bold tabular-nums text-violet-700">{formatMinutes(available)}</dd>
            ) : (
              <dd className="font-bold text-slate-500">0min</dd>
            )}
          </div>
        </dl>
        {available === 0 && (
          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-xs font-medium text-slate-600">
            Não há saldo [10+] disponível neste ciclo para reservar nesta data.
          </p>
        )}

        {/* Quantidade (os dois modos) — o limite aqui é a capacidade real do
            banco; NÃO existe "jornada futura" simulada (nada de base 8h). */}
        <div>
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Quanto deseja reservar para este dia?
          </span>
          <div className="relative">
            <Input
              type="number"
              min={1}
              max={available}
              inputMode="numeric"
              value={wantDraft}
              onChange={(e) => {
                setWantDraft(e.target.value);
                setError(null);
              }}
              aria-label="Minutos a reservar"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-bold text-slate-400">min</span>
          </div>
          <span className="mt-1 block text-xs text-slate-400">Máximo: {formatMinutes(available)}</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_OPTIONS.filter((m) => m <= available).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setWantDraft(String(m));
                  setError(null);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                  want === m ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-700 hover:bg-violet-100"
                }`}
              >
                {formatMinutes(m)}
              </button>
            ))}
          </div>
        </div>

        {/* Modo */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode("auto")}
            aria-pressed={mode === "auto"}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer ${
              mode === "auto" ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300" : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <span className="block text-xs font-bold text-slate-900">Automático</span>
            <span className="block text-[11px] font-medium text-slate-500">Reservar das origens mais antigas</span>
          </button>
          <button
            onClick={() => setMode("manual")}
            aria-pressed={mode === "manual"}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer ${
              mode === "manual" ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300" : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <span className="block text-xs font-bold text-slate-900">Manual</span>
            <span className="block text-[11px] font-medium text-slate-500">Escolher a origem das horas</span>
          </button>
        </div>
        {mode === "auto" && (
          <p className="text-[11px] text-slate-500">
            O Meu Horário reserva primeiro as origens [10+] mais antigas disponíveis.
          </p>
        )}

        {mode === "auto" ? (
          autoPreview && autoPreview.allocations.length > 0 ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Origem da reserva</p>
              <ul className="mt-1.5 space-y-1 text-xs font-medium text-violet-900">
                {autoPreview.allocations.map((a) => (
                  <li key={a.originDate} className="flex items-center justify-between gap-3">
                    <span>{formatDateShortBR(a.originDate)}</span>
                    <span className="font-bold tabular-nums">{formatMinutes(a.minutes)}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between border-t border-violet-200 pt-1 font-bold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatMinutes(autoPreview.allocatedMinutes)}</span>
                </li>
              </ul>
            </div>
          ) : null
        ) : (
          <div className="space-y-3">
            {bank.lots.filter((l) => l.availableMinutes > 0).length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-xs font-medium text-slate-600">
                Não há saldos [10+] disponíveis neste ciclo.
              </p>
            ) : (
              <ul className="space-y-2">
                {bank.lots
                  .filter((l) => l.availableMinutes > 0)
                  .map((lot) => {
                    const sel = manualSel[lot.originDate] ?? 0;
                    const checked = sel > 0;
                    {/* 4B: limite DINÂMICO 3G.2 — capacidade livre do lote
                        limitada pela quantidade ainda não atingida da reserva,
                        descontada das OUTRAS origens selecionadas. Quantidade
                        completa → demais origens ficam indisponíveis. */}
                    const maxForThisOrigin = manualMaxForOrigin(lot.availableMinutes, want, manualTotal - sel);
                    const blocked = !checked && maxForThisOrigin <= 0;
                    return (
                      <li
                        key={lot.originDate}
                        className={`flex flex-col gap-2 rounded-xl border px-3.5 py-2.5 sm:flex-row sm:items-center ${
                          checked ? "border-violet-300 bg-violet-50" : "border-slate-200 bg-white"
                        } ${blocked ? "opacity-50" : ""}`}
                      >
                        <label className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={blocked || want < 1}
                            onChange={(e) => {
                              setManualSel((prev) => ({
                                ...prev,
                                // Pré-preenche respeitando o máximo dinâmico
                                // (capacidade ∩ quantidade restante).
                                [lot.originDate]: e.target.checked
                                  ? Math.min(prev[lot.originDate] || lot.availableMinutes, maxForThisOrigin)
                                  : 0,
                              }));
                              setError(null);
                            }}
                            className="h-4 w-4 accent-violet-600 disabled:cursor-not-allowed"
                          />
                          <span className="text-xs font-bold text-slate-900">{formatDateShortBR(lot.originDate)}</span>
                        </label>
                        <span className="min-w-0 flex-1 text-[11px] font-medium text-slate-500 sm:pl-6">
                          Gerado: <b className="text-slate-700">{formatMinutes(lot.generatedMinutes)}</b>
                          {lot.usedMinutes > 0 && (
                            <>
                              {" "}· Utilizado: <b className="text-slate-700">{formatMinutes(lot.usedMinutes)}</b>
                            </>
                          )}
                          {lot.reservedMinutes > 0 && (
                            <>
                              {" "}· Reservado: <b className="text-slate-700">{formatMinutes(lot.reservedMinutes)}</b>
                            </>
                          )}
                          {" "}· Disponível: <b className="text-violet-700">{formatMinutes(lot.availableMinutes)}</b>
                        </span>
                        <div className="relative">
                          <Input
                            type="number"
                            min={0}
                            max={maxForThisOrigin}
                            step={5}
                            inputMode="numeric"
                            value={String(sel)}
                            disabled={!checked && (blocked || want < 1)}
                            onChange={(e) => {
                              const raw = Math.floor(Number(e.target.value) || 0);
                              const clamped = Math.max(0, Math.min(raw, maxForThisOrigin));
                              setManualSel((prev) => ({ ...prev, [lot.originDate]: clamped }));
                              setError(null);
                            }}
                            aria-label={`Minutos da origem ${lot.originDate}`}
                            className="w-24"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] font-bold text-slate-400">min</span>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
            {mode === "manual" && manualTotal > 0 && (
              <p className="text-[11px] font-semibold text-violet-700">
                Selecionado: <span className="tabular-nums">{formatMinutes(manualTotal)}</span>
                {manualTotal >= want && want > 0 ? " · quantidade atingida" : ` · faltam ${formatMinutes(Math.max(0, want - manualTotal))} para a quantidade escolhida`}
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Badge tone="violet" className="shrink-0">
            <CalendarClock size={11} aria-hidden /> [10+]
          </Badge>
          A reserva fica como planejado até você decidir o que fazer com ela.
        </p>
      </div>
    </Modal>
  );
}
