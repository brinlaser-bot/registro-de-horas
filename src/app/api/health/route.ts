import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// App 100% client-side: healthcheck simples, sem banco de dados.
export function GET() {
  return NextResponse.json({ ok: true });
}
