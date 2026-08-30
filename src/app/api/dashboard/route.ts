import { NextRequest, NextResponse } from "next/server";
import { enrichCompensations } from "@/lib/compensations";
import { companyDayContext } from "@/lib/company-calendar";
import { getAppData, settingsOf } from "@/lib/store";
import {
  addDays,
  computeDay,
  monthBounds,
  monthKey,
  nowMinutesLocal,
  todayString,
} from "@/lib/time";
import type { TimeEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const data = getAppData();
  const settings = settingsOf(data.user);

  const { searchParams } = req.nextUrl;
  const month = searchParams.get("month") ?? monthKey(todayString());
  const bounds = monthBounds(month);
  const today = todayString();
  const recentFrom = addDays(today, -13);

  const monthRows = data.entries.filter((entry) => entry.date >= bounds.from && entry.date <= bounds.to);
  const recentRows = data.entries.filter((entry) => entry.date >= recentFrom && entry.date <= today);
  const pendingRows = data.compensations.filter((comp) => comp.status === "pendente");

  const byDate = new Map<string, typeof monthRows>();
  for (const row of monthRows) {
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  }

  // Saldo regular SEMPRE pela resolução central (dayContext/companyDayContext):
  // no ponto (min(worked, limite)) − base efetiva. O [10+] não entra no saldo.
  const centralDay = (date: string, entries: TimeEntry[]) => {
    const result = computeDay(entries, settings);
    const cctx = companyDayContext(date, entries, data.absences, data.companyCalendars, settings);
    return {
      date,
      workedMinutes: result.workedMinutes,
      expectedMinutes: cctx.effectiveExpected,
      balanceMinutes: cctx.adjustedBalance,
      excessMinutes: result.excessMinutes,
      registrableMinutes: result.registrableMinutes,
      status: result.status,
      open: result.open,
      entryCount: result.entries.length,
    };
  };

  const monthDays = [...byDate.entries()]
    .map(([date, entries]) => centralDay(date, entries))
    .sort((a, b) => a.date.localeCompare(b.date));

  const todayResult = computeDay(byDate.get(today) ?? [], settings, nowMinutesLocal());
  const todayCentral = companyDayContext(today, byDate.get(today) ?? [], data.absences, data.companyCalendars, settings);

  const recentByDate = new Map<string, typeof recentRows>();
  for (const row of recentRows) {
    recentByDate.set(row.date, [...(recentByDate.get(row.date) ?? []), row]);
  }

  const recent = [];
  for (let i = 13; i >= 0; i--) {
    const date = addDays(today, -i);
    recent.push(centralDay(date, recentByDate.get(date) ?? []));
  }

  const monthTotals = monthDays.reduce(
    (acc, day) => {
      acc.trackedDays += 1;
      acc.workedTotal += day.workedMinutes;
      acc.registrableTotal += day.registrableMinutes;
      acc.balanceTotal += day.balanceMinutes;
      acc.excessTotal += day.excessMinutes;
      return acc;
    },
    { trackedDays: 0, workedTotal: 0, registrableTotal: 0, balanceTotal: 0, excessTotal: 0 },
  );

  const pending = enrichCompensations(pendingRows, data.entries, settings);

  return NextResponse.json({
    month,
    today: { ...todayResult, expectedMinutes: todayCentral.effectiveExpected, balanceMinutes: todayCentral.adjustedBalance },
    todayStr: today,
    monthDays,
    monthTotals,
    recent,
    pending,
    settings,
  });
}
