export type GenerationMode = "memory-book" | "wall-frame";

export type ProjectStatus =
  | "created"
  | "uploaded"
  | "processing"
  | "ready"
  | "failed";

export type RenderJobStatus = "queued" | "processing" | "completed" | "failed";
export type RenderOutputType = "master" | "chapter" | "wall-frame";
export type MediaAssetType = "image" | "video";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export interface UserRecord {
  id: string;
  firebaseUid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerationSettingsRecord extends JsonObject {
  generationMode: GenerationMode;
  theme?: string;
  pacing?: string;
  uploadedSoundtrackIds?: string[];
  soundtrackStrategy?: "auto-select-best-segments" | "track-order";
  diaryStyleSettings?: JsonObject;
  wallFrameStyleSettings?: JsonObject;
}

export interface ProjectRecord {
  id: string;
  userId: string;
  title: string;
  status: ProjectStatus;
  generationMode: GenerationMode;
  settings: GenerationSettingsRecord;
  storageRoot: string;
  thumbnailPath?: string;
  masterOutputId?: string;
  chapterOutputIds: string[];
  wallFrameOutputIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaAssetRecord {
  id: string;
  userId: string;
  projectId: string;
  type: MediaAssetType;
  originalFilename: string;
  mimeType: string;
  size: number;
  localPath: string;
  thumbnailPath?: string;
  proxyPath?: string;
  duration?: number;
  width?: number;
  height?: number;
  metadata: JsonObject;
  analysis: JsonObject;
  createdAt: Date;
}

export interface SoundtrackAssetRecord {
  id: string;
  userId: string;
  projectId: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  localPath: string;
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  analysis: JsonObject;
  createdAt: Date;
}

export interface RenderJobRecord {
  id: string;
  userId: string;
  projectId: string;
  generationMode: GenerationMode;
  status: RenderJobStatus;
  progress: number;
  currentStage: string;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  settingsSnapshot: GenerationSettingsRecord;
  renderPlanPath?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RenderOutputRecord {
  id: string;
  userId: string;
  projectId: string;
  renderJobId: string;
  type: RenderOutputType;
  title: string;
  localPath: string;
  duration?: number;
  size: number;
  thumbnailPath?: string;
  createdAt: Date;
}

export interface VerifiedIdentity {
  firebaseUid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
}
