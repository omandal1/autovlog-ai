import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getOptionalSessionUser();
  return NextResponse.json({ user });
}
