import type { Collection, Db, MongoClient as MongoClientType } from "mongodb";
import { MongoClient } from "mongodb";

import { ConfigurationError } from "./errors";
import type {
  MediaAssetRecord,
  ProjectRecord,
  RenderJobRecord,
  RenderOutputRecord,
  SoundtrackAssetRecord,
  UserRecord,
  VerifiedIdentity
} from "./models";
import type {
  AutoVlogRepository,
  MediaAssetPatch,
  ProjectPatch,
  RenderJobPatch,
  SoundtrackAssetPatch
} from "./repository";

interface Collections {
  users: Collection<UserRecord>;
  projects: Collection<ProjectRecord>;
  mediaAssets: Collection<MediaAssetRecord>;
  soundtrackAssets: Collection<SoundtrackAssetRecord>;
  renderJobs: Collection<RenderJobRecord>;
  renderOutputs: Collection<RenderOutputRecord>;
}

export interface MongoRepositoryOptions {
  databaseUrl?: string;
  databaseName?: string;
  client?: MongoClientType;
}

export class MongoAutoVlogRepository implements AutoVlogRepository {
  private readonly client: MongoClientType;
  private readonly ownsClient: boolean;
  private readonly db: Db;
  private readonly collections: Collections;

  private constructor(client: MongoClientType, databaseName: string, ownsClient: boolean) {
    this.client = client;
    this.ownsClient = ownsClient;
    this.db = client.db(databaseName);
    this.collections = {
      users: this.db.collection<UserRecord>("users"),
      projects: this.db.collection<ProjectRecord>("projects"),
      mediaAssets: this.db.collection<MediaAssetRecord>("mediaAssets"),
      soundtrackAssets: this.db.collection<SoundtrackAssetRecord>("soundtrackAssets"),
      renderJobs: this.db.collection<RenderJobRecord>("renderJobs"),
      renderOutputs: this.db.collection<RenderOutputRecord>("renderOutputs")
    };
  }

  static async connect(options: MongoRepositoryOptions) {
    if (!options.client && !options.databaseUrl) {
      throw new ConfigurationError(
        "DATABASE_NOT_CONFIGURED",
        "DATABASE_URL is required for the local API. Example: mongodb://127.0.0.1:27017/autovlog"
      );
    }

    const ownsClient = !options.client;
    const client = options.client ?? new MongoClient(options.databaseUrl!, {
      serverSelectionTimeoutMS: 5_000
    });
    if (ownsClient) {
      await client.connect();
    }

    const repository = new MongoAutoVlogRepository(
      client,
      options.databaseName || "autovlog",
      ownsClient
    );
    await repository.ensureIndexes();
    return repository;
  }

  private async ensureIndexes() {
    await Promise.all([
      this.collections.users.createIndex({ firebaseUid: 1 }, { unique: true }),
      this.collections.users.createIndex({ email: 1 }, { sparse: true }),
      this.collections.projects.createIndex({ userId: 1, updatedAt: -1 }),
      this.collections.projects.createIndex({ id: 1 }, { unique: true }),
      this.collections.mediaAssets.createIndex({ userId: 1, projectId: 1, createdAt: 1 }),
      this.collections.mediaAssets.createIndex({ id: 1 }, { unique: true }),
      this.collections.soundtrackAssets.createIndex({
        userId: 1,
        projectId: 1,
        createdAt: 1
      }),
      this.collections.soundtrackAssets.createIndex({ id: 1 }, { unique: true }),
      this.collections.renderJobs.createIndex({ userId: 1, projectId: 1, createdAt: -1 }),
      this.collections.renderJobs.createIndex({ id: 1 }, { unique: true }),
      this.collections.renderOutputs.createIndex({ userId: 1, projectId: 1, createdAt: -1 }),
      this.collections.renderOutputs.createIndex({ id: 1 }, { unique: true })
    ]);
  }

  async ping() {
    await this.db.command({ ping: 1 });
  }

  async close() {
    if (this.ownsClient) {
      await this.client.close();
    }
  }

  async failInterruptedRenderJobs(errorMessage: string) {
    const interrupted = await this.collections.renderJobs
      .find(
        { status: { $in: ["queued", "processing"] } },
        { projection: { userId: 1, projectId: 1 } }
      )
      .toArray();
    if (interrupted.length === 0) {
      return 0;
    }

    const now = new Date();
    const result = await this.collections.renderJobs.updateMany(
      { status: { $in: ["queued", "processing"] } },
      {
        $set: {
          status: "failed",
          currentStage: "interrupted",
          errorMessage: errorMessage.slice(0, 2_000),
          completedAt: now,
          updatedAt: now
        }
      }
    );

    const projectFilters = Array.from(
      new Map(
        interrupted.map((job) => [
          `${job.userId}:${job.projectId}`,
          { id: job.projectId, userId: job.userId }
        ])
      ).values()
    );
    if (projectFilters.length > 0) {
      await this.collections.projects.updateMany(
        {
          status: "processing",
          $or: projectFilters
        },
        { $set: { status: "failed", updatedAt: now } }
      );
    }

    return result.modifiedCount;
  }

  async upsertUser(identity: VerifiedIdentity) {
    const now = new Date();
    const profile = {
      ...(identity.email ? { email: identity.email } : {}),
      ...(identity.displayName ? { displayName: identity.displayName } : {}),
      ...(identity.photoURL ? { photoURL: identity.photoURL } : {}),
      updatedAt: now
    };
    const user = await this.collections.users.findOneAndUpdate(
      { firebaseUid: identity.firebaseUid },
      {
        $set: profile,
        $setOnInsert: {
          id: crypto.randomUUID(),
          firebaseUid: identity.firebaseUid,
          createdAt: now
        }
      },
      { upsert: true, returnDocument: "after" }
    );
    if (!user) {
      throw new Error("Failed to create or update the authenticated user record.");
    }
    return user;
  }

  async listProjects(userId: string) {
    return this.collections.projects.find({ userId }).sort({ updatedAt: -1 }).toArray();
  }

  async createProject(project: ProjectRecord) {
    await this.collections.projects.insertOne(project);
    return project;
  }

  async getProject(userId: string, projectId: string) {
    return this.collections.projects.findOne({ id: projectId, userId });
  }

  async updateProject(userId: string, projectId: string, patch: ProjectPatch) {
    return this.collections.projects.findOneAndUpdate(
      { id: projectId, userId },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
  }

  async deleteProject(userId: string, projectId: string) {
    const result = await this.collections.projects.deleteOne({ id: projectId, userId });
    if (result.deletedCount === 0) {
      return false;
    }

    const owned = { userId, projectId };
    await Promise.all([
      this.collections.mediaAssets.deleteMany(owned),
      this.collections.soundtrackAssets.deleteMany(owned),
      this.collections.renderJobs.deleteMany(owned),
      this.collections.renderOutputs.deleteMany(owned)
    ]);
    return true;
  }

  async listMedia(userId: string, projectId: string) {
    return this.collections.mediaAssets.find({ userId, projectId }).sort({ createdAt: 1 }).toArray();
  }

  async createMedia(asset: MediaAssetRecord) {
    await this.collections.mediaAssets.insertOne(asset);
    return asset;
  }

  async getMedia(userId: string, projectId: string, mediaId: string) {
    return this.collections.mediaAssets.findOne({ id: mediaId, userId, projectId });
  }

  async updateMedia(
    userId: string,
    projectId: string,
    mediaId: string,
    patch: MediaAssetPatch
  ) {
    return this.collections.mediaAssets.findOneAndUpdate(
      { id: mediaId, userId, projectId },
      { $set: patch },
      { returnDocument: "after" }
    );
  }

  async deleteMedia(userId: string, projectId: string, mediaId: string) {
    return this.collections.mediaAssets.findOneAndDelete({ id: mediaId, userId, projectId });
  }

  async listSoundtracks(userId: string, projectId: string) {
    return this.collections.soundtrackAssets
      .find({ userId, projectId })
      .sort({ createdAt: 1 })
      .toArray();
  }

  async createSoundtrack(asset: SoundtrackAssetRecord) {
    await this.collections.soundtrackAssets.insertOne(asset);
    return asset;
  }

  async getSoundtrack(userId: string, projectId: string, soundtrackId: string) {
    return this.collections.soundtrackAssets.findOne({
      id: soundtrackId,
      userId,
      projectId
    });
  }

  async updateSoundtrack(
    userId: string,
    projectId: string,
    soundtrackId: string,
    patch: SoundtrackAssetPatch
  ) {
    return this.collections.soundtrackAssets.findOneAndUpdate(
      { id: soundtrackId, userId, projectId },
      { $set: patch },
      { returnDocument: "after" }
    );
  }

  async deleteSoundtrack(userId: string, projectId: string, soundtrackId: string) {
    return this.collections.soundtrackAssets.findOneAndDelete({
      id: soundtrackId,
      userId,
      projectId
    });
  }

  async createRenderJob(job: RenderJobRecord) {
    await this.collections.renderJobs.insertOne(job);
    return job;
  }

  async listRenderJobs(userId: string, projectId: string) {
    return this.collections.renderJobs
      .find({ userId, projectId })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async getRenderJob(userId: string, projectId: string, renderJobId: string) {
    return this.collections.renderJobs.findOne({ id: renderJobId, userId, projectId });
  }

  async updateRenderJob(
    userId: string,
    projectId: string,
    renderJobId: string,
    patch: RenderJobPatch
  ) {
    return this.collections.renderJobs.findOneAndUpdate(
      { id: renderJobId, userId, projectId },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
  }

  async listOutputs(userId: string, projectId: string) {
    return this.collections.renderOutputs
      .find({ userId, projectId })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async createOutput(output: RenderOutputRecord) {
    await this.collections.renderOutputs.insertOne(output);
    return output;
  }

  async getOutput(userId: string, projectId: string, outputId: string) {
    return this.collections.renderOutputs.findOne({ id: outputId, userId, projectId });
  }
}
