import { mkdir, readFile, writeFile } from "fs/promises";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "crypto";
import path from "path";
import { promisify } from "util";

import { DEFAULT_ACCOUNT_STORAGE_ROOT } from "@/lib/constants";
import { createId } from "@/lib/ids";
import type {
  User,
  UserPreferences,
  UserSession
} from "@/lib/types";

const scryptAsync = promisify(scryptCallback);
const ACCOUNT_STORAGE_ROOT = path.resolve(
  process.cwd(),
  process.env.ACCOUNT_STORAGE_ROOT ?? DEFAULT_ACCOUNT_STORAGE_ROOT
);
const USERS_FILE = path.join(ACCOUNT_STORAGE_ROOT, "users.json");
const SESSIONS_FILE = path.join(ACCOUNT_STORAGE_ROOT, "sessions.json");

interface StoredUsersFile {
  users: User[];
}

interface StoredSessionsFile {
  sessions: UserSession[];
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function ensureAccountStorage() {
  await mkdir(ACCOUNT_STORAGE_ROOT, { recursive: true });
}

async function readUsersFile() {
  await ensureAccountStorage();
  try {
    const contents = await readFile(USERS_FILE, "utf8");
    const parsed = JSON.parse(contents) as StoredUsersFile;
    return parsed;
  } catch {
    return { users: [] } satisfies StoredUsersFile;
  }
}

async function writeUsersFile(users: User[]) {
  await ensureAccountStorage();
  await writeFile(USERS_FILE, JSON.stringify({ users }, null, 2), "utf8");
}

async function readSessionsFile() {
  await ensureAccountStorage();
  try {
    const contents = await readFile(SESSIONS_FILE, "utf8");
    return JSON.parse(contents) as StoredSessionsFile;
  } catch {
    return { sessions: [] } satisfies StoredSessionsFile;
  }
}

async function writeSessionsFile(sessions: UserSession[]) {
  await ensureAccountStorage();
  await writeFile(SESSIONS_FILE, JSON.stringify({ sessions }, null, 2), "utf8");
}

async function hashPassword(password: string, salt: string) {
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return key.toString("hex");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sanitizeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    preferences: user.preferences
  };
}

export type SafeUser = ReturnType<typeof sanitizeUser>;

export async function getUserById(userId: string) {
  const { users } = await readUsersFile();
  return users.find((user) => user.id === userId);
}

export async function listUsers() {
  const { users } = await readUsersFile();
  return users.map(sanitizeUser);
}

export async function createUserAccount(input: {
  email: string;
  password: string;
  preferences?: UserPreferences;
}) {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) {
    throw new Error("Use a valid email address.");
  }
  if (input.password.length < 8) {
    throw new Error("Passwords must be at least 8 characters.");
  }

  const { users } = await readUsersFile();
  if (users.some((user) => user.email === email)) {
    throw new Error("An account with that email already exists.");
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(input.password, salt);
  const now = new Date().toISOString();
  const user: User = {
    id: createId("user"),
    email,
    passwordHash,
    passwordSalt: salt,
    createdAt: now,
    updatedAt: now,
    preferences: input.preferences ?? {},
    connectedMusicAccounts: []
  };

  users.push(user);
  await writeUsersFile(users);
  return sanitizeUser(user);
}

export async function authenticateUserAccount(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const { users } = await readUsersFile();
  const user = users.find((entry) => entry.email === email);
  if (!user) {
    return undefined;
  }

  const attemptedHash = await hashPassword(password, user.passwordSalt);
  const attemptedBuffer = Buffer.from(attemptedHash, "hex");
  const storedBuffer = Buffer.from(user.passwordHash, "hex");
  if (
    attemptedBuffer.length !== storedBuffer.length ||
    !timingSafeEqual(attemptedBuffer, storedBuffer)
  ) {
    return undefined;
  }

  return sanitizeUser(user);
}

export async function createUserSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const { sessions } = await readSessionsFile();
  const session: UserSession = {
    id: createId("sess"),
    userId,
    tokenHash,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
  };

  const activeSessions = sessions.filter(
    (entry) => new Date(entry.expiresAt).getTime() > Date.now()
  );
  activeSessions.push(session);
  await writeSessionsFile(activeSessions);
  return {
    token,
    session
  };
}

export async function getSessionUserFromToken(token?: string) {
  if (!token) {
    return undefined;
  }
  const { sessions } = await readSessionsFile();
  const session = sessions.find((entry) => entry.tokenHash === hashToken(token));
  if (!session) {
    return undefined;
  }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await destroyUserSession(token);
    return undefined;
  }

  const user = await getUserById(session.userId);
  return user ? sanitizeUser(user) : undefined;
}

export async function destroyUserSession(token?: string) {
  if (!token) {
    return;
  }
  const { sessions } = await readSessionsFile();
  await writeSessionsFile(sessions.filter((entry) => entry.tokenHash !== hashToken(token)));
}

export async function updateUserPreferences(userId: string, preferences: Partial<UserPreferences>) {
  const { users } = await readUsersFile();
  const user = users.find((entry) => entry.id === userId);
  if (!user) {
    throw new Error("User not found.");
  }

  user.preferences = {
    ...user.preferences,
    ...preferences
  };
  user.updatedAt = new Date().toISOString();
  await writeUsersFile(users);
  return sanitizeUser(user);
}
