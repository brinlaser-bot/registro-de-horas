"use client";

/**
 * 4H — MODAL "ENCERRAR CICLO" (ação real e DEFINITIVA).
 *
 * A página da Central é somente-leitura (nunca chama `actions.`); este
 * componente é o ÚNICO ponto que executa o fechamento anual. Recebe a
 * elegibilidade/estado já calculado pela página (fontes canônicas puras
 * `checkCycleClose`/`computeClosingExcess`) e, na confirmação, chama
 * `actions.closeAnnualCycle` com a disposição escolhida.
 *
 * Regras do modal (§4H-2):
 *  · título "Encerrar ciclo {rótulo}" + intervalo 01/05 → 30/04;
 *  · mensagem fixa de irreversibilidade;
 *  · resumo: períodos consolidados, pendências e saldo final [10+];
 *  · saldo > 0 → EXIGE escolha exclusiva Liquidar | Transportar;
 *  · saldo = 0 → "Sem saldo [10+] a destinar." sem exigir escolha;
 *  · ação final "Encerrar ciclo" (definitiva).
 */
import { useState } from "react";
import { Lock } from "lucide-react";
import { actions } from "@/lib/store";
import { annualCycleBounds } from "@/lib/periods";
import { formatDateShortBR, formatMinutes } from "@/lib/time";
import { Badge, Button, Modal } from "@/components/ui";

export interface CloseCyclePreview {
  cycleLabel: string;
  eligible: boolean;
  blockers: string[];
  closingMinutes: number;
  consolidados: number;
  pendencias: number;
}

export function CloseCycleButton({ preview }: { preview: CloseCyclePreview }) {
  const [open, setOpen] = useState(false);
  const [disposition, setDisposition] = useState<"liquidated" | "carried" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!preview.eligible) return null;

  const bounds = annualCycleBounds(preview.cycleLabel);
  const saldo = preview.closingMinutes;
  const precisaEscolha = saldo > 0;
  const podeConfirmar = precisaEscolha ? disposition !== null : true;

  const confirmar = () => {
    if (!podeConfirmar) return;
    setBusy(true);
    const r = actions.closeAnnualCycle({
      cycleLabel: preview.cycleLabel,
      disposition: precisaEscolha ? (disposition ?? "liquidated") : "none",
    });
    setBusy(false);
    setOpen(false);
    setDisposition(null);
    if (!r.ok) {
      // superfície: se o store recusar (ex.: mudou desde o preview), abre novo ciclo de leitura
      alert(r.error ?? "Não foi possível encerrar o ciclo.");
      return;
    }
  };

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        <Lock size={14} aria-hidden /> Encerrar ciclo
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Encerrar ciclo ${preview.cycleLabel}`}
        subtitle={`${formatDateShortBR(bounds.from)} → ${formatDateShortBR(bounds.to)}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="danger" loading={busy} disabled={!podeConfirmar} onClick={confirmar}>
              Encerrar ciclo
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-700">
          <p className="font-medium text-slate-800">
            Confira os dados antes de encerrar o ciclo.
          </p>
          <p className="text-xs text-slate-600">
            Após o encerramento, os registros deste ciclo ficarão protegidos e os períodos não poderão mais ser reabertos.
          </p>

          {/* Resumo */}
          <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div>
              <dt className="font-semibold text-slate-400">Períodos consolidados</dt>
              <dd className="text-base font-extrabold tabular-nums">{preview.consolidados}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-400">Pendências</dt>
              <dd className="text-base font-extrabold tabular-nums">{preview.pendencias}</dd>
            </div>
            <div className="col-span-2">
              <dt className="font-semibold text-slate-400">Saldo final [10+]</dt>
              <dd className="text-base font-extrabold tabular-nums text-indigo-600">{formatMinutes(saldo)}</dd>
            </div>
          </dl>

          {precisaEscolha ? (
            <fieldset className="space-y-2">
              <legend className="text-xs font-bold text-slate-600">
                Há saldo [10+] a destinar — escolha uma opção:
              </legend>
              <label
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold cursor-pointer ${
                  disposition === "liquidated" ? "border-rose-300 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                <input type="radio" name="disposition" checked={disposition === "liquidated"} onChange={() => setDisposition("liquidated")} className="accent-rose-600" />
                <span>Liquidar saldo [10+]</span>
                <span className="ml-auto text-xs font-medium text-slate-500">não reutiliza no próximo ciclo</span>
              </label>
              <label
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold cursor-pointer ${
                  disposition === "carried" ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                <input type="radio" name="disposition" checked={disposition === "carried"} onChange={() => setDisposition("carried")} className="accent-indigo-600" />
                <span>Transportar para o próximo ciclo</span>
                <span className="ml-auto text-xs font-medium text-slate-500">fica Disponível no ciclo seguinte</span>
              </label>
              {!disposition && (
                <p className="text-[11px] font-semibold text-rose-600">Selecione Liquidar ou Transportar para habilitar a confirmação.</p>
              )}
            </fieldset>
          ) : (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
              Sem saldo [10+] a destinar. <Badge tone="emerald">Sem escolha necessária</Badge>
            </p>
          )}

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
            Esta operação é definitiva: não existe reabrir um ciclo anual encerrado.
          </p>
        </div>
      </Modal>
    </>
  );
}
