import { NextResponse } from "next/server";

import { startUserSession } from "@/lib/auth/session";
import { createUserAccount } from "@/storage/account-storage";

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

    const user = await createUserAccount({
      email: body.email,
      password: body.password
    });
    await startUserSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create account."
      },
      { status: 400 }
    );
  }
}
