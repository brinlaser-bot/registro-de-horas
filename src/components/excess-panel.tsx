"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Sparkles,
  TriangleAlert,
  TrendingDown,
  Zap,
} from "lucide-react";
import {
  buildDebtDays,
  openDebtFor,
  suggestTargets,
  totalsOf,
} from "@/lib/debt";
import { formatDateShortBR, formatMinutes, todayString, weekdayShort } from "@/lib/time";
import type { Compensation, TimeEntry, WorkSettings } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ProgressBar, StatCard } from "@/components/ui";
import { CompensationForm, type CompFormData } from "@/components/compensation-form";

interface Props {
  entries: TimeEntry[];
  compensations: Compensation[];
  settings: WorkSettings;
  range: { from: string; to: string };
  monthLabel: string;
  onCreateComp: (payload: CompFormData & { kind?: "excedente" | "deficit" }) => Promise<void>;
}

export function ExcessPanel({
  entries,
  compensations,
  settings,
  range,
  monthLabel,
  onCreateComp,
}: Props) {
  const today = todayString();
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<(CompFormData & { kind?: "excedente" | "deficit" }) | undefined>();

  const { excessDays, deficitDays, excessTotals, deficitTotals } = useMemo(() => {
    const all = buildDebtDays(entries, compensations, settings, range);
    const ex = all.filter((d) => d.kind === "excedente");
    const df = all.filter((d) => d.kind === "deficit");
    return {
      excessDays: ex.reverse(),
      deficitDays: df.reverse(),
      excessTotals: totalsOf(ex),
      deficitTotals: totalsOf(df),
    };
  }, [entries, compensations, settings, range]);

  const openFor = (date: string, kind: "excedente" | "deficit") => {
    const minutes = openDebtFor(entries, compensations, settings, date, kind);
    const suggestions = suggestTargets(entries, compensations, settings, date, today);
    const target = suggestions[0]?.date ?? today;
    setDraft({
      kind,
      sourceDate: date,
      targetDate: target,
      minutes: minutes > 0 ? minutes : 30,
      note: kind === "excedente" ? `Compensação do dia ${formatDateShortBR(date)}` : "",
    });
    setModalOpen(true);
  };

  const excessOpen = excessDays.filter((d) => d.remainingMinutes > 0 || d.pendingMinutes > 0);
  const deficitOpen = deficitDays.filter((d) => d.remainingMinutes > 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Excedente do mês"
          value={formatMinutes(excessTotals.debtTotal)}
          sub={`acima de ${formatMinutes(settings.maxDailyMinutes)}/dia · ${monthLabel}`}
          tone={excessTotals.debtTotal > 0 ? "rose" : "slate"}
          icon={<TriangleAlert size={16} />}
        />
        <StatCard
          label="Já compensado"
          value={formatMinutes(excessTotals.concluded)}
          sub={`${Math.round(excessTotals.percent)}% do excedente quitado`}
          tone="emerald"
          icon={<CheckCircle2 size={16} />}
        />
        <StatCard
          label="Ainda a compensar"
          value={formatMinutes(excessTotals.remaining)}
          sub={`${excessOpen.length} dia(s) com excedente em aberto`}
          tone={excessTotals.remaining > 0 ? "amber" : "slate"}
          icon={<ArrowLeftRight size={16} />}
        />
        <StatCard
          label="Déficit do mês"
          value={formatMinutes(deficitTotals.debtTotal)}
          sub={`abaixo da base · ${formatMinutes(deficitTotals.remaining)} em aberto`}
          tone={deficitTotals.remaining > 0 ? "indigo" : "slate"}
          icon={<TrendingDown size={16} />}
        />
      </div>

      {/* Barra de progresso */}
      <Card title="Progresso de compensação de excedentes" subtitle={`${monthLabel} · excedente vs. compensado`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700">
            <b className="text-emerald-600">{formatMinutes(excessTotals.concluded)}</b> compensados
            {excessTotals.pending > 0 && (
              <>
                {" · "}
                <b className="text-amber-600">{formatMinutes(excessTotals.pending)}</b> planejados
              </>
            )}
            {" · "}
            <b className="text-slate-500">{formatMinutes(excessTotals.remaining)}</b> restantes
          </p>
          <p className="text-xs font-bold text-slate-400">
            total {formatMinutes(excessTotals.debtTotal)}
          </p>
        </div>
        <div className="mt-2">
          <ProgressBar
            concluded={excessTotals.concluded}
            pending={excessTotals.pending}
            total={excessTotals.debtTotal}
          />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Dias com excedente pendente */}
        <Card
          title="Dias com excedente pendente"
          subtitle="Acima do limite — origem da dívida de horas"
        >
          {excessOpen.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={24} />}
              title="Nenhum excedente em aberto"
              description="Todos os dias que passaram do limite já foram totalmente compensados. 🎉"
            />
          ) : (
            <ul className="space-y-3">
              {excessOpen.map((d) => (
                <li key={d.date} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-900">
                      {weekdayShort(d.date).replace(".", "")}
                      <span className="ml-1.5 font-medium text-slate-400">
                        {formatDateShortBR(d.date)}
                      </span>
                    </span>
                    <Badge tone="rose">
                      excedente {formatMinutes(d.debtMinutes)}
                    </Badge>
                    {d.remainingMinutes > 0 ? (
                      <Badge tone="amber">restam {formatMinutes(d.remainingMinutes)}</Badge>
                    ) : (
                      <Badge tone="sky">{formatMinutes(d.pendingMinutes)} planejado</Badge>
                    )}
                    <div className="ml-auto">
                      <Button size="sm" variant="danger" onClick={() => openFor(d.date, "excedente")}>
                        <ArrowLeftRight size={13} /> Compensar agora
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {formatMinutes(d.workedMinutes)} trabalhados ·{" "}
                    {formatMinutes(d.allocatedMinutes)} alocados ·{" "}
                    {formatMinutes(d.concludedMinutes)} concluídos
                  </p>
                  <div className="mt-2">
                    <ProgressBar
                      concluded={d.concludedMinutes}
                      pending={d.pendingMinutes}
                      total={d.debtMinutes}
                      height={6}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Dias com déficit (dívida) */}
        <Card
          title="Dias com saldo negativo"
          subtitle="Abaixo da base — podem ser quitados com hora extra (até 10h)"
        >
          {deficitOpen.length === 0 ? (
            <EmptyState
              icon={<TrendingDown size={24} />}
              title="Nenhum déficit em aberto"
              description="Todos os dias abaixo da base já foram compensados com hora extra."
            />
          ) : (
            <ul className="space-y-3">
              {deficitOpen.map((d) => (
                <li key={d.date} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-900">
                      {weekdayShort(d.date).replace(".", "")}
                      <span className="ml-1.5 font-medium text-slate-400">
                        {formatDateShortBR(d.date)}
                      </span>
                    </span>
                    <Badge tone="indigo">déficit {formatMinutes(d.debtMinutes)}</Badge>
                    <Badge tone="amber">restam {formatMinutes(d.remainingMinutes)}</Badge>
                    <div className="ml-auto">
                      <Button size="sm" variant="subtle" onClick={() => openFor(d.date, "deficit")}>
                        <Zap size={13} /> Quitar com hora extra
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {formatMinutes(d.workedMinutes)} trabalhados de {formatMinutes(d.expectedMinutes)}{" "}
                    · {formatMinutes(d.allocatedMinutes)} alocados
                  </p>
                  <div className="mt-2">
                    <ProgressBar
                      concluded={d.concludedMinutes}
                      pending={d.pendingMinutes}
                      total={d.debtMinutes}
                      height={6}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CompensationForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={draft}
        kind={draft?.kind ?? "excedente"}
        suggestions={
          draft
            ? suggestTargets(entries, compensations, settings, draft.sourceDate, today)
            : []
        }
        onSave={async (payload) => {
          await onCreateComp({ ...payload, kind: draft?.kind ?? "excedente" });
          setModalOpen(false);
        }}
        smartHint={
          draft ? (
            <span className="inline-flex items-center gap-1.5">
              <Sparkles size={12} /> Sugestão inteligente: dias com saldo negativo, do mais recente
              para o mais antigo
            </span>
          ) : undefined
        }
      />
    </>
  );
}
