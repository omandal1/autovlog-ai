import type { TranscriptResult } from "@/lib/types";

const GENERIC_LABELS = new Set([
  "asset",
  "chapter",
  "clip",
  "content",
  "diary",
  "file",
  "highlight",
  "image",
  "media",
  "memory",
  "page",
  "photo",
  "picture",
  "project",
  "random",
  "render",
  "selected",
  "upload",
  "uploaded",
  "video"
]);

const TECHNICAL_PREFIXES = [
  "img",
  "vid",
  "dsc",
  "dscn",
  "pxl",
  "mvimg",
  "mov",
  "clip",
  "video",
  "image",
  "photo",
  "screenshot",
  "screenrecording",
  "screen",
  "wa",
  "wx",
  "gh"
];

const FILE_EXTENSION_PATTERN = /\.(?:mov|mp4|m4v|avi|webm|mkv|jpg|jpeg|png|heic|heif)$/i;
const UUID_PATTERN = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i;

export function normalizeContentText(value?: string) {
  const normalized = value
    ?.replace(FILE_EXTENSION_PATTERN, "")
    .replace(/[/\\]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function looksLikeTechnicalFilename(value?: string) {
  const text = normalizeContentText(value);
  if (!text) {
    return true;
  }

  const compact = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = tokenize(text);
  if (!tokens.length) {
    return true;
  }

  if (UUID_PATTERN.test(text)) {
    return true;
  }

  if (/^\d{6,}$/.test(compact) || /^\d{4,8}$/.test(compact)) {
    return true;
  }

  if (/^(?:img|vid|dscn?|pxl|mvimg|clip|video|photo|image|screenshot|screenrecording)\d+$/i.test(compact)) {
    return true;
  }

  if (/^\d{8}_\d{6}/.test(value ?? "") || /^\d{4}[-_]\d{2}[-_]\d{2}/.test(value ?? "")) {
    return true;
  }

  const technicalTokenCount = tokens.filter((token) => {
    if (/^\d+$/.test(token)) {
      return true;
    }
    if (GENERIC_LABELS.has(token)) {
      return true;
    }
    return TECHNICAL_PREFIXES.some((prefix) => token === prefix || token.startsWith(`${prefix}0`));
  }).length;

  const longRandomToken = tokens.some((token) => /[a-z]/.test(token) && /\d/.test(token) && token.length >= 7);
  const mostlyTechnical = technicalTokenCount / tokens.length >= 0.65;
  const onlyGenericWords = tokens.every((token) => GENERIC_LABELS.has(token) || /^\d+$/.test(token));

  return mostlyTechnical || onlyGenericWords || longRandomToken;
}

export function isMeaningfulContentText(value?: string) {
  const text = normalizeContentText(value);
  if (!text || text.length < 4) {
    return false;
  }
  if (looksLikeTechnicalFilename(text)) {
    return false;
  }

  const tokens = tokenize(text);
  const meaningfulTokens = tokens.filter(
    (token) => token.length > 2 && !GENERIC_LABELS.has(token) && !/^\d+$/.test(token)
  );
  if (!meaningfulTokens.length) {
    return false;
  }

  const genericPhrase = /^(?:memory|media|uploaded media|highlighted memory|chapter \d+|page \d+|selected plan)$/i;
  return !genericPhrase.test(text);
}

export function transcriptContentText(result?: TranscriptResult) {
  if (!result || result.source === "none" || result.source === "heuristic") {
    return undefined;
  }

  const candidate = normalizeContentText(result.snippet ?? result.text);
  if (!isMeaningfulContentText(candidate)) {
    return undefined;
  }

  return candidate;
}

