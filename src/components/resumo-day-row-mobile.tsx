"use client";

/**
 * Detalhamento diário — item MOBILE do Resumo do período (Etapa 3F.1).
 *
 * APRESENTAÇÃO SOMENTE: consome exatamente a MESMA derivação da 3F
 * (ResumoDetailRow de resumo-period-view) usada pela tabela desktop, cards
 * do Resumo e CSV. Nenhum cálculo paralelo vive aqui.
 *
 * Cada dia financeiramente relevante (ou com registro pendente) é um item
 * RECOLHÍVEL: padrão FECHADO, múltiplos dias podem ficar abertos ao mesmo
 * tempo, estado local da página (Set<string>) — sem persistência. Dias
 * simples (folga/feriado/sem registro/futuro) permanecem linhas compactas,
 * sem expansão.
 */
import { ChevronDown } from "lucide-react";
import { formatMinutes, weekdayShort } from "@/lib/time";
import { resumoEventKind, resumoFinancialFrozen, type ResumoDayRow } from "@/lib/resumo-days";
import { resumoDayPending, resumoProjectionVisible, type ResumoDetailRow } from "@/lib/resumo-period-view";
import { Badge } from "@/components/ui";

/** +30min / -1h30 / 0min — convenção de sinal do Resumo. */
export function fmtSigned(v: number): string {
  return `${v > 0 ? "+" : ""}${formatMinutes(v)}`;
}

/**
 * Toggle imutável da expansão local: abre um dia sem afetar os demais
 * (permite múltiplos dias abertos; fecha ao tocar de novo).
 */
export function toggleDayOpen(openDays: Set<string>, date: string): Set<string> {
  const next = new Set(openDays);
  if (next.has(date)) next.delete(date);
  else next.add(date);
  return next;
}

/** Badge de situação do dia — MESMO componente da tabela desktop. */
export function ResumoEventBadge({ day }: { day: ResumoDayRow }) {
  const kind = resumoEventKind(day);
  if (kind === "—") return <span className="text-xs text-slate-300">—</span>;
  const tone =
    kind === "Sem registro" || kind === "Registro inconsistente" || kind === "Registro incompleto"
      ? "amber"
      : kind === "Jornada abaixo do previsto"
        ? "rose"
        : kind === "Acima do limite [10+]"
          ? "violet"
          : kind === "Folga"
            ? "sky"
            : kind === "Ok"
              ? "emerald"
              : kind === "Em andamento"
                ? "indigo"
                : kind === "Falta"
                  ? "rose"
                  : "sky";
  return <Badge tone={tone}>{kind}</Badge>;
}

/**
 * Item recolhível por dia (mobile < md).
 * - Recolhido: dia + badge + números principais compactos (trabalhado,
 *   saldo) + chips [10+] gerado/usado quando existirem + chevron.
 * - Expandido: grid 2 colunas com os mesmos campos da derivação (sem campos
 *   vazios quando não agregam informação).
 * - Dia pendente (incompleto/inconsistente): recolhido mostra "Pendente";
 *   expandido mostra apenas a mensagem — nunca valores financeiros.
 * - Dia simples (folga/feriado/sem registro/futuro): linha compacta fixa,
 *   sem expansão.
 */
export function ResumoDayRowMobile({ row, open, onToggle }: {
  row: ResumoDetailRow;
  open: boolean;
  onToggle: () => void;
}) {
  const d = row.day;
  const pending = resumoDayPending(row);
  const frozen = resumoFinancialFrozen(d);
  const expandable = !frozen || pending;
  const showProj = resumoProjectionVisible(row);
  const detailId = `dia-mobile-${d.date}`;

  if (!expandable) {
    // Linha compacta: sem grid financeiro, sem expansão (folga/feriado/
    // sem registro/futuro/idle) — a lista continua leve até o fim do período.
    return (
      <li>
        <div className="flex flex-wrap items-center gap-2 px-1 py-2.5">
          <MobileDayDate date={d.date} />
          <ResumoEventBadge day={d} />
        </div>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
        className="flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-1 py-2.5 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <MobileDayDate date={d.date} />
          <ResumoEventBadge day={d} />
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {pending ? (
            <span className="text-xs font-bold text-amber-700">Pendente</span>
          ) : (
            <>
              {row.specialGenerated > 0 && (
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-violet-700 ring-1 ring-violet-200">
                  [10+] +{formatMinutes(row.specialGenerated)}
                </span>
              )}
              {row.specialUsed > 0 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-600 ring-1 ring-slate-200">
                  [10+] usado {formatMinutes(row.specialUsed)}
                </span>
              )}
              <span className="text-sm font-extrabold tabular-nums text-slate-900">
                {formatMinutes(d.workedMinutes)}
              </span>
              <span
                className={`text-sm font-extrabold tabular-nums ${
                  d.balanceMinutes > 0
                    ? "text-emerald-600"
                    : d.balanceMinutes < 0
                      ? "text-rose-600"
                      : "text-slate-500"
                }`}
              >
                {fmtSigned(d.balanceMinutes)}
              </span>
            </>
          )}
          <ChevronDown
            size={14}
            className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>
      {open && (
        <div id={detailId} className="px-1 pb-3">
          {pending ? (
            <p className="text-xs text-slate-500">
              Registro pendente. Os valores financeiros serão definidos após a correção.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <DetailField
                label="Trabalhado"
                value={d.workedMinutes > 0 ? formatMinutes(d.workedMinutes) : "—"}
              />
              <DetailField label="Jornada" value={formatMinutes(d.expectedMinutes)} className="text-slate-500" />
              <DetailField
                label="Saldo regular"
                value={fmtSigned(d.balanceMinutes)}
                className={
                  d.balanceMinutes > 0
                    ? "text-emerald-600"
                    : d.balanceMinutes < 0
                      ? "text-rose-600"
                      : "text-slate-500"
                }
              />
              <DetailField label="No ponto" value={formatMinutes(d.registrableMinutes)} className="text-indigo-600" />
              {row.specialGenerated > 0 && (
                <DetailField
                  label="[10+] gerado"
                  value={`+${formatMinutes(row.specialGenerated)}`}
                  className="text-violet-600"
                />
              )}
              {row.specialUsed > 0 && (
                <DetailField label="[10+] usado" value={formatMinutes(row.specialUsed)} />
              )}
              {showProj && (
                <DetailField
                  label="Projeção"
                  value={`${formatMinutes(row.projection.projectedWorkedMinutes)} / ${fmtSigned(row.projection.projectedBalanceMinutes)}`}
                  className="text-indigo-600"
                />
              )}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

function MobileDayDate({ date }: { date: string }) {
  return (
    <span className="text-sm font-bold text-slate-800">
      {weekdayShort(date).replace(".", "")}
      <span className="ml-1.5 font-medium text-slate-400">
        {date.slice(8)}/{date.slice(5, 7)}
      </span>
    </span>
  );
}

/** Campo label+valor do layout expandido (texto explícito — não depende de cor). */
function DetailField({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
      <dd className={`text-sm font-extrabold tabular-nums leading-snug ${className ?? "text-slate-800"}`}>{value}</dd>
    </div>
  );
}
