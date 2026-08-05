import { NextResponse } from "next/server";

import { startUserSession } from "@/lib/auth/session";
import { authenticateUserAccount } from "@/storage/account-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
    };
    if (!body.email || !body.password) {
      throw new Error("Email and password are required.");
    }

    const user = await authenticateUserAccount(body.email, body.password);
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    await startUserSession(user.id);
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to log in."
      },
      { status: 400 }
    );
  }
}
