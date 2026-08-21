import { NextRequest, NextResponse } from "next/server";
import { enrichCompensations } from "@/lib/compensations";
import { getAppData, settingsOf } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => null);
  const { id } = await ctx.params;

  const data = getAppData();
  const settings = settingsOf(data.user);
  const updated = data.compensations.find((c) => c.id === Number(id));

  if (!updated) {
    return NextResponse.json({ error: "Compensação não encontrada.", body }, { status: 404 });
  }

  const enriched = enrichCompensations([updated], data.entries, settings);
  return NextResponse.json({ compensation: enriched[0] });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ ok: true, id: Number(id) });
}
