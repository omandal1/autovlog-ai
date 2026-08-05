# AutoVlog AI Project Guide

## Product boundary

AutoVlog AI is an account-based, local-rendering application for personal memory videos. The public frontend is safe to host separately; all trusted data access, media processing, and FFmpeg work stays in the local/self-hosted backend.

Active modes:

1. Diary / Notebook Memory Book (`memory-book` internally for legacy compatibility)
2. Wall Frame Memories (`wall-frame`)

The internal `memory-book` value is intentionally retained so existing timelines remain readable. The user-facing product name is Diary / Notebook Memory Book. Unknown old modes normalize to Diary. Apple Music, Modern Vlog, and social-trend modes are outside the product boundary.

## Runtime components

| Component | Location | Responsibility |
| --- | --- | --- |
| Hosted frontend | `app/`, `components/`, `lib/firebase/`, `lib/api/` | Firebase sign-in, protected dashboard, uploads, mode settings, jobs, outputs |
| Local API | `server/` | Firebase Admin verification, MongoDB, ownership, CORS, disk uploads, file delivery, render coordination |
| Pipeline adapter | `server/autovlog-pipeline-adapter.ts` | Converts database records into the established analysis/timeline pipeline and registers durable outputs |
| Media analysis | `media-processing/`, `scoring/`, `lib/analysis/` | Metadata, normalization, proxies, keyframes, scoring, duplicate and story enrichment |
| Story/timeline | `lib/story/`, `timeline/` | Chapters, story anchors, master/chapter timeline generation |
| Diary renderer | `render/render-service.ts`, `lib/book/`, `lib/render/` | Book pages, diary text, page transitions, music/source-audio mix, validation |
| Wall Frame renderer | `lib/wall-frame/`, `lib/render/wall-frame-render-strategy.ts` | Frame clusters, camera paths, validation/repair, FFmpeg composition, audio |
| Optional sidecar | `backend-python/` | Non-critical analysis enrichment |

Next.js contains no local filesystem API routes. `NEXT_PUBLIC_API_BASE_URL` is the only frontend connection to the trusted API.

## Persistence model

MongoDB uses separate collections for users, projects, media assets, soundtrack assets, render jobs, and render outputs. Repository methods require both `userId` and resource identifiers for reads, updates, and deletes.

The database stores file metadata and server-only paths, not media blobs. API DTOs remove paths, secrets, tokens, and prototype-like properties recursively.

Files use:

```text
<STORAGE_ROOT>/users/<userId>/projects/<projectId>/
  uploads/{images,videos,music}
  processed/{thumbnails,proxies,frames}
  renders/{master,chapters,wall-frame}
  metadata
  temp/<renderJobId>
```

`server/storage/storage-provider.ts` is the provider contract. `LocalStorageProvider` is the default and validates every resolved path against the owned project root. Future object storage should implement that contract while preserving repository ownership checks and path-free DTOs.

## Authentication and authorization

The frontend obtains a Firebase ID token and attaches it as a Bearer token. The API verifies token validity and revocation with Firebase Admin, then upserts a local user keyed by Firebase UID.

The API router is authenticated by default. Project middleware resolves a project through `getProject(user.id, projectId)`; downstream asset/job/output queries repeat the user/project scope. A guessed ID from another account returns `404`.

Large output playback uses a short-lived signed file ticket. Ticket issuance is authenticated and ownership-checked; redemption verifies the signature/expiry and re-queries the owned output before range streaming.

## End-to-end render flow

1. An authenticated user creates a MongoDB project and project storage root.
2. Multer streams uploads to a temporary disk directory; `LocalStorageProvider` moves them into the owned project.
3. The adapter extracts initial media/MP3 metadata and persists it.
4. `POST /api/projects/:projectId/render` snapshots settings and creates a queued `RenderJob`.
5. The pipeline verifies every stored path, preprocesses media, scores it, enriches it, creates chapters/story data, and builds timelines.
6. Diary renders master plus chapter timelines. Wall Frame builds and validates a distinct `WallFrameRenderPlan` and renders one framed-wall master.
7. Uploaded music plans use only selected uploaded MP3s; the internal library is used only when the project has no uploaded selection. Source-video audio is mixed under the existing policy.
8. Each final MP4 is decoded/validated before a `RenderOutput` is registered.
9. Success completes the job and deletes its temp directory. Failure stores a useful redacted error and never registers a corrupt output.

## Wall Frame invariants

- Media is ordered deterministically and assigned without unnecessary repeats.
- Sections contain balanced clusters and a hero/support hierarchy.
- Every frame retains both persistent `mediaAssetId` and exact timeline `clipId`.
- Bounds, overlaps, media assignments, durations, camera paths, and soundtrack segments are validated.
- Photos/videos preserve aspect ratio with controlled cover/contain behavior.
- Only the focused eligible video contributes source audio in a wall section.
- Camera moves are deterministic, stable, and eased.
- Repair and single-frame-section fallbacks remain Wall Frame output; they never masquerade as Diary.

## Local development

See `README.md` for complete Firebase, MongoDB, environment, local run, and Vercel instructions.

Common commands:

```powershell
npm run dev:backend
npm run dev:frontend
npm run python
npm run check
npm test
npm run build
```

## Tests and acceptance evidence

`server/__tests__/app.test.ts` covers authentication, CORS, owner isolation, upload persistence, invalid MP3 rejection, output registration, signed file access, and range delivery.

`scripts/validate-wall-frame.ts` covers deterministic planning, balanced clusters, unique assignments, bounds, identity preservation, repair, and the Wall Frame-only fallback. `WALL_FRAME_RENDER_SMOKE=1` enables a real mixed photo/video/music/source-audio FFmpeg render.

## Legacy data policy

`storage/projects` and `storage/accounts` belong to the previous unauthenticated/local-account architecture. They remain ignored and untouched. `scripts/audit-legacy-projects.ts` inventories them without mutation. No ownerless project is made visible to a Firebase user merely because its ID is known.

Any future importer must require an explicit local user, copy files into that user's new project root, rewrite all derived paths, normalize removed modes to Diary, and insert ownership-scoped MongoDB records transactionally.

## Repository hygiene

Never commit:

- Firebase Admin credentials or `.env*` secrets
- `storage/users`, incoming uploads, old personal projects, or account/session files
- generated renders, `.next`, dependency folders, caches, or logs

Repository: <https://github.com/omandal1/autovlog-ai>
