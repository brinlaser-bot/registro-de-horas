"use client";

// Store client-side com persistência em localStorage.
// Uso pessoal: todos os dados ficam apenas no navegador.
import { useEffect, useState, useSyncExternalStore } from "react";
import { computeDay, type EntryType } from "./time";
import { buildSeedData, DEFAULT_USER } from "./seed-data";
import type {
  AppData,
  CompKind,
  CompStatus,
  Compensation,
  CompWithDays,
  DayResult,
  TimeEntry,
  User,
  WorkSettings,
} from "./types";

const STORAGE_KEY = "meu-horario:data:v1";

const pristine: AppData = {
  user: { ...DEFAULT_USER },
  entries: [],
  compensations: [],
};

let data: AppData = pristine;
let ready = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage indisponível (modo privado, cota cheia) — segue apenas em memória
  }
}

function load() {
  if (ready || typeof window === "undefined") return;
  ready = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppData;
      if (
        parsed &&
        parsed.user &&
        Array.isArray(parsed.entries) &&
        Array.isArray(parsed.compensations)
      ) {
        data = parsed;
        emit();
        return;
      }
    }
    // Primeiro acesso: popula com dados de exemplo
    data = buildSeedData();
    persist();
  } catch {
    data = pristine;
  }
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  load();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return data;
}

function getServerSnapshot() {
  return pristine;
}

function mutate(updater: (d: AppData) => AppData) {
  load();
  data = updater(data);
  persist();
  emit();
}

const nextId = (rows: { id: number }[]) =>
  rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;

export const actions = {
  addEntry(p: {
    date: string;
    time: string;
    type: EntryType;
    note: string | null;
    source?: "live" | "manual";
  }) {
    mutate((d) => ({
      ...d,
      entries: [
        ...d.entries,
        { id: nextId(d.entries), ...p, source: p.source ?? "live" },
      ],
    }));
  },

  updateEntry(id: number, patch: Partial<Pick<TimeEntry, "time" | "type" | "note">>) {
    mutate((d) => ({
      ...d,
      entries: d.entries.map((e) => (e.id === id ? { ...e, ...patch, edited: true } : e)),
    }));
  },

  deleteEntry(id: number) {
    mutate((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }));
  },

  addComp(p: {
    sourceDate: string;
    targetDate: string;
    minutes: number;
    note: string | null;
    status?: CompStatus;
    kind?: CompKind;
  }) {
    mutate((d) => ({
      ...d,
      compensations: [
        ...d.compensations,
        {
          id: nextId(d.compensations),
          sourceDate: p.sourceDate,
          targetDate: p.targetDate,
          minutes: p.minutes,
          status: p.status ?? "pendente",
          note: p.note,
          kind: p.kind ?? "excedente",
          createdAt: Date.now(),
        },
      ],
    }));
  },

  updateComp(id: number, patch: Partial<Omit<Compensation, "id">>) {
    mutate((d) => ({
      ...d,
      compensations: d.compensations.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  },

  completeComp(id: number) {
    actions.updateComp(id, { status: "concluida" });
  },

  deleteComp(id: number) {
    mutate((d) => ({ ...d, compensations: d.compensations.filter((c) => c.id !== id) }));
  },

  /**
   * Ajusta as compensações de um dia de origem para caberem na nova dívida
   * (após uma correção de registro). Preserva o histórico: reduz os minutos
   * (da mais recente para a mais antiga) e, quando sobra vinculação, cancela
   * em vez de apagar.
   */
  capCompensationsForSource(sourceDate: string, kind: CompKind, maxMinutes: number) {
    mutate((d) => {
      const linked = d.compensations
        .map((c, idx) => ({ c, idx }))
        .filter(
          ({ c }) =>
            c.sourceDate === sourceDate &&
            (c.kind ?? "excedente") === kind &&
            c.status !== "cancelada",
        )
        .sort((a, b) => b.c.createdAt - a.c.createdAt);

      let budget = Math.max(0, maxMinutes);
      const comps = [...d.compensations];

      for (const { c, idx } of linked) {
        if (budget <= 0) {
          comps[idx] = { ...c, status: "cancelada" };
          continue;
        }
        const keep = Math.min(c.minutes, budget);
        comps[idx] = keep > 0 ? { ...c, minutes: keep } : { ...c, status: "cancelada" };
        budget -= keep;
      }

      return { ...d, compensations: comps };
    });
  },

  updateUser(patch: Partial<User>) {
    mutate((d) => ({ ...d, user: { ...d.user, ...patch } }));
  },

  /** Substitui tudo pelos dados de exemplo. */
  reseed() {
    mutate(() => buildSeedData());
  },

  /** Apaga registros e compensações (mantém o perfil/jornada). */
  clearAll() {
    mutate((d) => ({ ...d, entries: [], compensations: [] }));
  },

  /** Substitui integralmente os dados pelos do backup. */
  replaceAll(p: { user: User; entries: TimeEntry[]; compensations: Compensation[] }) {
    mutate(() => ({ user: p.user, entries: p.entries, compensations: p.compensations }));
  },

  /** Mescla o backup com os dados atuais, evitando duplicação. */
  mergeBackup(p: { entries: TimeEntry[]; compensations: Compensation[] }) {
    mutate((d) => {
      const entryKeys = new Set(d.entries.map((e) => `${e.date}|${e.time}|${e.type}`));
      const compKeys = new Set(
        d.compensations.map((c) => `${c.sourceDate}|${c.targetDate}|${c.minutes}|${c.kind ?? "excedente"}`),
      );

      let entryCursor = d.entries.reduce((m, e) => Math.max(m, e.id), 0) + 1;
      let compCursor = d.compensations.reduce((m, c) => Math.max(m, c.id), 0) + 1;

      const newEntries: TimeEntry[] = [];
      for (const e of p.entries) {
        const key = `${e.date}|${e.time}|${e.type}`;
        if (entryKeys.has(key)) continue;
        entryKeys.add(key);
        newEntries.push({ ...e, id: entryCursor++ });
      }

      const newComps: Compensation[] = [];
      for (const c of p.compensations) {
        const key = `${c.sourceDate}|${c.targetDate}|${c.minutes}|${c.kind ?? "excedente"}`;
        if (compKeys.has(key)) continue;
        compKeys.add(key);
        newComps.push({ ...c, id: compCursor++, kind: c.kind ?? "excedente" });
      }

      return {
        ...d,
        entries: [...d.entries, ...newEntries],
        compensations: [...d.compensations, ...newComps],
      };
    });
  },
};

export function getAppData(): AppData {
  load();
  return data;
}

export function useAppData(): AppData {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** `true` após a hidratação (evita flash de estado vazio). */
export function useIsClient(): boolean {
  const [client, setClient] = useState(false);
  useEffect(() => setClient(true), []);
  return client;
}

export function settingsOf(u: User): WorkSettings {
  return {
    workStart: u.workStart,
    workEnd: u.workEnd,
    lunchStart: u.lunchStart,
    lunchEnd: u.lunchEnd,
    maxDailyMinutes: u.maxDailyMinutes,
    autoDeductLunch: u.autoDeductLunch,
  };
}

/** Enriquece uma compensação com o resumo dos dias de origem/destino. */
export function enrichComp(
  c: Compensation,
  entries: TimeEntry[],
  settings: WorkSettings,
): CompWithDays {
  const dayFor = (date: string): DayResult | null => {
    const list = entries.filter((e) => e.date === date);
    return list.length > 0 ? computeDay(list, settings) : null;
  };
  const src = dayFor(c.sourceDate);
  const tgt = dayFor(c.targetDate);
  return {
    ...c,
    sourceDay: src
      ? { workedMinutes: src.workedMinutes, excessMinutes: src.excessMinutes }
      : null,
    targetDay: tgt
      ? { workedMinutes: tgt.workedMinutes, balanceMinutes: tgt.balanceMinutes }
      : null,
  };
}

export function storageBytes(): number {
  if (typeof window === "undefined") return 0;
  try {
    return (window.localStorage.getItem(STORAGE_KEY) ?? "").length;
  } catch {
    return 0;
  }
}
