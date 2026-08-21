import { NextRequest, NextResponse } from "next/server";
import { enrichCompensations } from "@/lib/compensations";
import { getAppData, settingsOf } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = getAppData();
  const settings = settingsOf(data.user);
  const compensations = enrichCompensations(data.compensations, data.entries, settings);
  return NextResponse.json({ compensations });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  return NextResponse.json({ ok: true, body }, { status: 201 });
}
