import { mkdir, readdir, stat, writeFile } from "fs/promises";
import path from "path";

import { DEFAULT_STORAGE_ROOT } from "@/lib/constants";
import { normalizeProjectChapterTitles } from "@/lib/chapter-title-utils";
import { createId, createToken } from "@/lib/ids";
import type {
  ProjectRecord,
  ProjectSettings,
  ProjectSummary
} from "@/lib/types";
import { normalizeProjectSettings } from "@/lib/user-controls/generation-settings";

export interface ProjectPaths {
  root: string;
  uploadsDir: string;
  musicDir: string;
  thumbnailsDir: string;
  normalizedDir: string;
  proxiesDir: string;
  keyframesDir: string;
  timelinesDir: string;
  outputsDir: string;
  tempDir: string;
  metadataFile: string;
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

export function getStorageRoot() {
  return path.resolve(process.cwd(), process.env.STORAGE_ROOT ?? DEFAULT_STORAGE_ROOT);
}

export function getProjectPaths(projectId: string): ProjectPaths {
  const root = path.join(getStorageRoot(), projectId);
  return {
    root,
    uploadsDir: path.join(root, "uploads"),
    musicDir: path.join(root, "music"),
    thumbnailsDir: path.join(root, "thumbnails"),
    normalizedDir: path.join(root, "normalized"),
    proxiesDir: path.join(root, "proxies"),
    keyframesDir: path.join(root, "keyframes"),
    timelinesDir: path.join(root, "timelines"),
    outputsDir: path.join(root, "outputs"),
    tempDir: path.join(root, "temp"),
    metadataFile: path.join(root, "project.json")
  };
}

export async function ensureStorageRoot() {
  await mkdir(getStorageRoot(), { recursive: true });
}

export async function ensureProjectStructure(projectId: string) {
  const paths = getProjectPaths(projectId);
  await Promise.all(
    Object.values(paths)
      .filter((value) => !value.endsWith(".json"))
      .map((value) => mkdir(value, { recursive: true }))
  );
  return paths;
}

export async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function readJson<T>(filePath: string) {
  const { readFile } = await import("fs/promises");
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function createProjectRecord(settings: ProjectSettings, ownerUserId?: string) {
  await ensureStorageRoot();
  const projectId = createId("proj");
  const now = new Date().toISOString();
  const record: ProjectRecord = {
    id: projectId,
    ownerUserId,
    name: `College upload ${now.slice(0, 10)}`,
    createdAt: now,
    updatedAt: now,
    status: "uploaded",
    stage: "queued",
    settings: normalizeProjectSettings(settings),
    assetCount: 0,
    assets: [],
    chapters: [],
    outputs: [],
    previewPlans: [],
    timelinePaths: {
      chapters: []
    }
  };

  await ensureProjectStructure(projectId);
  await writeJson(getProjectPaths(projectId).metadataFile, record);
  return record;
}

export async function saveProjectRecord(record: ProjectRecord) {
  const normalizedRecord = normalizeProjectChapterTitles({
    ...record,
    updatedAt: new Date().toISOString(),
    settings: normalizeProjectSettings(record.settings)
  });
  await writeJson(getProjectPaths(normalizedRecord.id).metadataFile, normalizedRecord);
}

export async function readProjectRecord(projectId: string) {
  return normalizeProjectChapterTitles(
    await readJson<ProjectRecord>(getProjectPaths(projectId).metadataFile)
  );
}

export async function listProjectSummaries(ownerUserId?: string) {
  await ensureStorageRoot();
  const entries = await readdir(getStorageRoot(), { withFileTypes: true });
  const summaries: ProjectSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const record = await readJson<ProjectRecord>(getProjectPaths(entry.name).metadataFile);
      if (ownerUserId && record.ownerUserId && record.ownerUserId !== ownerUserId) {
        continue;
      }
      if (ownerUserId && !record.ownerUserId) {
        continue;
      }

      summaries.push({
        id: record.id,
        ownerUserId: record.ownerUserId,
        name: record.name,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        status: record.status,
        stage: record.stage,
        settings: record.settings,
        error: record.error,
        assetCount: record.assetCount,
        outputs: record.outputs
      });
    } catch {
      // Skip malformed directories.
    }
  }

  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveUploadBuffer(
  projectId: string,
  originalFilename: string,
  buffer: Buffer
) {
  const paths = await ensureProjectStructure(projectId);
  const targetName = `${Date.now()}-${createToken()}-${sanitizeSegment(originalFilename)}`;
  const targetPath = path.join(paths.uploadsDir, targetName);
  await writeFile(targetPath, buffer);
  return targetPath;
}

export async function saveProjectMusicBuffer(
  projectId: string,
  originalFilename: string,
  buffer: Buffer
) {
  const paths = await ensureProjectStructure(projectId);
  const targetName = `${Date.now()}-${createToken()}-${sanitizeSegment(originalFilename)}`;
  const targetPath = path.join(paths.musicDir, targetName);
  await writeFile(targetPath, buffer);
  return targetPath;
}

export async function fileExists(filePath?: string) {
  if (!filePath) {
    return false;
  }
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readProjectOutput(projectId: string, outputId: string) {
  const record = await readProjectRecord(projectId);
  return record.outputs.find((item) => item.id === outputId);
}
