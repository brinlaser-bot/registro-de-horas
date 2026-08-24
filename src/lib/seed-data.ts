// Gera o conjunto de dados de exemplo no primeiro acesso (localStorage vazio)
import { addDays, isWeekend, nextWorkday, todayString } from "./time";
import type { AppData, Compensation, TimeEntry, User } from "./types";

export const DEFAULT_USER: User = {
  id: 1,
  name: "Alex Santos",
  email: "voce@exemplo.com",
  workStart: "08:00",
  workEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  maxDailyMinutes: 600,
  autoDeductLunch: true,
  birthDate: null,
};

type Pattern = Array<[string, "entrada" | "saida"]>;

/** Padrões de dia (do mais recente para o mais antigo), pulando fins de semana. */
const PATTERNS: Pattern[] = [
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:00", "saida"]],
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["19:45", "saida"]], // 10h45 — excedente 45min
  [["08:02", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:00", "saida"]],
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["20:30", "saida"]], // 11h30 — excedente 1h30
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["15:30", "saida"]], // 6h30 — dia de compensação
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:00", "saida"]],
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:00", "saida"]],
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:30", "saida"]], // 8h30
  [["07:45", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["16:45", "saida"]], // 8h
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["19:15", "saida"]], // 10h15 — excedente 15min
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["16:45", "saida"]], // 7h45
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:00", "saida"]],
  [["08:10", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:20", "saida"]], // 8h10
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:00", "saida"]],
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["16:30", "saida"]], // 7h30
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:00", "saida"]],
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["18:45", "saida"]], // 9h45
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:00", "saida"]],
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:00", "saida"]],
  [["08:00", "entrada"], ["12:00", "saida"], ["13:00", "entrada"], ["17:00", "saida"]],
];

export function buildSeedData(): AppData {
  const today = todayString();
  const days: string[] = [];
  let offset = 1;
  for (let i = 0; i < PATTERNS.length; i++) {
    let date = addDays(today, -offset);
    while (isWeekend(date)) {
      offset += 1;
      date = addDays(today, -offset);
    }
    days.push(date);
    offset += 1;
  }

  const entries: TimeEntry[] = [];
  let id = 1;
  days.forEach((date, i) => {
    const pattern = PATTERNS[i];
    pattern.forEach(([time, type], j) => {
      const note =
        i === 1 && j === 3
          ? "Fechamento de projeto — excedeu o limite"
          : i === 3 && j === 3
            ? "Dia longo, compensar amanhã"
            : i === 9
              ? "Home office"
              : null;
      entries.push({ id: id++, date, time, type, note });
    });
  });

  const dayOf = (n: number) => days[n] ?? today;
  const pendingTarget = isWeekend(today) ? nextWorkday(today) : today;
  const now = Date.now();

  const compensations: Compensation[] = [
    {
      id: 1,
      sourceDate: dayOf(3), // 11h30 → excedente 1h30
      targetDate: dayOf(4), // compensado no dia seguinte (6h30)
      minutes: 90,
      status: "concluida",
      note: "Compensação do dia com 11h30 de trabalho.",
      createdAt: now - 86_400_000 * 3,
    },
    {
      id: 2,
      sourceDate: dayOf(9), // 10h15 → excedente 15min
      targetDate: dayOf(10), // saiu 15min mais cedo
      minutes: 15,
      status: "concluida",
      note: "Saída 15min antes do horário.",
      createdAt: now - 86_400_000 * 8,
    },
    {
      id: 3,
      sourceDate: dayOf(1), // 10h45 → excedente 45min
      targetDate: pendingTarget,
      minutes: 45,
      status: "pendente",
      note: "Planejo sair mais cedo para compensar.",
      createdAt: now,
    },
  ];

  return {
    user: { ...DEFAULT_USER },
    entries,
    compensations,
    absences: [],
    companyCalendars: undefined,
    faltas: [], // nunca semear faltas: falta é sempre registro explícito do usuário
  };
}
