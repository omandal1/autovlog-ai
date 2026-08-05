import { cookies } from "next/headers";

import {
  createUserSession,
  destroyUserSession,
  getSessionUserFromToken,
  type SafeUser
} from "@/storage/account-storage";

export const AUTH_COOKIE_NAME = "autovlog_session";

function cookieConfig() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14
  };
}

export async function getOptionalSessionUser() {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  return getSessionUserFromToken(token);
}

export async function requireSessionUser() {
  const user = await getOptionalSessionUser();
  if (!user) {
    throw new Error("Sign in to use this feature.");
  }
  return user;
}

export async function startUserSession(userId: string) {
  const store = await cookies();
  const { token } = await createUserSession(userId);
  store.set(AUTH_COOKIE_NAME, token, cookieConfig());
}

export async function clearUserSession() {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  await destroyUserSession(token);
  store.set(AUTH_COOKIE_NAME, "", {
    ...cookieConfig(),
    maxAge: 0
  });
}

export interface SessionResponsePayload {
  user?: SafeUser;
}
