"use client";

/**
 * ETAPA 4H.2 — MODAL "DESTINAR HORAS [10+]" (FLUXO INVERSO).
 *
 * A origem [10+] vem FIXA (o lote escolhido na Central de Horas ou no
 * DayCard de Registros que GEROU a hora). A usuária escolhe UM dia abaixo
 * da base e UMA quantidade — o MESMO motor canônico do fluxo atual:
 *
 *   · elegibilidade/destinos → eligibleSpecialExcessDestinationsForOrigin
 *     (derivado 4H.2 sobre as fontes 3A/3E + guards 4G/4H);
 *   · saldo da origem        → 3C (buildSpecialExcessBank, via helper);
 *   · preview da projeção    → 3A (projectRealizedDayOfficial);
 *   · gravação               → actions.createSpecialExcessUse (3D), com
 *     allocationStrategy "manual" e a origem fixa — o MESMO registro
 *     (SpecialExcessUse/allocation) criado pelo fluxo destino→origem.
 *
 * Regra-mãe preservada: o uso NÃO altera a jornada factual nem o saldo
 * regular — apenas registra o uso [10+] na projeção do ponto.
 *
 * Máximo da operação = min( disponível da origem, necessidade restante do
 * destino ) — destino que precisa MAIS que a origem aparece (máx. = origem);
 * destino que precisa MENOS limita ao próprio (a origem mantém o resto).
 * Destinação parcial (menor que o máximo) é permitida; UM destino por
 * operação. Sem destino elegível: CTA desabilitado + explicação compacta
 * (o lote NUNCA é escondido).
 */
import { useMemo, useState } from "react";
import { ArrowRightLeft, Timer } from "lucide-react";
import { Badge, Button, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import { actions, settingsOf, useAppData } from "@/lib/store";
import {
  buildSpecialExcessOriginBank,
  eligibleSpecialExcessDestinationsForOrigin,
  maxDestinableMinutes,
  type SpecialExcessDestinationCandidate,
} from "@/lib/special-excess-destinations";
import { buildResumoDayRow } from "@/lib/resumo-days";
import { isProjectableDayStatus, projectRealizedDayOfficial } from "@/lib/official-projection";
import { formatDateShortBR, formatMinutes, todayString } from "@/lib/time";

export interface SpecialExcessDestineOriginRef {
  /** Data factual da origem (apresentação) — a identidade do lote no banco. */
  originDate: string;
  /** Ciclo OPERACIONAL do lote (não-carregado: ciclo da origem;
   *  transportado: o NOVO ciclo onde o saldo foi autorizado). */
  cycle: string;
  /** true quando o lote é saldo TRANSPORTADO do ciclo anterior (4H). */
  carried?: boolean;
  /** Lastro transportado (somente exibição). */
  carriedInMinutes?: number;
  /** Ciclo onde o [10+] nasceu de fato (proveniência, somente exibição). */
  originCycle?: string;
}

interface Props {
  origin: SpecialExcessDestineOriginRef;
  onClose: () => void;
}

const QUICK_OPTIONS = [15, 30, 45, 60];

/**
 * 4H.2 — restrição do modal p/ erro do store (o guard real continua no
 * motor; aqui só a tradução para linguagem simples, sem código técnico).
 */
function translateDestineError(code: string | undefined, fallback?: string): string {
  switch (code) {
    case "insufficient-special-balance":
      return "A origem disponível ficou menor do que o valor informado.";
    case "requested-exceeds-destination-need":
    case "destination-no-remaining-need":
      return "Esse valor ultrapassa o necessário para completar a jornada do destino.";
    case "destination-not-eligible":
      return "Esse dia não está elegível para receber [10+] agora.";
    case "origin-not-realized":
      return "Essa origem ainda não é um dia realizado.";
    case "origin-not-found":
      return "Essa origem não está no banco [10+] deste ciclo.";
    case "origin-outside-cycle":
      return "Essa origem pertence a outro ciclo anual; o [10+] não atravessa 30/04.";
    case "period-closed":
      return "Este período já está fechado e não pode mais ser alterado.";
    case "consolidated":
      return "O destino está protegido por consolidação e não pode receber [10+].";
    case "cycle-closed":
      return "O ciclo anual já foi encerrado; não é possível criar novos usos de [10+].";
    default:
      return fallback ?? "Não foi possível destinar as horas [10+].";
  }
}

export function SpecialExcessDestineModal({ origin, onClose }: Props) {
  const { user, entries, absences, companyCalendars, faltas, specialExcessUses, specialExcessPlans, periodConsolidations, annualCycleClosures } = useAppData();
  const toast = useToast();
  const todayStr = todayString();
  const settings = settingsOf(user);

  const bank = useMemo(
    () =>
      buildSpecialExcessOriginBank({
        cycle: origin.cycle,
        asOfDate: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
        annualCycleClosures,
      }),
    [origin.cycle, todayStr, entries, absences, companyCalendars, settings, faltas, user.controlStartDate, specialExcessUses, specialExcessPlans, annualCycleClosures],
  );

  const lot = bank.lots.find((l) => l.originDate === origin.originDate);
  const originAvailable = lot?.availableMinutes ?? 0;

  const destinos = useMemo<SpecialExcessDestinationCandidate[]>(
    () =>
      eligibleSpecialExcessDestinationsForOrigin({
        cycle: origin.cycle,
        asOfDate: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
        periodConsolidations,
        annualCycleClosures,
      }),
    [origin.cycle, todayStr, entries, absences, companyCalendars, settings, faltas, user.controlStartDate, specialExcessUses, specialExcessPlans, periodConsolidations, annualCycleClosures],
  );

  const [destDate, setDestDate] = useState<string | null>(null);
  const dest = destinos.find((d) => d.date === destDate) ?? null;
  const maxOp = dest ? maxDestinableMinutes(originAvailable, dest.remainingNeedMinutes) : 0;
  // 4H.2 — sugestão inicial = máximo da operação; a usuária pode reduzir
  // (destinação parcial). O campo trava no máximo (nada inválido é mantido).
  const [draft, setDraft] = useState<string | null>(null);
  const draftVal = draft === null ? maxOp : Math.floor(Number(draft) || 0);
  const minutes = Math.max(0, Math.min(maxOp, draftVal));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickDest = (date: string) => {
    setDestDate(date);
    setDraft(null);
    setError(null);
  };

  /* Preview — motor 3A com o MESMO insumo factual do destino (o factual
     NUNCA muda; apenas a projeção do ponto). Dependências apenas de
     valores memoizados/estado (padrão do modal canônico 3E). */
  const projection = useMemo(() => {
    if (minutes <= 0) return null;
    const d = destDate ? (destinos.find((x) => x.date === destDate) ?? null) : null;
    if (!d) return null;
    const row = buildResumoDayRow({
      date: d.date, today: todayStr, entries, absences, calendars: companyCalendars, settings, faltas, controlStartDate: user.controlStartDate,
    });
    const p = projectRealizedDayOfficial({
      date: d.date,
      factualWorkedMinutes: row.workedMinutes,
      factualRegistrableMinutes: row.registrableMinutes,
      factualRegularBalanceMinutes: row.balanceMinutes,
      effectiveBaseMinutes: row.requiredWorkMinutes,
      financialValid: isProjectableDayStatus(row.status),
      realized: (row.entryCount > 0 || row.calendarEventDay) && d.date <= todayStr,
      usedSpecialMinutes: d.usedActiveMinutes + minutes,
    });
    return {
      projectedWorkedMinutes: p.projectedWorkedMinutes,
      projectedBalanceMinutes: p.projectedBalanceMinutes,
      factualBalanceMinutes: row.balanceMinutes,
      factualWorkedMinutes: row.workedMinutes,
    };
  }, [destDate, destinos, minutes, todayStr, entries, absences, companyCalendars, settings, faltas, user.controlStartDate]);

  const confirm = async () => {
    if (busy || !dest || minutes < 1) return;
    setBusy(true);
    setError(null);
    try {
      // MESMO motor canônico do fluxo destino→origem: UM uso, UMA origem
      // (a fixa deste modal), UM destino, UMA quantidade (3D).
      const res = actions.createSpecialExcessUse({
        destinationDate: dest.date,
        minutes,
        allocationStrategy: "manual",
        manualAllocations: [{ originDate: origin.originDate, minutes }],
        asOfDate: todayStr,
      });
      if (!res.ok) {
        setError(translateDestineError(res.code, res.error));
        return;
      }
      toast.show(`${formatMinutes(minutes)} de [10+] destinados de ${formatDateShortBR(origin.originDate)} para ${formatDateShortBR(dest.date)}.`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Destinar horas [10+]"
      subtitle={`Origem: ${formatDateShortBR(origin.originDate)} · ciclo ${bank.cycle}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={confirm}
            loading={busy}
            disabled={minutes < 1 || dest === null || originAvailable <= 0}
            className="w-full !bg-violet-600 hover:!bg-violet-700 active:!bg-violet-800 sm:w-auto"
          >
            <Timer size={15} /> Destinar {minutes > 0 ? formatMinutes(minutes) : "horas"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Origem fixa (lote) — saldo canônico 3C */}
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-violet-900">
            <ArrowRightLeft size={13} aria-hidden className="text-violet-500" />
            <span>Origem {formatDateShortBR(origin.originDate)}</span>
            {origin.carried && (
              <Badge tone="sky">
                Trazido do ciclo {origin.originCycle ?? "anterior"}
              </Badge>
            )}
          </p>
          <p className="mt-1 text-sm font-extrabold tabular-nums text-violet-700">
            Disponível nesta origem: <span className="tabular-nums">{formatMinutes(originAvailable)}</span>
          </p>
          {origin.carried && (
            <p className="text-[11px] font-medium text-violet-600">
              Lastro transportado: <b className="tabular-nums">{formatMinutes(origin.carriedInMinutes ?? originAvailable)}</b> · não conta como “Gerado neste ciclo”
            </p>
          )}
        </div>

        {/* Destinos elegíveis (derivado 4H.2 — mais antigo → mais recente) */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Dias abaixo da base para receber estas horas
          </p>
          {originAvailable <= 0 ? (
            <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-xs font-medium text-slate-600">
              Esta origem não tem saldo [10+] disponível agora.
            </p>
          ) : destinos.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs font-semibold text-amber-800">
              Não há dias abaixo da base disponíveis para receber estas horas.
            </p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {destinos.map((d) => {
                const active = destDate === d.date;
                const rowMax = maxDestinableMinutes(originAvailable, d.remainingNeedMinutes);
                return (
                  <li key={d.date}>
                    <button
                      type="button"
                      onClick={() => pickDest(d.date)}
                      aria-pressed={active}
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                        active
                          ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="text-sm font-bold tabular-nums text-slate-900">{formatDateShortBR(d.date)}</span>
                        <span className="text-xs font-semibold text-slate-500">
                          Faltam <b className="tabular-nums text-slate-900">{formatMinutes(d.remainingNeedMinutes)}</b> para completar a base
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium text-slate-500">
                        Máximo nesta operação: <b className="tabular-nums text-slate-700">{formatMinutes(rowMax)}</b>
                        {d.remainingNeedMinutes > originAvailable && (
                          <span className="text-slate-400"> · você pode destinar até {formatMinutes(originAvailable)} desta origem</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Quantidade (editável; sugestão = máximo da operação) */}
        {dest && originAvailable > 0 && (
          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Quanto destinar para {formatDateShortBR(dest.date)}?
            </span>
            <div className="relative">
              <Input
                type="number"
                min={1}
                max={maxOp}
                inputMode="numeric"
                value={String(minutes)}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                aria-label="Minutos a destinar"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-bold text-slate-400">min</span>
            </div>
            <span className="mt-1 block text-xs text-slate-400">
              Máximo agora: {formatMinutes(maxOp)} (menor entre disponível da origem e falta do destino)
            </span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_OPTIONS.filter((m) => m <= maxOp).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setDraft(String(m));
                    setError(null);
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                    minutes === m
                      ? "bg-violet-600 text-white"
                      : "bg-violet-50 text-violet-700 hover:bg-violet-100"
                  }`}
                >
                  {formatMinutes(m)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Preview — factual inalterado; somente a projeção muda (motor 3A) */}
        {projection && dest && minutes > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Como ficará</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">Origem</dt>
                <dd className="font-bold tabular-nums text-slate-900">{formatDateShortBR(origin.originDate)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Disponível antes</dt>
                <dd className="font-bold tabular-nums text-slate-900">{formatMinutes(originAvailable)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Destino</dt>
                <dd className="font-bold tabular-nums text-slate-900">{formatDateShortBR(dest.date)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Necessidade antes</dt>
                <dd className="font-bold tabular-nums text-slate-900">{formatMinutes(dest.remainingNeedMinutes)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Usar</dt>
                <dd className="font-bold tabular-nums text-violet-700">{formatMinutes(minutes)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Disponível restante da origem</dt>
                <dd className="font-bold tabular-nums text-violet-700">{formatMinutes(originAvailable - minutes)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Jornada factual</dt>
                <dd className="font-bold tabular-nums text-slate-900">
                  {formatMinutes(projection.factualWorkedMinutes)}
                  <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">inalterada</span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Novo uso [10+]</dt>
                <dd className="font-bold tabular-nums text-violet-700">{formatMinutes(minutes)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Projeção no ponto</dt>
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

        {/* Explicação discreta (regra-mãe) */}
        <p className="text-[11px] leading-relaxed text-slate-500">
          Destinar não altera sua jornada real nem o saldo factual. As horas [10+] desta origem passam a
          completar a jornada do destino na projeção do ponto — o mesmo registro criado pelo fluxo
          “Completar jornada com [10+]”.
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
