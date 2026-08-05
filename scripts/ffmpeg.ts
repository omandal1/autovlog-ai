import { execFile } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function resolveConfiguredBinary(configured: string | undefined) {
  return configured && configured.trim().length ? configured : undefined;
}

function resolvePackageBinary(relativePath: string) {
  const candidates = [
    path.resolve(process.cwd(), "node_modules", relativePath),
    path.resolve(process.cwd(), ".next", "standalone", "node_modules", relativePath)
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function resolveFfmpegBinary() {
  const configured = resolveConfiguredBinary(process.env.FFMPEG_PATH);
  if (configured) {
    return configured;
  }

  const executable = os.platform() === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return resolvePackageBinary(path.join("ffmpeg-static", executable));
}

function resolveFfprobeBinary() {
  const configured = resolveConfiguredBinary(process.env.FFPROBE_PATH);
  if (configured) {
    return configured;
  }

  const executable = os.platform() === "win32" ? "ffprobe.exe" : "ffprobe";
  return resolvePackageBinary(
    path.join("ffprobe-static", "bin", os.platform(), os.arch(), executable)
  );
}

export const ffmpegPath = resolveFfmpegBinary();
export const ffprobePath = resolveFfprobeBinary();

export async function runFfmpeg(
  args: string[],
  cwd?: string,
  options?: {
    timeoutMs?: number;
  }
) {
  if (!ffmpegPath) {
    throw new Error("FFmpeg binary is unavailable.");
  }
  return execFileAsync(ffmpegPath, args, {
    cwd,
    windowsHide: true,
    timeout: options?.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 32 * 1024 * 1024
  });
}

export async function runFfprobe(args: string[], cwd?: string) {
  if (!ffprobePath) {
    throw new Error("FFprobe binary is unavailable.");
  }
  return execFileAsync(ffprobePath, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
}

export async function probeFile(filePath: string) {
  const { stdout } = await runFfprobe([
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath
  ]);
  return JSON.parse(stdout) as {
    format?: {
      duration?: string;
      tags?: Record<string, string>;
    };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      duration?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      sample_aspect_ratio?: string;
      display_aspect_ratio?: string;
      tags?: Record<string, string>;
    }>;
  };
}

export function buildScalePadFilter(width: number, height: number) {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

export function escapeForDrawtext(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

export function resolveFontPath() {
  const candidates = [
    "C:/Windows/Fonts/segoepr.ttf",
    "C:/Windows/Fonts/comic.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function resolveEmojiFontPath() {
  const candidates = [
    "C:/Windows/Fonts/seguiemj.ttf",
    "C:/Windows/Fonts/seguisym.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "/System/Library/Fonts/Apple Color Emoji.ttc",
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function normalizeFfmpegPath(filePath: string) {
  return path.resolve(filePath).replace(/\\/g, "/");
}
