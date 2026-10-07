import express, { type Express } from "express";

import { createAuthMiddleware } from "./auth/auth-middleware";
import type { TokenVerifier } from "./auth/token-verifier";
import type { ServerConfig } from "./config";
import { createCorsMiddleware } from "./cors";
import { errorHandler, notFoundHandler } from "./errors";
import {
  PipelineCoordinator,
  UnavailableProjectPipelineAdapter,
  type ProjectPipelineAdapter
} from "./pipeline";
import type { AutoVlogRepository } from "./repository";
import { createApiRouter } from "./routes";
import type { StorageProvider } from "./storage/storage-provider";
import { OutputTicketService } from "./output-tickets";

export interface AppDependencies {
  config: ServerConfig;
  repository: AutoVlogRepository;
  storage: StorageProvider;
  tokenVerifier: TokenVerifier;
  pipelineAdapter?: ProjectPipelineAdapter;
  outputTicketService?: OutputTicketService;
}

export function createApp(dependencies: AppDependencies): Express {
  const { config, repository, storage, tokenVerifier } = dependencies;
  const pipeline = new PipelineCoordinator(
    dependencies.pipelineAdapter ?? new UnavailableProjectPipelineAdapter(),
    repository,
    storage
  );
  const outputTickets =
    dependencies.outputTicketService ??
    new OutputTicketService({
      secret: config.fileTicketSecret,
      ttlSeconds: config.fileTicketTtlSeconds
    });
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(createCorsMiddleware(config.frontendOrigins));

  app.get("/health", async (_request, response) => {
    try {
      await repository.ping();
      response.json({
        status: "ok",
        service: "autovlog-local-api",
        database: "connected",
        pipeline: pipeline.adapter.available ? "connected" : "not-connected",
        timestamp: new Date().toISOString()
      });
    } catch {
      response.status(503).json({
        status: "degraded",
        service: "autovlog-local-api",
        database: "unavailable",
        pipeline: pipeline.adapter.available ? "connected" : "not-connected",
        timestamp: new Date().toISOString()
      });
    }
  });

  app.use(express.json({ limit: "1mb", strict: true }));
  app.use(
    "/api",
    createApiRouter({
      config,
      repository,
      storage,
      pipeline,
      outputTickets,
      authMiddleware: createAuthMiddleware(tokenVerifier, repository)
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
