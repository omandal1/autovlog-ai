export type UploadCategory = "image" | "video" | "music";
export type RenderOutputDirectory = "master" | "chapter" | "wall-frame";

export interface SaveUploadInput {
  userId: string;
  projectId: string;
  category: UploadCategory;
  originalFilename: string;
  tempPath: string;
}

export interface SavedFile {
  absolutePath: string;
  size: number;
}

export interface StorageProvider {
  initialize(): Promise<void>;
  saveUpload(input: SaveUploadInput): Promise<SavedFile>;
  getProjectStorageRoot(userId: string, projectId: string): Promise<string>;
  getMediaPath(userId: string, projectId: string, storedPath: string): Promise<string>;
  getSoundtrackPath(userId: string, projectId: string, storedPath: string): Promise<string>;
  getRenderOutputPath(userId: string, projectId: string, storedPath: string): Promise<string>;
  allocateRenderOutputPath(
    userId: string,
    projectId: string,
    directory: RenderOutputDirectory,
    filename: string
  ): Promise<string>;
  resolveProjectPath(userId: string, projectId: string, storedPath: string): Promise<string>;
  deleteFile(userId: string, projectId: string, storedPath: string): Promise<void>;
  deleteProject(userId: string, projectId: string): Promise<void>;
  cleanupTemp(userId: string, projectId: string, renderJobId?: string): Promise<void>;
}
