import type { Server } from "node:http";
import path from "node:path";

import { config as loadDotenv } from "dotenv";

import { FirebaseAdminTokenVerifier } from "./auth/firebase-admin-token-verifier";
import { createApp } from "./app";
import { loadServerConfig } from "./config";
import { MongoAutoVlogRepository } from "./mongo-repository";
import type { ProjectPipelineAdapter } from "./pipeline";
import type { AutoVlogRepository } from "./repository";
import { LocalStorageProvider } from "./storage/local-storage-provider";
import { createUnavailableRepository } from "./unavailable-repository";
import { AutoVlogPipelineAdapter } from "./autovlog-pipeline-adapter";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), override: false, quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), ".env"), override: false, quiet: true });

export const INTERRUPTED_RENDER_MESSAGE =
  "The backend stopped before this render finished. Start a new render to retry.";

export async function reconcileInterruptedRenderJobs(
  repository: Pick<AutoVlogRepository, "failInterruptedRenderJobs">
) {
  return repository.failInterruptedRenderJobs(INTERRUPTED_RENDER_MESSAGE);
}

export interface PipelineFactoryContext {
  config: ReturnType<typeof loadServerConfig>;
  repository: Awaited<ReturnType<typeof MongoAutoVlogRepository.connect>> | ReturnType<typeof createUnavailableRepository>;
  storage: LocalStorageProvider;
}

export type PipelineAdapterFactory = (
  context: PipelineFactoryContext
) => ProjectPipelineAdapter | Promise<ProjectPipelineAdapter>;

export async function startLocalApi(
  pipelineAdapterOrFactory?: ProjectPipelineAdapter | PipelineAdapterFactory
) {
  const config = loadServerConfig();
  const repository = await MongoAutoVlogRepository.connect({
    databaseUrl: config.databaseUrl,
    databaseName: config.databaseName
  }).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    const message = config.databaseUrl
      ? `MongoDB is unavailable. Start MongoDB and verify DATABASE_URL. (${detail})`
      : "DATABASE_URL is missing. Configure it before using authenticated API routes.";
    console.warn(`AutoVlog API started without a database: ${message}`);
    return createUnavailableRepository(message);
  });
  const interruptedRenderJobs = await reconcileInterruptedRenderJobs(repository);
  if (interruptedRenderJobs > 0) {
    console.warn(`Marked ${interruptedRenderJobs} interrupted render job(s) as failed.`);
  }
  const storage = new LocalStorageProvider(config.storageRoot);
  await storage.initialize();
  const pipelineAdapter =
    typeof pipelineAdapterOrFactory === "function"
      ? await pipelineAdapterOrFactory({ config, repository, storage })
      : pipelineAdapterOrFactory ?? new AutoVlogPipelineAdapter(repository);
  const app = createApp({
    config,
    repository,
    storage,
    tokenVerifier: new FirebaseAdminTokenVerifier(config.firebase),
    pipelineAdapter
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(config.port, config.host, () => resolve(listening));
    listening.once("error", reject);
  });

  const close = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await repository.close();
  };

  return { app, server, config, repository, storage, close };
}

if (require.main === module) {
  void startLocalApi()
    .then(({ config, close }) => {
      console.log(`AutoVlog local API listening at http://${config.host}:${config.port}`);
      const shutdown = () => {
        void close().finally(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Unable to start the AutoVlog local API: ${message}`);
      process.exitCode = 1;
    });
}
