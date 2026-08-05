# AutoVlog AI Project Guide

## Purpose

AutoVlog AI is a local-first media pipeline for turning a large collection of photos, videos, and optional music into a cinematic master vlog plus shorter chapter videos. It combines a Next.js interface, Node.js orchestration, a FastAPI analysis service, and FFmpeg-based media processing.

## Current capabilities

- Ingest mixed image and video uploads.
- Extract metadata and order media chronologically.
- Generate normalized images, thumbnails, video proxies, and keyframes.
- Detect duplicates, weak media, dialogue, and recurring faces using local heuristics.
- Score and group media into chapters.
- Generate multiple story and preview variants.
- Respect pin, exclude, pacing, theme, and soundtrack controls.
- Render a master vlog and chapter videos with transitions, source audio, and music mixing.
- Continue with deterministic fallbacks when the optional Python analysis service is unavailable.

## Technology

- Next.js 16 App Router, React 18, TypeScript, and Tailwind CSS
- Node.js route handlers and pipeline orchestration
- Python FastAPI and Uvicorn for optional analysis enrichment
- FFmpeg and FFprobe for preprocessing, composition, audio mixing, and rendering
- Local JSON and filesystem storage

## Architecture

```text
Browser UI
   |
   v
Next.js pages and API routes
   |
   +--> Project, preview, and render orchestration
   |       |
   |       +--> Metadata and preprocessing
   |       +--> Analysis and scoring
   |       +--> Chaptering and story planning
   |       +--> Timeline generation
   |       +--> FFmpeg rendering
   |
   +--> FastAPI analysis service (optional)
   |
   +--> Local project storage
```

## Important directories

| Path | Responsibility |
| --- | --- |
| `app/` | Next.js pages and API endpoints |
| `components/` | Upload, account, and project dashboard interfaces |
| `lib/` | Analysis, audio, story, preview, themes, rendering, and shared types |
| `media-processing/` | Metadata extraction and source preprocessing |
| `timeline/` | Chapter detection and render timeline generation |
| `render/` | Final FFmpeg render service |
| `scoring/` | Deterministic scoring and Python-service integration |
| `backend-python/` | FastAPI analysis service |
| `scripts/` | Demo, debugging, validation, and rendering utilities |
| `assets/music/` | Built-in local soundtrack library |
| `storage/test-media/` | Small reproducible media fixtures |
| `storage/projects/` | Runtime uploads and generated projects; intentionally ignored by Git |

## Local development

Install dependencies:

```powershell
npm install
python -m pip install -r backend-python/requirements.txt
```

Start the analysis service:

```powershell
npm run python
```

Start the web application in a second terminal:

```powershell
npm run dev
```

Open `http://127.0.0.1:3000`. The Python service listens on `http://127.0.0.1:8001`.

## Configuration

Copy `.env.example` to `.env.local` when local overrides are needed:

```env
PYTHON_SERVICE_URL=http://127.0.0.1:8001
STORAGE_ROOT=./storage/projects
FFMPEG_PATH=
FFPROBE_PATH=
```

When FFmpeg paths are omitted, the app uses the binaries supplied by `ffmpeg-static` and `ffprobe-static`.

## Validation

Run the TypeScript check before publishing changes:

```powershell
npm run check
```

Run a complete local demo against a media folder:

```powershell
npm run demo -- ./your-media-folder balanced fast-cuts cinematic
```

## Data and repository boundaries

The repository includes source code, built-in music, samples, and test fixtures. The following stay local and must not be committed:

- uploaded personal media and generated projects under `storage/projects/`
- account and session data under `storage/accounts/`
- `.env` and `.env.local` files
- dependency folders and Python virtual environments
- `.next`, caches, logs, and generated build artifacts

## GitHub

Repository: <https://github.com/omandal1/autovlog-ai>

Use focused commits, run `npm run check`, and keep runtime user data out of Git history.
