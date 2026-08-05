import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
  unlink
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ApiError } from "../errors";
import type {
  RenderOutputDirectory,
  SaveUploadInput,
  SavedFile,
  StorageProvider
} from "./storage-provider";

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function requireSafeId(value: string, label: string) {
  if (!SAFE_ID.test(value)) {
    throw new ApiError(400, "INVALID_IDENTIFIER", `${label} is invalid.`);
  }
  return value;
}

function safeFilename(originalFilename: string) {
  const basename = path.basename(originalFilename).normalize("NFKC");
  const extension = path.extname(basename).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  const stem = path
    .basename(basename, path.extname(basename))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${randomUUID()}-${stem || "upload"}${extension}`;
}

async function moveFile(source: string, destination: string) {
  try {
    await rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    await copyFile(source, destination);
    await unlink(source);
  }
}

export class LocalStorageProvider implements StorageProvider {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async initialize() {
    await mkdir(path.join(this.root, "users"), { recursive: true });
  }

  private projectRoot(userId: string, projectId: string) {
    return path.join(
      this.root,
      "users",
      requireSafeId(userId, "User ID"),
      "projects",
      requireSafeId(projectId, "Project ID")
    );
  }

  private async ensureProjectStructure(userId: string, projectId: string) {
    const root = this.projectRoot(userId, projectId);
    await Promise.all(
      [
        "uploads/images",
        "uploads/videos",
        "uploads/music",
        "processed/thumbnails",
        "processed/proxies",
        "processed/frames",
        "renders/master",
        "renders/chapters",
        "renders/wall-frame",
        "metadata",
        "temp"
      ].map((directory) => mkdir(path.join(root, directory), { recursive: true }))
    );
    return root;
  }

  async getProjectStorageRoot(userId: string, projectId: string) {
    return this.ensureProjectStructure(userId, projectId);
  }

  async saveUpload(input: SaveUploadInput): Promise<SavedFile> {
    const root = await this.ensureProjectStructure(input.userId, input.projectId);
    const directory =
      input.category === "image"
        ? "uploads/images"
        : input.category === "video"
          ? "uploads/videos"
          : "uploads/music";
    const destination = path.join(root, directory, safeFilename(input.originalFilename));
    await moveFile(path.resolve(input.tempPath), destination);
    const fileStat = await stat(destination);
    return { absolutePath: destination, size: fileStat.size };
  }

  private async validateStoredPath(userId: string, projectId: string, storedPath: string) {
    if (!path.isAbsolute(storedPath)) {
      throw new ApiError(500, "INVALID_STORED_PATH", "A stored file path is invalid.");
    }
    const projectRoot = this.projectRoot(userId, projectId);
    const resolved = path.resolve(storedPath);
    const relative = path.relative(projectRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
      throw new ApiError(403, "FILE_ACCESS_DENIED", "The requested file is outside this project.");
    }
    return resolved;
  }

  async resolveProjectPath(userId: string, projectId: string, storedPath: string) {
    const resolved = await this.validateStoredPath(userId, projectId, storedPath);
    try {
      await access(resolved, constants.R_OK);
    } catch {
      throw new ApiError(404, "FILE_NOT_FOUND", "The requested project file is missing.");
    }
    return resolved;
  }

  async getMediaPath(userId: string, projectId: string, storedPath: string) {
    const resolved = await this.resolveProjectPath(userId, projectId, storedPath);
    const mediaRoot = path.join(this.projectRoot(userId, projectId), "uploads");
    const processedRoot = path.join(this.projectRoot(userId, projectId), "processed");
    if (!resolved.startsWith(`${mediaRoot}${path.sep}`) && !resolved.startsWith(`${processedRoot}${path.sep}`)) {
      throw new ApiError(403, "FILE_ACCESS_DENIED", "The file is not a media asset.");
    }
    return resolved;
  }

  async getSoundtrackPath(userId: string, projectId: string, storedPath: string) {
    const resolved = await this.resolveProjectPath(userId, projectId, storedPath);
    const musicRoot = path.join(this.projectRoot(userId, projectId), "uploads", "music");
    if (!resolved.startsWith(`${musicRoot}${path.sep}`)) {
      throw new ApiError(403, "FILE_ACCESS_DENIED", "The file is not a soundtrack asset.");
    }
    return resolved;
  }

  async getRenderOutputPath(userId: string, projectId: string, storedPath: string) {
    const resolved = await this.resolveProjectPath(userId, projectId, storedPath);
    const renderRoot = path.join(this.projectRoot(userId, projectId), "renders");
    if (!resolved.startsWith(`${renderRoot}${path.sep}`)) {
      throw new ApiError(403, "FILE_ACCESS_DENIED", "The file is not a render output.");
    }
    return resolved;
  }

  async allocateRenderOutputPath(
    userId: string,
    projectId: string,
    directory: RenderOutputDirectory,
    filename: string
  ) {
    const root = await this.ensureProjectStructure(userId, projectId);
    const folder = directory === "chapter" ? "chapters" : directory;
    return path.join(root, "renders", folder, safeFilename(filename));
  }

  async deleteFile(userId: string, projectId: string, storedPath: string) {
    const resolved = await this.validateStoredPath(userId, projectId, storedPath);
    await rm(resolved, { force: true });
  }

  async deleteProject(userId: string, projectId: string) {
    const projectRoot = this.projectRoot(userId, projectId);
    const usersRoot = path.join(this.root, "users");
    const relative = path.relative(usersRoot, projectRoot);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative.length < 5) {
      throw new ApiError(500, "UNSAFE_STORAGE_TARGET", "Refusing to delete an unsafe path.");
    }
    await rm(projectRoot, { recursive: true, force: true });
  }

  async cleanupTemp(userId: string, projectId: string, renderJobId?: string) {
    const projectRoot = this.projectRoot(userId, projectId);
    const tempRoot = path.join(projectRoot, "temp");
    const target = renderJobId
      ? path.join(tempRoot, requireSafeId(renderJobId, "Render job ID"))
      : tempRoot;
    await rm(target, { recursive: true, force: true });
    if (!renderJobId) {
      await mkdir(tempRoot, { recursive: true });
    }
  }
}
