import path from "path";

import { analyzeDuplicateMedia } from "@/lib/analysis/duplicate-detector";
import { clusterRecurringFaces } from "@/lib/analysis/face-clustering";
import { applyQualityTiers } from "@/lib/analysis/quality-filter";
import { enrichAssetsWithTranscription } from "@/lib/analysis/transcription";
import { analyzeMp3FileWithFallback, validateMp3Upload } from "@/lib/audio/soundtrack-analysis";
import { SOUNDTRACK_UPLOAD_POLICY } from "@/lib/constants";
import { createId } from "@/lib/ids";
import { buildPreviewPlanVariants } from "@/lib/preview/preview-plan-builder";
import { validatePreviewPlans } from "@/lib/preview/preview-plan-validator";
import type {
  GenerationSettings,
  MediaAsset,
  PipelineStage,
  PreviewPlan,
  PreviewRegenerationMode,
  ProjectRecord,
  ProjectSettings,
  Timeline,
  UserMediaState
} from "@/lib/types";
import { mergeProjectSettings, normalizeProjectSettings } from "@/lib/user-controls/generation-settings";
import { runWithConcurrency } from "@/lib/utils";
import { extractMetadata, inferMediaType } from "@/media-processing/metadata";
import { preprocessAsset } from "@/media-processing/preprocess";
import { renderProjectTimelines } from "@/render/render-service";
import { mergePythonSuggestions, scoreAssetsWithHeuristics } from "@/scoring/heuristics";
import {
  requestChapterLabels,
  requestPythonSuggestions
} from "@/scoring/python-service";
import {
  createProjectRecord,
  getProjectPaths,
  listProjectSummaries,
  readProjectRecord,
  saveProjectRecord,
  saveProjectMusicBuffer,
  saveUploadBuffer,
  writeJson
} from "@/storage/local-storage";
import { applyChapterLabels, buildChapters } from "@/timeline/chaptering";

const activeJobs = new Map<string, Promise<unknown>>();

interface RefreshPreviewOptions {
  mode?: PreviewRegenerationMode;
  settingsPatch?: Partial<ProjectSettings> & {
    generation?: Partial<GenerationSettings>;
  };
  clearOutputs?: boolean;
}

async function updateProject(
  projectId: string,
  updater: (record: ProjectRecord) => ProjectRecord | Promise<ProjectRecord>
) {
  const record = await readProjectRecord(projectId);
  const updated = await updater(record);
  await saveProjectRecord(updated);
  return updated;
}

async function assertProjectAccess(projectId: string, requesterUserId?: string) {
  const record = await readProjectRecord(projectId);
  if (record.ownerUserId && record.ownerUserId !== requesterUserId) {
    throw new Error("Project not found.");
  }
  return record;
}

function statusForStage(stage: PipelineStage): ProjectRecord["status"] {
  if (stage === "complete") {
    return "ready";
  }
  if (stage === "failed") {
    return "failed";
  }
  if (stage === "preview") {
    return "preview";
  }
  return "processing";
}

async function markStage(projectId: string, stage: PipelineStage) {
  return updateProject(projectId, (record) => ({
    ...record,
    stage,
    status: statusForStage(stage)
  }));
}

function createAssetRecord(projectId: string, fileName: string, uploadOrder: number, originalPath: string) {
  const assetId = createId("asset");
  return {
    id: assetId,
    projectId,
    filename: fileName,
    uploadOrder,
    mediaType: inferMediaType(fileName)!,
    storage: {
      originalPath,
      thumbnailPath: path.join(getProjectPaths(projectId).thumbnailsDir, `${assetId}.jpg`)
    },
    metadata: {
      capturedAtSource: "upload_order",
      extension: path.extname(fileName).toLowerCase(),
      mimeType: "application/octet-stream",
      byteSize: 0
    },
    userState: {
      pinned: false,
      excluded: false
    },
    analysis: {
      selectionReasons: [],
      skipReasons: []
    }
  } satisfies Partial<MediaAsset>;
}

function activeRenderableAssets(assets: MediaAsset[]) {
  return assets.filter(
    (asset) =>
      !asset.userState?.excluded &&
      asset.analysis?.qualityTier !== "excluded"
  );
}

async function persistTimelines(project: ProjectRecord, timelines: Timeline[]) {
  const paths = getProjectPaths(project.id);
  const masterTimeline = timelines.find((timeline) => timeline.kind === "master");
  const chapterTimelines = timelines.filter((timeline) => timeline.kind === "chapter");

  for (const timeline of timelines) {
    await writeJson(path.join(paths.timelinesDir, `${timeline.id}.json`), timeline);
  }

  return updateProject(project.id, (record) => ({
    ...record,
    timelinePaths: {
      master: masterTimeline ? path.join(paths.timelinesDir, `${masterTimeline.id}.json`) : undefined,
      chapters: chapterTimelines.map((timeline) => path.join(paths.timelinesDir, `${timeline.id}.json`))
    }
  }));
}

function findPreviewPlan(record: ProjectRecord, planId?: string) {
  const previewPlans = record.previewPlans ?? [];
  if (!previewPlans.length) {
    return undefined;
  }

  return (
    previewPlans.find((plan) => plan.id === planId) ??
    previewPlans.find((plan) => plan.id === record.selectedPlanId) ??
    previewPlans.find((plan) => plan.isPrimary) ??
    previewPlans[0]
  );
}

async function persistSelectedPreviewPlan(projectId: string, plan: PreviewPlan) {
  const record = await readProjectRecord(projectId);
  const updated = await persistTimelines(record, [plan.masterTimeline, ...plan.chapterTimelines]);
  return updateProject(projectId, () => ({
    ...updated,
    selectedPlanId: plan.id,
    storyPlan: plan.storyPlan
  }));
}

async function enrichAnalyzedAssets(assets: MediaAsset[]) {
  const transcribed = await enrichAssetsWithTranscription(assets);
  const duplicateAnalyzed = analyzeDuplicateMedia(transcribed);
  const clustered = clusterRecurringFaces(duplicateAnalyzed);
  return applyQualityTiers(clustered);
}

async function saveAndAnalyzeSoundtracks(projectId: string, files: File[]) {
  const limitedFiles = files.slice(0, SOUNDTRACK_UPLOAD_POLICY.maxTracks);
  const soundtracks = [];

  for (const file of limitedFiles) {
    validateMp3Upload(file);
    const buffer = Buffer.from(await file.arrayBuffer());
    const soundtrackPath = await saveProjectMusicBuffer(projectId, file.name, buffer);
    const id = createId("snd", 8);
    try {
      const analysis = await analyzeMp3FileWithFallback(soundtrackPath, file.name);
      soundtracks.push({
        id,
        filename: file.name,
        title: file.name.replace(/\.mp3$/i, ""),
        artist: "Uploaded MP3",
        path: soundtrackPath,
        mimeType: file.type || "audio/mpeg",
        byteSize: buffer.length,
        status: "ready" as const,
        analysis
      });
    } catch (error) {
      throw new Error(
        `${file.name} could not be analyzed as a usable MP3${
          error instanceof Error ? `: ${error.message}` : "."
        }`
      );
    }
  }

  return soundtracks;
}

function buildPreviewVariants(project: ProjectRecord, mode: PreviewRegenerationMode = "full-plan") {
  const previewPlans = validatePreviewPlans(buildPreviewPlanVariants(project, mode));
  if (!previewPlans.length) {
    throw new Error("Unable to build any preview plans from the current media set.");
  }
  return previewPlans;
}

async function refreshProjectPreview(
  projectId: string,
  options: RefreshPreviewOptions = {}
) {
  if (options.settingsPatch) {
    await updateProject(projectId, (record) => ({
      ...record,
      settings: mergeProjectSettings(record.settings, options.settingsPatch!),
      error: undefined
    }));
  }

  const current = await readProjectRecord(projectId);
  const renderableAssets = activeRenderableAssets(current.assets);
  if (!renderableAssets.length) {
    throw new Error("At least one non-excluded asset must remain available for the preview.");
  }

  await markStage(projectId, "group");
  let chapters: ProjectRecord["chapters"] = buildChapters(
    projectId,
    renderableAssets
  ) as ProjectRecord["chapters"];
  try {
    chapters = applyChapterLabels(
      chapters,
      await requestChapterLabels(chapters, renderableAssets)
    );
  } catch {
    chapters = applyChapterLabels(chapters, []);
  }

  await markStage(projectId, "story");
  const projectForPlanning = await updateProject(projectId, (record) => ({
    ...record,
    chapters,
    outputs: options.clearOutputs ?? true ? [] : record.outputs,
    error: undefined
  }));

  await markStage(projectId, "timeline");
  const previewPlans = buildPreviewVariants(projectForPlanning, options.mode);
  const selectedPlan = previewPlans.find((plan) => plan.isPrimary) ?? previewPlans[0]!;

  await updateProject(projectId, (record) => ({
    ...record,
    chapters,
    storyPlan: selectedPlan.storyPlan,
    previewPlans,
    selectedPlanId: selectedPlan.id,
    outputs: options.clearOutputs ?? true ? [] : record.outputs,
    status: "preview",
    stage: "preview",
    error: undefined
  }));

  await persistSelectedPreviewPlan(projectId, selectedPlan);
  return readProjectRecord(projectId);
}

export async function createProjectFromFiles(
  files: File[],
  settings: ProjectSettings,
  options?: {
    ownerUserId?: string;
    soundtrackFile?: File | null;
    soundtrackFiles?: File[];
  }
) {
  const supportedFiles = files.filter((file) => inferMediaType(file.name));
  if (!supportedFiles.length) {
    throw new Error("No supported media files were uploaded.");
  }

  const normalizedSettings = normalizeProjectSettings(settings);
  const record = await createProjectRecord(normalizedSettings, options?.ownerUserId);
  const assets: MediaAsset[] = [];

  for (let index = 0; index < supportedFiles.length; index += 1) {
    const file = supportedFiles[index]!;
    const buffer = Buffer.from(await file.arrayBuffer());
    const originalPath = await saveUploadBuffer(record.id, file.name, buffer);
    const baseAsset = createAssetRecord(record.id, file.name, index, originalPath);
    const metadata = await extractMetadata({
      filePath: originalPath,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: buffer.length,
      mediaType: baseAsset.mediaType,
      uploadOrder: index,
      lastModifiedMs: file.lastModified
    });

    assets.push({
      ...baseAsset,
      metadata,
      storage: {
        originalPath,
        thumbnailPath: path.join(getProjectPaths(record.id).thumbnailsDir, `${baseAsset.id}.jpg`)
      }
    } as MediaAsset);
  }

  const soundtrackFiles = [
    ...(options?.soundtrackFiles ?? []),
    ...(options?.soundtrackFile ? [options.soundtrackFile] : [])
  ].filter((file) => file.size > 0);
  let nextSettings = normalizedSettings;
  if (soundtrackFiles.length > 0) {
    const uploadedSoundtracks = await saveAndAnalyzeSoundtracks(record.id, soundtrackFiles);
    nextSettings = normalizeProjectSettings({
      ...normalizedSettings,
      musicSelection: {
        sourcePolicy: "user-uploaded-audio",
        exportPolicy: "direct-user-audio",
        note: "Uploaded MP3 tracks will be used exclusively for the final soundtrack.",
        uploadedSoundtracks,
        preferredTrackOrder: uploadedSoundtracks.map((track) => track.id),
        soundtrackStrategy: "auto-select-best-segments"
      }
    });
  }

  const nextRecord: ProjectRecord = {
    ...record,
    ownerUserId: options?.ownerUserId,
    settings: nextSettings,
    assetCount: assets.length,
    assets,
    status: "uploaded",
    stage: "queued"
  };

  await saveProjectRecord(nextRecord);
  void enqueueProjectProcessing(record.id);
  return nextRecord;
}

export async function processProject(projectId: string) {
  try {
    await markStage(projectId, "ingest");
    await markStage(projectId, "preprocess");
    let project = await readProjectRecord(projectId);

    const preprocessedAssets = await runWithConcurrency(project.assets, 3, preprocessAsset);
    project = await updateProject(projectId, (record) => ({
      ...record,
      assets: preprocessedAssets
    }));

    await markStage(projectId, "score");
    let scoredAssets: MediaAsset[] = await scoreAssetsWithHeuristics(project.assets);
    try {
      const suggestions = await requestPythonSuggestions(scoredAssets);
      scoredAssets = mergePythonSuggestions(scoredAssets, suggestions);
    } catch {
      // Keep deterministic scores when Python suggestions are unavailable.
    }
    project = await updateProject(projectId, (record) => ({
      ...record,
      assets: scoredAssets
    }));

    await markStage(projectId, "analysis");
    const analyzedAssets = await enrichAnalyzedAssets(scoredAssets);
    await updateProject(projectId, (record) => ({
      ...record,
      assets: analyzedAssets
    }));

    return refreshProjectPreview(projectId, {
      mode: "full-plan",
      clearOutputs: true
    });
  } catch (error) {
    await updateProject(projectId, (record) => ({
      ...record,
      status: "failed",
      stage: "failed",
      error: error instanceof Error ? error.message : "Pipeline failed."
    }));
    throw error;
  }
}

export function enqueueProjectProcessing(projectId: string) {
  const current = activeJobs.get(projectId);
  if (current) {
    return current;
  }
  const job = processProject(projectId).finally(() => {
    activeJobs.delete(projectId);
  });
  activeJobs.set(projectId, job);
  return job;
}

export async function renderSelectedPreview(
  projectId: string,
  planId?: string,
  requesterUserId?: string
) {
  const project = await assertProjectAccess(projectId, requesterUserId);
  const plan = findPreviewPlan(project, planId);
  if (!plan) {
    throw new Error("No preview plan is available to render.");
  }

  await markStage(projectId, "render");
  const selectedProject = await persistSelectedPreviewPlan(projectId, plan);
  const timelineList =
    selectedProject.settings.generation?.generationMode === "wall-frame"
      ? [plan.masterTimeline]
      : [plan.masterTimeline, ...plan.chapterTimelines];

  try {
    const outputs = (await renderProjectTimelines(selectedProject, timelineList)).map((output) => ({
      ...output,
      planId: plan.id
    }));

    await updateProject(projectId, (record) => ({
      ...record,
      selectedPlanId: plan.id,
      storyPlan: plan.storyPlan,
      outputs,
      stage: "complete",
      status: "ready",
      error: undefined
    }));
  } catch (error) {
    await updateProject(projectId, (record) => ({
      ...record,
      status: "failed",
      stage: "failed",
      error: error instanceof Error ? error.message : "Rendering failed."
    }));
    throw error;
  }

  return readProjectRecord(projectId);
}

export function enqueueProjectRender(
  projectId: string,
  planId?: string,
  requesterUserId?: string
) {
  const key = `${projectId}:render:${planId ?? "selected"}`;
  const current = activeJobs.get(key);
  if (current) {
    return current;
  }

  const job = renderSelectedPreview(projectId, planId, requesterUserId).finally(() => {
    activeJobs.delete(key);
  });
  job.catch((error) => {
    console.error(`Render job failed for ${projectId}`, error);
  });
  activeJobs.set(key, job);
  return job;
}

export async function getProject(projectId: string, requesterUserId?: string) {
  return assertProjectAccess(projectId, requesterUserId);
}

export async function selectPreviewPlan(projectId: string, planId: string, requesterUserId?: string) {
  const record = await assertProjectAccess(projectId, requesterUserId);
  const plan = findPreviewPlan(record, planId);
  if (!plan) {
    throw new Error("Preview plan not found.");
  }

  const selected = await persistSelectedPreviewPlan(projectId, plan);
  if (record.selectedPlanId && record.selectedPlanId !== plan.id && record.outputs.length) {
    return updateProject(projectId, () => ({
      ...selected,
      outputs: [],
      status: "preview",
      stage: "preview"
    }));
  }

  return selected;
}

export async function regenerateProjectPreview(
  projectId: string,
  mode: PreviewRegenerationMode = "full-plan",
  requesterUserId?: string
) {
  await assertProjectAccess(projectId, requesterUserId);
  return refreshProjectPreview(projectId, {
    mode,
    clearOutputs: true
  });
}

export async function updateProjectGenerationSettings(
  projectId: string,
  settingsPatch: Partial<ProjectSettings> & {
    generation?: Partial<GenerationSettings>;
  },
  requesterUserId?: string
) {
  await assertProjectAccess(projectId, requesterUserId);
  return refreshProjectPreview(projectId, {
    settingsPatch,
    mode: "full-plan",
    clearOutputs: true
  });
}

export async function addProjectSoundtracks(
  projectId: string,
  files: File[],
  requesterUserId?: string
) {
  const current = await assertProjectAccess(projectId, requesterUserId);
  if (!files.length) {
    return current;
  }

  const existing = current.settings.musicSelection?.uploadedSoundtracks ?? [];
  if (existing.length + files.length > SOUNDTRACK_UPLOAD_POLICY.maxTracks) {
    throw new Error(`A project can use up to ${SOUNDTRACK_UPLOAD_POLICY.maxTracks} MP3 tracks.`);
  }
  const uploadedSoundtracks = await saveAndAnalyzeSoundtracks(projectId, files);
  const mergedTracks = [...existing, ...uploadedSoundtracks];

  return refreshProjectPreview(projectId, {
    settingsPatch: {
      musicSelection: {
        sourcePolicy: "user-uploaded-audio",
        exportPolicy: "direct-user-audio",
        note: "Uploaded MP3 tracks will be used exclusively for the final soundtrack.",
        uploadedSoundtracks: mergedTracks,
        preferredTrackOrder: mergedTracks.map((track) => track.id),
        soundtrackStrategy:
          current.settings.musicSelection?.soundtrackStrategy ?? "auto-select-best-segments"
      }
    },
    mode: "music-mood",
    clearOutputs: true
  });
}

export async function removeProjectSoundtrack(
  projectId: string,
  soundtrackId: string,
  requesterUserId?: string
) {
  const current = await assertProjectAccess(projectId, requesterUserId);
  const remainingTracks = (current.settings.musicSelection?.uploadedSoundtracks ?? []).filter(
    (track) => track.id !== soundtrackId
  );

  return refreshProjectPreview(projectId, {
    settingsPatch: {
      musicSelection: {
        sourcePolicy: remainingTracks.length ? "user-uploaded-audio" : "internal-licensed",
        exportPolicy: remainingTracks.length ? "direct-user-audio" : "internal-licensed",
        note: remainingTracks.length
          ? "Uploaded MP3 tracks will be used exclusively for the final soundtrack."
          : "Using the built-in royalty-free music library because no MP3 files are attached.",
        uploadedSoundtracks: remainingTracks,
        preferredTrackOrder: remainingTracks.map((track) => track.id),
        soundtrackStrategy:
          current.settings.musicSelection?.soundtrackStrategy ?? "auto-select-best-segments"
      }
    },
    mode: "music-mood",
    clearOutputs: true
  });
}

export async function updateAssetUserState(
  projectId: string,
  assetId: string,
  patch: Partial<UserMediaState>,
  requesterUserId?: string
) {
  const current = await assertProjectAccess(projectId, requesterUserId);
  const asset = current.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new Error("Asset not found.");
  }

  const nextState: UserMediaState = {
    pinned: patch.excluded ? false : patch.pinned ?? asset.userState?.pinned ?? false,
    excluded: patch.excluded ?? asset.userState?.excluded ?? false
  };

  const activeCount = current.assets.filter(
    (item) => !item.userState?.excluded || item.id === assetId
  ).length;
  if (nextState.excluded && !asset.userState?.excluded && activeCount <= 1) {
    throw new Error("At least one asset must stay included.");
  }

  await updateProject(projectId, (record) => ({
    ...record,
    assets: record.assets.map((item) =>
      item.id === assetId
        ? {
            ...item,
            userState: nextState
          }
        : item
    ),
    error: undefined
  }));

  return refreshProjectPreview(projectId, {
    mode: "full-plan",
    clearOutputs: true
  });
}

export async function retryProject(projectId: string, requesterUserId?: string) {
  const record = await assertProjectAccess(projectId, requesterUserId);
  if (record.previewPlans?.length) {
    await updateProject(projectId, (current) => ({
      ...current,
      status: "preview",
      stage: "preview",
      error: undefined,
      outputs: []
    }));
    void enqueueProjectRender(projectId, record.selectedPlanId, requesterUserId);
    return readProjectRecord(projectId);
  }

  await updateProject(projectId, (current) => ({
    ...current,
    status: "uploaded",
    stage: "queued",
    error: undefined,
    outputs: [],
    previewPlans: [],
    storyPlan: undefined,
    selectedPlanId: undefined,
    timelinePaths: {
      master: undefined,
      chapters: []
    }
  }));

  void enqueueProjectProcessing(projectId);
  return readProjectRecord(projectId);
}

export async function listProjectsForUser(ownerUserId?: string) {
  const summaries = await listProjectSummaries();
  if (ownerUserId) {
    return summaries.filter((project) => project.ownerUserId === ownerUserId);
  }
  return summaries.filter((project) => !project.ownerUserId);
}

export { listProjectSummaries };
