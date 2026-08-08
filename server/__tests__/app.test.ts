import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import request from "supertest";

import { createApp } from "../app";
import type { TokenVerifier } from "../auth/token-verifier";
import { loadServerConfig } from "../config";
import type {
  MediaAssetRecord,
  ProjectRecord,
  RenderJobRecord,
  RenderOutputRecord,
  SoundtrackAssetRecord,
  UserRecord,
  VerifiedIdentity
} from "../models";
import {
  CallbackProjectPipelineAdapter,
  type ProjectPipelineAdapter
} from "../pipeline";
import { OutputTicketService } from "../output-tickets";
import {
  INTERRUPTED_RENDER_MESSAGE,
  reconcileInterruptedRenderJobs
} from "../start";
import { createUnavailableRepository } from "../unavailable-repository";
import type {
  AutoVlogRepository,
  MediaAssetPatch,
  ProjectPatch,
  RenderJobPatch,
  SoundtrackAssetPatch
} from "../repository";
import { LocalStorageProvider } from "../storage/local-storage-provider";

class MemoryRepository implements AutoVlogRepository {
  users: UserRecord[] = [];
  projects: ProjectRecord[] = [];
  media: MediaAssetRecord[] = [];
  soundtracks: SoundtrackAssetRecord[] = [];
  jobs: RenderJobRecord[] = [];
  outputs: RenderOutputRecord[] = [];

  async ping() {}
  async close() {}
  async failInterruptedRenderJobs(errorMessage: string) {
    const affectedProjects = new Set<string>();
    let updated = 0;
    for (const job of this.jobs) {
      if (job.status !== "queued" && job.status !== "processing") continue;
      Object.assign(job, {
        status: "failed",
        currentStage: "interrupted",
        errorMessage,
        completedAt: new Date(),
        updatedAt: new Date()
      });
      affectedProjects.add(`${job.userId}:${job.projectId}`);
      updated += 1;
    }
    for (const project of this.projects) {
      if (
        project.status === "processing" &&
        affectedProjects.has(`${project.userId}:${project.id}`)
      ) {
        project.status = "failed";
        project.updatedAt = new Date();
      }
    }
    return updated;
  }

  async upsertUser(identity: VerifiedIdentity) {
    const existing = this.users.find((user) => user.firebaseUid === identity.firebaseUid);
    if (existing) {
      Object.assign(existing, identity, { updatedAt: new Date() });
      return existing;
    }
    const now = new Date();
    const user: UserRecord = {
      id: `user-${identity.firebaseUid}`,
      ...identity,
      createdAt: now,
      updatedAt: now
    };
    this.users.push(user);
    return user;
  }

  async listProjects(userId: string) {
    return this.projects.filter((project) => project.userId === userId);
  }
  async createProject(project: ProjectRecord) {
    this.projects.push(project);
    return project;
  }
  async getProject(userId: string, projectId: string) {
    return this.projects.find((project) => project.userId === userId && project.id === projectId) ?? null;
  }
  async updateProject(userId: string, projectId: string, patch: ProjectPatch) {
    const project = await this.getProject(userId, projectId);
    if (!project) return null;
    Object.assign(project, patch, { updatedAt: new Date() });
    return project;
  }
  async deleteProject(userId: string, projectId: string) {
    const index = this.projects.findIndex(
      (project) => project.userId === userId && project.id === projectId
    );
    if (index < 0) return false;
    this.projects.splice(index, 1);
    this.media = this.media.filter((asset) => asset.userId !== userId || asset.projectId !== projectId);
    this.soundtracks = this.soundtracks.filter(
      (asset) => asset.userId !== userId || asset.projectId !== projectId
    );
    this.jobs = this.jobs.filter((job) => job.userId !== userId || job.projectId !== projectId);
    this.outputs = this.outputs.filter(
      (output) => output.userId !== userId || output.projectId !== projectId
    );
    return true;
  }

  async listMedia(userId: string, projectId: string) {
    return this.media.filter((asset) => asset.userId === userId && asset.projectId === projectId);
  }
  async createMedia(asset: MediaAssetRecord) {
    this.media.push(asset);
    return asset;
  }
  async getMedia(userId: string, projectId: string, mediaId: string) {
    return (
      this.media.find(
        (asset) => asset.userId === userId && asset.projectId === projectId && asset.id === mediaId
      ) ?? null
    );
  }
  async updateMedia(userId: string, projectId: string, mediaId: string, patch: MediaAssetPatch) {
    const asset = await this.getMedia(userId, projectId, mediaId);
    if (!asset) return null;
    Object.assign(asset, patch);
    return asset;
  }
  async deleteMedia(userId: string, projectId: string, mediaId: string) {
    const asset = await this.getMedia(userId, projectId, mediaId);
    if (!asset) return null;
    this.media.splice(this.media.indexOf(asset), 1);
    return asset;
  }

  async listSoundtracks(userId: string, projectId: string) {
    return this.soundtracks.filter(
      (asset) => asset.userId === userId && asset.projectId === projectId
    );
  }
  async createSoundtrack(asset: SoundtrackAssetRecord) {
    this.soundtracks.push(asset);
    return asset;
  }
  async getSoundtrack(userId: string, projectId: string, soundtrackId: string) {
    return (
      this.soundtracks.find(
        (asset) =>
          asset.userId === userId && asset.projectId === projectId && asset.id === soundtrackId
      ) ?? null
    );
  }
  async updateSoundtrack(
    userId: string,
    projectId: string,
    soundtrackId: string,
    patch: SoundtrackAssetPatch
  ) {
    const asset = await this.getSoundtrack(userId, projectId, soundtrackId);
    if (!asset) return null;
    Object.assign(asset, patch);
    return asset;
  }
  async deleteSoundtrack(userId: string, projectId: string, soundtrackId: string) {
    const asset = await this.getSoundtrack(userId, projectId, soundtrackId);
    if (!asset) return null;
    this.soundtracks.splice(this.soundtracks.indexOf(asset), 1);
    return asset;
  }

  async createRenderJob(job: RenderJobRecord) {
    this.jobs.push(job);
    return job;
  }
  async listRenderJobs(userId: string, projectId: string) {
    return this.jobs
      .filter((job) => job.userId === userId && job.projectId === projectId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }
  async getRenderJob(userId: string, projectId: string, renderJobId: string) {
    return (
      this.jobs.find(
        (job) => job.userId === userId && job.projectId === projectId && job.id === renderJobId
      ) ?? null
    );
  }
  async updateRenderJob(
    userId: string,
    projectId: string,
    renderJobId: string,
    patch: RenderJobPatch
  ) {
    const job = await this.getRenderJob(userId, projectId, renderJobId);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date() });
    return job;
  }

  async listOutputs(userId: string, projectId: string) {
    return this.outputs.filter(
      (output) => output.userId === userId && output.projectId === projectId
    );
  }
  async createOutput(output: RenderOutputRecord) {
    this.outputs.push(output);
    return output;
  }
  async getOutput(userId: string, projectId: string, outputId: string) {
    return (
      this.outputs.find(
        (output) =>
          output.userId === userId && output.projectId === projectId && output.id === outputId
      ) ?? null
    );
  }
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(
  options: { now?: () => number; pipelineAdapter?: ProjectPipelineAdapter } = {}
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "autovlog-api-test-"));
  roots.push(root);
  const repository = new MemoryRepository();
  const storage = new LocalStorageProvider(root);
  await storage.initialize();
  const config = loadServerConfig(
    {
      NODE_ENV: "test",
      STORAGE_ROOT: root,
      FRONTEND_ORIGIN: "https://app.example.test"
    },
    root
  );
  const tokenVerifier: TokenVerifier = {
    async verifyIdToken(token) {
      if (token !== "alice" && token !== "bob") {
        throw new Error("invalid token");
      }
      return { firebaseUid: token, email: `${token}@example.test` };
    }
  };
  const pipelineAdapter = options.pipelineAdapter ?? new CallbackProjectPipelineAdapter({
    async render(input, runtime) {
      await runtime.updateProgress(50, "rendering");
      const type = input.project.generationMode === "wall-frame" ? "wall-frame" : "master";
      const outputPath = await runtime.storage.allocateRenderOutputPath(
        input.user.id,
        input.project.id,
        type === "wall-frame" ? "wall-frame" : "master",
        "result.mp4"
      );
      await writeFile(outputPath, Buffer.from("0123456789", "ascii"));
      await runtime.registerOutput({ type, title: "Rendered memory", localPath: outputPath });
    }
  });
  const outputTicketService = new OutputTicketService({
    secret: config.fileTicketSecret,
    ttlSeconds: config.fileTicketTtlSeconds,
    now: options.now
  });
  return {
    app: createApp({
      config,
      repository,
      storage,
      tokenVerifier,
      pipelineAdapter,
      outputTicketService
    }),
    repository,
    storage,
    root
  };
}

function auth(token: "alice" | "bob") {
  return { Authorization: `Bearer ${token}` };
}

describe("AutoVlog local API", () => {
  test("keeps the unavailable-database fallback usable during async startup", async () => {
    const repository = createUnavailableRepository("MongoDB is offline for this test.");
    const resolved = await Promise.resolve(repository);

    assert.equal(resolved, repository);
    assert.equal(await reconcileInterruptedRenderJobs(repository), 0);
    await assert.rejects(repository.ping(), (error: unknown) => {
      return (
        error instanceof Error &&
        "code" in error &&
        error.code === "DATABASE_UNAVAILABLE"
      );
    });
  });

  test("marks interrupted render jobs and their processing projects as failed", async () => {
    const { repository, root } = await fixture();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const user = await repository.upsertUser({ firebaseUid: "alice" });
    const project: ProjectRecord = {
      id: "interrupted-project",
      userId: user.id,
      title: "Interrupted memories",
      status: "processing",
      generationMode: "memory-book",
      settings: { generationMode: "memory-book" },
      storageRoot: path.join(root, "users", user.id, "projects", "interrupted-project"),
      chapterOutputIds: [],
      wallFrameOutputIds: [],
      createdAt: now,
      updatedAt: now
    };
    repository.projects.push(project);
    repository.jobs.push(
      {
        id: "queued-job",
        userId: user.id,
        projectId: project.id,
        generationMode: "memory-book",
        status: "queued",
        progress: 0,
        currentStage: "queued",
        settingsSnapshot: { generationMode: "memory-book" },
        createdAt: now,
        updatedAt: now
      },
      {
        id: "processing-job",
        userId: user.id,
        projectId: project.id,
        generationMode: "memory-book",
        status: "processing",
        progress: 63,
        currentStage: "encoding",
        settingsSnapshot: { generationMode: "memory-book" },
        createdAt: now,
        updatedAt: now
      },
      {
        id: "completed-job",
        userId: user.id,
        projectId: project.id,
        generationMode: "memory-book",
        status: "completed",
        progress: 100,
        currentStage: "complete",
        settingsSnapshot: { generationMode: "memory-book" },
        completedAt: now,
        createdAt: now,
        updatedAt: now
      }
    );

    assert.equal(await reconcileInterruptedRenderJobs(repository), 2);
    assert.equal(project.status, "failed");
    for (const job of repository.jobs.slice(0, 2)) {
      assert.equal(job.status, "failed");
      assert.equal(job.currentStage, "interrupted");
      assert.equal(job.errorMessage, INTERRUPTED_RENDER_MESSAGE);
      assert.ok(job.completedAt instanceof Date);
    }
    assert.equal(repository.jobs[2]!.status, "completed");
  });

  test("rejects deletion during an active render and purges a queued project", async () => {
    const renderCalls: string[] = [];
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseRender!: () => void;
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    const pipelineAdapter = new CallbackProjectPipelineAdapter({
      async render(input) {
        renderCalls.push(input.project.id);
        signalStarted();
        await renderGate;
      }
    });
    const { app } = await fixture({ pipelineAdapter });

    const createRenderableProject = async (title: string) => {
      const created = await request(app)
        .post("/api/projects")
        .set(auth("alice"))
        .send({ title, generationMode: "memory-book" });
      assert.equal(created.status, 201);
      const projectId = created.body.project.id as string;
      const uploaded = await request(app)
        .post(`/api/projects/${projectId}/media`)
        .set(auth("alice"))
        .attach("files", Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
          filename: "memory.png",
          contentType: "image/png"
        });
      assert.equal(uploaded.status, 201);
      return projectId;
    };

    const activeProjectId = await createRenderableProject("Active render");
    const queuedProjectId = await createRenderableProject("Queued render");
    const activeRender = await request(app)
      .post(`/api/projects/${activeProjectId}/render`)
      .set(auth("alice"))
      .send({});
    assert.equal(activeRender.status, 202);
    await started;

    const queuedRender = await request(app)
      .post(`/api/projects/${queuedProjectId}/render`)
      .set(auth("alice"))
      .send({});
    assert.equal(queuedRender.status, 202);

    try {
      const activeDeletion = await request(app)
        .delete(`/api/projects/${activeProjectId}`)
        .set(auth("alice"));
      assert.equal(activeDeletion.status, 409);
      assert.equal(activeDeletion.body.error.code, "RENDER_IN_PROGRESS");

      const queuedDeletion = await request(app)
        .delete(`/api/projects/${queuedProjectId}`)
        .set(auth("alice"));
      assert.equal(queuedDeletion.status, 204);
      const deletedProject = await request(app)
        .get(`/api/projects/${queuedProjectId}`)
        .set(auth("alice"));
      assert.equal(deletedProject.status, 404);
    } finally {
      releaseRender();
    }

    let activeDeletionStatus = 409;
    for (let attempt = 0; attempt < 50 && activeDeletionStatus === 409; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeDeletionStatus = (
        await request(app).delete(`/api/projects/${activeProjectId}`).set(auth("alice"))
      ).status;
    }
    assert.equal(activeDeletionStatus, 204);
    assert.deepEqual(renderCalls, [activeProjectId]);
  });

  test("requires authentication, restricts CORS, and hides projects across owners", async () => {
    const { app } = await fixture();

    const unauthenticated = await request(app).get("/api/projects");
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.error.code, "AUTH_REQUIRED");

    const rejectedOrigin = await request(app)
      .get("/health")
      .set("Origin", "https://evil.example.test");
    assert.equal(rejectedOrigin.status, 403);
    assert.equal(rejectedOrigin.body.error.code, "ORIGIN_NOT_ALLOWED");

    const created = await request(app)
      .post("/api/projects")
      .set(auth("alice"))
      .send({ title: "Alice memories", generationMode: "memory-book" });
    assert.equal(created.status, 201);
    assert.equal(created.body.project.title, "Alice memories");
    assert.equal("storageRoot" in created.body.project, false);

    const guessed = await request(app)
      .get(`/api/projects/${created.body.project.id}`)
      .set(auth("bob"));
    assert.equal(guessed.status, 404);
    assert.equal(guessed.body.error.code, "NOT_FOUND");
  });

  test("persists owned uploads, registers render output, and supports byte ranges", async () => {
    const { app, repository, root } = await fixture();
    const created = await request(app)
      .post("/api/projects")
      .set(auth("alice"))
      .send({ title: "Wall memories", generationMode: "wall-frame" });
    const projectId = created.body.project.id as string;

    const uploadedMedia = await request(app)
      .post(`/api/projects/${projectId}/media`)
      .set(auth("alice"))
      .attach("files", Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: "memory.png",
        contentType: "image/png"
      });
    assert.equal(uploadedMedia.status, 201);
    assert.equal(uploadedMedia.body.media.length, 1);
    assert.equal("localPath" in uploadedMedia.body.media[0], false);
    assert.match(repository.media[0].localPath, /users[\\/]user-alice[\\/]projects/);

    const uploadedSoundtracks = await request(app)
      .post(`/api/projects/${projectId}/soundtracks`)
      .set(auth("alice"))
      .attach("soundtracks", Buffer.from("ID3test-track", "ascii"), {
        filename: "song.mp3",
        contentType: "audio/mpeg"
      });
    assert.equal(uploadedSoundtracks.status, 201);
    assert.equal(uploadedSoundtracks.body.soundtracks.length, 1);
    assert.equal("localPath" in uploadedSoundtracks.body.soundtracks[0], false);

    const render = await request(app)
      .post(`/api/projects/${projectId}/render`)
      .set(auth("alice"))
      .send({});
    assert.equal(render.status, 202);
    assert.equal(render.body.renderJob.status, "queued");

    let completed;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      completed = await request(app)
        .get(`/api/projects/${projectId}/render-jobs/${render.body.renderJob.id}`)
        .set(auth("alice"));
      if (completed.body.renderJob?.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(completed?.body.renderJob.status, "completed");

    const outputs = await request(app)
      .get(`/api/projects/${projectId}/outputs`)
      .set(auth("alice"));
    assert.equal(outputs.status, 200);
    assert.equal(outputs.body.outputs.length, 1);
    assert.equal(outputs.body.outputs[0].type, "wall-frame");
    assert.equal("localPath" in outputs.body.outputs[0], false);

    const outputId = outputs.body.outputs[0].id as string;
    repository.outputs[0]!.title = "Mémoires été.mp4";
    const ticket = await request(app)
      .post(`/api/projects/${projectId}/outputs/${outputId}/access-tickets`)
      .set(auth("alice"))
      .send({ disposition: "inline" });
    assert.equal(ticket.status, 201);
    const ticketUrl = ticket.body.accessTicket.url as string;
    assert.match(ticketUrl, /^\/api\/output-access\/v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(ticketUrl.includes(projectId), false);
    assert.equal(ticketUrl.includes(outputId), false);
    assert.equal(ticketUrl.includes("user-alice"), false);

    const ranged = await request(app).get(ticketUrl).set("Range", "bytes=2-5");
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers["content-range"], "bytes 2-5/10");
    assert.equal(
      ranged.headers["content-disposition"],
      "inline; filename=\"M_moires _t_.mp4\"; filename*=UTF-8''M%C3%A9moires%20%C3%A9t%C3%A9.mp4"
    );
    assert.deepEqual(ranged.body, Buffer.from("2345", "ascii"));

    const head = await request(app).head(ticketUrl);
    assert.equal(head.status, 200);
    assert.equal(head.headers["content-length"], "10");
    assert.equal(head.headers["cache-control"], "private, no-store");

    const attachmentTicket = await request(app)
      .post(`/api/projects/${projectId}/outputs/${outputId}/access-tickets`)
      .set(auth("alice"))
      .send({ disposition: "attachment" });
    const attachmentHead = await request(app).head(attachmentTicket.body.accessTicket.url);
    assert.equal(attachmentHead.status, 200);
    assert.equal(
      attachmentHead.headers["content-disposition"],
      "attachment; filename=\"M_moires _t_.mp4\"; filename*=UTF-8''M%C3%A9moires%20%C3%A9t%C3%A9.mp4"
    );

    const denied = await request(app)
      .post(`/api/projects/${projectId}/outputs/${outputId}/access-tickets`)
      .set(auth("bob"))
      .send({ disposition: "attachment" });
    assert.equal(denied.status, 404);

    const usersDirectory = await readdir(path.join(root, "users"));
    assert.deepEqual(usersDirectory, ["user-alice"]);
  });

  test("rejects expired or tampered output tickets and revalidates ownership", async () => {
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const { app, repository, storage } = await fixture({ now: () => nowMs });
    const created = await request(app)
      .post("/api/projects")
      .set(auth("alice"))
      .send({ title: "Ticket checks", generationMode: "memory-book" });
    const projectId = created.body.project.id as string;
    const outputId = "ticket-output";
    const outputPath = await storage.allocateRenderOutputPath(
      "user-alice",
      projectId,
      "master",
      "ticket-result.mp4"
    );
    await writeFile(outputPath, Buffer.from("0123456789", "ascii"));
    await repository.createOutput({
      id: outputId,
      userId: "user-alice",
      projectId,
      renderJobId: "ticket-job",
      type: "master",
      title: "Ticket result",
      localPath: outputPath,
      size: 10,
      createdAt: new Date(nowMs)
    });

    const issue = () =>
      request(app)
        .post(`/api/projects/${projectId}/outputs/${outputId}/access-tickets`)
        .set(auth("alice"))
        .send({ disposition: "inline" });

    const expiring = await issue();
    assert.equal(expiring.status, 201);
    nowMs += 901_000;
    const expired = await request(app).get(expiring.body.accessTicket.url);
    assert.equal(expired.status, 401);
    assert.equal(expired.body.error.code, "OUTPUT_TICKET_EXPIRED");

    const fresh = await issue();
    assert.equal(fresh.status, 201);
    const freshUrl = fresh.body.accessTicket.url as string;
    const finalCharacter = freshUrl.at(-1);
    const tamperedUrl = `${freshUrl.slice(0, -1)}${finalCharacter === "A" ? "B" : "A"}`;
    const tampered = await request(app).get(tamperedUrl);
    assert.equal(tampered.status, 401);
    assert.equal(tampered.body.error.code, "OUTPUT_TICKET_INVALID");

    const ownershipTicket = await issue();
    repository.outputs[0]!.userId = "user-bob";
    const ownershipChanged = await request(app).get(ownershipTicket.body.accessTicket.url);
    assert.equal(ownershipChanged.status, 404);
  });

  test("redacts local paths from media and soundtrack analysis DTOs", async () => {
    const { app, repository, root } = await fixture();
    const created = await request(app)
      .post("/api/projects")
      .set(auth("alice"))
      .send({ title: "Redaction checks" });
    const projectId = created.body.project.id as string;
    const now = new Date();

    repository.media.push({
      id: "media-redaction",
      userId: "user-alice",
      projectId,
      type: "image",
      originalFilename: "memory.jpg",
      mimeType: "image/jpeg",
      size: 123,
      localPath: path.join(root, "users", "user-alice", "memory.jpg"),
      metadata: {},
      analysis: {
        error: "ffprobe could not inspect \"C:\\Users\\alice\\Private Videos\\clip.mp4\": invalid data",
        nested: {
          ingestError: "decoder failed at /srv/autovlog/users/alice/media/clip.mp4"
        },
        referenceUrl: "https://example.test/reference/error"
      },
      createdAt: now
    });
    repository.soundtracks.push({
      id: "soundtrack-redaction",
      userId: "user-alice",
      projectId,
      originalFilename: "song.mp3",
      mimeType: "audio/mpeg",
      size: 456,
      localPath: path.join(root, "users", "user-alice", "song.mp3"),
      analysis: {
        error: "ENOENT while reading D:\\Downloads\\Private Music\\song.mp3"
      },
      createdAt: now
    });

    const media = await request(app)
      .get(`/api/projects/${projectId}/media`)
      .set(auth("alice"));
    assert.equal(media.status, 200);
    assert.equal(
      media.body.media[0].analysis.error,
      "ffprobe could not inspect \"[local file]\": invalid data"
    );
    assert.equal(
      media.body.media[0].analysis.nested.ingestError,
      "An internal file operation failed."
    );
    assert.equal(
      media.body.media[0].analysis.referenceUrl,
      "https://example.test/reference/error"
    );

    const soundtracks = await request(app)
      .get(`/api/projects/${projectId}/soundtracks`)
      .set(auth("alice"));
    assert.equal(soundtracks.status, 200);
    assert.equal(
      soundtracks.body.soundtracks[0].analysis.error,
      "An internal file operation failed."
    );

    const publicPayload = JSON.stringify({ media: media.body, soundtracks: soundtracks.body });
    assert.equal(publicPayload.includes("C:\\\\Users"), false);
    assert.equal(publicPayload.includes("D:\\\\Downloads"), false);
    assert.equal(publicPayload.includes("/srv/autovlog"), false);
  });

  test("rejects an MP3 extension with invalid file content", async () => {
    const { app } = await fixture();
    const created = await request(app)
      .post("/api/projects")
      .set(auth("alice"))
      .send({ title: "Invalid upload" });
    const projectId = created.body.project.id as string;

    const invalid = await request(app)
      .post(`/api/projects/${projectId}/soundtracks`)
      .set(auth("alice"))
      .attach("files", Buffer.from("not-an-mp3", "ascii"), {
        filename: "fake.mp3",
        contentType: "audio/mpeg"
      });
    assert.equal(invalid.status, 415);
    assert.equal(invalid.body.error.code, "INVALID_MP3");
  });
});
