import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { config as loadDotenv } from "dotenv";
import { MongoClient } from "mongodb";

import { AutoVlogPipelineAdapter } from "../server/autovlog-pipeline-adapter";
import { loadServerConfig } from "../server/config";
import type { RenderJobRecord, UserRecord } from "../server/models";
import { MongoAutoVlogRepository } from "../server/mongo-repository";
import { PipelineCoordinator } from "../server/pipeline";
import { LocalStorageProvider } from "../server/storage/local-storage-provider";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), override: false, quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), ".env"), override: false, quiet: true });

async function main() {
  const projectId = process.argv[2]?.trim();
  if (!projectId) {
    throw new Error("Usage: npm run rerender:project -- <projectId>");
  }

  const config = loadServerConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to rerun a persisted project.");
  }

  const client = new MongoClient(config.databaseUrl, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  try {
    const database = client.db(config.databaseName);
    const storedProject = await database.collection("projects").findOne({ id: projectId });
    if (!storedProject || typeof storedProject.userId !== "string") {
      throw new Error(`Project ${projectId} was not found.`);
    }

    const repository = await MongoAutoVlogRepository.connect({
      client,
      databaseName: config.databaseName
    });
    let project = await repository.getProject(storedProject.userId, projectId);
    if (!project) {
      throw new Error(`Project ${projectId} was not found for its recorded owner.`);
    }
    const requestedMode = process.argv[3];
    if (requestedMode) {
      if (requestedMode !== "wall-frame" && requestedMode !== "memory-book") {
        throw new Error("Optional render mode must be wall-frame or memory-book.");
      }
      // Test another mode without overwriting the user's saved preferences.
      project = {
        ...project,
        generationMode: requestedMode,
        settings: { ...project.settings, generationMode: requestedMode }
      };
    }
    const user = await database.collection<UserRecord>("users").findOne({ id: project.userId });
    if (!user) {
      throw new Error(`The owner record for project ${projectId} was not found.`);
    }

    const existingJobs = await repository.listRenderJobs(user.id, project.id);
    const activeJob = existingJobs.find((job) => job.status === "queued" || job.status === "processing");
    if (activeJob) {
      throw new Error(`Render ${activeJob.id} is already ${activeJob.status}; refusing to start a duplicate.`);
    }

    const [media, soundtracks] = await Promise.all([
      repository.listMedia(user.id, project.id),
      repository.listSoundtracks(user.id, project.id)
    ]);
    if (!media.length) {
      throw new Error(`Project ${projectId} has no media.`);
    }

    const now = new Date();
    const renderJob: RenderJobRecord = {
      id: randomUUID(),
      userId: user.id,
      projectId: project.id,
      generationMode: project.generationMode,
      status: "queued",
      progress: 0,
      currentStage: "queued",
      settingsSnapshot: project.settings,
      createdAt: now,
      updatedAt: now
    };
    await repository.createRenderJob(renderJob);

    const storage = new LocalStorageProvider(config.storageRoot);
    await storage.initialize();
    const coordinator = new PipelineCoordinator(
      new AutoVlogPipelineAdapter(repository),
      repository,
      storage
    );
    coordinator.enqueue({ user, project, media, soundtracks, renderJob });

    console.log(
      `[rerender] Started ${renderJob.id} for ${project.title} (${project.generationMode}, ${media.length} media, ${soundtracks.length} soundtrack).`
    );
    let lastState = "";
    const deadline = Date.now() + 45 * 60 * 1_000;
    while (Date.now() < deadline) {
      const current = await repository.getRenderJob(user.id, project.id, renderJob.id);
      if (!current) {
        throw new Error(`Render job ${renderJob.id} disappeared while it was running.`);
      }
      const state = `${current.status}:${current.progress}:${current.currentStage}`;
      if (state !== lastState) {
        console.log(`[rerender] ${current.status} ${current.progress}% — ${current.currentStage}`);
        lastState = state;
      }
      if (current.status === "completed") {
        const outputs = (await repository.listOutputs(user.id, project.id)).filter(
          (output) => output.renderJobId === renderJob.id
        );
        console.log(`[rerender] Completed with ${outputs.length} validated output(s).`);
        for (const output of outputs) {
          console.log(`[rerender] ${output.type}: ${output.localPath} (${output.size} bytes)`);
        }
        return;
      }
      if (current.status === "failed") {
        throw new Error(current.errorMessage ?? `Render ${renderJob.id} failed without diagnostics.`);
      }
      await delay(2_000);
    }
    throw new Error(`Render ${renderJob.id} did not finish within 45 minutes.`);
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(`[rerender] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
