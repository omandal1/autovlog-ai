import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import type { Request, Response } from "express";

import { ApiError } from "./errors";

function basenameForHeader(filename: string) {
  // Treat both separators as path separators regardless of the host OS. The
  // name may originate on a different platform than the API server.
  return filename.replace(/\\/g, "/").split("/").at(-1) || "download";
}

function safeAsciiDownloadName(filename: string) {
  const fallback = basenameForHeader(filename)
    .replace(/[\u0000-\u001f\u007f-\uffff"\\]/g, "_")
    .replace(/[^A-Za-z0-9 ._()-]/g, "_")
    .slice(0, 180)
    .trim();
  return fallback || "download";
}

function encodeRfc5987Filename(filename: string) {
  const unicodeName = [...basenameForHeader(filename).replace(/[\u0000-\u001f\u007f]/g, "_")]
    .slice(0, 180)
    .join("") || "download";
  // Encoding byte-by-byte also handles malformed surrogate input without
  // allowing it to turn into an invalid HTTP header value.
  return [...Buffer.from(unicodeName, "utf8")]
    .map((byte) => {
      const character = String.fromCharCode(byte);
      return /[A-Za-z0-9._~-]/.test(character)
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}

function contentDisposition(disposition: "inline" | "attachment", filename: string) {
  return `${disposition}; filename="${safeAsciiDownloadName(filename)}"; filename*=UTF-8''${encodeRfc5987Filename(filename)}`;
}

function parseRange(rangeHeader: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) {
    return null;
  }

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function streamFile(
  request: Request,
  response: Response,
  input: {
    filePath: string;
    mimeType: string;
    filename: string;
    disposition?: "inline" | "attachment";
  }
) {
  const fileStat = await stat(input.filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new ApiError(404, "FILE_NOT_FOUND", "The requested project file is missing.");
  }

  const size = fileStat.size;
  const rangeHeader = request.header("range");
  const range = rangeHeader ? parseRange(rangeHeader, size) : undefined;
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", input.mimeType || "application/octet-stream");
  response.setHeader(
    "Content-Disposition",
    contentDisposition(input.disposition ?? "inline", input.filename)
  );

  if (rangeHeader && !range) {
    response.setHeader("Content-Range", `bytes */${size}`);
    response.status(416).end();
    return;
  }

  if (range) {
    response.status(206);
    response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    response.setHeader("Content-Length", range.end - range.start + 1);
  } else {
    response.status(200);
    response.setHeader("Content-Length", size);
  }

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(input.filePath, range ?? undefined);
  stream.on("error", (error) => {
    if (!response.headersSent) {
      response.status(500).json({
        error: { code: "FILE_STREAM_FAILED", message: "Unable to read the project file." }
      });
    } else {
      response.destroy(error);
    }
  });
  stream.pipe(response);
}

export function mimeTypeFromFilename(filename: string) {
  switch (path.extname(filename).toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}
