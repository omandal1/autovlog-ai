import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { open } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Request } from "express";
import multer from "multer";

import type { ServerConfig } from "./config";
import { ApiError } from "./errors";

function extensionFor(filename: string) {
  return path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
}

function diskUploadStorage(root: string) {
  mkdirSync(root, { recursive: true });
  return multer.diskStorage({
    destination: root,
    filename: (_request, file, callback) => {
      callback(null, `${randomUUID()}${extensionFor(file.originalname)}`);
    }
  });
}

function isMedia(file: Express.Multer.File) {
  return file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/");
}

function isMp3(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase();
  return (
    extension === ".mp3" &&
    ["audio/mpeg", "audio/mp3", "audio/x-mpeg", "application/octet-stream"].includes(
      file.mimetype
    )
  );
}

export function createMediaUploadMiddleware(config: ServerConfig) {
  return multer({
    storage: diskUploadStorage(config.incomingUploadRoot),
    limits: {
      fileSize: config.maxMediaFileBytes,
      files: config.maxFilesPerRequest,
      fields: 20,
      parts: config.maxFilesPerRequest + 20
    },
    fileFilter: (_request, file, callback) => {
      if (!isMedia(file)) {
        callback(new ApiError(415, "UNSUPPORTED_MEDIA", "Upload only image or video files."));
        return;
      }
      callback(null, true);
    }
  }).fields([
    { name: "files", maxCount: config.maxFilesPerRequest },
    { name: "media", maxCount: config.maxFilesPerRequest }
  ]);
}

export function createSoundtrackUploadMiddleware(config: ServerConfig) {
  return multer({
    storage: diskUploadStorage(config.incomingUploadRoot),
    limits: {
      fileSize: config.maxSoundtrackFileBytes,
      files: config.maxFilesPerRequest,
      fields: 20,
      parts: config.maxFilesPerRequest + 20
    },
    fileFilter: (_request, file, callback) => {
      if (!isMp3(file)) {
        callback(new ApiError(415, "UNSUPPORTED_SOUNDTRACK", "Upload only valid MP3 files."));
        return;
      }
      callback(null, true);
    }
  }).fields([
    { name: "files", maxCount: config.maxFilesPerRequest },
    { name: "soundtracks", maxCount: config.maxFilesPerRequest }
  ]);
}

export function uploadedFiles(request: Request) {
  if (!request.files) {
    return [];
  }
  if (Array.isArray(request.files)) {
    return request.files;
  }
  return Object.values(request.files).flat();
}

export async function removeTemporaryUploads(files: readonly Express.Multer.File[]) {
  await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
}

export async function assertMp3Signature(file: Express.Multer.File) {
  const handle = await open(file.path, "r");
  try {
    const header = Buffer.alloc(3);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const hasId3 = bytesRead === 3 && header.toString("ascii") === "ID3";
    const hasFrameSync = bytesRead >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
    if (!hasId3 && !hasFrameSync) {
      throw new ApiError(
        415,
        "INVALID_MP3",
        `${file.originalname.slice(0, 120)} does not appear to be a valid MP3 file.`
      );
    }
  } finally {
    await handle.close();
  }
}
