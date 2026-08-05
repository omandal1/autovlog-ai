import { NextResponse } from "next/server";

import { clearUserSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearUserSession();
  return NextResponse.json({ ok: true });
}
