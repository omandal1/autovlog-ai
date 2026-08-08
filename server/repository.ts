import type {
  MediaAssetRecord,
  ProjectRecord,
  RenderJobRecord,
  RenderOutputRecord,
  SoundtrackAssetRecord,
  UserRecord,
  VerifiedIdentity
} from "./models";

export type ProjectPatch = Partial<
  Pick<
    ProjectRecord,
    | "title"
    | "status"
    | "generationMode"
    | "settings"
    | "thumbnailPath"
    | "masterOutputId"
    | "chapterOutputIds"
    | "wallFrameOutputIds"
  >
>;

export type RenderJobPatch = Partial<
  Pick<
    RenderJobRecord,
    | "status"
    | "progress"
    | "currentStage"
    | "errorMessage"
    | "startedAt"
    | "completedAt"
    | "renderPlanPath"
  >
>;

export type MediaAssetPatch = Partial<
  Pick<
    MediaAssetRecord,
    | "thumbnailPath"
    | "proxyPath"
    | "duration"
    | "width"
    | "height"
    | "metadata"
    | "analysis"
  >
>;

export type SoundtrackAssetPatch = Partial<
  Pick<
    SoundtrackAssetRecord,
    "duration" | "bitrate" | "sampleRate" | "channels" | "analysis"
  >
>;

export interface AutoVlogRepository {
  ping(): Promise<void>;
  close(): Promise<void>;
  failInterruptedRenderJobs(errorMessage: string): Promise<number>;
  upsertUser(identity: VerifiedIdentity): Promise<UserRecord>;

  listProjects(userId: string): Promise<ProjectRecord[]>;
  createProject(project: ProjectRecord): Promise<ProjectRecord>;
  getProject(userId: string, projectId: string): Promise<ProjectRecord | null>;
  updateProject(
    userId: string,
    projectId: string,
    patch: ProjectPatch
  ): Promise<ProjectRecord | null>;
  deleteProject(userId: string, projectId: string): Promise<boolean>;

  listMedia(userId: string, projectId: string): Promise<MediaAssetRecord[]>;
  createMedia(asset: MediaAssetRecord): Promise<MediaAssetRecord>;
  getMedia(
    userId: string,
    projectId: string,
    mediaId: string
  ): Promise<MediaAssetRecord | null>;
  updateMedia(
    userId: string,
    projectId: string,
    mediaId: string,
    patch: MediaAssetPatch
  ): Promise<MediaAssetRecord | null>;
  deleteMedia(
    userId: string,
    projectId: string,
    mediaId: string
  ): Promise<MediaAssetRecord | null>;

  listSoundtracks(userId: string, projectId: string): Promise<SoundtrackAssetRecord[]>;
  createSoundtrack(asset: SoundtrackAssetRecord): Promise<SoundtrackAssetRecord>;
  getSoundtrack(
    userId: string,
    projectId: string,
    soundtrackId: string
  ): Promise<SoundtrackAssetRecord | null>;
  updateSoundtrack(
    userId: string,
    projectId: string,
    soundtrackId: string,
    patch: SoundtrackAssetPatch
  ): Promise<SoundtrackAssetRecord | null>;
  deleteSoundtrack(
    userId: string,
    projectId: string,
    soundtrackId: string
  ): Promise<SoundtrackAssetRecord | null>;

  createRenderJob(job: RenderJobRecord): Promise<RenderJobRecord>;
  listRenderJobs(userId: string, projectId: string): Promise<RenderJobRecord[]>;
  getRenderJob(
    userId: string,
    projectId: string,
    renderJobId: string
  ): Promise<RenderJobRecord | null>;
  updateRenderJob(
    userId: string,
    projectId: string,
    renderJobId: string,
    patch: RenderJobPatch
  ): Promise<RenderJobRecord | null>;

  listOutputs(userId: string, projectId: string): Promise<RenderOutputRecord[]>;
  createOutput(output: RenderOutputRecord): Promise<RenderOutputRecord>;
  getOutput(
    userId: string,
    projectId: string,
    outputId: string
  ): Promise<RenderOutputRecord | null>;
}
