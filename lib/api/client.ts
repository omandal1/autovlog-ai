import type {
  ApiErrorPayload,
  CreateProjectInput,
  CreateRenderInput,
  CurrentUserDto,
  MediaAssetDto,
  OutputAccessTicketDto,
  ProjectDetailDto,
  ProjectDto,
  RenderJobDto,
  RenderOutputDto,
  SoundtrackAssetDto,
  UpdateProjectInput
} from "@/lib/api/types";

export type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function configuredBaseUrl() {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  return (value || "http://127.0.0.1:8787").replace(/\/$/, "");
}

function extractError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const candidate = payload as ApiErrorPayload;
  if (typeof candidate.error === "string") return candidate.error;
  if (candidate.error && typeof candidate.error === "object" && candidate.error.message) {
    return candidate.error.message;
  }
  return candidate.message || fallback;
}

function unwrap<T>(payload: unknown, key: string): T {
  if (payload && typeof payload === "object" && key in payload) {
    return (payload as Record<string, T>)[key]!;
  }
  return payload as T;
}

export interface ApiClient {
  readonly baseUrl: string;
  getCurrentUser(): Promise<CurrentUserDto>;
  listProjects(): Promise<ProjectDto[]>;
  createProject(input: CreateProjectInput): Promise<ProjectDto>;
  getProject(projectId: string): Promise<ProjectDetailDto>;
  updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectDto>;
  deleteProject(projectId: string): Promise<void>;
  listMedia(projectId: string): Promise<MediaAssetDto[]>;
  uploadMedia(projectId: string, files: File[]): Promise<MediaAssetDto[]>;
  deleteMedia(projectId: string, mediaId: string): Promise<void>;
  fetchMediaThumbnail(projectId: string, mediaId: string): Promise<Blob>;
  listSoundtracks(projectId: string): Promise<SoundtrackAssetDto[]>;
  uploadSoundtracks(projectId: string, files: File[]): Promise<SoundtrackAssetDto[]>;
  deleteSoundtrack(projectId: string, soundtrackId: string): Promise<void>;
  startRender(projectId: string, input: CreateRenderInput): Promise<RenderJobDto>;
  listRenderJobs(projectId: string): Promise<RenderJobDto[]>;
  getRenderJob(projectId: string, renderJobId: string): Promise<RenderJobDto>;
  listOutputs(projectId: string): Promise<RenderOutputDto[]>;
  createOutputAccessTicket(
    projectId: string,
    outputId: string,
    disposition: "inline" | "attachment"
  ): Promise<OutputAccessTicketDto>;
}

export function createApiClient(getToken: TokenProvider): ApiClient {
  const baseUrl = configuredBaseUrl();

  async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = await getToken(!retry);
    if (!token) {
      throw new ApiError("Your sign-in session is not ready. Please sign in again.", 401, "AUTH_REQUIRED");
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        cache: "no-store"
      });
    } catch {
      throw new ApiError(
        `AutoVlog could not reach the local backend at ${baseUrl}. Start the backend or update NEXT_PUBLIC_API_BASE_URL.`,
        0,
        "BACKEND_UNREACHABLE"
      );
    }

    if (response.status === 401 && retry) {
      return request<T>(path, init, false);
    }

    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      const errorPayload = payload as ApiErrorPayload | undefined;
      throw new ApiError(
        extractError(payload, `Request failed (${response.status}).`),
        response.status,
        errorPayload?.code
      );
    }

    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return (await response.blob()) as T;
    return (await response.json()) as T;
  }

  function formData(files: File[]) {
    const data = new FormData();
    files.forEach((file) => data.append("files", file, file.name));
    return data;
  }

  return {
    baseUrl,
    async getCurrentUser() {
      return unwrap<CurrentUserDto>(await request("/api/me"), "user");
    },
    async listProjects() {
      return unwrap<ProjectDto[]>(await request("/api/projects"), "projects");
    },
    async createProject(input) {
      return unwrap<ProjectDto>(
        await request("/api/projects", { method: "POST", body: JSON.stringify(input) }),
        "project"
      );
    },
    async getProject(projectId) {
      const payload = await request<
        ProjectDetailDto | { project: ProjectDetailDto; latestRenderJob?: RenderJobDto | null }
      >(`/api/projects/${encodeURIComponent(projectId)}`);
      if (payload && typeof payload === "object" && "project" in payload) {
        return { ...payload.project, latestRenderJob: payload.latestRenderJob };
      }
      return payload as ProjectDetailDto;
    },
    async updateProject(projectId, input) {
      return unwrap<ProjectDto>(
        await request(`/api/projects/${encodeURIComponent(projectId)}`, {
          method: "PATCH",
          body: JSON.stringify(input)
        }),
        "project"
      );
    },
    async deleteProject(projectId) {
      await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    },
    async listMedia(projectId) {
      return unwrap<MediaAssetDto[]>(
        await request(`/api/projects/${encodeURIComponent(projectId)}/media`),
        "media"
      );
    },
    async uploadMedia(projectId, files) {
      return unwrap<MediaAssetDto[]>(
        await request(`/api/projects/${encodeURIComponent(projectId)}/media`, {
          method: "POST",
          body: formData(files)
        }),
        "media"
      );
    },
    async deleteMedia(projectId, mediaId) {
      await request(
        `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}`,
        { method: "DELETE" }
      );
    },
    async fetchMediaThumbnail(projectId, mediaId) {
      return request<Blob>(
        `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/content?variant=thumbnail`
      );
    },
    async listSoundtracks(projectId) {
      return unwrap<SoundtrackAssetDto[]>(
        await request(`/api/projects/${encodeURIComponent(projectId)}/soundtracks`),
        "soundtracks"
      );
    },
    async uploadSoundtracks(projectId, files) {
      return unwrap<SoundtrackAssetDto[]>(
        await request(`/api/projects/${encodeURIComponent(projectId)}/soundtracks`, {
          method: "POST",
          body: formData(files)
        }),
        "soundtracks"
      );
    },
    async deleteSoundtrack(projectId, soundtrackId) {
      await request(
        `/api/projects/${encodeURIComponent(projectId)}/soundtracks/${encodeURIComponent(soundtrackId)}`,
        { method: "DELETE" }
      );
    },
    async startRender(projectId, input) {
      return unwrap<RenderJobDto>(
        await request(`/api/projects/${encodeURIComponent(projectId)}/render`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
        "renderJob"
      );
    },
    async listRenderJobs(projectId) {
      return unwrap<RenderJobDto[]>(
        await request(`/api/projects/${encodeURIComponent(projectId)}/render-jobs`),
        "renderJobs"
      );
    },
    async getRenderJob(projectId, renderJobId) {
      return unwrap<RenderJobDto>(
        await request(
          `/api/projects/${encodeURIComponent(projectId)}/render-jobs/${encodeURIComponent(renderJobId)}`
        ),
        "renderJob"
      );
    },
    async listOutputs(projectId) {
      return unwrap<RenderOutputDto[]>(
        await request(`/api/projects/${encodeURIComponent(projectId)}/outputs`),
        "outputs"
      );
    },
    async createOutputAccessTicket(projectId, outputId, disposition) {
      const ticket = unwrap<OutputAccessTicketDto>(
        await request(
          `/api/projects/${encodeURIComponent(projectId)}/outputs/${encodeURIComponent(outputId)}/access-tickets`,
          {
            method: "POST",
            body: JSON.stringify({ disposition })
          }
        ),
        "accessTicket"
      );
      const url = new URL(ticket.url, `${baseUrl}/`);
      if (url.origin !== new URL(baseUrl).origin) {
        throw new ApiError("The backend returned an invalid output URL.", 502, "INVALID_OUTPUT_URL");
      }
      return { ...ticket, url: url.toString() };
    }
  };
}

export function getApiBaseUrl() {
  return configuredBaseUrl();
}
