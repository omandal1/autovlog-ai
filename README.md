# AutoVlog AI

AutoVlog AI turns a user's photos, videos, and optional MP3 files into durable personal-memory videos. It is now split into a Vercel-ready Next.js frontend and a local/self-hosted API that owns authentication checks, MongoDB metadata, large files, analysis, and FFmpeg rendering.

The supported products are:

- **Diary / Notebook Memory Book** — the existing physical-book presentation, diary text, page turns, uploaded soundtrack mixing, one master, and chapter mini-vlogs.
- **Wall Frame Memories** — an original gallery tour with rotating hero memories, varied frame openings/materials, camera glides, push-ins, captions, and focused source-video audio. It produces a 2–5 minute Wall Frame Master plus 30–90 second memory-cluster videos.

Apple Music, Modern Vlog, social-trend scraping, and TikTok/Instagram modes are not part of this product.

## Architecture

```text
Next.js frontend (local or Vercel)
  -> Firebase Auth (Google and email/password)
  -> Firebase ID token in Authorization: Bearer ...
  -> Express API (local/self-hosted, port 8787)
       -> Firebase Admin token verification
       -> MongoDB metadata and ownership queries
       -> LocalStorageProvider under storage/users/...
       -> local media analysis + FFmpeg render pipeline
       -> optional FastAPI analysis sidecar (port 8001)
```

The browser never receives raw filesystem paths. Every project, asset, soundtrack, job, and output lookup is scoped to the authenticated local user record. Large uploads are streamed to disk, and video delivery supports HTTP byte ranges.

## Requirements

- Node.js 22.15 or newer
- MongoDB Community Server or another reachable MongoDB deployment
- A Firebase project with Authentication enabled
- Python 3.10+ only if using the optional analysis sidecar
- Local disk space for original media, processed files, temporary renders, and outputs

FFmpeg and FFprobe use the bundled `ffmpeg-static` and `ffprobe-static` packages unless explicit paths are configured.

## Cost guardrail

The local AutoVlog setup is designed to run without paid cloud resources: MongoDB Community Server and media storage stay on the local machine, while Firebase remains on the no-cost Spark plan for email/password and Google authentication. Do not enable Google Cloud billing or upgrade Firebase to the Blaze plan for local development.

## First-time setup

Install Node dependencies:

```powershell
npm install
```

Copy the environment template:

```powershell
Copy-Item .env.example .env.local
```

The backend loads `.env.local` and `.env`; Next.js loads `.env.local`.

Start MongoDB, then confirm that `DATABASE_URL` points to it. A common local value is:

```env
DATABASE_URL=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=autovlog
```

The API intentionally starts in a degraded state when MongoDB is unavailable. `/health` returns `503`, and authenticated data routes return a clear database configuration error instead of silently using temporary data.

## Firebase setup

1. Create or select a Firebase project.
2. In **Authentication > Sign-in method**, enable Email/Password and Google.
3. Register a Firebase Web app and copy its public values into the `NEXT_PUBLIC_FIREBASE_*` variables.
4. Create a Firebase Admin service account and put its project ID, client email, and private key in the backend-only variables.
5. Add `localhost` and the eventual Vercel domain to Firebase Authentication's authorized domains.

Example client configuration:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

Example server configuration:

```env
FIREBASE_PROJECT_ID=your-project
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Instead of embedding a private key, local development can save the service-account JSON as `.secrets/firebase-admin.json` and set `GOOGLE_APPLICATION_CREDENTIALS` to its absolute path. The `.secrets` directory is ignored by Git. Secrets must never use a `NEXT_PUBLIC_` prefix or be committed.

If Firebase client settings are missing, the login screen shows a configuration message. If Firebase Admin is missing, the API stays up but authenticated routes return a clear `503` configuration error.

## Run locally

Use two terminals from the repository root.

Terminal 1 — authenticated local API, MongoDB access, storage, and rendering:

```powershell
npm run dev:backend
```

Terminal 2 — Next.js frontend:

```powershell
npm run dev:frontend
```

Open `http://127.0.0.1:3000`. The API is at `http://127.0.0.1:8787`; its public health endpoint is `http://127.0.0.1:8787/health`.

The Python sidecar is optional. To enable its extra scoring, chapter-label, and transcription hints:

```powershell
python -m pip install -r backend-python/requirements.txt
npm run python
```

When the sidecar is offline, deterministic Node.js analysis remains active.

## Environment variables

The complete, secret-free template is in `.env.example`.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | frontend | Reachable Express API origin |
| `NEXT_PUBLIC_FIREBASE_*` | frontend | Firebase Web app configuration |
| `DATABASE_URL` | backend | MongoDB connection string |
| `MONGODB_DB_NAME` | backend | MongoDB database name |
| `STORAGE_ROOT` | backend | Local storage root; defaults to `./storage` |
| `FIREBASE_PROJECT_ID` | backend | Firebase Admin project |
| `FIREBASE_CLIENT_EMAIL` | backend | Firebase Admin service-account email |
| `FIREBASE_PRIVATE_KEY` | backend | Firebase Admin private key |
| `FRONTEND_ORIGIN` | backend | Comma-separated allowed browser origins |
| `HOST`, `PORT` | backend | API bind address and port |
| `MAX_*` | backend | Upload byte/count limits |
| `FILE_TICKET_*` | backend | Signed streaming link secret and TTL (defaults to 900 seconds; maximum 3600) |
| `PYTHON_SERVICE_URL` | render pipeline | Optional analysis sidecar URL |
| `FFMPEG_PATH`, `FFPROBE_PATH` | render pipeline | Optional binary overrides |

## Local storage

Large files are not stored as MongoDB blobs and are not written to Vercel's filesystem. MongoDB stores metadata and server-only local paths. `LocalStorageProvider` creates this structure:

```text
storage/
  users/<localUserId>/projects/<projectId>/
    uploads/images/
    uploads/videos/
    uploads/music/
    processed/thumbnails/
    processed/proxies/
    processed/frames/
    renders/master/
    renders/chapters/
    renders/wall-frame/
    metadata/
    temp/
```

Path segments are validated, client paths are ignored, stored paths are checked against the owned project root, and project deletion is constrained to that root. Runtime user files are ignored by Git.

`StorageProvider` is the extension boundary for a future S3, R2, or Firebase Storage implementation. Replacing local storage does not require changing browser DTOs or project ownership rules.

## Upload and soundtrack behavior

- Media and MP3 files belong to a project and persist across refreshes.
- Uploads use disk-backed multipart handling instead of buffering multi-GB video files in memory.
- MP3 extensions, MIME types, signatures, and configured limits are validated.
- Multiple uploaded MP3s are analyzed for duration, loudness, silence edges, energy, and estimated tempo.
- If detailed MP3 analysis fails but FFprobe confirms valid usable audio, a conservative duration/volume plan is used.
- When any MP3s are selected, only those MP3s provide background music. Source-video audio can still be mixed and ducks the music.
- Uploaded songs play continuously from their beginnings in playlist order. Songs are not chopped at scene/page boundaries; the playlist loops when needed, with a brief boundary blend to avoid clicks. Chapter soundtrack balancing selects a song for each mini-vlog, which also plays from its beginning and loops as needed.
- Without an uploaded MP3, the local royalty-free library supplies fallback music.

## Render jobs and outputs

Starting a render creates a MongoDB `RenderJob`. Progress, current stage, errors, settings snapshots, and plan paths persist. Successful files are validated before `RenderOutput` records are created.

The shared professional editorial planner runs before either renderer. It derives a structured `EditorialAnalysis` for each usable asset, selects candidate source ranges, suppresses redundant takes, chooses a hook from across the footage, restores contextual chronology after the hook, varies shot scale/visual palette, and records selection reasons. Every timeline stores an `EditDecisionList` containing scene and clip decisions, source trims, pacing, audio overlap decisions, and explainability data. Diary and Wall Frame therefore interpret the same story decisions in different visual languages.

Render stages are reported from real work (`VALIDATING_MEDIA`, `ANALYZING_MEDIA`, `PLANNING_STORY`, `PREPARING_MEDIA`, `BUILDING_VISUALS`, `RENDERING_SEGMENTS`, `MIXING_AUDIO`, `FINAL_ENCODING`, and `VALIDATING_OUTPUT`). A per-job timing file is written under the project `metadata` directory. Final registration performs an independent FFprobe check for a playable H.264/yuv420p video with AAC-compatible audio.

Unchanged normalized images, thumbnails, video proxies, and sampled keyframes are reused. Metadata and image scoring use bounded worker pools, video normalization is limited to three concurrent jobs, and one corrupt source asset is recorded and skipped without discarding an otherwise usable project.

Diary mode renders the master and chapter timelines. Wall Frame mode renders a `wall-frame-master` plus `wall-frame-cluster` outputs from the editorial chapters. Saved outputs remain visible when the generation mode changes.

The Wall Frame coverage planner first chooses a duration-appropriate set of memories, then assigns every selected memory a hero slot. Each section normally features two heroes, foreshadows upcoming heroes in supporting frames, and promotes those memories in following sections. Plans record `selectedMasterMedia`, explicit duration exclusions, per-memory hero/support counts, and coverage metrics. Validation rejects uncovered selected memories or hero domination. The low/medium/high Frame Variety control affects the actual materials and masked openings. Intermediate layouts and masks are deterministic throughout camera motion.

Output preview/download links are short-lived signed tickets issued only after an authenticated ownership check. Tickets default to a 15-minute lifetime (`FILE_TICKET_TTL_SECONDS=900`) and are capped at one hour. The ticket endpoint rechecks the output record and preserves byte-range streaming, so the browser does not have to buffer an entire large render.

## Vercel frontend deployment

Only the Next.js frontend should be deployed to Vercel. The old Next.js filesystem/render API routes have been removed; heavy FFmpeg work remains in `server/`.

1. Import the GitHub repository into Vercel.
2. Configure the five `NEXT_PUBLIC_*` variables for each Vercel environment.
3. Set `NEXT_PUBLIC_API_BASE_URL` to the public **HTTPS** address of the self-hosted API.
4. Add the Vercel domain to Firebase authorized domains.
5. Add the same exact Vercel origin to the backend's `FRONTEND_ORIGIN` and restart the backend.

`127.0.0.1` works only when the browser and API are on the same machine. A hosted frontend used from other devices needs the local API exposed through a securely configured HTTPS reverse proxy or tunnel. Protect that endpoint, keep Firebase verification enabled, and do not expose MongoDB or the storage directory directly.

## Legacy projects

Old JSON projects under `storage/projects` are left untouched. They are never auto-attached to a Firebase account, because many have no verifiable owner and project-ID guessing must not grant access.

Run the read-only audit:

```powershell
npm run audit:legacy
npm run audit:legacy -- --json
```

Unknown or removed legacy generation modes should be treated as Diary during any future explicit, owner-verified import. The authenticated API writes all new projects to the new user/project layout.

## Validation

```powershell
npm run check
npm test
npm run build
```

`npm test` runs API ownership/upload/range tests, Diary and Wall Frame validation, 36/100/300-item editorial planning scenarios, corrupt-source handling, and normalized-proxy cache validation. All runtime and test scratch directories stay under this D-drive project storage root. An optional real FFmpeg Wall Frame smoke pass can be run with:

```powershell
$env:WALL_FRAME_RENDER_SMOKE='1'
npm run validate:wall-frame
```

The continuous-music regression test renders actual encoded audio and a Wall Frame MP4, then checks the order of known audio passages through multiple loops:

```powershell
npx ts-node -r tsconfig-paths/register --project tsconfig.scripts.json scripts/validate-continuous-music.ts
```

## Wall Frame originality note

Wall Frame Memories uses the broad idea of moving among framed personal memories. Its layout system, frame treatments, camera paths, captions, timing, fallback logic, and audio rules are original to AutoVlog AI. It does not include Disney branding, show music, protected typography, or a copied sequence from the cited television intro reference.

Repository: <https://github.com/omandal1/autovlog-ai>

Official setup references:

- Firebase Web Authentication: <https://firebase.google.com/docs/auth/web/start>
- Firebase Admin ID-token verification: <https://firebase.google.com/docs/auth/admin/verify-id-tokens>
- MongoDB Node.js driver: <https://www.mongodb.com/docs/drivers/node/current/>
- Vercel environment variables: <https://vercel.com/docs/environment-variables/framework-environment-variables>
