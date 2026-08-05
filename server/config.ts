import { randomBytes } from "node:crypto";
import path from "node:path";

export interface FirebaseAdminConfig {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
  useApplicationDefaultCredential?: boolean;
}

export interface ServerConfig {
  port: number;
  host: string;
  databaseUrl?: string;
  databaseName: string;
  storageRoot: string;
  incomingUploadRoot: string;
  frontendOrigins: string[];
  nodeEnv: "development" | "test" | "production";
  maxMediaFileBytes: number;
  maxSoundtrackFileBytes: number;
  maxFilesPerRequest: number;
  fileTicketSecret: string;
  fileTicketTtlSeconds: number;
  firebase: FirebaseAdminConfig;
}

let developmentFileTicketSecret: string | undefined;

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function boundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum: number
) {
  const parsed = positiveInteger(value, fallback, name);
  if (parsed > maximum) {
    throw new Error(`${name} must not exceed ${maximum}.`);
  }
  return parsed;
}

function fileTicketSecret(environment: NodeJS.ProcessEnv, nodeEnv: ServerConfig["nodeEnv"]) {
  const configured = environment.FILE_TICKET_SECRET;
  if (configured) {
    if (Buffer.byteLength(configured, "utf8") < 32) {
      throw new Error("FILE_TICKET_SECRET must be at least 32 bytes.");
    }
    return configured;
  }
  if (nodeEnv === "production") {
    throw new Error("FILE_TICKET_SECRET is required in production.");
  }
  developmentFileTicketSecret ??= randomBytes(32).toString("base64url");
  return developmentFileTicketSecret;
}

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/$/, "");
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): ServerConfig {
  const nodeEnv =
    environment.NODE_ENV === "production" || environment.NODE_ENV === "test"
      ? environment.NODE_ENV
      : "development";
  const storageRoot = path.resolve(cwd, environment.STORAGE_ROOT ?? "storage");
  const configuredOrigins = (environment.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  const frontendOrigins = Array.from(
    new Set(
      configuredOrigins.length > 0
        ? configuredOrigins
        : nodeEnv === "production"
          ? []
          : ["http://localhost:3000", "http://127.0.0.1:3000"]
    )
  );

  return {
    port: positiveInteger(environment.PORT, 8787, "PORT"),
    host: environment.HOST?.trim() || "127.0.0.1",
    databaseUrl: environment.DATABASE_URL?.trim() || undefined,
    databaseName: environment.MONGODB_DB_NAME?.trim() || "autovlog",
    storageRoot,
    incomingUploadRoot: path.join(storageRoot, ".incoming"),
    frontendOrigins,
    nodeEnv,
    maxMediaFileBytes: positiveInteger(
      environment.MAX_MEDIA_FILE_BYTES,
      10 * 1024 * 1024 * 1024,
      "MAX_MEDIA_FILE_BYTES"
    ),
    maxSoundtrackFileBytes: positiveInteger(
      environment.MAX_SOUNDTRACK_FILE_BYTES,
      1024 * 1024 * 1024,
      "MAX_SOUNDTRACK_FILE_BYTES"
    ),
    maxFilesPerRequest: positiveInteger(
      environment.MAX_FILES_PER_REQUEST,
      500,
      "MAX_FILES_PER_REQUEST"
    ),
    fileTicketSecret: fileTicketSecret(environment, nodeEnv),
    fileTicketTtlSeconds: boundedPositiveInteger(
      environment.FILE_TICKET_TTL_SECONDS,
      900,
      "FILE_TICKET_TTL_SECONDS",
      3600
    ),
    firebase: {
      projectId: environment.FIREBASE_PROJECT_ID?.trim() || undefined,
      clientEmail: environment.FIREBASE_CLIENT_EMAIL?.trim() || undefined,
      privateKey: environment.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n") || undefined,
      useApplicationDefaultCredential: Boolean(environment.GOOGLE_APPLICATION_CREDENTIALS)
    }
  };
}
