import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { ApiError } from "./errors";
import type {
  MediaAssetRecord,
  ProjectRecord,
  RenderJobRecord,
  RenderOutputRecord,
  RenderOutputType,
  SoundtrackAssetRecord,
  UserRecord
} from "./models";
import type { AutoVlogRepository } from "./repository";
import type { StorageProvider } from "./storage/storage-provider";
import { assertValidVideoFile } from "@/lib/render/video-integrity";

export interface PipelineOutputInput {
  type: RenderOutputType;
  title: string;
  localPath: string;
  duration?: number;
  thumbnailPath?: string;
}

export interface PipelineRenderRuntime {
  storage: StorageProvider;
  updateProgress(progress: number, currentStage: string): Promise<void>;
  registerOutput(input: PipelineOutputInput): Promise<RenderOutputRecord>;
}

export interface PipelineRenderInput {
  user: UserRecord;
  project: ProjectRecord;
  media: MediaAssetRecord[];
  soundtracks: SoundtrackAssetRecord[];
  renderJob: RenderJobRecord;
}

export interface ProjectPipelineAdapter {
  readonly available: boolean;
  readonly unavailableReason?: string;
  mediaUploaded?(project: ProjectRecord, media: MediaAssetRecord[]): Promise<void>;
  soundtracksUploaded?(
    project: ProjectRecord,
    soundtracks: SoundtrackAssetRecord[]
  ): Promise<void>;
  mediaRemoved?(project: ProjectRecord, media: MediaAssetRecord): Promise<void>;
  soundtrackRemoved?(
    project: ProjectRecord,
    soundtrack: SoundtrackAssetRecord
  ): Promise<void>;
  projectDeleted?(project: ProjectRecord): Promise<void>;
  render(input: PipelineRenderInput, runtime: PipelineRenderRuntime): Promise<void>;
}

export type PipelineCallbacks = Omit<ProjectPipelineAdapter, "available" | "unavailableReason">;

export class CallbackProjectPipelineAdapter implements ProjectPipelineAdapter {
  readonly available = true;
  readonly mediaUploaded?: ProjectPipelineAdapter["mediaUploaded"];
  readonly soundtracksUploaded?: ProjectPipelineAdapter["soundtracksUploaded"];
  readonly mediaRemoved?: ProjectPipelineAdapter["mediaRemoved"];
  readonly soundtrackRemoved?: ProjectPipelineAdapter["soundtrackRemoved"];
  readonly projectDeleted?: ProjectPipelineAdapter["projectDeleted"];
  readonly render: ProjectPipelineAdapter["render"];

  constructor(callbacks: PipelineCallbacks) {
    this.mediaUploaded = callbacks.mediaUploaded;
    this.soundtracksUploaded = callbacks.soundtracksUploaded;
    this.mediaRemoved = callbacks.mediaRemoved;
    this.soundtrackRemoved = callbacks.soundtrackRemoved;
    this.projectDeleted = callbacks.projectDeleted;
    this.render = callbacks.render;
  }
}

export class UnavailableProjectPipelineAdapter implements ProjectPipelineAdapter {
  readonly available = false;

  constructor(
    readonly unavailableReason =
      "The local rendering pipeline has not been connected to the API server."
  ) {}

  async render(): Promise<void> {
    throw new ApiError(503, "PIPELINE_UNAVAILABLE", this.unavailableReason);
  }
}

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(99, Math.round(progress)));
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "The render pipeline failed.").slice(0, 2_000);
}

const PROJECT_DELETION_MESSAGE = "This render was cancelled because its project was deleted.";

class ProjectRenderCancelledError extends Error {
  constructor() {
    super(PROJECT_DELETION_MESSAGE);
    this.name = "ProjectRenderCancelledError";
  }
}

function projectKey(userId: string, projectId: string) {
  return `${userId}:${projectId}`;
}

export class PipelineCoordinator {
  private readonly queue: PipelineRenderInput[] = [];
  private activeRenders = 0;
  private readonly cancelledProjects = new Set<string>();
  private readonly activeRuns = new Map<string, PipelineRenderInput>();

  constructor(
    readonly adapter: ProjectPipelineAdapter,
    private readonly repository: AutoVlogRepository,
    private readonly storage: StorageProvider
  ) {}

  requireAvailable() {
    if (!this.adapter.available) {
      throw new ApiError(
        503,
        "PIPELINE_UNAVAILABLE",
        this.adapter.unavailableReason ?? "The render pipeline is unavailable."
      );
    }
  }

  async mediaUploaded(project: ProjectRecord, media: MediaAssetRecord[]) {
    await this.adapter.mediaUploaded?.(project, media);
  }

  async soundtracksUploaded(project: ProjectRecord, soundtracks: SoundtrackAssetRecord[]) {
    await this.adapter.soundtracksUploaded?.(project, soundtracks);
  }

  async mediaRemoved(project: ProjectRecord, media: MediaAssetRecord) {
    await this.adapter.mediaRemoved?.(project, media);
  }

  async soundtrackRemoved(project: ProjectRecord, soundtrack: SoundtrackAssetRecord) {
    await this.adapter.soundtrackRemoved?.(project, soundtrack);
  }

  async projectDeleted(project: ProjectRecord) {
    const key = projectKey(project.userId, project.id);
    if (this.activeRuns.has(key)) {
      throw new ApiError(
        409,
        "RENDER_IN_PROGRESS",
        "Wait for the active render to finish before deleting this project."
      );
    }
    this.cancelledProjects.add(key);

    const cancelledQueued: PipelineRenderInput[] = [];
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const queued = this.queue[index]!;
      if (projectKey(queued.user.id, queued.project.id) === key) {
        cancelledQueued.push(...this.queue.splice(index, 1));
      }
    }
    const completedAt = new Date();
    await Promise.allSettled(
      cancelledQueued.map((queued) =>
        this.repository.updateRenderJob(
          queued.user.id,
          queued.project.id,
          queued.renderJob.id,
          {
            status: "failed",
            currentStage: "cancelled",
            errorMessage: PROJECT_DELETION_MESSAGE,
            completedAt
          }
        )
      )
    );

    await this.adapter.projectDeleted?.(project);
  }

  enqueue(input: PipelineRenderInput) {
    if (this.cancelledProjects.has(projectKey(input.user.id, input.project.id))) {
      throw new ApiError(409, "PROJECT_DELETING", "This project is being deleted.");
    }
    this.queue.push(input);
    this.drainQueue();
  }

  private drainQueue() {
    if (this.activeRenders >= 1) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    this.activeRenders += 1;
    const key = projectKey(next.user.id, next.project.id);
    this.activeRuns.set(key, next);
    setImmediate(() => {
      void this.execute(next).finally(() => {
        if (this.activeRuns.get(key) === next) {
          this.activeRuns.delete(key);
        }
        this.activeRenders -= 1;
        this.drainQueue();
      });
    });
  }

  private assertProjectActive(userId: string, projectId: string) {
    if (this.cancelledProjects.has(projectKey(userId, projectId))) {
      throw new ProjectRenderCancelledError();
    }
  }

  private async assertPersistedProjectActive(input: PipelineRenderInput) {
    this.assertProjectActive(input.user.id, input.project.id);
    const project = await this.repository.getProject(input.user.id, input.project.id);
    this.assertProjectActive(input.user.id, input.project.id);
    if (!project) {
      throw new ProjectRenderCancelledError();
    }
    return project;
  }

  private guardedStorage(userId: string, projectId: string): StorageProvider {
    return new Proxy(this.storage, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== "function") {
          return value;
        }
        return (...args: unknown[]) => {
          this.assertProjectActive(userId, projectId);
          return (value as (...methodArgs: unknown[]) => unknown).apply(target, args);
        };
      }
    }) as StorageProvider;
  }

  private async execute(input: PipelineRenderInput) {
    const { user, project, renderJob } = input;
    const renderStartedMs = Date.now();
    let activeStage = "QUEUED";
    let activeStageStartedMs = renderStartedMs;
    const stageDurationsMs: Record<string, number> = {};
    let metricsPath: string | undefined;

    const normalizedStage = (value: string) =>
      (value.split(/[·:]/)[0] ?? value).trim().replace(/\s+/g, "_").toUpperCase();
    const transitionStage = (nextValue: string) => {
      const nextStage = normalizedStage(nextValue);
      if (nextStage === activeStage) return false;
      const now = Date.now();
      stageDurationsMs[activeStage] =
        (stageDurationsMs[activeStage] ?? 0) + now - activeStageStartedMs;
      console.info(
        `[render:${renderJob.id}] ${activeStage} ${(stageDurationsMs[activeStage] / 1_000).toFixed(2)}s -> ${nextStage}`
      );
      activeStage = nextStage;
      activeStageStartedMs = now;
      return true;
    };
    const persistMetrics = async (status: "processing" | "completed" | "failed", error?: unknown) => {
      if (!metricsPath) return;
      const now = Date.now();
      const snapshotDurations = {
        ...stageDurationsMs,
        [activeStage]: (stageDurationsMs[activeStage] ?? 0) + now - activeStageStartedMs
      };
      const temporaryPath = `${metricsPath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
      await mkdir(path.dirname(metricsPath), { recursive: true });
      await writeFile(
        temporaryPath,
        `${JSON.stringify({
          renderJobId: renderJob.id,
          projectId: project.id,
          mode: project.generationMode,
          mediaCount: input.media.length,
          soundtrackCount: input.soundtracks.length,
          status,
          activeStage,
          startedAt: new Date(renderStartedMs).toISOString(),
          updatedAt: new Date(now).toISOString(),
          elapsedSec: Number(((now - renderStartedMs) / 1_000).toFixed(3)),
          stageTimingsSec: Object.fromEntries(
            Object.entries(snapshotDurations).map(([stage, durationMs]) => [
              stage,
              Number((durationMs / 1_000).toFixed(3))
            ])
          ),
          error: error ? errorMessage(error) : undefined
        }, null, 2)}\n`,
        "utf8"
      );
      // Windows does not consistently replace an existing destination with
      // rename(). Metrics are refreshed at every stage, so remove only the
      // previous metrics snapshot before atomically promoting the new one.
      await rm(metricsPath, { force: true });
      await rename(temporaryPath, metricsPath);
    };
    try {
      await this.assertPersistedProjectActive(input);
      const startedJob = await this.repository.updateRenderJob(user.id, project.id, renderJob.id, {
        status: "processing",
        progress: 1,
        currentStage: "starting",
        startedAt: new Date(),
        errorMessage: undefined
      });
      this.assertProjectActive(user.id, project.id);
      if (!startedJob) {
        throw new ProjectRenderCancelledError();
      }
      const startedProject = await this.repository.updateProject(user.id, project.id, {
        status: "processing"
      });
      this.assertProjectActive(user.id, project.id);
      if (!startedProject) {
        throw new ProjectRenderCancelledError();
      }

      const guardedStorage = this.guardedStorage(user.id, project.id);
      metricsPath = path.join(
        await guardedStorage.getProjectStorageRoot(user.id, project.id),
        "metadata",
        `${renderJob.id}-metrics.json`
      );
      transitionStage("STARTING");
      await persistMetrics("processing");

      const runtime: PipelineRenderRuntime = {
        storage: guardedStorage,
        updateProgress: async (progress, currentStage) => {
          const stageChanged = transitionStage(currentStage);
          this.assertProjectActive(user.id, project.id);
          const updated = await this.repository.updateRenderJob(user.id, project.id, renderJob.id, {
            status: "processing",
            progress: clampProgress(progress),
            currentStage: currentStage.slice(0, 160)
          });
          this.assertProjectActive(user.id, project.id);
          if (!updated) {
            throw new ProjectRenderCancelledError();
          }
          if (stageChanged) {
            await persistMetrics("processing");
          }
        },
        registerOutput: async (outputInput) => {
          await this.assertPersistedProjectActive(input);
          const localPath = await guardedStorage.getRenderOutputPath(
            user.id,
            project.id,
            outputInput.localPath
          );
          const fileStat = await stat(localPath);
          this.assertProjectActive(user.id, project.id);
          if (!fileStat.isFile() || fileStat.size === 0) {
            throw new Error("The render pipeline produced an empty output.");
          }
          const validatedOutput = await assertValidVideoFile(localPath, {
            label: `final ${outputInput.type} output`,
            minBytes: 1024,
            minDurationSec: 0.1,
            requireH264: true,
            requireYuv420p: true,
            requireAudio: true,
            requireAac: true,
            decode: false
          });
          if (outputInput.thumbnailPath) {
            await guardedStorage.resolveProjectPath(
              user.id,
              project.id,
              outputInput.thumbnailPath
            );
          }
          const output: RenderOutputRecord = {
            id: randomUUID(),
            userId: user.id,
            projectId: project.id,
            renderJobId: renderJob.id,
            type: outputInput.type,
            title: outputInput.title.slice(0, 160),
            localPath,
            duration: validatedOutput.durationSec,
            size: fileStat.size,
            thumbnailPath: outputInput.thumbnailPath,
            createdAt: new Date()
          };
          await this.assertPersistedProjectActive(input);
          await this.repository.createOutput(output);
          this.assertProjectActive(user.id, project.id);

          const latestProject = await this.repository.getProject(user.id, project.id);
          this.assertProjectActive(user.id, project.id);
          if (!latestProject) {
            throw new ProjectRenderCancelledError();
          }
          if (output.type === "master") {
            await this.repository.updateProject(user.id, project.id, {
              masterOutputId: output.id
            });
          } else if (output.type === "chapter") {
            await this.repository.updateProject(user.id, project.id, {
              chapterOutputIds: Array.from(
                new Set([...latestProject.chapterOutputIds, output.id])
              )
            });
          } else {
            await this.repository.updateProject(user.id, project.id, {
              wallFrameOutputIds: Array.from(
                new Set([...latestProject.wallFrameOutputIds, output.id])
              )
            });
          }
          this.assertProjectActive(user.id, project.id);
          return output;
        }
      };

      await this.adapter.render(input, runtime);
      await this.assertPersistedProjectActive(input);
      const current = await this.repository.getRenderJob(user.id, project.id, renderJob.id);
      this.assertProjectActive(user.id, project.id);
      if (!current) {
        throw new ProjectRenderCancelledError();
      }
      if (current.status !== "failed") {
        transitionStage("COMPLETED");
        await this.repository.updateRenderJob(user.id, project.id, renderJob.id, {
          status: "completed",
          progress: 100,
          currentStage: "complete",
          completedAt: new Date()
        });
        await this.repository.updateProject(user.id, project.id, { status: "ready" });
        await persistMetrics("completed");
      }
    } catch (error) {
      if (error instanceof ProjectRenderCancelledError) {
        return;
      }
      transitionStage("FAILED");
      await persistMetrics("failed", error).catch(() => undefined);
      await Promise.allSettled([
        this.repository.updateRenderJob(user.id, project.id, renderJob.id, {
          status: "failed",
          currentStage: "failed",
          errorMessage: errorMessage(error),
          completedAt: new Date()
        }),
        this.repository.updateProject(user.id, project.id, { status: "failed" })
      ]);
    } finally {
      await this.storage.cleanupTemp(user.id, project.id, renderJob.id).catch(() => undefined);
    }
  }
}
