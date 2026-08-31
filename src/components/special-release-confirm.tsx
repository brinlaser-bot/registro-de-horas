"use client";

// ─────────────────────────────────────────────────────────────
// ETAPA 3G — CONFIRMAÇÃO CONTEXTUAL DA LIBERAÇÃO DE [10+].
//
// Gate de UI CENTRAL: quando um action de batida (adicionar/editar/
// excluir) detecta que a alteração factual reduziria o uso ativo de
// [10+] do dia (plano 3G do store), a operação NÃO é persistida e o
// resultado volta com code "special-release-required". Este provider
// intercepta esse resultado UMA VEZ para todo o app, mostra a
// confirmação humana (§6/§29) e só então re-invoca o MESMO action com
// `specialReleaseConfirmed: true` (aplicação coesa no store, §8).
//
// "Voltar" → NADA muda: a 1ª chamada já não alterou estado; o caller
// recebe code "special-release-cancelled" (silencioso, sem toast).
//
// Linguagem da interface: curta e humana — nada de reconciliation/
// allocation/FIFO (§29).
// ─────────────────────────────────────────────────────────────
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { actions, type ActionResult } from "@/lib/store";
import type { SpecialReconciliationPlan } from "@/lib/special-excess-reconciliation";
import { formatMinutes, formatDateBR, weekdayShort } from "@/lib/time";
import { Badge, Button, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";

type AddEntryParams = Parameters<typeof actions.addEntry>[0];
type AddEntriesParams = Parameters<typeof actions.addEntries>[0];
type UpdateEntryPatch = Parameters<typeof actions.updateEntry>[1];

/** Resultado devolvido ao caller quando o usuário escolhe "Voltar". */
const CANCELLED: ActionResult = { ok: false, code: "special-release-cancelled" };

interface PendingRelease {
  plans: SpecialReconciliationPlan[];
  retry: (confirmed: boolean) => ActionResult;
}

interface PunchActionsApi {
  addEntry: (p: AddEntryParams) => Promise<ActionResult>;
  addEntries: (list: AddEntriesParams) => Promise<ActionResult>;
  updateEntry: (id: number, patch: UpdateEntryPatch) => Promise<ActionResult>;
  deleteEntry: (id: number) => Promise<ActionResult>;
}

interface SpecialReleaseApi extends PunchActionsApi {
  /** Abre a confirmação; resolve a promessa do caller com o resultado. */
  confirmRelease: (
    plans: SpecialReconciliationPlan[],
    retry: (confirmed: boolean) => ActionResult,
    resolve: (res: ActionResult) => void,
  ) => void;
}

const SpecialReleaseContext = createContext<SpecialReleaseApi>({
  addEntry: async () => CANCELLED,
  addEntries: async () => CANCELLED,
  updateEntry: async () => CANCELLED,
  deleteEntry: async () => CANCELLED,
  confirmRelease: () => {},
});

export function SpecialReleaseProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingRelease | null>(null);
  const toast = useToast();
  const resolver = useRef<((res: ActionResult) => void) | null>(null);

  const confirmRelease = useCallback(
    (
      plans: SpecialReconciliationPlan[],
      retry: (confirmed: boolean) => ActionResult,
      resolve: (res: ActionResult) => void,
    ) => {
      resolver.current = resolve;
      setPending({ plans, retry });
    },
    [],
  );

  /** "Voltar" → cancelled (nada mudou); "Continuar" → aplicação coesa. */
  const decide = useCallback(
    (confirmed: boolean) => {
      const resolve = resolver.current;
      const current = pending;
      resolver.current = null;
      setPending(null);
      if (!resolve) return;
      resolve(confirmed && current ? current.retry(true) : CANCELLED);
    },
    [pending],
  );

  /** Executa o action; se o store pedir liberação, abre a confirmação. */
  const run = useCallback(
    (
      attempt: () => ActionResult,
      retryWith: (confirmed: boolean) => ActionResult,
      resolve: (res: ActionResult) => void,
    ) => {
      let res: ActionResult;
      try {
        res = attempt();
      } catch {
        resolve({ ok: false, code: "invalid", error: "Não foi possível salvar." });
        return;
      }
      if (res.ok || res.code !== "special-release-required" || !res.specialReleases?.length) {
        // 3G.4: ajuste automático de origem [10+] → feedback curto (§10).
        if (res.ok && res.warning) toast.show(res.warning, "info");
        resolve(res);
        return;
      }
      confirmRelease(res.specialReleases, retryWith, resolve);
    },
    [confirmRelease, toast],
  );

  const api = useMemo<SpecialReleaseApi>(
    () => ({
      confirmRelease,
      addEntry: (p) =>
        new Promise((resolve) =>
          run(
            () => actions.addEntry(p),
            (confirmed) => actions.addEntry(p, { specialReleaseConfirmed: confirmed }),
            resolve,
          ),
        ),
      addEntries: (list) =>
        new Promise((resolve) =>
          run(
            () => actions.addEntries(list),
            (confirmed) => actions.addEntries(list, { specialReleaseConfirmed: confirmed }),
            resolve,
          ),
        ),
      updateEntry: (id, patch) =>
        new Promise((resolve) =>
          run(
            () => actions.updateEntry(id, patch),
            (confirmed) => actions.updateEntry(id, patch, { specialReleaseConfirmed: confirmed }),
            resolve,
          ),
        ),
      deleteEntry: (id) =>
        new Promise((resolve) =>
          run(
            () => actions.deleteEntry(id),
            (confirmed) => actions.deleteEntry(id, { specialReleaseConfirmed: confirmed }),
            resolve,
          ),
        ),
    }),
    [confirmRelease, run],
  );

  return (
    <SpecialReleaseContext.Provider value={api}>
      {children}
      <SpecialReleaseDialog pending={pending} onDecide={decide} />
    </SpecialReleaseContext.Provider>
  );
}

/**
 * Actions de batida COM a confirmação 3G — mesmas assinaturas dos actions
 * do store, porém assíncronos: quando o store pede liberação de [10+],
 * a promessa só resolve depois da decisão do usuário.
 * Callers devem tratar `code === "special-release-cancelled"` como
 * operação abortada SEM toast (o diálogo já é o feedback).
 */
export function useSpecialPunchActions(): PunchActionsApi {
  const { addEntry, addEntries, updateEntry, deleteEntry } = useContext(SpecialReleaseContext);
  return useMemo(() => ({ addEntry, addEntries, updateEntry, deleteEntry }), [addEntry, addEntries, updateEntry, deleteEntry]);
}

/* ── Diálogo (§6/§29) ───────────────────────────────────────── */

function ReleaseLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className={`text-sm font-extrabold tabular-nums ${tone ?? "text-slate-900"}`}>{value}</span>
    </div>
  );
}

function SpecialReleaseDialog({
  pending,
  onDecide,
}: {
  pending: PendingRelease | null;
  onDecide: (confirmed: boolean) => void;
}) {
  if (!pending) return null;
  const plans = pending.plans;
  const single = plans.length === 1;
  return (
    <Modal
      open
      onClose={() => onDecide(false)}
      title="Alteração da jornada"
      subtitle={single ? formatDateBR(plans[0].destinationDate) : `${plans.length} dias com uso de [10+] afetados`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => onDecide(false)}>
            Voltar
          </Button>
          <Button onClick={() => onDecide(true)}>Continuar e ajustar [10+]</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {plans.map((plan) => {
          const dia = `${weekdayShort(plan.destinationDate).replace(".", "")} ${formatDateBR(plan.destinationDate)}`;
          const completa = plan.neededMinutesAfter === 0;
          return (
            <div key={plan.destinationDate} className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              {!single && <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">{dia}</p>}
              <div className="space-y-1.5">
                <ReleaseLine label="Nova jornada" value={formatMinutes(plan.prospectiveWorkedMinutes)} />
                <ReleaseLine label="[10+] utilizado atualmente" value={formatMinutes(plan.activeUsedMinutesBefore)} />
                <ReleaseLine
                  label="[10+] necessário após a alteração"
                  value={plan.neededMinutesAfter === null ? "—" : formatMinutes(plan.neededMinutesAfter)}
                />
                <ReleaseLine label="Voltará ao banco" value={formatMinutes(plan.releaseMinutes)} tone="text-violet-700" />
              </div>
              <p className="mt-3 text-sm font-medium leading-relaxed text-slate-700">
                {completa ? (
                  <>
                    Esta alteração completa a jornada de {dia}. O uso de{" "}
                    <b>{formatMinutes(plan.activeUsedMinutesBefore)}</b> de <Badge tone="violet">[10+]</Badge> não
                    será mais necessário e voltará ao saldo disponível. A jornada real ficará em{" "}
                    <b>{formatMinutes(plan.prospectiveWorkedMinutes)}</b>.
                  </>
                ) : (
                  <>
                    Após esta alteração, o dia {dia} precisará de apenas{" "}
                    <b>{formatMinutes(plan.neededMinutesAfter ?? 0)}</b> de <Badge tone="violet">[10+]</Badge>:{" "}
                    {formatMinutes(plan.allowedUsedMinutesAfter)} continuarão utilizados e{" "}
                    <b>{formatMinutes(plan.releaseMinutes)}</b> voltarão ao saldo disponível.
                  </>
                )}
              </p>
            </div>
          );
        })}
        <p className="text-xs text-slate-500">
          Ao continuar, a alteração das batidas e o ajuste do [10+] são salvos juntos. Ao voltar, nada é alterado.
        </p>
      </div>
    </Modal>
  );
}
