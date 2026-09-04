"use client";

import { useMemo, useState } from "react";
import { Timer } from "lucide-react";
import { Badge, Button, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import { actions, settingsOf, useAppData } from "@/lib/store";
import { allocateSpecialExcessFifo } from "@/lib/special-excess-bank";
import { buildSpecialExcessDayView } from "@/lib/special-excess-day-view";
import { projectRealizedDayOfficial } from "@/lib/official-projection";
import type { SpecialExcessAllocation } from "@/lib/special-excess-use";
import { formatDateShortBR, formatMinutes, todayString } from "@/lib/time";

interface Props {
  /** Data do dia elegível (destino do uso). */
  date: string;
  onClose: () => void;
}

/** Traduz os codes da ação 3D para mensagens simples (sem código técnico). */
function translateUseError(code: string | undefined, fallback?: string): string {
  switch (code) {
    case "insufficient-special-balance":
      return "Seu saldo [10+] disponível não é suficiente para esse uso.";
    case "requested-exceeds-destination-need":
    case "destination-no-remaining-need":
      return "Esse valor ultrapassa o necessário para completar a jornada.";
    case "origin-not-realized":
      return "Essa origem ainda não está disponível para uso.";
    case "origin-not-found":
      return "Essa origem não está disponível no banco [10+].";
    case "origin-outside-cycle":
      return "Essa origem pertence a outro ciclo anual; o [10+] não atravessa 30/04.";
    case "period-closed":
      return "Este período já está fechado e não pode mais ser alterado.";
    case "invalid-manual-allocation":
      return "Confira a seleção de origens.";
    default:
      return fallback ?? "Não foi possível registrar o uso de [10+].";
  }
}

const QUICK_OPTIONS = [15, 30, 45, 60];

/**
 * 3G.1 — RESTANTE no modo MANUAL: "ainda pode completar neste dia" APÓS a
 * seleção atual do formulário. Reutiliza o `remainingMinutes` já derivado
 * pelo dia-view (necessidade disponível ANTES do novo uso) e desconta o
 * total selecionado — derivação de apresentação, SEM fórmula financeira
 * paralela. Nunca negativo.
 *
 *   remainingAfterSelection = max(remainingMinutes − selectedTotal, 0)
 */
export function manualRemainingAfterSelection(remainingMinutes: number, selectedTotal: number): number {
  return Math.max(0, remainingMinutes - selectedTotal);
}

/**
 * 3G.2 — MÁXIMO selecionável de UMA origem no modo MANUAL. Regra-mãe: um
 * destino só recebe [10+] até completar a BASE EFETIVA (nunca cria crédito
 * artificial). Reutiliza a necessidade JÁ derivada pelo day-view
 * (`remainingMinutes`) e a disponibilidade real do lote; o restante é
 * descontado das OUTRAS seleções do formulário — derivação de apresentação,
 * sem fórmula financeira paralela. Nunca negativo.
 *
 *   remainingSelectable = max(remainingNeed − selectedFromOthers, 0)
 *   maxForThisOrigin    = min(availableFromThisOrigin, remainingSelectable)
 */
export function manualMaxForOrigin(
  availableMinutes: number,
  remainingNeedMinutes: number,
  selectedFromOtherOrigins: number,
): number {
  const remainingSelectable = Math.max(0, remainingNeedMinutes - selectedFromOtherOrigins);
  return Math.max(0, Math.min(availableMinutes, remainingSelectable));
}

/**
 * Modal "Completar jornada com [10+]" (Etapa 3E).
 *
 * - Automático (padrão): o sistema retira das origens mais antigas (motor 3C);
 *   a UI apenas EXIBE o preview — não implementa FIFO.
 * - Manual: o usuário escolhe as origens (lotes com disponível > 0); a soma
 *   das seleções é a quantidade autoritativa (sem segundo campo divergente).
 * - Preview da projeção usa o motor 3A (não recalcula fórmula na UI).
 * - Confirma chama createSpecialExcessUse (3D). periodClosed não é inferido:
 *   ainda não existe fonte persistida de fechamento (limitação documentada).
 */
export function SpecialExcessUseModal({ date, onClose }: Props) {
  const { user, entries, absences, companyCalendars, faltas, specialExcessUses, specialExcessPlans, annualCycleClosures } = useAppData();
  const toast = useToast();
  const todayStr = todayString();
  const settings = settingsOf(user);

  const view = useMemo(
    () =>
      buildSpecialExcessDayView({
        date,
        asOfDate: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
        // 4A: minuto reservado por plano ativo NÃO está disponível para um
        // novo uso — o banco canônico líquida reservas (GERADO−USO−RESERVA).
        plans: specialExcessPlans ?? [],
        // 4H.1: capacidade do ciclo inclui saldo TRANSPORTADO formalmente
        // (mesma fonte canônica do store). Sem isto o preview/lotes/máximo
        // ignorariam o trazido e divergiriam do que o store de fato aloca.
        closures: annualCycleClosures,
      }),
    [date, todayStr, entries, absences, companyCalendars, settings, faltas, user.controlStartDate, specialExcessUses, specialExcessPlans, annualCycleClosures],
  );

  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [autoDraft, setAutoDraft] = useState<string>(String(view.maxUsableMinutes));
  const [manualSel, setManualSel] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 3G.2: aviso curto quando o valor digitado excede o máximo da seleção
  // (o campo trava no máximo — nada inválido é mantido no formulário).
  const [clampNote, setClampNote] = useState<string | null>(null);

  const maxUsable = view.maxUsableMinutes;
  const autoMinutes = Math.max(0, Math.floor(Number(autoDraft) || 0));
  const autoOver = autoMinutes > maxUsable;
  const autoEffective = autoOver ? maxUsable : autoMinutes;

  // Preview automático — motor 3C (a UI só exibe o resultado).
  const autoPreview = useMemo(() => {
    if (mode !== "auto" || autoEffective <= 0) return null;
    return allocateSpecialExcessFifo({ bank: view.bank, destinationDate: date, requestedMinutes: autoEffective });
  }, [mode, autoEffective, view.bank, date]);

  const manualAllocations: SpecialExcessAllocation[] = Object.entries(manualSel)
    .filter(([, m]) => m > 0)
    .map(([originDate, minutes]) => ({ originDate, minutes }));
  const manualTotal = manualAllocations.reduce((s, a) => s + a.minutes, 0);

  const selectedTotal = mode === "auto" ? autoEffective : manualTotal;

  // Preview da projeção — motor 3A (§14): jornada factual + uso selecionado.
  const projection = useMemo(() => {
    if (selectedTotal <= 0) return null;
    return projectRealizedDayOfficial({
      date,
      factualWorkedMinutes: view.workedMinutes,
      factualRegistrableMinutes: view.registrableMinutes,
      factualRegularBalanceMinutes: view.factualBalanceMinutes,
      /* 4D.4.2: base canônica do dia (requiredWorkMinutes) — mesma fonte do
         motor e da view (Parte D: factual nunca muda; só a projeção). */
      effectiveBaseMinutes: view.requiredWorkMinutes,
      financialValid: view.eligible,
      // 4D.4.2: mesmo "realized" canônico da view (evento de calendário é fato).
      realized: view.realized,
      usedSpecialMinutes: view.usedActiveMinutes + selectedTotal,
    });
  }, [date, view, selectedTotal]);

  const confirm = async () => {
    if (busy) return;
    if (mode === "auto") {
      if (autoMinutes < 1) {
        setError("Informe quanto deseja utilizar.");
        return;
      }
      if (autoOver) {
        setError(`O máximo para este dia agora é ${formatMinutes(maxUsable)}.`);
        return;
      }
    } else {
      if (manualTotal < 1) {
        setError("Escolha ao menos uma origem.");
        return;
      }
      for (const a of manualAllocations) {
        const lot = view.bank.lots.find((l) => l.originDate === a.originDate);
        if (!lot || a.minutes > lot.availableMinutes) {
          setError(`Essa origem não tem ${formatMinutes(a.minutes)} disponíveis.`);
          return;
        }
      }
      if (manualTotal > view.remainingMinutes) {
        setError("Esse valor ultrapassa o necessário para completar a jornada.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = actions.createSpecialExcessUse({
        destinationDate: date,
        minutes: selectedTotal,
        // UI "Automático" = estratégia "fifo" do modelo 3D (FIFO não é texto principal).
        allocationStrategy: mode === "auto" ? "fifo" : "manual",
        ...(mode === "manual" ? { manualAllocations } : {}),
        asOfDate: todayStr,
      });
      if (!res.ok) {
        setError(translateUseError(res.code, res.error));
        return;
      }
      toast.show(`${formatMinutes(selectedTotal)} de [10+] utilizados.`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Completar jornada com [10+]"
      subtitle={`Dia ${formatDateShortBR(date)} · saldo [10+] do ciclo ${view.bank.cycle}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={confirm}
            loading={busy}
            disabled={selectedTotal < 1 || (mode === "auto" && autoOver)}
            className="!bg-violet-600 hover:!bg-violet-700 active:!bg-violet-800"
          >
            <Timer size={15} /> Usar [10+]
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Cabeçalho — o factual NÃO muda visualmente */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-slate-50 px-3.5 py-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Data</dt>
            <dd className="font-bold text-slate-900">{formatDateShortBR(date)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Jornada factual</dt>
            <dd className="font-bold tabular-nums text-slate-900">{formatMinutes(view.workedMinutes)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Saldo factual</dt>
            <dd
              className={`font-bold tabular-nums ${view.factualBalanceMinutes < 0 ? "text-rose-600" : "text-emerald-600"}`}
            >
              {view.factualBalanceMinutes > 0 ? "+" : ""}
              {formatMinutes(view.factualBalanceMinutes)}
            </dd>
          </div>
          {/* 1º uso: só "Falta para completar" (sem número duplicado).
              Uso parcial: falta original + já utilizado + ainda pode completar. */}
          <div>
            <dt className="text-slate-500">
              {view.usedActiveMinutes > 0 ? "Falta original" : "Falta para completar a jornada"}
            </dt>
            <dd className="font-bold tabular-nums text-slate-900">{formatMinutes(view.neededMinutes)}</dd>
          </div>
          {view.usedActiveMinutes > 0 && (
            <div>
              <dt className="text-slate-500">Já utilizado neste dia</dt>
              <dd className="font-bold tabular-nums text-violet-700">{formatMinutes(view.usedActiveMinutes)}</dd>
            </div>
          )}
          {view.usedActiveMinutes > 0 && (
            <div>
              <dt className="text-slate-500">Ainda pode completar</dt>
              <dd className="font-bold tabular-nums text-slate-900">{formatMinutes(view.remainingMinutes)}</dd>
            </div>
          )}
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-slate-500">
              Banco <span className="font-semibold">[10+]</span> disponível
            </dt>
            <dd className="font-bold tabular-nums text-violet-700">{formatMinutes(view.bankAvailableMinutes)}</dd>
          </div>
        </dl>

        {/* Modo */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode("auto")}
            aria-pressed={mode === "auto"}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer ${
              mode === "auto"
                ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300"
                : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <span className="block text-xs font-bold text-slate-900">Automático</span>
            <span className="block text-[11px] font-medium text-slate-500">Usar horas mais antigas primeiro</span>
          </button>
          <button
            onClick={() => setMode("manual")}
            aria-pressed={mode === "manual"}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer ${
              mode === "manual"
                ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300"
                : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <span className="block text-xs font-bold text-slate-900">Manual</span>
            <span className="block text-[11px] font-medium text-slate-500">Escolher a origem das horas</span>
          </button>
        </div>
        {mode === "auto" && (
          <p className="text-[11px] text-slate-500">
            O Meu Horário usa primeiro os saldos [10+] mais antigos disponíveis.
          </p>
        )}

        {mode === "auto" ? (
          <div className="space-y-3">
            <div>
              {/* Unidade "min" explícita no campo (internamente continua minutos). */}
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Quanto deseja utilizar?
              </span>
              <div className="relative">
                <Input
                  type="number"
                  min={1}
                  max={maxUsable}
                  inputMode="numeric"
                  value={autoDraft}
                  onChange={(e) => {
                    setAutoDraft(e.target.value);
                    setError(null);
                  }}
                  aria-label="Minutos a utilizar"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-bold text-slate-400">min</span>
              </div>
              <span className="mt-1 block text-xs text-slate-400">Máximo agora: {formatMinutes(maxUsable)}</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK_OPTIONS.filter((m) => m <= maxUsable).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setAutoDraft(String(m));
                      setError(null);
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                      autoMinutes === m
                        ? "bg-violet-600 text-white"
                        : "bg-violet-50 text-violet-700 hover:bg-violet-100"
                    }`}
                  >
                    {formatMinutes(m)}
                  </button>
                ))}
              </div>
            </div>

            {autoPreview && autoPreview.allocations.length > 0 && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Origem das horas</p>
                <ul className="mt-1.5 space-y-1 text-xs font-medium text-violet-900">
                  {autoPreview.allocations.map((a) => (
                    <li key={`${a.originDate}-${a.carried ? "c" : "f"}`} className="flex items-center justify-between gap-3">
                      <span>
                        {formatDateShortBR(a.originDate)}
                        {a.carried && (
                          <span className="ml-1.5 font-semibold text-sky-600">· trazido do ciclo anterior</span>
                        )}
                      </span>
                      <span className="font-bold tabular-nums">{formatMinutes(a.minutes)}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between border-t border-violet-200 pt-1 font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatMinutes(autoPreview.allocatedMinutes)}</span>
                  </li>
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {view.lots.length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-xs font-medium text-slate-600">
                Não há saldos [10+] disponíveis neste ciclo.
              </p>
            ) : (
              <ul className="space-y-2">
                {view.lots.map((lot) => {
                  const sel = manualSel[lot.originDate] ?? 0;
                  const checked = sel > 0;
                  {/* 3G.2: máximo DINÂMICO — disponibilidade do lote limitada
                      pela necessidade restante do destino, descontada das
                      OUTRAS origens selecionadas. Necessidade completa → a
                      origem não selecionada fica bloqueada (visual claro). */}
                  const maxForThisOrigin = manualMaxForOrigin(lot.availableMinutes, view.remainingMinutes, manualTotal - sel);
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
                          disabled={blocked}
                          onChange={(e) => {
                            setClampNote(null);
                            setManualSel((prev) => ({
                              ...prev,
                              // 3G.2: pré-preenche respeitando o máximo da
                              // seleção (disponibilidade ∩ necessidade restante).
                              [lot.originDate]: e.target.checked
                                ? Math.min(prev[lot.originDate] || lot.availableMinutes, maxForThisOrigin)
                                : 0,
                            }));
                          }}
                          className="h-4 w-4 accent-violet-600 disabled:cursor-not-allowed"
                        />
                        <span className="text-xs font-bold text-slate-900">
                          {formatDateShortBR(lot.originDate)}
                          {lot.carried && (
                            <Badge tone="sky" className="ml-1.5">trazido · {lot.originCycle ?? "ciclo anterior"}</Badge>
                          )}
                        </span>
                      </label>
                      <span className="min-w-0 flex-1 text-[11px] font-medium text-slate-500 sm:pl-6">
                        {lot.carried ? (
                          <>
                            Trazido do ciclo anterior: <b className="text-slate-700">{formatMinutes(lot.carriedInMinutes ?? lot.availableMinutes)}</b>
                          </>
                        ) : (
                          <>
                            Gerado: <b className="text-slate-700">{formatMinutes(lot.generatedMinutes)}</b>
                          </>
                        )}
                        {lot.usedMinutes > 0 && (
                          <>
                            {" "}
                            · Utilizado: <b className="text-slate-700">{formatMinutes(lot.usedMinutes)}</b>
                          </>
                        )}
                        {" "}
                        · Disponível: <b className="text-violet-700">{formatMinutes(lot.availableMinutes)}</b>
                      </span>
                      <div className="relative">
                        <Input
                          type="number"
                          min={0}
                          max={maxForThisOrigin}
                          step={5}
                          inputMode="numeric"
                          disabled={!checked}
                          value={checked ? String(sel) : ""}
                          onChange={(e) => {
                            // 3G.2: trava no máximo dinâmico (padrão do
                            // componente: clamp) + aviso curto e claro.
                            const wanted = Math.floor(Number(e.target.value) || 0);
                            const capped = Math.max(0, Math.min(maxForThisOrigin, wanted));
                            setManualSel((prev) => ({ ...prev, [lot.originDate]: capped }));
                            setClampNote(wanted > capped ? `Máximo disponível para esta seleção: ${formatMinutes(capped)}.` : null);
                          }}
                          className="w-24"
                          aria-label={`Minutos da origem ${formatDateShortBR(lot.originDate)}`}
                        />
                        {/* Unidade "min" explícita no campo manual (interno: minutos). */}
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] font-bold text-slate-400">min</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {/* 3G.2: feedback do clamp — o valor inválido nunca é mantido. */}
            {clampNote && (
              <p className="text-[11px] font-semibold text-amber-700" role="status">
                {clampNote}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs">
              <span className="font-medium text-slate-600">
                Total selecionado: <b className="tabular-nums text-slate-900">{formatMinutes(manualTotal)}</b>
              </span>
              {/* 3G.1: restante considera a SELEÇÃO ATUAL do formulário
                  (derivação manualRemainingAfterSelection). Quando a seleção
                  completa a necessidade, informa isso em vez de "0min". */}
              {manualRemainingAfterSelection(view.remainingMinutes, manualTotal) > 0 ? (
                <span className="font-medium text-slate-600">
                  Ainda pode completar neste dia:{" "}
                  <b className="tabular-nums text-slate-900">
                    {formatMinutes(manualRemainingAfterSelection(view.remainingMinutes, manualTotal))}
                  </b>
                </span>
              ) : manualTotal > 0 ? (
                <span className="font-medium text-emerald-700">Esta seleção completa a jornada.</span>
              ) : (
                <span className="font-medium text-slate-600">
                  Ainda pode completar neste dia: <b className="tabular-nums text-slate-900">{formatMinutes(0)}</b>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Preview da projeção — motor 3A */}
        {projection && selectedTotal > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Como ficará na projeção do ponto
            </p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-slate-500">Jornada factual</dt>
                <dd className="font-bold tabular-nums text-slate-900">{formatMinutes(view.workedMinutes)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Novo uso [10+]</dt>
                <dd className="font-bold tabular-nums text-violet-700">{formatMinutes(selectedTotal)}</dd>
              </div>
              {/* 2º uso: diferencia o novo uso do total após confirmar (1º uso:
                  total = novo, então a linha é omitida para não duplicar). */}
              {view.usedActiveMinutes > 0 && (
                <div>
                  <dt className="text-slate-500">Total [10+] após confirmar</dt>
                  <dd className="font-bold tabular-nums text-violet-700">
                    {formatMinutes(view.usedActiveMinutes + selectedTotal)}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-slate-500">Projeção</dt>
                <dd className="font-bold tabular-nums text-slate-900">{formatMinutes(projection.projectedWorkedMinutes)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Saldo projetado</dt>
                <dd
                  className={`font-bold tabular-nums ${
                    projection.projectedBalanceMinutes < 0 ? "text-rose-600" : "text-emerald-600"
                  }`}
                >
                  {projection.projectedBalanceMinutes > 0 ? "+" : ""}
                  {formatMinutes(projection.projectedBalanceMinutes)}
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/* Explicação discreta */}
        <p className="text-[11px] leading-relaxed text-slate-500">
          O uso de [10+] não altera sua jornada real. Ele registra como essas horas serão consideradas na projeção
          do ponto.
        </p>

        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
