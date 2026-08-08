import type {
  JsonObject,
  JsonValue,
  MediaAssetRecord,
  ProjectRecord,
  RenderJobRecord,
  RenderOutputRecord,
  SoundtrackAssetRecord,
  UserRecord
} from "./models";

const PRIVATE_KEY = /(^|_)(path|localpath|storageroot|renderplanpath|password|secret|token)$/i;
const PROTOTYPE_KEY = /^(?:__proto__|prototype|constructor)$/i;
const LOCAL_PATH_START =
  /(?:^|[^A-Za-z0-9+.\/\\-])(?:file:\/\/\/|[A-Za-z]:[\\/]|\\\\[^\\/\s]|\/(?![\/\s]))/i;
const QUOTED_LOCAL_PATH =
  /(["'`])(?:file:\/\/\/|[A-Za-z]:[\\/]|\\\\[^\\/\s]|\/(?![\/\s]))(?:(?!\1)[^\r\n])*\1/gi;

export function sanitizeJson(value: unknown, depth = 0): JsonValue {
  if (depth > 8) {
    return null;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 1_000).map((entry) => sanitizeJson(entry, depth + 1));
  }
  if (typeof value === "object") {
    const output: JsonObject = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (PRIVATE_KEY.test(key.replace(/-/g, "_")) || PROTOTYPE_KEY.test(key)) {
        continue;
      }
      output[key] = sanitizeJson(entry, depth + 1);
    }
    return output;
  }
  return null;
}

/**
 * Removes host filesystem locations from text that can cross the API
 * boundary. Quoted paths retain the useful surrounding error context. For an
 * unquoted path, the complete message is replaced because whitespace can be
 * part of a valid filename and guessing its endpoint could leak a suffix.
 */
export function redactLocalPaths(message: string) {
  if (!LOCAL_PATH_START.test(message)) {
    return message;
  }

  const quotedPathsRedacted = message.replace(QUOTED_LOCAL_PATH, "$1[local file]$1");
  return LOCAL_PATH_START.test(quotedPathsRedacted)
    ? "An internal file operation failed."
    : quotedPathsRedacted;
}

function redactAnalysisPaths(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    return redactLocalPaths(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactAnalysisPaths);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        entry === undefined ? null : redactAnalysisPaths(entry)
      ])
    );
  }
  return value;
}

function sanitizeAnalysisJson(value: unknown) {
  return redactAnalysisPaths(sanitizeJson(value));
}

function dateToIso(value: Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function apiProjectPath(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

export function toUserDto(user: UserRecord) {
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    createdAt: dateToIso(user.createdAt),
    updatedAt: dateToIso(user.updatedAt)
  };
}

export function toProjectDto(project: ProjectRecord) {
  const base = apiProjectPath(project.id);
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    generationMode: project.generationMode,
    settings: sanitizeJson(project.settings),
    thumbnailUrl: project.thumbnailPath ? `${base}/thumbnail` : null,
    masterOutputId: project.masterOutputId ?? null,
    chapterOutputIds: project.chapterOutputIds,
    wallFrameOutputIds: project.wallFrameOutputIds,
    createdAt: dateToIso(project.createdAt),
    updatedAt: dateToIso(project.updatedAt)
  };
}

export function toMediaDto(asset: MediaAssetRecord) {
  const base = `${apiProjectPath(asset.projectId)}/media/${encodeURIComponent(asset.id)}`;
  return {
    id: asset.id,
    projectId: asset.projectId,
    type: asset.type,
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    size: asset.size,
    duration: asset.duration ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    metadata: sanitizeJson(asset.metadata),
    analysis: sanitizeAnalysisJson(asset.analysis),
    contentUrl: `${base}/content`,
    thumbnailUrl: asset.thumbnailPath ? `${base}/content?variant=thumbnail` : null,
    createdAt: dateToIso(asset.createdAt)
  };
}

export function toSoundtrackDto(asset: SoundtrackAssetRecord) {
  const analysis = sanitizeAnalysisJson(asset.analysis);
  const hasAnalysisError =
    analysis && typeof analysis === "object" && !Array.isArray(analysis) && "error" in analysis;
  return {
    id: asset.id,
    projectId: asset.projectId,
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    size: asset.size,
    duration: asset.duration ?? null,
    bitrate: asset.bitrate ?? null,
    sampleRate: asset.sampleRate ?? null,
    channels: asset.channels ?? null,
    status: asset.duration ? "ready" : hasAnalysisError ? "analysis-failed" : "processing",
    analysis,
    createdAt: dateToIso(asset.createdAt)
  };
}

export function toRenderJobDto(job: RenderJobRecord) {
  return {
    id: job.id,
    projectId: job.projectId,
    generationMode: job.generationMode,
    status: job.status,
    progress: job.progress,
    currentStage: job.currentStage,
    errorMessage: job.errorMessage ? redactLocalPaths(job.errorMessage).slice(0, 2_000) : null,
    startedAt: job.startedAt ? dateToIso(job.startedAt) : null,
    completedAt: job.completedAt ? dateToIso(job.completedAt) : null,
    settingsSnapshot: sanitizeJson(job.settingsSnapshot),
    createdAt: dateToIso(job.createdAt),
    updatedAt: dateToIso(job.updatedAt)
  };
}

export function toOutputDto(output: RenderOutputRecord) {
  const base = `${apiProjectPath(output.projectId)}/outputs/${encodeURIComponent(output.id)}`;
  return {
    id: output.id,
    projectId: output.projectId,
    renderJobId: output.renderJobId,
    type: output.type,
    title: output.title,
    duration: output.duration ?? null,
    size: output.size,
    thumbnailUrl: output.thumbnailPath ? `${base}/thumbnail` : null,
    contentUrl: `${base}/content`,
    downloadUrl: `${base}/download`,
    createdAt: dateToIso(output.createdAt)
  };
}
