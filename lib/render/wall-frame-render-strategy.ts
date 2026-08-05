import { randomUUID } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";

import {
  assertValidVideoFile,
  writeAtomicVideo,
  type VideoProbeSummary
} from "@/lib/render/video-integrity";
import { getFrameStyleDefinition, getWallStyleDefinition } from "@/lib/wall-frame/style-registry";
import {
  calculateWallFrameDuration,
  calculateWallSectionTimings
} from "@/lib/wall-frame/timing";
import type {
  MemoryFrame,
  WallFrameRenderPlan,
  WallFrameSectionTiming,
  WallSection
} from "@/lib/wall-frame/types";
import {
  assertValidWallFramePlan,
  buildSimpleWallFrameFallback,
  validateAndRepairWallFramePlan,
  validateWallFrameRenderPlan
} from "@/lib/wall-frame/validator";
import {
  escapeForDrawtext,
  resolveFontPath,
  runFfmpeg
} from "@/scripts/ffmpeg";

export interface WallFrameRenderOptions {
  plan: WallFrameRenderPlan;
  outputPath: string;
  tempRoot?: string;
  renderPlanPath?: string;
  keepTemporaryFiles?: boolean;
  preserveSourceAudio?: boolean;
  timeoutMs?: number;
  onProgress?: (update: {
    stage: "validate" | "sections" | "stitch" | "audio" | "mux" | "fallback";
    progress: number;
    detail: string;
  }) => void | Promise<void>;
}

export interface WallFrameRenderResult {
  outputPath: string;
  durationSec: number;
  outputMetadata: VideoProbeSummary;
  plan: WallFrameRenderPlan;
  fallbackUsed: boolean;
  audioFallback: "none" | "music-only" | "silent";
  attempts: string[];
}

interface RenderedWallVideo {
  videoPath: string;
  durationSec: number;
  sectionTimings: WallFrameSectionTiming[];
  usedCutFallback: boolean;
}

interface AudioInputSpec {
  kind: "music" | "source";
  sourcePath: string;
  sourceOffsetSec: number;
  startSec: number;
  durationSec: number;
  gain: number;
  fadeSec: number;
}

const WALL_CANVAS_SCALE = 1.16;
const DEFAULT_RENDER_TIMEOUT_MS = 180_000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function even(value: number) {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function round(value: number, places = 3) {
  return Number(value.toFixed(places));
}

function summarizeError(error: unknown) {
  if (typeof error === "object" && error) {
    const stderr = "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
    return `${stderr}\n${message}`.replace(/\s+/g, " ").trim().slice(0, 2400);
  }
  return String(error).replace(/\s+/g, " ").trim().slice(0, 2400);
}

function toLinearGain(db: number) {
  return Math.pow(10, clamp(Number.isFinite(db) ? db : 0, -30, 6) / 20);
}

function buildValidationOptions(options: {
  label: string;
  width: number;
  height: number;
  fps: number;
  minDurationSec: number;
}) {
  return {
    label: options.label,
    minDurationSec: Math.max(0.1, options.minDurationSec),
    width: options.width,
    height: options.height,
    fps: options.fps,
    requireH264: true,
    requireYuv420p: true,
    decode: true
  };
}

function textureFilters(section: WallSection) {
  const style = getWallStyleDefinition(section.backgroundStyle);
  const gridOpacity = style.textureOpacity.toFixed(3);
  switch (style.texture) {
    case "gallery":
      return `drawgrid=w=iw/10:h=ih/7:t=1:c=${style.accentColor}@${gridOpacity}`;
    case "cork":
      return `noise=alls=5:allf=u,drawgrid=w=iw/19:h=ih/13:t=1:c=${style.accentColor}@0.08`;
    case "plaster":
      return `noise=alls=2:allf=u,drawgrid=w=iw/13:h=ih/9:t=1:c=${style.accentColor}@${gridOpacity}`;
    case "paint":
    default:
      return `drawgrid=w=iw/14:h=ih/10:t=1:c=${style.accentColor}@${gridOpacity}`;
  }
}

function buildMediaFilter(
  frame: MemoryFrame,
  width: number,
  height: number,
  durationSec: number,
  fps: number
) {
  const sizing =
    frame.cropMode === "contain"
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x171717`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  const common = `${sizing},setsar=1,fps=${fps}`;
  if (frame.mediaType === "image") {
    return `${common},trim=duration=${durationSec.toFixed(3)},setpts=PTS-STARTPTS,format=rgba`;
  }
  return `${common},tpad=stop_mode=clone:stop_duration=${durationSec.toFixed(
    3
  )},trim=duration=${durationSec.toFixed(3)},setpts=PTS-STARTPTS,format=rgba`;
}

function buildCameraFilter(options: {
  section: WallSection;
  canvasWidth: number;
  canvasHeight: number;
  outputWidth: number;
  outputHeight: number;
  fps: number;
}) {
  const frames = Math.max(1, Math.round(options.section.durationSec * options.fps));
  const denominator = Math.max(frames - 1, 1);
  const progress =
    options.section.cameraPath.easing === "ease-in-out"
      ? `(1-cos(PI*on/${denominator}))/2`
      : `on/${denominator}`;
  const { start, end } = options.section.cameraPath;
  const baseZoom = Math.max(
    options.canvasWidth / options.outputWidth,
    options.canvasHeight / options.outputHeight
  );
  const zoom = `${baseZoom.toFixed(7)}*(${start.zoom.toFixed(7)}+${(
    end.zoom - start.zoom
  ).toFixed(7)}*${progress})`;
  const focusX = `${start.x.toFixed(7)}+${(end.x - start.x).toFixed(7)}*${progress}`;
  const focusY = `${start.y.toFixed(7)}+${(end.y - start.y).toFixed(7)}*${progress}`;
  return `zoompan=z='${zoom}':x='(iw-iw/zoom)*(${focusX})':y='(ih-ih/zoom)*(${focusY})':d=1:s=${options.outputWidth}x${options.outputHeight}:fps=${options.fps},trim=duration=${options.section.durationSec.toFixed(
    3
  )},setpts=PTS-STARTPTS,vignette=PI/9,setsar=1,format=yuv420p`;
}

function safeCaption(value: string | undefined) {
  return value?.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 76);
}

async function renderWallSection(options: {
  section: WallSection;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  timeoutMs: number;
}) {
  const canvasWidth = even(options.width * WALL_CANVAS_SCALE);
  const canvasHeight = even(options.height * WALL_CANVAS_SCALE);
  const wallStyle = getWallStyleDefinition(options.section.backgroundStyle);
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${wallStyle.baseColor}:s=${canvasWidth}x${canvasHeight}:r=${options.fps}:d=${options.section.durationSec.toFixed(
      3
    )}`
  ];

  for (const frame of options.section.frames) {
    if (frame.mediaType === "image") {
      args.push(
        "-loop",
        "1",
        "-framerate",
        `${options.fps}`,
        "-t",
        options.section.durationSec.toFixed(3),
        "-i",
        frame.sourcePath
      );
      continue;
    }
    const remainingSource = frame.sourceDurationSec
      ? Math.max(0.1, frame.sourceDurationSec - frame.trimStartSec)
      : options.section.durationSec;
    args.push(
      "-ss",
      Math.max(0, frame.trimStartSec).toFixed(3),
      "-t",
      Math.min(options.section.durationSec, remainingSource).toFixed(3),
      "-i",
      frame.sourcePath
    );
  }

  const filters: string[] = [
    `[0:v]format=rgba,${textureFilters(options.section)}[canvas0]`
  ];
  let currentLabel = "[canvas0]";
  const fontPath = resolveFontPath();

  options.section.frames.forEach((frame, index) => {
    const style = getFrameStyleDefinition(frame.frameStyle);
    const x = Math.round(frame.bounds.x * canvasWidth);
    const y = Math.round(frame.bounds.y * canvasHeight);
    const outerWidth = Math.max(80, Math.round(frame.bounds.width * canvasWidth));
    const outerHeight = Math.max(70, Math.round(frame.bounds.height * canvasHeight));
    const border = Math.max(6, Math.round(Math.min(outerWidth, outerHeight) * style.borderRatio));
    const caption = safeCaption(frame.caption);
    const captionHeight = caption
      ? clamp(Math.round(outerHeight * 0.14), Math.max(24, border * 2), Math.round(outerHeight * 0.2))
      : 0;
    const matInset = Math.max(3, Math.round(border * 0.38));
    const mediaX = x + border + matInset;
    const mediaY = y + border + matInset;
    const mediaWidth = even(Math.max(32, outerWidth - 2 * (border + matInset)));
    const mediaHeight = even(
      Math.max(32, outerHeight - 2 * (border + matInset) - captionHeight)
    );
    const shadowOffset = Math.max(
      4,
      Math.round(Math.min(outerWidth, outerHeight) * style.shadowOffsetRatio * (0.8 + frame.zDepth * 0.4))
    );
    const edge = Math.max(2, Math.round(border * 0.18));
    const frameBaseLabel = `[framebase${index}]`;
    const mediaLabel = `[media${index}]`;
    const overlaidLabel = `[overlaid${index}]`;
    const nextLabel = `[canvas${index + 1}]`;

    filters.push(
      `${currentLabel}drawbox=x=${x + shadowOffset}:y=${y + shadowOffset}:w=${outerWidth}:h=${outerHeight}:color=black@${style.shadowOpacity.toFixed(
        2
      )}:t=fill,drawbox=x=${x}:y=${y}:w=${outerWidth}:h=${outerHeight}:color=${style.outerColor}:t=fill,drawbox=x=${
        x + border
      }:y=${y + border}:w=${outerWidth - border * 2}:h=${outerHeight - border * 2}:color=${
        style.innerMatColor
      }:t=fill${frameBaseLabel}`
    );
    filters.push(
      `[${index + 1}:v]${buildMediaFilter(
        frame,
        mediaWidth,
        mediaHeight,
        options.section.durationSec,
        options.fps
      )}${mediaLabel}`
    );
    filters.push(
      `${frameBaseLabel}${mediaLabel}overlay=x=${mediaX}:y=${mediaY}:eof_action=repeat${overlaidLabel}`
    );

    const postFilters = [
      `drawbox=x=${x}:y=${y}:w=${outerWidth}:h=${outerHeight}:color=${style.edgeColor}:t=${edge}`
    ];
    if (caption) {
      const captionY = y + outerHeight - border - captionHeight;
      const fontSize = clamp(Math.round(Math.min(outerWidth / 20, outerHeight / 15)), 14, 34);
      const fontPart = fontPath ? `fontfile='${escapeForDrawtext(fontPath)}':` : "";
      postFilters.push(
        `drawbox=x=${x + border}:y=${captionY}:w=${outerWidth - border * 2}:h=${captionHeight}:color=${
          style.captionColor
        }@0.94:t=fill`,
        `drawtext=${fontPart}text='${escapeForDrawtext(caption)}':x=${
          x + border + Math.max(7, matInset)
        }:y=${captionY}+((${captionHeight}-text_h)/2):fontsize=${fontSize}:fontcolor=${
          style.captionTextColor
        }:borderw=1:bordercolor=black@0.12`
      );
    }
    filters.push(`${overlaidLabel}${postFilters.join(",")}${nextLabel}`);
    currentLabel = nextLabel;
  });

  filters.push(
    `${currentLabel}${buildCameraFilter({
      section: options.section,
      canvasWidth,
      canvasHeight,
      outputWidth: options.width,
      outputHeight: options.height,
      fps: options.fps
    })}[vout]`
  );

  await writeAtomicVideo({
    outputPath: options.outputPath,
    label: `Wall Frame section ${options.section.id}`,
    validation: buildValidationOptions({
      label: `Wall Frame section ${options.section.id}`,
      width: options.width,
      height: options.height,
      fps: options.fps,
      minDurationSec: options.section.durationSec - 0.2
    }),
    render: (temporaryOutputPath) =>
      runFfmpeg(
        [
          ...args,
          "-filter_complex",
          filters.join(";"),
          "-map",
          "[vout]",
          "-t",
          options.section.durationSec.toFixed(3),
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-r",
          `${options.fps}`,
          "-s",
          `${options.width}x${options.height}`,
          "-movflags",
          "+faststart",
          temporaryOutputPath
        ],
        undefined,
        { timeoutMs: Math.max(options.timeoutMs, options.section.durationSec * 10_000) }
      )
  });
}

function mapTransition(section: WallSection) {
  switch (section.transitionToNext?.type) {
    case "glide-left":
      return "smoothleft";
    case "glide-right":
      return "smoothright";
    default:
      return "fade";
  }
}

async function stitchWithTransitions(options: {
  plan: WallFrameRenderPlan;
  sectionPaths: string[];
  outputPath: string;
  timeoutMs: number;
}) {
  const { width, height, fps } = options.plan.renderSize;
  const args = ["-y"];
  options.sectionPaths.forEach((sectionPath) => args.push("-i", sectionPath));
  const filters = options.sectionPaths.map(
    (_, index) => `[${index}:v]settb=AVTB,setpts=PTS-STARTPTS[v${index}]`
  );
  let currentLabel = "[v0]";
  let currentDurationSec = options.plan.wallSections[0]!.durationSec;
  for (let index = 1; index < options.plan.wallSections.length; index += 1) {
    const previous = options.plan.wallSections[index - 1]!;
    const next = options.plan.wallSections[index]!;
    const overlap = previous.transitionToNext?.durationSec ?? 0;
    const outputLabel = `[xf${index}]`;
    filters.push(
      `${currentLabel}[v${index}]xfade=transition=${mapTransition(previous)}:duration=${overlap.toFixed(
        3
      )}:offset=${Math.max(0, currentDurationSec - overlap).toFixed(3)}${outputLabel}`
    );
    currentLabel = outputLabel;
    currentDurationSec += next.durationSec - overlap;
  }
  filters.push(`${currentLabel}fps=${fps},setsar=1,format=yuv420p[vout]`);

  return writeAtomicVideo({
    outputPath: options.outputPath,
    label: "stitched Wall Frame montage",
    validation: buildValidationOptions({
      label: "stitched Wall Frame montage",
      width,
      height,
      fps,
      minDurationSec: options.plan.durationSec - 0.3
    }),
    render: (temporaryOutputPath) =>
      runFfmpeg(
        [
          ...args,
          "-filter_complex",
          filters.join(";"),
          "-map",
          "[vout]",
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-r",
          `${fps}`,
          "-movflags",
          "+faststart",
          temporaryOutputPath
        ],
        undefined,
        { timeoutMs: Math.max(options.timeoutMs, options.plan.durationSec * 8_000) }
      )
  });
}

async function stitchWithCuts(options: {
  plan: WallFrameRenderPlan;
  sectionPaths: string[];
  outputPath: string;
  timeoutMs: number;
}) {
  const { width, height, fps } = options.plan.renderSize;
  const args = ["-y"];
  options.sectionPaths.forEach((sectionPath) => args.push("-i", sectionPath));
  const labels = options.sectionPaths
    .map((_, index) => `[${index}:v]settb=AVTB,setpts=PTS-STARTPTS[v${index}]`)
    .join(";");
  const inputs = options.sectionPaths.map((_, index) => `[v${index}]`).join("");
  const filter = `${labels};${inputs}concat=n=${options.sectionPaths.length}:v=1:a=0,fps=${fps},setsar=1,format=yuv420p[vout]`;
  const durationSec = options.plan.wallSections.reduce(
    (sum, section) => sum + section.durationSec,
    0
  );
  return writeAtomicVideo({
    outputPath: options.outputPath,
    label: "cut-stitched Wall Frame montage",
    validation: buildValidationOptions({
      label: "cut-stitched Wall Frame montage",
      width,
      height,
      fps,
      minDurationSec: durationSec - 0.3
    }),
    render: (temporaryOutputPath) =>
      runFfmpeg(
        [
          ...args,
          "-filter_complex",
          filter,
          "-map",
          "[vout]",
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-r",
          `${fps}`,
          "-movflags",
          "+faststart",
          temporaryOutputPath
        ],
        undefined,
        { timeoutMs: Math.max(options.timeoutMs, durationSec * 8_000) }
      )
  });
}

async function stitchSectionVideos(options: {
  plan: WallFrameRenderPlan;
  sectionPaths: string[];
  outputPath: string;
  timeoutMs: number;
}): Promise<RenderedWallVideo> {
  if (options.sectionPaths.length === 1) {
    const metadata = await writeAtomicVideo({
      outputPath: options.outputPath,
      label: "single-section Wall Frame montage",
      validation: buildValidationOptions({
        label: "single-section Wall Frame montage",
        width: options.plan.renderSize.width,
        height: options.plan.renderSize.height,
        fps: options.plan.renderSize.fps,
        minDurationSec: options.plan.durationSec - 0.2
      }),
      render: (temporaryOutputPath) =>
        runFfmpeg([
          "-y",
          "-i",
          options.sectionPaths[0]!,
          "-map",
          "0:v:0",
          "-an",
          "-c:v",
          "copy",
          "-movflags",
          "+faststart",
          temporaryOutputPath
        ])
    });
    return {
      videoPath: options.outputPath,
      durationSec: metadata.durationSec,
      sectionTimings: calculateWallSectionTimings(options.plan.wallSections),
      usedCutFallback: false
    };
  }

  try {
    const metadata = await stitchWithTransitions(options);
    return {
      videoPath: options.outputPath,
      durationSec: metadata.durationSec,
      sectionTimings: calculateWallSectionTimings(options.plan.wallSections),
      usedCutFallback: false
    };
  } catch (error) {
    console.warn(
      `[wall-frame] Smooth wall transitions failed; using stable cuts. ${summarizeError(error)}`
    );
    const metadata = await stitchWithCuts(options);
    let cursor = 0;
    const sectionTimings = options.plan.wallSections.map((section) => {
      const timing = {
        sectionId: section.id,
        startSec: round(cursor),
        endSec: round(cursor + section.durationSec),
        durationSec: section.durationSec,
        transitionOverlapSec: 0
      };
      cursor += section.durationSec;
      return timing;
    });
    return {
      videoPath: options.outputPath,
      durationSec: metadata.durationSec,
      sectionTimings,
      usedCutFallback: true
    };
  }
}

function collectAudioInputs(options: {
  plan: WallFrameRenderPlan;
  sectionTimings: WallFrameSectionTiming[];
  durationSec: number;
  preserveSourceAudio: boolean;
}) {
  const music: AudioInputSpec[] = options.plan.soundtrackPlan.segments
    .filter(
      (segment) =>
        segment.sourcePath && segment.durationSec > 0 && segment.startSec < options.durationSec
    )
    .map((segment) => ({
      kind: "music",
      sourcePath: segment.sourcePath,
      sourceOffsetSec: Math.max(0, segment.sourceOffsetSec),
      startSec: Math.max(0, segment.startSec),
      durationSec: Math.min(segment.durationSec, options.durationSec - segment.startSec),
      gain: toLinearGain(segment.volumeDb) * 0.58,
      fadeSec: clamp(segment.crossfadeSec || 0.35, 0.08, 1.5)
    }));
  const source: AudioInputSpec[] = [];

  if (options.preserveSourceAudio) {
    for (const timing of options.sectionTimings) {
      const section = options.plan.wallSections.find((item) => item.id === timing.sectionId);
      const frame = section?.frames.find(
        (item) => item.useSourceAudio && item.mediaType === "video" && item.audioSourcePath
      );
      if (!frame?.audioSourcePath) {
        continue;
      }
      const remainingSource = frame.sourceDurationSec
        ? Math.max(0.1, frame.sourceDurationSec - frame.trimStartSec)
        : timing.durationSec;
      source.push({
        kind: "source",
        sourcePath: frame.audioSourcePath,
        sourceOffsetSec: Math.max(0, frame.trimStartSec),
        startSec: timing.startSec,
        durationSec: Math.min(timing.durationSec, remainingSource),
        gain: 0.88,
        fadeSec: 0.22
      });
    }
  }
  return { music, source };
}

function createAudioMixFilter(inputs: AudioInputSpec[], durationSec: number, duckMusic: boolean) {
  const filters: string[] = [];
  const musicLabels: string[] = [];
  const sourceLabels: string[] = [];
  inputs.forEach((input, index) => {
    const label = `[a${index}]`;
    const fadeOutStart = Math.max(0, input.durationSec - input.fadeSec);
    const delayMs = Math.max(0, Math.round(input.startSec * 1000));
    filters.push(
      `[${index}:a]atrim=duration=${input.durationSec.toFixed(
        3
      )},asetpts=PTS-STARTPTS,volume=${input.gain.toFixed(5)},afade=t=in:st=0:d=${Math.min(
        input.fadeSec,
        input.durationSec / 2
      ).toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${Math.min(
        input.fadeSec,
        input.durationSec / 2
      ).toFixed(3)},adelay=${delayMs}|${delayMs}${label}`
    );
    (input.kind === "music" ? musicLabels : sourceLabels).push(label);
  });

  function mixGroup(labels: string[], name: string) {
    if (labels.length === 1) {
      filters.push(`${labels[0]}anull[${name}]`);
    } else if (labels.length > 1) {
      filters.push(
        `${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0[${name}]`
      );
    }
  }
  mixGroup(musicLabels, "music");
  mixGroup(sourceLabels, "source");

  let combinedLabel: string;
  if (musicLabels.length && sourceLabels.length && duckMusic) {
    filters.push(
      `[source]asplit=2[source_sc][source_mix]`,
      `[music][source_sc]sidechaincompress=threshold=0.045:ratio=7:attack=18:release=360[ducked]`,
      `[ducked][source_mix]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[combined]`
    );
    combinedLabel = "[combined]";
  } else if (musicLabels.length && sourceLabels.length) {
    filters.push(
      `[music][source]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[combined]`
    );
    combinedLabel = "[combined]";
  } else {
    combinedLabel = musicLabels.length ? "[music]" : "[source]";
  }
  filters.push(
    `${combinedLabel}apad=whole_dur=${durationSec.toFixed(
      3
    )},atrim=duration=${durationSec.toFixed(3)},alimiter=limit=0.94,aresample=48000[aout]`
  );
  return filters.join(";");
}

async function renderAudioBed(options: {
  inputs: AudioInputSpec[];
  outputPath: string;
  durationSec: number;
  duckMusic: boolean;
  timeoutMs: number;
}) {
  if (!options.inputs.length) {
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-t",
      options.durationSec.toFixed(3),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      options.outputPath
    ]);
    return;
  }

  const args = ["-y"];
  for (const input of options.inputs) {
    args.push(
      "-ss",
      input.sourceOffsetSec.toFixed(3),
      "-t",
      input.durationSec.toFixed(3),
      "-i",
      input.sourcePath
    );
  }
  await runFfmpeg(
    [
      ...args,
      "-filter_complex",
      createAudioMixFilter(options.inputs, options.durationSec, options.duckMusic),
      "-map",
      "[aout]",
      "-vn",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      options.outputPath
    ],
    undefined,
    { timeoutMs: options.timeoutMs }
  );
}

async function renderAudioWithFallback(options: {
  plan: WallFrameRenderPlan;
  sectionTimings: WallFrameSectionTiming[];
  durationSec: number;
  outputPath: string;
  preserveSourceAudio: boolean;
  timeoutMs: number;
}) {
  const inputs = collectAudioInputs(options);
  if (
    options.plan.soundtrackPlan.sourcePolicy === "user-uploaded-audio" &&
    inputs.music.length === 0
  ) {
    throw new Error("The uploaded MP3 soundtrack plan did not contain a usable audio segment.");
  }
  const combined = [...inputs.music, ...inputs.source];
  try {
    await renderAudioBed({
      inputs: combined,
      outputPath: options.outputPath,
      durationSec: options.durationSec,
      duckMusic: inputs.music.length > 0 && inputs.source.length > 0,
      timeoutMs: options.timeoutMs
    });
    return "none" as const;
  } catch (error) {
    console.warn(`[wall-frame] Full audio mix failed. ${summarizeError(error)}`);
  }

  if (inputs.music.length) {
    try {
      await renderAudioBed({
        inputs: inputs.music,
        outputPath: options.outputPath,
        durationSec: options.durationSec,
        duckMusic: false,
        timeoutMs: options.timeoutMs
      });
      return "music-only" as const;
    } catch (error) {
      console.warn(`[wall-frame] Music-only audio mix failed. ${summarizeError(error)}`);
      if (options.plan.soundtrackPlan.sourcePolicy === "user-uploaded-audio") {
        throw new Error(
          `The uploaded MP3 soundtrack could not be mixed into the Wall Frame output: ${summarizeError(
            error
          )}`
        );
      }
    }
  }

  await renderAudioBed({
    inputs: [],
    outputPath: options.outputPath,
    durationSec: options.durationSec,
    duckMusic: false,
    timeoutMs: options.timeoutMs
  });
  return "silent" as const;
}

async function muxWallVideo(options: {
  video: RenderedWallVideo;
  audioPath: string;
  outputPath: string;
  plan: WallFrameRenderPlan;
}) {
  const { width, height, fps } = options.plan.renderSize;
  return writeAtomicVideo({
    outputPath: options.outputPath,
    label: "Wall Frame master output",
    validation: buildValidationOptions({
      label: "Wall Frame master output",
      width,
      height,
      fps,
      minDurationSec: options.video.durationSec - 0.3
    }),
    render: (temporaryOutputPath) =>
      runFfmpeg([
        "-y",
        "-i",
        options.video.videoPath,
        "-i",
        options.audioPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        options.video.durationSec.toFixed(3),
        "-movflags",
        "+faststart",
        temporaryOutputPath
      ])
  });
}

async function renderCandidate(options: {
  plan: WallFrameRenderPlan;
  outputPath: string;
  tempDir: string;
  preserveSourceAudio: boolean;
  timeoutMs: number;
  progress: WallFrameRenderOptions["onProgress"];
}) {
  const { width, height, fps } = options.plan.renderSize;
  const sectionPaths: string[] = [];
  for (let index = 0; index < options.plan.wallSections.length; index += 1) {
    const section = options.plan.wallSections[index]!;
    const sectionPath = path.join(
      options.tempDir,
      `section-${String(index).padStart(3, "0")}.mp4`
    );
    sectionPaths.push(sectionPath);
    await renderWallSection({
      section,
      outputPath: sectionPath,
      width,
      height,
      fps,
      timeoutMs: options.timeoutMs
    });
    await options.progress?.({
      stage: "sections",
      progress: 0.1 + ((index + 1) / options.plan.wallSections.length) * 0.55,
      detail: `Rendered wall section ${index + 1} of ${options.plan.wallSections.length}.`
    });
  }

  await options.progress?.({ stage: "stitch", progress: 0.7, detail: "Gliding between wall sections." });
  const stitched = await stitchSectionVideos({
    plan: options.plan,
    sectionPaths,
    outputPath: path.join(options.tempDir, "wall-stitched.mp4"),
    timeoutMs: options.timeoutMs
  });
  const effectivePlan = stitched.usedCutFallback
    ? (() => {
        const wallSections = options.plan.wallSections.map((section) => ({
          ...section,
          transitionToNext: undefined
        }));
        const candidate: WallFrameRenderPlan = {
          ...options.plan,
          wallSections,
          durationSec: calculateWallFrameDuration(wallSections),
          fallbackLevel:
            options.plan.fallbackLevel === "none" ? "repaired" : options.plan.fallbackLevel
        };
        const validationReport = validateWallFrameRenderPlan(candidate);
        validationReport.repairs = [
          ...options.plan.validationReport.repairs,
          {
            type: "transition-fallback",
            targetId: candidate.id,
            detail: "Replaced unsupported smooth wall transitions with stable cuts."
          }
        ];
        return { ...candidate, validationReport };
      })()
    : options.plan;
  await options.progress?.({ stage: "audio", progress: 0.82, detail: "Mixing soundtrack and memory audio." });
  const audioPath = path.join(options.tempDir, "wall-audio.m4a");
  const audioFallback = await renderAudioWithFallback({
    plan: effectivePlan,
    sectionTimings: stitched.sectionTimings,
    durationSec: stitched.durationSec,
    outputPath: audioPath,
    preserveSourceAudio: options.preserveSourceAudio,
    timeoutMs: options.timeoutMs
  });
  await options.progress?.({ stage: "mux", progress: 0.92, detail: "Writing the Wall Frame master." });
  const metadata = await muxWallVideo({
    video: stitched,
    audioPath,
    outputPath: options.outputPath,
    plan: effectivePlan
  });
  return { metadata, audioFallback, plan: effectivePlan, transitionFallbackUsed: stitched.usedCutFallback };
}

export class WallFrameRenderStrategy {
  async render(options: WallFrameRenderOptions): Promise<WallFrameRenderResult> {
    const attempts: string[] = [];
    const timeoutMs = Math.max(30_000, options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS);
    const tempRoot = options.tempRoot ?? path.join(path.dirname(options.outputPath), ".wall-frame-temp");
    const runDir = path.join(
      tempRoot,
      `${options.plan.id}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    );
    await mkdir(runDir, { recursive: true });
    let success = false;

    try {
      await options.onProgress?.({ stage: "validate", progress: 0.03, detail: "Validating Wall Frame layout." });
      const repaired = validateAndRepairWallFramePlan(options.plan).plan;
      const candidates = [repaired];
      const simpleFallback = buildSimpleWallFrameFallback(repaired);
      if (simpleFallback.id !== repaired.id) {
        candidates.push(simpleFallback);
      }

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]!;
        try {
          assertValidWallFramePlan(candidate);
          if (index > 0) {
            await options.onProgress?.({
              stage: "fallback",
              progress: 0.08,
              detail: "Retrying with a simpler Wall Frame layout."
            });
          }
          const candidateDir = path.join(runDir, `attempt-${index + 1}`);
          await mkdir(candidateDir, { recursive: true });
          const rendered = await renderCandidate({
            plan: candidate,
            outputPath: options.outputPath,
            tempDir: candidateDir,
            preserveSourceAudio: options.preserveSourceAudio !== false,
            timeoutMs,
            progress: options.onProgress
          });
          const metadata = await assertValidVideoFile(options.outputPath, {
            ...buildValidationOptions({
              label: "completed Wall Frame master",
              width: candidate.renderSize.width,
              height: candidate.renderSize.height,
              fps: candidate.renderSize.fps,
              minDurationSec: rendered.metadata.durationSec - 0.15
            }),
            decode: true
          });
          if (options.renderPlanPath) {
            await mkdir(path.dirname(options.renderPlanPath), { recursive: true });
            await writeFile(options.renderPlanPath, JSON.stringify(rendered.plan, null, 2), "utf8");
          }
          success = true;
          return {
            outputPath: options.outputPath,
            durationSec: metadata.durationSec,
            outputMetadata: metadata,
            plan: rendered.plan,
            fallbackUsed:
              rendered.plan.fallbackLevel !== "none" ||
              rendered.transitionFallbackUsed ||
              index > 0,
            audioFallback: rendered.audioFallback,
            attempts
          };
        } catch (error) {
          const detail = `Attempt ${index + 1} (${candidate.fallbackLevel}) failed: ${summarizeError(error)}`;
          attempts.push(detail);
          console.warn(`[wall-frame] ${detail}`);
        }
      }
      throw new Error(`Wall Frame rendering failed. ${attempts.join(" ")}`);
    } finally {
      if (success && !options.keepTemporaryFiles) {
        await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}

export async function renderWallFramePlan(options: WallFrameRenderOptions) {
  return new WallFrameRenderStrategy().render(options);
}
