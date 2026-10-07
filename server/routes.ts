import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";

import { getAuthContext } from "./auth/auth-middleware";
import type { ServerConfig } from "./config";
import {
  sanitizeJson,
  toMediaDto,
  toOutputDto,
  toProjectDto,
  toRenderJobDto,
  toSoundtrackDto,
  toUserDto
} from "./dto";
import { ApiError, asyncHandler, notFound } from "./errors";
import type {
  GenerationMode,
  GenerationSettingsRecord,
  JsonObject,
  MediaAssetRecord,
  ProjectRecord,
  RenderJobRecord,
  SoundtrackAssetRecord
} from "./models";
import type { PipelineCoordinator } from "./pipeline";
import type { AutoVlogRepository } from "./repository";
import {
  OutputTicketError,
  type OutputTicketDisposition,
  type OutputTicketService
} from "./output-tickets";
import { mimeTypeFromFilename, streamFile } from "./stream-file";
import type { StorageProvider } from "./storage/storage-provider";
import {
  createMediaUploadMiddleware,
  createSoundtrackUploadMiddleware,
  assertMp3Signature,
  removeTemporaryUploads,
  uploadedFiles
} from "./uploads";

const GENERATION_MODES = ["memory-book", "wall-frame"] as const;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

const createProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    generationMode: z.enum(GENERATION_MODES).optional(),
    settings: z.record(z.unknown()).optional()
  })
  .strict();

const updateProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    generationMode: z.enum(GENERATION_MODES).optional(),
    settings: z.record(z.unknown()).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one project change.");

const renderSchema = z
  .object({ settings: z.record(z.unknown()).optional() })
  .strict()
  .default({});

const outputTicketSchema = z
  .object({ disposition: z.enum(["inline", "attachment"]) })
  .strict();

type RequestWithProject = Request & { ownedProject?: ProjectRecord };

export interface ApiRouterDependencies {
  config: ServerConfig;
  repository: AutoVlogRepository;
  storage: StorageProvider;
  pipeline: PipelineCoordinator;
  outputTickets: OutputTicketService;
  authMiddleware: RequestHandler;
}

function routeId(request: Request, key: string): string {
  const value = request.params[key];
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new ApiError(400, "INVALID_IDENTIFIER", `${key} is invalid.`);
  }
  return value;
}

function getOwnedProject(request: Request) {
  const project = (request as RequestWithProject).ownedProject;
  if (!project) {
    throw notFound("Project not found.");
  }
  return project;
}

function createProjectOwnershipMiddleware(repository: AutoVlogRepository): RequestHandler {
  return (request, _response, next) => {
    void (async () => {
      const { user } = getAuthContext(request);
      const project = await repository.getProject(user.id, routeId(request, "projectId"));
      if (!project) {
        throw notFound("Project not found.");
      }
      (request as RequestWithProject).ownedProject = project;
      next();
    })().catch(next);
  };
}

function uploadWithCleanup(middleware: RequestHandler): RequestHandler {
  return (request, response, next) => {
    middleware(request, response, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      void removeTemporaryUploads(uploadedFiles(request)).finally(() => next(error));
    });
  };
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_REQUEST", "The request body is invalid.", {
      fields: parsed.error.flatten().fieldErrors,
      form: parsed.error.flatten().formErrors
    });
  }
  return parsed.data;
}

function settingsFromInput(
  input: Record<string, unknown> | undefined,
  generationMode: GenerationMode,
  current?: GenerationSettingsRecord
): GenerationSettingsRecord {
  const sanitized = sanitizeJson(input ?? {});
  const object =
    sanitized && !Array.isArray(sanitized) && typeof sanitized === "object"
      ? (sanitized as JsonObject)
      : {};
  return {
    ...(current ?? {}),
    ...object,
    generationMode
  } as GenerationSettingsRecord;
}

async function validateSoundtrackSelection(
  repository: AutoVlogRepository,
  userId: string,
  projectId: string,
  settings: GenerationSettingsRecord
) {
  const selected = settings.uploadedSoundtrackIds;
  if (!selected) {
    return;
  }
  if (!Array.isArray(selected) || selected.some((id) => typeof id !== "string" || !SAFE_ID.test(id))) {
    throw new ApiError(400, "INVALID_SOUNDTRACK_SELECTION", "Soundtrack IDs are invalid.");
  }
  const available = new Set(
    (await repository.listSoundtracks(userId, projectId)).map((soundtrack) => soundtrack.id)
  );
  if (selected.some((id) => !available.has(id))) {
    throw new ApiError(
      400,
      "INVALID_SOUNDTRACK_SELECTION",
      "A selected soundtrack does not belong to this project."
    );
  }
}

function defaultProjectTitle() {
  return `AutoVlog ${new Date().toISOString().slice(0, 10)}`;
}

export function createApiRouter(dependencies: ApiRouterDependencies) {
  const { config, repository, storage, pipeline, outputTickets, authMiddleware } = dependencies;
  const router = Router();
  const ownsProject = createProjectOwnershipMiddleware(repository);
  const mediaUpload = uploadWithCleanup(createMediaUploadMiddleware(config));
  const soundtrackUpload = uploadWithCleanup(createSoundtrackUploadMiddleware(config));

  const redeemOutputTicket = asyncHandler(async (request, response) => {
    const token = request.params.ticket;
    if (typeof token !== "string") {
      throw new ApiError(401, "OUTPUT_TICKET_INVALID", "The output access ticket is invalid.");
    }

    let claims: {
      userId: string;
      projectId: string;
      outputId: string;
      disposition: OutputTicketDisposition;
    };
    try {
      claims = outputTickets.verify(token);
    } catch (error) {
      if (error instanceof OutputTicketError) {
        throw new ApiError(
          401,
          error.reason === "expired" ? "OUTPUT_TICKET_EXPIRED" : "OUTPUT_TICKET_INVALID",
          error.message
        );
      }
      throw error;
    }

    // A ticket is only a short-lived capability. The database remains the
    // authority, so deletion or ownership changes take effect immediately.
    const output = await repository.getOutput(claims.userId, claims.projectId, claims.outputId);
    if (!output) {
      throw notFound("Render output not found.");
    }
    const filePath = await storage.getRenderOutputPath(
      claims.userId,
      claims.projectId,
      output.localPath
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    await streamFile(request, response, {
      filePath,
      mimeType: mimeTypeFromFilename(filePath),
      filename: output.title.endsWith(".mp4") ? output.title : `${output.title}.mp4`,
      disposition: claims.disposition
    });
  });

  // Media elements and browser downloads cannot attach Firebase bearer
  // headers. This capability route is intentionally public; possession of a
  // valid, opaque, short-lived ticket is the authorization check.
  router.get("/output-access/:ticket", redeemOutputTicket);
  router.head("/output-access/:ticket", redeemOutputTicket);

  router.use(authMiddleware);

  router.get(
    "/me",
    asyncHandler(async (request, response) => {
      response.json({ user: toUserDto(getAuthContext(request).user) });
    })
  );

  router.get(
    "/projects",
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const projects = await repository.listProjects(user.id);
      response.json({ projects: projects.map(toProjectDto) });
    })
  );

  router.post(
    "/projects",
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const body = parseBody(createProjectSchema, request.body);
      const id = randomUUID();
      const generationMode = body.generationMode ?? "memory-book";
      const settings = settingsFromInput(body.settings, generationMode);
      await validateSoundtrackSelection(repository, user.id, id, settings);
      const now = new Date();
      const storageRoot = await storage.getProjectStorageRoot(user.id, id);
      const project: ProjectRecord = {
        id,
        userId: user.id,
        title: body.title ?? defaultProjectTitle(),
        status: "created",
        generationMode,
        settings,
        storageRoot,
        chapterOutputIds: [],
        wallFrameOutputIds: [],
        createdAt: now,
        updatedAt: now
      };
      try {
        await repository.createProject(project);
      } catch (error) {
        await storage.deleteProject(user.id, id).catch(() => undefined);
        throw error;
      }
      response.status(201).json({ project: toProjectDto(project) });
    })
  );

  router.get(
    "/projects/:projectId",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const jobs = await repository.listRenderJobs(user.id, project.id);
      response.json({
        project: toProjectDto(project),
        latestRenderJob: jobs[0] ? toRenderJobDto(jobs[0]) : null
      });
    })
  );

  router.patch(
    "/projects/:projectId",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const body = parseBody(updateProjectSchema, request.body);
      const generationMode = body.generationMode ?? project.generationMode;
      const settings = settingsFromInput(body.settings, generationMode, project.settings);
      await validateSoundtrackSelection(repository, user.id, project.id, settings);
      const updated = await repository.updateProject(user.id, project.id, {
        ...(body.title ? { title: body.title } : {}),
        generationMode,
        settings
      });
      if (!updated) {
        throw notFound("Project not found.");
      }
      response.json({ project: toProjectDto(updated) });
    })
  );

  router.delete(
    "/projects/:projectId",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      await pipeline.projectDeleted(project);
      if (!(await repository.deleteProject(user.id, project.id))) {
        throw notFound("Project not found.");
      }
      await storage.deleteProject(user.id, project.id);
      response.sendStatus(204);
    })
  );

  router.get(
    "/projects/:projectId/media",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const media = await repository.listMedia(user.id, project.id);
      response.json({ media: media.map(toMediaDto) });
    })
  );

  router.post(
    "/projects/:projectId/media",
    ownsProject,
    mediaUpload,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const files = uploadedFiles(request);
      if (files.length === 0) {
        throw new ApiError(400, "FILES_REQUIRED", "Choose at least one image or video.");
      }

      const created: MediaAssetRecord[] = [];
      try {
        for (const file of files) {
          const type = file.mimetype.startsWith("image/") ? "image" : "video";
          const saved = await storage.saveUpload({
            userId: user.id,
            projectId: project.id,
            category: type,
            originalFilename: file.originalname,
            tempPath: file.path
          });
          const asset: MediaAssetRecord = {
            id: randomUUID(),
            userId: user.id,
            projectId: project.id,
            type,
            originalFilename: file.originalname.slice(0, 255),
            mimeType: file.mimetype,
            size: saved.size,
            localPath: saved.absolutePath,
            metadata: {},
            analysis: {},
            createdAt: new Date()
          };
          try {
            await repository.createMedia(asset);
          } catch (error) {
            await storage.deleteFile(user.id, project.id, saved.absolutePath).catch(() => undefined);
            throw error;
          }
          created.push(asset);
        }
      } catch (error) {
        await Promise.allSettled(
          created.flatMap((asset) => [
            repository.deleteMedia(user.id, project.id, asset.id),
            storage.deleteFile(user.id, project.id, asset.localPath)
          ])
        );
        await removeTemporaryUploads(files);
        throw error;
      }

      await removeTemporaryUploads(files);
      await repository.updateProject(user.id, project.id, { status: "uploaded" });
      try {
        await pipeline.mediaUploaded(project, created);
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : "Analysis failed.";
        await Promise.allSettled(
          created.map((asset) =>
            repository.updateMedia(user.id, project.id, asset.id, {
              analysis: { status: "analysis-failed", error: message }
            })
          )
        );
      }
      response.status(201).json({ media: created.map(toMediaDto) });
    })
  );

  router.delete(
    "/projects/:projectId/media/:mediaId",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const asset = await repository.getMedia(
        user.id,
        project.id,
        routeId(request, "mediaId")
      );
      if (!asset) {
        throw notFound("Media asset not found.");
      }
      await pipeline.mediaRemoved(project, asset);
      await Promise.all(
        [asset.localPath, asset.thumbnailPath, asset.proxyPath]
          .filter((value): value is string => Boolean(value))
          .map((filePath) => storage.deleteFile(user.id, project.id, filePath))
      );
      await repository.deleteMedia(user.id, project.id, asset.id);
      response.sendStatus(204);
    })
  );

  const serveMedia = asyncHandler(async (request, response) => {
    const { user } = getAuthContext(request);
    const project = getOwnedProject(request);
    const asset = await repository.getMedia(
      user.id,
      project.id,
      routeId(request, "mediaId")
    );
    if (!asset) {
      throw notFound("Media asset not found.");
    }
    const variant = request.query.variant;
    if (variant !== undefined && variant !== "thumbnail" && variant !== "proxy") {
      throw new ApiError(400, "INVALID_VARIANT", "Media variant is invalid.");
    }
    const storedPath =
      variant === "thumbnail"
        ? asset.thumbnailPath
        : variant === "proxy"
          ? asset.proxyPath
          : asset.localPath;
    if (!storedPath) {
      throw notFound("The requested media variant is not available.");
    }
    const filePath = await storage.getMediaPath(user.id, project.id, storedPath);
    await streamFile(request, response, {
      filePath,
      mimeType: variant ? mimeTypeFromFilename(filePath) : asset.mimeType,
      filename: asset.originalFilename,
      disposition: "inline"
    });
  });
  router.get("/projects/:projectId/media/:mediaId/content", ownsProject, serveMedia);
  router.head("/projects/:projectId/media/:mediaId/content", ownsProject, serveMedia);

  router.get(
    "/projects/:projectId/soundtracks",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const soundtracks = await repository.listSoundtracks(user.id, project.id);
      response.json({ soundtracks: soundtracks.map(toSoundtrackDto) });
    })
  );

  router.post(
    "/projects/:projectId/soundtracks",
    ownsProject,
    soundtrackUpload,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const files = uploadedFiles(request);
      if (files.length === 0) {
        throw new ApiError(400, "FILES_REQUIRED", "Choose at least one MP3 soundtrack.");
      }

      const created: SoundtrackAssetRecord[] = [];
      try {
        for (const file of files) {
          await assertMp3Signature(file);
          const saved = await storage.saveUpload({
            userId: user.id,
            projectId: project.id,
            category: "music",
            originalFilename: file.originalname,
            tempPath: file.path
          });
          const soundtrack: SoundtrackAssetRecord = {
            id: randomUUID(),
            userId: user.id,
            projectId: project.id,
            originalFilename: file.originalname.slice(0, 255),
            mimeType: "audio/mpeg",
            size: saved.size,
            localPath: saved.absolutePath,
            analysis: {},
            createdAt: new Date()
          };
          try {
            await repository.createSoundtrack(soundtrack);
          } catch (error) {
            await storage.deleteFile(user.id, project.id, saved.absolutePath).catch(() => undefined);
            throw error;
          }
          created.push(soundtrack);
        }
      } catch (error) {
        await Promise.allSettled(
          created.flatMap((asset) => [
            repository.deleteSoundtrack(user.id, project.id, asset.id),
            storage.deleteFile(user.id, project.id, asset.localPath)
          ])
        );
        await removeTemporaryUploads(files);
        throw error;
      }

      await removeTemporaryUploads(files);
      try {
        await pipeline.soundtracksUploaded(project, created);
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : "Analysis failed.";
        await Promise.allSettled(
          created.map((asset) =>
            repository.updateSoundtrack(user.id, project.id, asset.id, {
              analysis: { status: "analysis-failed", error: message }
            })
          )
        );
      }
      response.status(201).json({ soundtracks: created.map(toSoundtrackDto) });
    })
  );

  router.delete(
    "/projects/:projectId/soundtracks/:soundtrackId",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const soundtrack = await repository.getSoundtrack(
        user.id,
        project.id,
        routeId(request, "soundtrackId")
      );
      if (!soundtrack) {
        throw notFound("Soundtrack not found.");
      }
      await pipeline.soundtrackRemoved(project, soundtrack);
      await storage.deleteFile(user.id, project.id, soundtrack.localPath);
      await repository.deleteSoundtrack(user.id, project.id, soundtrack.id);
      response.sendStatus(204);
    })
  );

  router.post(
    "/projects/:projectId/render",
    ownsProject,
    asyncHandler(async (request, response) => {
      pipeline.requireAvailable();
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const body = parseBody(renderSchema, request.body) ?? {};
      const settings = settingsFromInput(body.settings, project.generationMode, project.settings);
      await validateSoundtrackSelection(repository, user.id, project.id, settings);
      const media = await repository.listMedia(user.id, project.id);
      if (media.length === 0) {
        throw new ApiError(409, "MEDIA_REQUIRED", "Upload at least one photo or video first.");
      }
      const soundtracks = await repository.listSoundtracks(user.id, project.id);
      const now = new Date();
      const renderJob: RenderJobRecord = {
        id: randomUUID(),
        userId: user.id,
        projectId: project.id,
        generationMode: project.generationMode,
        status: "queued",
        progress: 0,
        currentStage: "queued",
        settingsSnapshot: settings,
        createdAt: now,
        updatedAt: now
      };
      await repository.createRenderJob(renderJob);
      await repository.updateProject(user.id, project.id, { settings });
      pipeline.enqueue({ user, project: { ...project, settings }, media, soundtracks, renderJob });
      response.status(202).json({ renderJob: toRenderJobDto(renderJob) });
    })
  );

  router.get(
    "/projects/:projectId/render-jobs",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const jobs = await repository.listRenderJobs(user.id, project.id);
      response.json({ renderJobs: jobs.map(toRenderJobDto) });
    })
  );

  router.get(
    "/projects/:projectId/render-jobs/:renderJobId",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const job = await repository.getRenderJob(
        user.id,
        project.id,
        routeId(request, "renderJobId")
      );
      if (!job) {
        throw notFound("Render job not found.");
      }
      response.json({ renderJob: toRenderJobDto(job) });
    })
  );

  router.get(
    "/projects/:projectId/outputs",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const outputs = await repository.listOutputs(user.id, project.id);
      response.json({ outputs: outputs.map(toOutputDto) });
    })
  );

  router.post(
    "/projects/:projectId/outputs/:outputId/access-tickets",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const body = parseBody(outputTicketSchema, request.body);
      const output = await repository.getOutput(
        user.id,
        project.id,
        routeId(request, "outputId")
      );
      if (!output) {
        throw notFound("Render output not found.");
      }

      const issued = outputTickets.issue({
        userId: user.id,
        projectId: project.id,
        outputId: output.id,
        disposition: body.disposition
      });
      response.setHeader("Cache-Control", "no-store");
      response.status(201).json({
        accessTicket: {
          url: `/api/output-access/${encodeURIComponent(issued.token)}`,
          disposition: body.disposition,
          expiresAt: issued.expiresAt.toISOString()
        }
      });
    })
  );

  const serveOutput = (disposition: "inline" | "attachment") =>
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const output = await repository.getOutput(
        user.id,
        project.id,
        routeId(request, "outputId")
      );
      if (!output) {
        throw notFound("Render output not found.");
      }
      const filePath = await storage.getRenderOutputPath(user.id, project.id, output.localPath);
      await streamFile(request, response, {
        filePath,
        mimeType: mimeTypeFromFilename(filePath),
        filename: output.title.endsWith(".mp4") ? output.title : `${output.title}.mp4`,
        disposition
      });
    });
  router.get(
    "/projects/:projectId/outputs/:outputId/download",
    ownsProject,
    serveOutput("attachment")
  );
  router.head(
    "/projects/:projectId/outputs/:outputId/download",
    ownsProject,
    serveOutput("attachment")
  );
  router.get(
    "/projects/:projectId/outputs/:outputId/content",
    ownsProject,
    serveOutput("inline")
  );
  router.head(
    "/projects/:projectId/outputs/:outputId/content",
    ownsProject,
    serveOutput("inline")
  );

  router.get(
    "/projects/:projectId/outputs/:outputId/thumbnail",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      const output = await repository.getOutput(
        user.id,
        project.id,
        routeId(request, "outputId")
      );
      if (!output?.thumbnailPath) {
        throw notFound("Output thumbnail not found.");
      }
      const filePath = await storage.resolveProjectPath(
        user.id,
        project.id,
        output.thumbnailPath
      );
      await streamFile(request, response, {
        filePath,
        mimeType: mimeTypeFromFilename(filePath),
        filename: `${output.title}-thumbnail`,
        disposition: "inline"
      });
    })
  );

  router.get(
    "/projects/:projectId/thumbnail",
    ownsProject,
    asyncHandler(async (request, response) => {
      const { user } = getAuthContext(request);
      const project = getOwnedProject(request);
      if (!project.thumbnailPath) {
        throw notFound("Project thumbnail not found.");
      }
      const filePath = await storage.resolveProjectPath(
        user.id,
        project.id,
        project.thumbnailPath
      );
      await streamFile(request, response, {
        filePath,
        mimeType: mimeTypeFromFilename(filePath),
        filename: `${project.title}-thumbnail`,
        disposition: "inline"
      });
    })
  );

  return router;
}
