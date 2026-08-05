# AutoVlog AI

AutoVlog AI is a production-oriented local app that ingests 100 to 300 uploaded images and videos, analyzes them, generates preview variants, and renders:

- one 5-minute cinematic college vlog recap
- three to ten 1-minute chapter mini-vlogs

The app is fully local for the MVP: Next.js 14 provides the UI and Node orchestration, FastAPI augments analysis and chapter labeling, and FFmpeg performs all media preprocessing and final rendering.

## Stack

- Frontend: Next.js 14 App Router, React, TypeScript, TailwindCSS
- Backend: Node.js route handlers inside Next.js
- Analysis service: FastAPI microservice in `backend-python`
- Media engine: FFmpeg via `ffmpeg-static` and `ffprobe-static`
- Storage: local filesystem under `storage/projects`

## Pipeline

1. `ingest`
   - Saves original uploads with unique IDs
   - Extracts EXIF/video metadata
   - Persists a project record to local storage
2. `preprocess`
   - Normalizes images
   - Generates thumbnails
   - Builds video proxies and keyframes
3. `analysis`
   - Detects duplicates and weak media
   - Adds dialogue/transcript metadata when available
   - Clusters recurring friend-like faces heuristically
   - Persists explainable selection and skip reasons
4. `score`
   - Runs deterministic heuristics first
   - Optionally asks the FastAPI service for score boosts and semantic hints
5. `group`
   - Orders assets chronologically
   - Splits them into time-based chapters
   - Labels chapters with Python heuristics or a deterministic fallback
6. `story`
   - Builds a story plan with highlights, anchors, chapter plans, and titles
   - Generates up to three preview plan variants for comparison
   - Respects pin/exclude decisions and user steering controls
7. `render`
   - Renders every clip with FFmpeg
  - Preserves source audio and mixes it with uploaded MP3 or local fallback music beds
   - Uses book-style cover pages, spreads, dividers, and page-turn transitions
   - Applies beat-aware timing when music analysis is available
   - Produces final MP4 outputs

## Project structure

```text
app/                   Next.js frontend and API routes
components/            Upload, preview, steering, and dashboard UI
lib/                   Shared types, helpers, pipeline orchestration
media-processing/      Metadata extraction and preprocessing
scoring/               Deterministic scoring + Python service integration
lib/analysis/          Duplicate detection, transcription, quality tiers, face clustering
lib/story/             Story planning and chapter intelligence
lib/preview/           Preview plan generation and validation
lib/themes/            Theme presets and visual styling registry
timeline/              Chaptering and timeline generation
render/                FFmpeg render pipeline
backend-python/        FastAPI service
scripts/               FFmpeg helpers and demo runner
storage/               Local storage abstraction
samples/               Example timeline JSON
```

## Local setup

### 1. Install Node dependencies

```bash
npm install
```

### 2. Install Python dependencies

```bash
python -m pip install -r backend-python/requirements.txt
```

### 3. Start the Python service

```bash
npm run python
```

### 4. Start the Next.js app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Quick start from the workspace root

If you are currently in `D:\Downloads\projects\codex_projects`, use:

```powershell
.\run-autovlog-ai.ps1
```

That script starts both the FastAPI service and the Next.js dev server in the correct project folder.

## Optional environment configuration

Copy `.env.example` to `.env.local` if you want to override the defaults:

```bash
PYTHON_SERVICE_URL=http://127.0.0.1:8001
STORAGE_ROOT=./storage/projects
FFMPEG_PATH=
FFPROBE_PATH=
```

If `FFMPEG_PATH` or `FFPROBE_PATH` are omitted, the app uses the binaries from `ffmpeg-static` and `ffprobe-static`.

Uploaded MP3 soundtracks are stored with the project and used exclusively when provided. If no
MP3 files are uploaded, the renderer uses the built-in royalty-free/local fallback music library.

## Demo run from a local folder

```bash
npm run demo -- ./your-media-folder balanced fast-cuts cinematic
```

That command will:

- create a project from every supported file in the folder
- generate preview plans
- render the selected preview plan
- print the rendered output paths

## Example input/output

### Example input

- 240 mixed uploads
- 160 photos
- 80 videos
- spread across three weeks of campus life

### Example output

- `master_*.mp4` in `storage/projects/<projectId>/outputs`
- `chapter_*.mp4` files for each chapter
- timeline JSON in `storage/projects/<projectId>/timelines`
- derived thumbnails, normalized images, proxies, and keyframes

## Timeline format

Sample files live in:

- `samples/sample-master-timeline.json`
- `samples/sample-chapter-timeline.json`

Each timeline contains:

- render profile
- ordered clip list
- clip trim windows
- chapter IDs
- user-selected steering settings
- page/book render metadata
- transition and audio planning data

## Failsafe behavior

When advanced analysis is unavailable, the app still:

- scores deterministically in Node
- creates fallback chapter names
- builds preview plans with deterministic heuristics
- renders valid MP4 outputs with local audio and simplified planning

## Core modules

- `lib/project-service.ts`
  - upload, analysis, preview generation, render orchestration, and persistence
- `lib/analysis/*`
  - duplicate, quality, transcript, and face-aware enrichment
- `lib/story/story-planner.ts`
  - highlight detection, anchor selection, and title generation
- `lib/preview/preview-plan-builder.ts`
  - preview variants and selected-plan preparation
- `media-processing/metadata.ts`
  - EXIF/video probing and chronological ordering helpers
- `media-processing/preprocess.ts`
  - thumbnails, normalized images, video proxies, and keyframes
- `scoring/heuristics.ts`
  - clarity, brightness, contrast, motion, uniqueness, duration scoring
- `timeline/chaptering.ts`
  - chapter boundary detection and fallback labels
- `timeline/generator.ts`
  - master and chapter timeline assembly from the selected story plan
- `render/render-service.ts`
  - FFmpeg book-page rendering, audio mixing, transitions, and final muxing
- `backend-python/main.py`
  - optional score boosts, chapter labeling, and transcript metadata
