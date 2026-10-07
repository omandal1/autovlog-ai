import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { analyzeDuplicateMedia } from "@/lib/analysis/duplicate-detector";
import { clusterRecurringFaces } from "@/lib/analysis/face-clustering";
import { applyQualityTiers } from "@/lib/analysis/quality-filter";
import { enrichAssetsWithTranscription } from "@/lib/analysis/transcription";
import { analyzeMp3FileWithFallback } from "@/lib/audio/soundtrack-analysis";
import { balanceChapterSoundtracks } from "@/lib/audio/chapter-soundtrack-balancer";
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/constants";
import { createStoryPlan } from "@/lib/story/story-planner";
import { enrichAssetsWithEditorialAnalysis } from "@/lib/editorial/editorial-planner";
import type {
  GenerationSettings,
  MediaAsset,
  ProjectRecord as RenderProjectRecord,
  ProjectSettings,
  SoundtrackAnalysis,
  ThemePreset,
  Timeline,
  UploadedSoundtrack
} from "@/lib/types";
import {
  deriveLegacySettingsFromGeneration,
  normalizeGenerationSettings,
  normalizeProjectSettings
} from "@/lib/user-controls/generation-settings";
import { runWithConcurrency } from "@/lib/utils";
import { extractMetadata } from "@/media-processing/metadata";
import { preprocessAsset } from "@/media-processing/preprocess";
import {
  validateMediaSource,
  validateSoundtrackSource
} from "@/media-processing/validation";
import { renderTimeline } from "@/render/render-service";
import { mergePythonSuggestions, scoreAssetsWithHeuristics } from "@/scoring/heuristics";
import { requestChapterLabels, requestPythonSuggestions } from "@/scoring/python-service";
import { runFfmpeg } from "@/scripts/ffmpeg";
import { applyChapterLabels, buildChapters } from "@/timeline/chaptering";
import { buildProjectTimelines } from "@/timeline/generator";
import { normalizeWallFrameSettings } from "@/lib/wall-frame/style-registry";
import type { WallFrameStyleSettings } from "@/lib/wall-frame/types";

import type {
  JsonObject,
  MediaAssetRecord,
  ProjectRecord,
  SoundtrackAssetRecord
} from "./models";
import type {
  PipelineRenderInput,
  PipelineRenderRuntime,
  ProjectPipelineAdapter
} from "./pipeline";
import type { AutoVlogRepository } from "./repository";

const THEMES = new Set<ThemePreset>([
  "scrapbook",
  "yearbook",
  "photo-album",
  "cinematic-journal",
  "minimal-clean"
]);
const PACING = new Set<GenerationSettings["pacing"]>([
  "fast",
  "balanced",
  "slow-sentimental"
]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function existingString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

async function fileExists(filePath?: string) {
  if (!filePath) {
    return false;
  }
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function processingPaths(projectRoot: string, asset: MediaAssetRecord) {
  return {
    thumbnailPath: path.join(projectRoot, "processed", "thumbnails", `${asset.id}.jpg`),
    normalizedPath: path.join(projectRoot, "processed", "frames", `${asset.id}-normalized.jpg`),
    proxyPath: path.join(projectRoot, "processed", "proxies", `${asset.id}.mp4`),
    keyframeDir: path.join(projectRoot, "processed", "frames", asset.id)
  };
}

function createGenerationSettings(project: ProjectRecord): GenerationSettings {
  const settings = asObject(project.settings);
  const diarySettings = asObject(settings.diaryStyleSettings);
  const requestedTheme = existingString(diarySettings.themePreset) ?? existingString(settings.theme);
  const requestedPacing = existingString(diarySettings.pacing) ?? existingString(settings.pacing);
  const themePreset = THEMES.has(requestedTheme as ThemePreset)
    ? (requestedTheme as ThemePreset)
    : DEFAULT_GENERATION_SETTINGS.themePreset;
  const pacing = PACING.has(requestedPacing as GenerationSettings["pacing"])
    ? (requestedPacing as GenerationSettings["pacing"])
    : DEFAULT_GENERATION_SETTINGS.pacing;

  return normalizeGenerationSettings({
    ...DEFAULT_GENERATION_SETTINGS,
    ...(settings as Partial<GenerationSettings>),
    generationMode: project.generationMode,
    themePreset,
    pacing,
    wallFrameStyleSettings: normalizeWallFrameSettings(
      asObject(settings.wallFrameStyleSettings) as Partial<WallFrameStyleSettings>
    )
  });
}

function selectedSoundtrackIds(project: ProjectRecord) {
  const raw = asObject(project.settings).uploadedSoundtrackIds;
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === "string")
    : [];
}

function createProjectSettings(
  project: ProjectRecord,
  soundtracks: UploadedSoundtrack[]
): ProjectSettings {
  const generation = createGenerationSettings(project);
  const legacy = deriveLegacySettingsFromGeneration(generation);
  const strategy = asObject(project.settings).soundtrackStrategy === "track-order"
    ? "track-order"
    : "auto-select-best-segments";

  return normalizeProjectSettings({
    ...legacy,
    generation,
    musicSelection: {
      sourcePolicy: soundtracks.length ? "user-uploaded-audio" : "internal-licensed",
      exportPolicy: soundtracks.length ? "direct-user-audio" : "internal-licensed",
      note: soundtracks.length
        ? "Using only this project's uploaded MP3 soundtracks."
        : "Using the built-in royalty-free fallback because no MP3 is attached.",
      uploadedSoundtracks: soundtracks,
      preferredTrackOrder: soundtracks.map((track) => track.id),
      soundtrackStrategy: strategy
    }
  });
}

function storedAnalysis(record: SoundtrackAssetRecord): SoundtrackAnalysis | undefined {
  const analysis = asObject(record.analysis);
  const durationSec = Number(record.duration ?? analysis.durationSec);
  const stableStartSec = Number(analysis.stableStartSec);
  const stableEndSec = Number(analysis.stableEndSec);
  const energyScore = Number(analysis.energyScore);
  if (
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    !Number.isFinite(stableStartSec) ||
    !Number.isFinite(stableEndSec) ||
    !Number.isFinite(energyScore)
  ) {
    return undefined;
  }
  return {
    ...(analysis as unknown as SoundtrackAnalysis),
    durationSec,
    stableStartSec,
    stableEndSec,
    energyScore
  };
}

function toUploadedSoundtrack(record: SoundtrackAssetRecord, analysis: SoundtrackAnalysis) {
  return {
    id: record.id,
    filename: record.originalFilename,
    title: record.originalFilename.replace(/\.mp3$/i, ""),
    artist: "Uploaded MP3",
    path: record.localPath,
    mimeType: record.mimeType,
    byteSize: record.size,
    status: "ready",
    analysis
  } satisfies UploadedSoundtrack;
}

export class AutoVlogPipelineAdapter implements ProjectPipelineAdapter {
  readonly available = true;

  constructor(private readonly repository: AutoVlogRepository) {}

  async mediaUploaded(project: ProjectRecord, media: MediaAssetRecord[]) {
    await runWithConcurrency(
      media,
      8,
      async (record, uploadOrder) => {
        try {
          const validation = await validateMediaSource(record.localPath, record.type);
          if (!validation.valid) {
            throw new Error(validation.reason ?? "Uploaded media is invalid.");
          }
          const metadata = await extractMetadata({
            filePath: record.localPath,
            filename: record.originalFilename,
            mimeType: record.mimeType,
            byteSize: record.size,
            mediaType: record.type,
            uploadOrder
          });
          await this.repository.updateMedia(project.userId, project.id, record.id, {
            duration: metadata.durationSec,
            width: metadata.width,
            height: metadata.height,
            metadata: asJsonObject(metadata),
            analysis: { validationStatus: "valid" }
          });
        } catch (error) {
          await this.repository.updateMedia(project.userId, project.id, record.id, {
            analysis: { ingestError: messageFrom(error).slice(0, 1_000) }
          });
        }
      }
    );
  }

  async soundtracksUploaded(project: ProjectRecord, soundtracks: SoundtrackAssetRecord[]) {
    await runWithConcurrency(
      soundtracks,
      4,
      async (record) => {
        try {
          const validation = await validateSoundtrackSource(record.localPath);
          if (!validation.valid) {
            throw new Error(validation.reason ?? "Uploaded soundtrack is invalid.");
          }
          const analysis = await analyzeMp3FileWithFallback(
            record.localPath,
            record.originalFilename
          );
          await this.repository.updateSoundtrack(project.userId, project.id, record.id, {
            duration: analysis.durationSec,
            bitrate: analysis.bitrateKbps,
            sampleRate: analysis.sampleRateHz,
            channels: analysis.channels,
            analysis: asJsonObject(analysis)
          });
        } catch (error) {
          await this.repository.updateSoundtrack(project.userId, project.id, record.id, {
            analysis: { error: messageFrom(error).slice(0, 1_000) }
          });
        }
      }
    );
  }

  private async prepareSoundtracks(
    input: PipelineRenderInput,
    runtime: PipelineRenderRuntime
  ) {
    const requestedIds = selectedSoundtrackIds(input.project);
    const requested = requestedIds.length
      ? input.soundtracks.filter((record) => requestedIds.includes(record.id))
      : input.soundtracks;
    const prepared = await runWithConcurrency<SoundtrackAssetRecord, UploadedSoundtrack | undefined>(
      requested,
      3,
      async (record) => {
      try {
        const safePath = await runtime.storage.getSoundtrackPath(
          input.user.id,
          input.project.id,
          record.localPath
        );
        const validation = await validateSoundtrackSource(safePath);
        if (!validation.valid) {
          throw new Error(validation.reason ?? "Soundtrack validation failed.");
        }
        const analysis =
          storedAnalysis(record) ??
          (await analyzeMp3FileWithFallback(safePath, record.originalFilename));
        await this.repository.updateSoundtrack(input.user.id, input.project.id, record.id, {
          duration: analysis.durationSec,
          bitrate: analysis.bitrateKbps,
          sampleRate: analysis.sampleRateHz,
          channels: analysis.channels,
          analysis: asJsonObject({ ...analysis, validationStatus: "valid" })
        });
        return toUploadedSoundtrack({ ...record, localPath: safePath }, analysis);
      } catch (error) {
        await this.repository.updateSoundtrack(input.user.id, input.project.id, record.id, {
          analysis: {
            validationStatus: "invalid",
            error: messageFrom(error).slice(0, 1_000)
          }
        });
        return undefined;
      }
      }
    );
    const result = prepared.filter(isDefined);
    if (requested.length > 0 && result.length === 0) {
      throw new Error("None of the selected MP3 soundtrack files passed audio validation.");
    }
    return result;
  }

  private async prepareMedia(
    input: PipelineRenderInput,
    runtime: PipelineRenderRuntime,
    projectRoot: string
  ) {
    await runtime.updateProgress(7, "VALIDATING_MEDIA · checking uploads");
    const candidates = await runWithConcurrency<MediaAssetRecord, MediaAsset | undefined>(
      input.media,
      8,
      async (record, uploadOrder) => {
      try {
        const originalPath = await runtime.storage.getMediaPath(
          input.user.id,
          input.project.id,
          record.localPath
        );
        const validation = await validateMediaSource(originalPath, record.type);
        if (!validation.valid) {
          throw new Error(validation.reason ?? "Media validation failed.");
        }
        const metadata = await extractMetadata({
          filePath: originalPath,
          filename: record.originalFilename,
          mimeType: record.mimeType,
          byteSize: record.size,
          mediaType: record.type,
          uploadOrder
        });
        const derived = processingPaths(projectRoot, record);
        return {
          id: record.id,
          projectId: input.project.id,
          filename: record.originalFilename,
          mediaType: record.type,
          uploadOrder,
          storage: {
            originalPath,
            thumbnailPath: derived.thumbnailPath,
            normalizedPath: record.type === "image" ? derived.normalizedPath : undefined,
            proxyPath: record.type === "video" ? derived.proxyPath : undefined,
            keyframeDir: record.type === "video" ? derived.keyframeDir : undefined
          },
          metadata: {
            ...metadata,
            durationSec: metadata.durationSec ?? validation.durationSec,
            width: metadata.width ?? validation.width,
            height: metadata.height ?? validation.height
          },
          userState: { pinned: false, excluded: false },
          analysis: { selectionReasons: [], skipReasons: [] }
        } satisfies MediaAsset;
      } catch (error) {
        const validationError = messageFrom(error).slice(0, 1_000);
        await this.repository.updateMedia(input.user.id, input.project.id, record.id, {
          analysis: {
            ...record.analysis,
            validationStatus: "invalid",
            validationError
          }
        });
        console.warn(`[render:${input.renderJob.id}] Skipping invalid media ${record.id}: ${validationError}`);
        return undefined;
      }
      }
    );
    const baseAssets = candidates.filter(isDefined);
    if (!baseAssets.length) {
      throw new Error("No uploaded photos or videos passed media validation.");
    }

    await runtime.updateProgress(13, "PREPARING_MEDIA · building or reusing proxies");
    const prepared = await runWithConcurrency<MediaAsset, MediaAsset | undefined>(
      baseAssets,
      3,
      async (asset) => {
      try {
        return await preprocessAsset(asset);
      } catch (error) {
        const processingError = messageFrom(error).slice(0, 1_000);
        await this.repository.updateMedia(input.user.id, input.project.id, asset.id, {
          analysis: { validationStatus: "invalid", processingError }
        });
        console.warn(`[render:${input.renderJob.id}] Skipping unprocessable media ${asset.id}: ${processingError}`);
        return undefined;
      }
      }
    );
    const preprocessed = prepared.filter(isDefined);
    if (!preprocessed.length) {
      throw new Error("No validated media could be prepared for rendering.");
    }
    await runtime.updateProgress(22, "ANALYZING_MEDIA · scoring memories");
    let scored: MediaAsset[] = await scoreAssetsWithHeuristics(preprocessed);
    try {
      scored = mergePythonSuggestions(scored, await requestPythonSuggestions(scored));
    } catch {
      // The optional Python analysis sidecar is not required for a valid local render.
    }

    await runtime.updateProgress(29, "ANALYZING_MEDIA · finding story moments");
    let transcribed: MediaAsset[] = scored;
    try {
      transcribed = await enrichAssetsWithTranscription(scored);
    } catch {
      // Keep the deterministic local analysis if the Python sidecar is offline.
    }
    const analyzed = enrichAssetsWithEditorialAnalysis(
      applyQualityTiers(clusterRecurringFaces(analyzeDuplicateMedia(transcribed)))
    );

    await runWithConcurrency(
      analyzed,
      8,
      async (asset) => {
        const thumbnailPath = (await fileExists(asset.storage.thumbnailPath))
          ? asset.storage.thumbnailPath
          : undefined;
        const proxyPath = (await fileExists(asset.storage.proxyPath))
          ? asset.storage.proxyPath
          : undefined;
        await this.repository.updateMedia(input.user.id, input.project.id, asset.id, {
          ...(thumbnailPath ? { thumbnailPath } : {}),
          ...(proxyPath ? { proxyPath } : {}),
          duration: asset.metadata.durationSec,
          width: asset.metadata.width,
          height: asset.metadata.height,
          metadata: asJsonObject(asset.metadata),
          analysis: asJsonObject({
            ...asset.analysis,
            validationStatus: "valid",
            score: asset.score,
            fingerprints: asset.fingerprints
          })
        });
      }
    );

    let firstThumbnail: string | undefined;
    for (const asset of analyzed) {
      if (await fileExists(asset.storage.thumbnailPath)) {
        firstThumbnail = asset.storage.thumbnailPath;
        break;
      }
    }
    if (firstThumbnail) {
      await this.repository.updateProject(input.user.id, input.project.id, {
        thumbnailPath: firstThumbnail
      });
    }
    return analyzed;
  }

  async render(input: PipelineRenderInput, runtime: PipelineRenderRuntime) {
    const projectRoot = await runtime.storage.getProjectStorageRoot(
      input.user.id,
      input.project.id
    );
    const jobTempRoot = await runtime.storage.getRenderTempRoot(
      input.user.id,
      input.project.id,
      input.renderJob.id
    );
    const metadataRoot = path.join(projectRoot, "metadata");
    await mkdir(metadataRoot, { recursive: true });

    await runtime.updateProgress(4, "VALIDATING_MEDIA · validating project files");
    const soundtracks = await this.prepareSoundtracks(input, runtime);
    const assets = await this.prepareMedia(input, runtime, projectRoot);
    const renderableAssets = assets.filter(
      (asset) => asset.analysis?.qualityTier !== "excluded"
    );
    const planningAssets = renderableAssets.length ? renderableAssets : assets;
    if (!planningAssets.length) {
      throw new Error("No usable photos or videos remain for this render.");
    }

    const settings = createProjectSettings(input.project, soundtracks);
    let chapters: RenderProjectRecord["chapters"] = buildChapters(
      input.project.id,
      planningAssets
    );
    try {
      chapters = applyChapterLabels(
        chapters,
        await requestChapterLabels(chapters, planningAssets)
      );
    } catch {
      chapters = applyChapterLabels(chapters, []);
    }
    const now = new Date().toISOString();
    let renderProject: RenderProjectRecord = {
      id: input.project.id,
      ownerUserId: input.user.id,
      name: input.project.title,
      createdAt: input.project.createdAt.toISOString(),
      updatedAt: now,
      status: "processing",
      stage: "timeline",
      settings,
      assetCount: planningAssets.length,
      assets: planningAssets,
      chapters,
      outputs: [],
      timelinePaths: { chapters: [] }
    };
    renderProject = {
      ...renderProject,
      storyPlan: createStoryPlan(renderProject)
    };

    await runtime.updateProgress(36, "PLANNING_STORY · building editorial decisions");
    const built = buildProjectTimelines(renderProject);
    const timelines: Timeline[] = balanceChapterSoundtracks([built.masterTimeline, ...built.chapterTimelines]);
    const progressSpan = 58 / Math.max(1, timelines.length);

    for (let index = 0; index < timelines.length; index += 1) {
      const timeline = timelines[index]!;
      const type = input.project.generationMode === "wall-frame"
        ? timeline.kind === "master"
          ? "wall-frame-master"
          : "wall-frame-cluster"
        : timeline.kind;
      const directory = input.project.generationMode === "wall-frame" ? "wall-frame" : timeline.kind;
      const outputPath = await runtime.storage.allocateRenderOutputPath(
        input.user.id,
        input.project.id,
        directory,
        `${input.project.title}-${type}-${index + 1}.mp4`
      );
      const timelinePath = path.join(
        metadataRoot,
        `${input.renderJob.id}-${timeline.id}-timeline.json`
      );
      const renderPlanPath = path.join(
        metadataRoot,
        `${input.renderJob.id}-${timeline.id}-render-plan.json`
      );
      const baseProgress = 36 + index * progressSpan;
      await runtime.updateProgress(baseProgress, `BUILDING_VISUALS · rendering ${type}`);
      const output = await renderTimeline(renderProject, timeline, {
        outputPath,
        timelinePath,
        renderPlanPath,
        tempRoot: jobTempRoot,
        onProgress: async (update) => {
          const stage = /mix|audio|soundtrack/i.test(update.detail)
            ? "MIXING_AUDIO"
            : /final encod|mux/i.test(update.detail)
              ? "FINAL_ENCODING"
              : /validat/i.test(update.detail)
                ? "VALIDATING_OUTPUT"
                : "RENDERING_SEGMENTS";
          await runtime.updateProgress(
            baseProgress + update.progress * progressSpan,
            `${stage} · ${type}: ${update.detail}`
          );
        }
      });
      const outputThumbnailPath = path.join(
        projectRoot,
        "processed",
        "thumbnails",
        `${input.renderJob.id}-${timeline.id}-output.jpg`
      );
      const thumbnailPath = await runFfmpeg([
        "-y",
        "-ss",
        "0.25",
        "-i",
        output.outputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black",
        outputThumbnailPath
      ])
        .then(() => outputThumbnailPath)
        .catch(() => undefined);
      await this.repository.updateRenderJob(
        input.user.id,
        input.project.id,
        input.renderJob.id,
        { renderPlanPath: input.project.generationMode === "wall-frame" ? renderPlanPath : timelinePath }
      );
      await runtime.registerOutput({
        type,
        title: output.title,
        localPath: output.outputPath,
        duration: output.durationSec,
        thumbnailPath
      });
    }
    await runtime.updateProgress(96, "VALIDATING_OUTPUT · finalizing outputs");
  }
}
