"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode
} from "react";

import { AuthScreen } from "@/components/auth-screen";
import { useAuth } from "@/components/auth-provider";
import { ApiError, createApiClient, type ApiClient } from "@/lib/api/client";
import type {
  CameraMotionDto,
  CaptionStyleDto,
  CurrentUserDto,
  DiaryThemeDto,
  GenerationModeDto,
  GenerationSettingsDto,
  MediaAssetDto,
  PacingDto,
  ProjectDetailDto,
  ProjectDto,
  RenderJobDto,
  RenderOutputDto,
  SoundtrackAssetDto,
  WallFrameStyleDto,
  WallStyleDto
} from "@/lib/api/types";

const diaryDefaults: Required<GenerationSettingsDto>["diaryStyleSettings"] = {
  themePreset: "scrapbook",
  pacing: "balanced"
};

const wallDefaults: Required<GenerationSettingsDto>["wallFrameStyleSettings"] = {
  frameStyle: "mixed-scrapbook",
  wallStyle: "dorm-room-wall",
  cameraMotion: "balanced",
  captionStyle: "memory-captions"
};

function settingsForMode(mode: GenerationModeDto, current?: GenerationSettingsDto): GenerationSettingsDto {
  if (mode === "wall-frame") {
    return { ...current, wallFrameStyleSettings: current?.wallFrameStyleSettings || wallDefaults };
  }
  const diary = current?.diaryStyleSettings || diaryDefaults;
  return {
    ...current,
    theme: diary.themePreset,
    pacing: diary.pacing,
    diaryStyleSettings: diary
  };
}

function messageFrom(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatBytes(value?: number | null) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(value?: number | null) {
  if (!value || !Number.isFinite(value)) return null;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function modeLabel(mode: GenerationModeDto) {
  return mode === "wall-frame" ? "Wall Frame Memories" : "Diary / Notebook Memory Book";
}

function isActiveJob(job?: RenderJobDto | null) {
  return job?.status === "queued" || job?.status === "processing";
}

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-orange-200" />
        <p className="mt-4 text-sm text-slate-400">Opening your memory library...</p>
      </div>
    </main>
  );
}

function Notice({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "success" | "info" }) {
  const styles = {
    error: "border-rose-300/20 bg-rose-300/10 text-rose-100",
    success: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
    info: "border-sky-300/20 bg-sky-300/10 text-sky-100"
  };
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${styles[tone]}`} role={tone === "error" ? "alert" : undefined}>{children}</div>;
}

function AccountHeader({
  profile,
  onSignOut
}: {
  profile: CurrentUserDto | null;
  onSignOut: () => Promise<void>;
}) {
  const auth = useAuth();
  const name = profile?.displayName || auth.user?.displayName || profile?.email || auth.user?.email || "Signed-in creator";
  const photo = profile?.photoURL || auth.user?.photoURL;
  return (
    <header className="flex flex-col gap-5 rounded-[1.75rem] border border-white/10 bg-slate-950/50 p-5 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
      <Link href="/" className="group">
        <p className="text-xs uppercase tracking-[0.4em] text-orange-200/80">AutoVlog AI</p>
        <p className="mt-1 text-sm text-slate-400 transition group-hover:text-white">Your private memory studio</p>
      </Link>
      <div className="flex items-center gap-3">
        {photo ? (
          // Firebase profile images are remote and provider-specific, so a plain image avoids a brittle host allowlist.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="h-10 w-10 rounded-full border border-white/10 object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-orange-300 to-sky-300 font-semibold text-slate-950">
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="max-w-52 truncate text-sm font-medium text-white">{name}</div>
          <div className="max-w-52 truncate text-xs text-slate-500">{profile?.email || auth.user?.email}</div>
        </div>
        <button type="button" onClick={() => void onSignOut()} className="ml-2 rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:border-white/20 hover:bg-white/5 hover:text-white">
          Sign out
        </button>
      </div>
    </header>
  );
}

function ModeSelector({ value, onChange, disabled = false }: { value: GenerationModeDto; onChange: (mode: GenerationModeDto) => void; disabled?: boolean }) {
  const modes: Array<{ id: GenerationModeDto; eyebrow: string; title: string; detail: string; accent: string }> = [
    {
      id: "memory-book",
      eyebrow: "Tactile & nostalgic",
      title: "Diary / Notebook",
      detail: "Turn chapters into warm paper spreads with handwritten notes and page-turn movement.",
      accent: "border-orange-200/35 bg-orange-200/10"
    },
    {
      id: "wall-frame",
      eyebrow: "Cinematic & spatial",
      title: "Wall Frame Memories",
      detail: "Glide across an original gallery wall, revealing photos and moving clips inside frames.",
      accent: "border-sky-200/35 bg-sky-200/10"
    }
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(mode.id)}
          className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
            value === mode.id ? mode.accent : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
          }`}
          aria-pressed={value === mode.id}
        >
          <p className="text-[0.68rem] uppercase tracking-[0.28em] text-slate-400">{mode.eyebrow}</p>
          <p className="mt-2 text-lg font-medium text-white">{mode.title}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{mode.detail}</p>
        </button>
      ))}
    </div>
  );
}

function SelectControl<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-orange-200/40">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function GenerationControls({ mode, settings, onChange }: { mode: GenerationModeDto; settings: GenerationSettingsDto; onChange: (settings: GenerationSettingsDto) => void }) {
  if (mode === "wall-frame") {
    const wall = settings.wallFrameStyleSettings || wallDefaults;
    const update = (next: Partial<typeof wall>) => onChange({ ...settings, wallFrameStyleSettings: { ...wall, ...next } });
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectControl<WallFrameStyleDto> label="Frame style" value={wall.frameStyle} onChange={(value) => update({ frameStyle: value })} options={[
          { value: "classic-wood", label: "Classic wood" },
          { value: "modern-black", label: "Modern black" },
          { value: "white-gallery", label: "White gallery" },
          { value: "mixed-scrapbook", label: "Mixed scrapbook" }
        ]} />
        <SelectControl<WallStyleDto> label="Wall style" value={wall.wallStyle} onChange={(value) => update({ wallStyle: value })} options={[
          { value: "warm-bedroom-wall", label: "Warm bedroom wall" },
          { value: "dorm-room-wall", label: "Dorm room wall" },
          { value: "clean-gallery-wall", label: "Clean gallery wall" },
          { value: "corkboard-scrapbook-wall", label: "Corkboard scrapbook" }
        ]} />
        <SelectControl<CameraMotionDto> label="Camera motion" value={wall.cameraMotion} onChange={(value) => update({ cameraMotion: value })} options={[
          { value: "slow-cinematic", label: "Slow cinematic" },
          { value: "balanced", label: "Balanced" },
          { value: "energetic", label: "Energetic" }
        ]} />
        <SelectControl<CaptionStyleDto> label="Caption style" value={wall.captionStyle} onChange={(value) => update({ captionStyle: value })} options={[
          { value: "none", label: "None" },
          { value: "simple-dates", label: "Simple dates" },
          { value: "memory-captions", label: "Memory captions" },
          { value: "diary-style-notes", label: "Diary-style notes" }
        ]} />
      </div>
    );
  }
  const diary = settings.diaryStyleSettings || diaryDefaults;
  const update = (next: Partial<typeof diary>) => {
    const updatedDiary = { ...diary, ...next };
    onChange({
      ...settings,
      theme: updatedDiary.themePreset,
      pacing: updatedDiary.pacing,
      diaryStyleSettings: updatedDiary
    });
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectControl<DiaryThemeDto> label="Book style" value={diary.themePreset} onChange={(value) => update({ themePreset: value })} options={[
        { value: "scrapbook", label: "Scrapbook" },
        { value: "yearbook", label: "Yearbook" },
        { value: "photo-album", label: "Photo album" },
        { value: "cinematic-journal", label: "Cinematic journal" },
        { value: "minimal-clean", label: "Minimal clean" }
      ]} />
      <SelectControl<PacingDto> label="Pacing" value={diary.pacing} onChange={(value) => update({ pacing: value })} options={[
        { value: "fast", label: "Fast" },
        { value: "balanced", label: "Balanced" },
        { value: "slow-sentimental", label: "Slow & sentimental" }
      ]} />
    </div>
  );
}

function Dashboard({ api, profile, onSignOut }: { api: ApiClient; profile: CurrentUserDto | null; onSignOut: () => Promise<void> }) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<GenerationModeDto>("memory-book");
  const [creating, setCreating] = useState(false);

  const loadProjects = useCallback(async () => {
    setError(null);
    try {
      setProjects(await api.listProjects());
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  async function createProject() {
    if (!title.trim()) {
      setError("Give this memory project a name first.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const project = await api.createProject({ title: title.trim(), generationMode: mode, settings: settingsForMode(mode) });
      router.push(`/projects/${project.id}`);
    } catch (createError) {
      setError(messageFrom(createError));
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 md:px-8 md:py-10">
      <AccountHeader profile={profile} onSignOut={onSignOut} />
      <section className="mt-10 grid gap-8 xl:grid-cols-[1.02fr,0.98fr] xl:items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.45em] text-orange-200/80">Memory library</p>
          <h1 className="mt-4 max-w-3xl text-5xl leading-[0.95] text-white md:text-7xl" style={{ fontFamily: "var(--font-heading)" }}>
            Make your camera roll feel alive again.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
            Create a private project, add photos and clips, layer in your own MP3s, then render a diary film or a cinematic wall of framed memories.
          </p>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-slate-950/50 p-6 shadow-glow backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-sky-200/70">New project</p>
              <h2 className="mt-2 text-2xl text-white" style={{ fontFamily: "var(--font-heading)" }}>Start with a title and format</h2>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">Files come next</span>
          </div>
          <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createProject(); }} placeholder="Spring semester, senior year..." className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none placeholder:text-slate-600 focus:border-orange-200/40" />
          <div className="mt-4"><ModeSelector value={mode} onChange={setMode} disabled={creating} /></div>
          <button type="button" disabled={creating} onClick={() => void createProject()} className="mt-5 w-full rounded-2xl bg-gradient-to-r from-orange-300 via-amber-200 to-sky-300 px-5 py-3 font-semibold text-slate-950 transition hover:brightness-105 disabled:opacity-60">
            {creating ? "Creating your studio..." : "Create project"}
          </button>
        </div>
      </section>

      <section className="mt-12 rounded-[2rem] border border-white/10 bg-slate-950/40 p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-slate-500">Saved work</p>
            <h2 className="mt-2 text-3xl text-white" style={{ fontFamily: "var(--font-heading)" }}>Your projects</h2>
          </div>
          <button type="button" onClick={() => { setLoading(true); void loadProjects(); }} className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Refresh</button>
        </div>
        {error ? <div className="mt-5"><Notice>{error}</Notice></div> : null}
        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-48 animate-pulse rounded-[1.5rem] bg-white/5" />)}</div>
        ) : projects.length ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`} className="group relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5 transition hover:-translate-y-0.5 hover:border-orange-200/25 hover:bg-white/[0.07]">
                <div className="flex items-center justify-between gap-3">
                  <span className={`rounded-full px-3 py-1 text-[0.68rem] uppercase tracking-[0.2em] ${project.generationMode === "wall-frame" ? "bg-sky-300/10 text-sky-100" : "bg-orange-300/10 text-orange-100"}`}>{project.generationMode === "wall-frame" ? "Wall frame" : "Diary"}</span>
                  <span className="text-xs capitalize text-slate-500">{project.status}</span>
                </div>
                <h3 className="mt-5 text-3xl text-white" style={{ fontFamily: "var(--font-heading)" }}>{project.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{modeLabel(project.generationMode)}</p>
                <div className="mt-7 flex items-center justify-between text-xs text-slate-500">
                  <span>Updated {formatDate(project.updatedAt)}</span>
                  <span className="text-orange-100/70 transition group-hover:translate-x-1">Open project →</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
            <p className="text-lg text-white">No saved projects yet</p>
            <p className="mt-2 text-sm text-slate-400">Create your first project above. It will be waiting here whenever you return.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function FileDrop({ kind, files, onFiles, disabled }: { kind: "media" | "soundtrack"; files: File[]; onFiles: (files: File[]) => void; disabled: boolean }) {
  const media = kind === "media";
  function select(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    onFiles(selected);
    event.target.value = "";
  }
  return (
    <label className={`flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-6 text-center transition ${disabled ? "pointer-events-none border-white/5 opacity-50" : "border-white/15 bg-white/[0.025] hover:border-orange-200/35 hover:bg-white/[0.05]"}`}>
      <input type="file" multiple className="hidden" disabled={disabled} accept={media ? "image/*,video/*" : "audio/mpeg,.mp3"} onChange={select} />
      <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-300">{media ? "Photos + videos" : "MP3 soundtracks"}</span>
      <p className="mt-3 text-sm text-slate-400">{files.length ? `${files.length} ${files.length === 1 ? "file" : "files"} ready` : media ? "Choose multiple images and clips" : "Choose one or more MP3 files"}</p>
    </label>
  );
}

function MediaThumbnail({ api, asset }: { api: ApiClient; asset: MediaAssetDto }) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setThumbnailUrl(null);
    if (!asset.thumbnailUrl) return () => { cancelled = true; };

    void api.fetchMediaThumbnail(asset.projectId, asset.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnailUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setThumbnailUrl(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, asset.id, asset.projectId, asset.thumbnailUrl]);

  return (
    <div className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-slate-900 text-[0.6rem] font-medium uppercase tracking-[0.16em] text-slate-500">
      {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <span aria-hidden="true">{asset.type === "video" ? "Video" : "Photo"}</span>}
    </div>
  );
}

function MediaList({ api, media, busyId, onDelete, disabled = false }: { api: ApiClient; media: MediaAssetDto[]; busyId: string | null; onDelete: (id: string) => Promise<void>; disabled?: boolean }) {
  return media.length ? (
    <div className="space-y-2">
      {media.map((asset) => (
        <div key={asset.id} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
          <div className="flex min-w-0 items-center gap-3">
            <MediaThumbnail api={api} asset={asset} />
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className={`rounded-md px-2 py-0.5 text-[0.65rem] uppercase tracking-wide ${asset.type === "video" ? "bg-sky-300/10 text-sky-100" : "bg-orange-300/10 text-orange-100"}`}>{asset.type}</span><p className="truncate text-sm text-white">{asset.originalFilename}</p></div>
              <p className="mt-1 text-xs text-slate-500">{formatBytes(asset.size)}{formatDuration(asset.duration) ? ` · ${formatDuration(asset.duration)}` : ""}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</p>
            </div>
          </div>
          <button type="button" disabled={disabled || busyId === asset.id} onClick={() => void onDelete(asset.id)} className="rounded-full px-3 py-1.5 text-xs text-rose-200 transition hover:bg-rose-300/10 disabled:opacity-50">{busyId === asset.id ? "Removing..." : "Remove"}</button>
        </div>
      ))}
    </div>
  ) : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-500">No photos or videos uploaded yet.</p>;
}

function SoundtrackList({ soundtracks, busyId, onDelete, disabled = false }: { soundtracks: SoundtrackAssetDto[]; busyId: string | null; onDelete: (id: string) => Promise<void>; disabled?: boolean }) {
  return soundtracks.length ? (
    <div className="space-y-2">
      {soundtracks.map((track, index) => (
        <div key={track.id} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-violet-300/10 text-xs text-violet-100">{index + 1}</span><p className="truncate text-sm text-white">{track.originalFilename}</p></div>
            <p className="mt-1 pl-9 text-xs text-slate-500">{formatBytes(track.size)}{formatDuration(track.duration) ? ` · ${formatDuration(track.duration)}` : ""}{track.status ? ` · ${track.status}` : ""}</p>
          </div>
          <button type="button" disabled={disabled || busyId === track.id} onClick={() => void onDelete(track.id)} className="rounded-full px-3 py-1.5 text-xs text-rose-200 transition hover:bg-rose-300/10 disabled:opacity-50">{busyId === track.id ? "Removing..." : "Remove"}</button>
        </div>
      ))}
    </div>
  ) : <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center"><p className="text-sm text-slate-400">No uploaded soundtrack</p><p className="mt-1 text-xs text-slate-600">The renderer will use the built-in royalty-free fallback library.</p></div>;
}

function RenderStatus({ job }: { job: RenderJobDto }) {
  const progress = Math.max(0, Math.min(100, Math.round(job.progress || 0)));
  return (
    <div className={`rounded-2xl border p-4 ${job.status === "failed" ? "border-rose-300/20 bg-rose-300/[0.06]" : job.status === "completed" ? "border-emerald-300/20 bg-emerald-300/[0.06]" : "border-sky-300/20 bg-sky-300/[0.06]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs uppercase tracking-[0.25em] text-slate-500">Latest render</p><p className="mt-1 text-sm font-medium capitalize text-white">{job.currentStage || job.status}</p></div>
        <span className="text-sm text-slate-300">{progress}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900"><div className={`h-full rounded-full transition-all duration-500 ${job.status === "failed" ? "bg-rose-300" : job.status === "completed" ? "bg-emerald-300" : "bg-gradient-to-r from-orange-300 to-sky-300"}`} style={{ width: `${progress}%` }} /></div>
      {job.errorMessage ? <p className="mt-3 text-sm text-rose-200">{job.errorMessage}</p> : null}
      {isActiveJob(job) ? <p className="mt-3 text-xs text-slate-500">You can leave this page. Progress and outputs are saved by the local backend.</p> : null}
    </div>
  );
}

function OutputCard({ api, projectId, output }: { api: ApiClient; projectId: string; output: RenderOutputDto }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openOutput(action: "preview" | "download") {
    setBusy(action);
    setError(null);
    try {
      const disposition = action === "preview" ? "inline" : "attachment";
      const ticket = await api.createOutputAccessTicket(projectId, output.id, disposition);
      if (action === "preview") {
        setPreviewUrl(ticket.url);
      } else {
        const anchor = document.createElement("a");
        anchor.href = ticket.url;
        anchor.referrerPolicy = "no-referrer";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    } catch (ticketError) {
      setError(messageFrom(ticketError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
      {previewUrl ? <video key={previewUrl} src={previewUrl} controls playsInline preload="metadata" className="aspect-video w-full bg-black object-contain" /> : <div className="grid aspect-video place-items-center bg-gradient-to-br from-slate-900 to-slate-950"><div className="text-center"><p className="text-3xl text-white/30">▶</p><p className="mt-2 text-xs text-slate-500">Secure streamed preview</p></div></div>}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3"><div><span className="rounded-full bg-white/5 px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.18em] text-slate-300">{output.type}</span><h4 className="mt-3 font-medium text-white">{output.title}</h4><p className="mt-1 text-xs text-slate-500">{formatBytes(output.size)}{formatDuration(output.duration) ? ` · ${formatDuration(output.duration)}` : ""}</p></div></div>
        <div className="mt-4 flex gap-2"><button type="button" disabled={busy !== null} onClick={() => void openOutput("preview")} className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50">{busy === "preview" ? "Loading..." : previewUrl ? "Refresh preview" : "Preview"}</button><button type="button" disabled={busy !== null} onClick={() => void openOutput("download")} className="flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-50">{busy === "download" ? "Preparing..." : "Download"}</button></div>
        <p className="mt-3 text-[0.68rem] leading-5 text-slate-600">Large videos stream directly from local storage. Access links are temporary and can be refreshed here.</p>
        {error ? <p className="mt-2 text-xs text-rose-200">{error}</p> : null}
      </div>
    </article>
  );
}

function ProjectStudio({ api, projectId, profile, onSignOut }: { api: ApiClient; projectId: string; profile: CurrentUserDto | null; onSignOut: () => Promise<void> }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetailDto | null>(null);
  const [media, setMedia] = useState<MediaAssetDto[]>([]);
  const [soundtracks, setSoundtracks] = useState<SoundtrackAssetDto[]>([]);
  const [outputs, setOutputs] = useState<RenderOutputDto[]>([]);
  const [job, setJob] = useState<RenderJobDto | null>(null);
  const [mode, setMode] = useState<GenerationModeDto>("memory-book");
  const [settings, setSettings] = useState<GenerationSettingsDto>(() => settingsForMode("memory-book"));
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [soundtrackFiles, setSoundtrackFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [nextProject, nextMedia, nextSoundtracks, nextOutputs, nextJobs] = await Promise.all([
        api.getProject(projectId),
        api.listMedia(projectId),
        api.listSoundtracks(projectId),
        api.listOutputs(projectId),
        api.listRenderJobs(projectId)
      ]);
      setProject(nextProject);
      setMedia(nextMedia);
      setSoundtracks(nextSoundtracks);
      setOutputs(nextOutputs);
      setMode(nextProject.generationMode || "memory-book");
      setSettings(settingsForMode(nextProject.generationMode || "memory-book", nextProject.settings));
      const embeddedJob = nextProject.latestRenderJob || nextJobs.find(isActiveJob) || nextJobs[0];
      if (embeddedJob) setJob(embeddedJob);
      setError(null);
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!isActiveJob(job)) return;
    const interval = window.setInterval(() => {
      void api.getRenderJob(projectId, job!.id).then((nextJob) => {
        setJob(nextJob);
        if (!isActiveJob(nextJob)) void refresh(true);
      }).catch((pollError) => setError(messageFrom(pollError)));
    }, 2500);
    return () => window.clearInterval(interval);
  }, [api, job, projectId, refresh]);

  useEffect(() => {
    if (!project || isActiveJob(job) || !["queued", "processing"].includes(project.status)) return;
    const interval = window.setInterval(() => { void refresh(true); }, 5000);
    return () => window.clearInterval(interval);
  }, [job, project, refresh]);

  function changeMode(nextMode: GenerationModeDto) {
    setMode(nextMode);
    setSettings((current) => settingsForMode(nextMode, current));
    setSuccess(null);
  }

  async function saveDirection() {
    setBusy("save"); setError(null); setSuccess(null);
    try {
      const updated = await api.updateProject(projectId, { generationMode: mode, settings });
      setProject((current) => current ? { ...current, ...updated } : { ...updated });
      setSuccess("Creative direction saved.");
    } catch (saveError) { setError(messageFrom(saveError)); }
    finally { setBusy(null); }
  }

  async function uploadMedia() {
    if (!mediaFiles.length) return;
    setBusy("media"); setError(null); setSuccess(null);
    try { await api.uploadMedia(projectId, mediaFiles); setMediaFiles([]); await refresh(true); setSuccess("Media uploaded and saved to this project."); }
    catch (uploadError) { setError(messageFrom(uploadError)); }
    finally { setBusy(null); }
  }

  async function uploadSoundtracks() {
    if (!soundtrackFiles.length) return;
    const invalid = soundtrackFiles.find((file) => !file.name.toLowerCase().endsWith(".mp3") && file.type !== "audio/mpeg");
    if (invalid) { setError(`${invalid.name} is not an MP3 file.`); return; }
    setBusy("soundtracks"); setError(null); setSuccess(null);
    try { await api.uploadSoundtracks(projectId, soundtrackFiles); setSoundtrackFiles([]); await refresh(true); setSuccess("Soundtracks uploaded. The renderer will use these tracks instead of fallback music."); }
    catch (uploadError) { setError(messageFrom(uploadError)); }
    finally { setBusy(null); }
  }

  async function deleteMedia(id: string) {
    setDeletingId(id); setError(null);
    try { await api.deleteMedia(projectId, id); setMedia((current) => current.filter((item) => item.id !== id)); }
    catch (deleteError) { setError(messageFrom(deleteError)); }
    finally { setDeletingId(null); }
  }

  async function deleteSoundtrack(id: string) {
    setDeletingId(id); setError(null);
    try { await api.deleteSoundtrack(projectId, id); setSoundtracks((current) => current.filter((item) => item.id !== id)); }
    catch (deleteError) { setError(messageFrom(deleteError)); }
    finally { setDeletingId(null); }
  }

  async function startRender() {
    if (!media.length) { setError("Upload at least one photo or video before rendering."); return; }
    setBusy("render"); setError(null); setSuccess(null);
    try {
      const renderSettings: GenerationSettingsDto = {
        ...settings,
        uploadedSoundtrackIds: soundtracks.map((track) => track.id),
        soundtrackStrategy: "auto-select-best-segments"
      };
      setSettings(renderSettings);
      await api.updateProject(projectId, { generationMode: mode, settings: renderSettings });
      const nextJob = await api.startRender(projectId, { settings: renderSettings });
      setJob(nextJob);
      setProject((current) => current ? { ...current, status: "queued", generationMode: mode, settings: renderSettings } : current);
      setSuccess("Render queued. The local FFmpeg backend is now building your video.");
    } catch (renderError) { setError(messageFrom(renderError)); }
    finally { setBusy(null); }
  }

  async function deleteProject() {
    if (isActiveJob(job)) {
      setError("Wait for the active render to finish before deleting this project.");
      return;
    }
    if (!project || !window.confirm(`Delete “${project.title}” and all of its locally stored uploads and renders? This cannot be undone.`)) return;
    setBusy("delete-project"); setError(null);
    try { await api.deleteProject(projectId); router.push("/"); }
    catch (deleteError) { setError(messageFrom(deleteError)); setBusy(null); }
  }

  if (loading) return <><main className="mx-auto min-h-screen max-w-7xl px-4 py-6 md:px-8 md:py-10"><AccountHeader profile={profile} onSignOut={onSignOut} /><div className="mt-8 h-80 animate-pulse rounded-[2rem] bg-white/5" /></main></>;

  if (!project) return <main className="mx-auto min-h-screen max-w-3xl px-4 py-10"><Notice>{error || "This project could not be found."}</Notice><Link href="/" className="mt-5 inline-block text-sm text-orange-100">← Back to projects</Link></main>;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 md:px-8 md:py-10">
      <AccountHeader profile={profile} onSignOut={onSignOut} />
      <div className="mt-7 flex flex-wrap items-center justify-between gap-4"><Link href="/" className="text-sm text-slate-400 transition hover:text-white">← All projects</Link><button type="button" onClick={() => void deleteProject()} disabled={busy !== null || isActiveJob(job)} title={isActiveJob(job) ? "Wait for the active render to finish before deleting." : undefined} className="rounded-full px-4 py-2 text-sm text-rose-200 hover:bg-rose-300/10 disabled:opacity-50">{busy === "delete-project" ? "Deleting..." : isActiveJob(job) ? "Render in progress" : "Delete project"}</button></div>

      <section className="mt-6 rounded-[2.25rem] border border-white/10 bg-slate-950/50 p-6 shadow-2xl backdrop-blur md:p-9">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] ${mode === "wall-frame" ? "bg-sky-300/10 text-sky-100" : "bg-orange-300/10 text-orange-100"}`}>{mode === "wall-frame" ? "Wall frame" : "Diary"}</span><span className="text-xs capitalize text-slate-500">{project.status}</span></div><h1 className="mt-4 text-5xl text-white md:text-6xl" style={{ fontFamily: "var(--font-heading)" }}>{project.title}</h1><p className="mt-3 text-sm text-slate-400">Created {formatDate(project.createdAt)} · Updated {formatDate(project.updatedAt)}</p></div><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-2xl bg-white/5 px-4 py-3"><p className="text-xl text-white">{media.length}</p><p className="text-[0.65rem] uppercase tracking-wide text-slate-500">Media</p></div><div className="rounded-2xl bg-white/5 px-4 py-3"><p className="text-xl text-white">{soundtracks.length}</p><p className="text-[0.65rem] uppercase tracking-wide text-slate-500">Songs</p></div><div className="rounded-2xl bg-white/5 px-4 py-3"><p className="text-xl text-white">{outputs.length}</p><p className="text-[0.65rem] uppercase tracking-wide text-slate-500">Outputs</p></div></div></div>
        {error ? <div className="mt-5"><Notice>{error}</Notice></div> : null}
        {success ? <div className="mt-5"><Notice tone="success">{success}</Notice></div> : null}
        {job ? <div className="mt-5"><RenderStatus job={job} /></div> : null}
      </section>

      <div className="mt-7 grid gap-7 xl:grid-cols-[1.08fr,0.92fr]">
        <div className="space-y-7">
          <section className="rounded-[2rem] border border-white/10 bg-slate-950/40 p-6 md:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.3em] text-orange-200/70">1 · Add the memories</p><h2 className="mt-2 text-3xl text-white" style={{ fontFamily: "var(--font-heading)" }}>Photos and videos</h2></div><span className="text-xs text-slate-500">Stored locally</span></div><div className="mt-5"><FileDrop kind="media" files={mediaFiles} onFiles={setMediaFiles} disabled={busy !== null || isActiveJob(job)} /></div>{mediaFiles.length ? <div className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] p-3"><p className="truncate text-xs text-slate-400">{mediaFiles.map((file) => file.name).join(", ")}</p><button type="button" onClick={() => void uploadMedia()} disabled={busy !== null} className="shrink-0 rounded-xl bg-orange-200 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50">{busy === "media" ? "Uploading..." : "Upload media"}</button></div> : null}<div className="mt-5 max-h-96 overflow-y-auto pr-1"><MediaList api={api} media={media} busyId={deletingId} onDelete={deleteMedia} disabled={isActiveJob(job)} /></div></section>

          <section className="rounded-[2rem] border border-white/10 bg-slate-950/40 p-6 md:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.3em] text-violet-200/70">2 · Set the soundtrack</p><h2 className="mt-2 text-3xl text-white" style={{ fontFamily: "var(--font-heading)" }}>Your MP3 collection</h2><p className="mt-2 text-sm leading-6 text-slate-400">When you add MP3s, the final background music comes only from this list. Source clip audio is mixed in where it matters.</p></div><span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-400">Optional</span></div><div className="mt-5"><FileDrop kind="soundtrack" files={soundtrackFiles} onFiles={setSoundtrackFiles} disabled={busy !== null || isActiveJob(job)} /></div>{soundtrackFiles.length ? <div className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] p-3"><p className="truncate text-xs text-slate-400">{soundtrackFiles.map((file) => file.name).join(", ")}</p><button type="button" onClick={() => void uploadSoundtracks()} disabled={busy !== null} className="shrink-0 rounded-xl bg-violet-200 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50">{busy === "soundtracks" ? "Uploading..." : "Upload MP3s"}</button></div> : null}<div className="mt-5 max-h-80 overflow-y-auto pr-1"><SoundtrackList soundtracks={soundtracks} busyId={deletingId} onDelete={deleteSoundtrack} disabled={isActiveJob(job)} /></div></section>
        </div>

        <div className="space-y-7">
          <section className="rounded-[2rem] border border-white/10 bg-slate-950/40 p-6 md:p-8"><p className="text-xs uppercase tracking-[0.3em] text-sky-200/70">3 · Choose the experience</p><h2 className="mt-2 text-3xl text-white" style={{ fontFamily: "var(--font-heading)" }}>Creative direction</h2><div className="mt-5"><ModeSelector value={mode} onChange={changeMode} disabled={busy !== null || isActiveJob(job)} /></div><div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><GenerationControls mode={mode} settings={settings} onChange={setSettings} /></div><button type="button" onClick={() => void saveDirection()} disabled={busy !== null || isActiveJob(job)} className="mt-4 w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50">{busy === "save" ? "Saving..." : "Save creative direction"}</button></section>

          <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-orange-200/[0.09] via-slate-950/50 to-sky-200/[0.09] p-6 md:p-8"><p className="text-xs uppercase tracking-[0.3em] text-orange-100/70">4 · Render locally</p><h2 className="mt-2 text-3xl text-white" style={{ fontFamily: "var(--font-heading)" }}>Build {mode === "wall-frame" ? "the framed-wall film" : "the memory book"}</h2><p className="mt-3 text-sm leading-6 text-slate-300">The authenticated backend keeps heavy analysis, local storage, and FFmpeg rendering off the hosted frontend.</p><div className="mt-5 rounded-2xl bg-black/20 p-4 text-xs leading-5 text-slate-400"><div className="flex justify-between gap-3"><span>Format</span><span className="text-right text-slate-200">{modeLabel(mode)}</span></div><div className="mt-2 flex justify-between gap-3"><span>Media ready</span><span className="text-slate-200">{media.length}</span></div><div className="mt-2 flex justify-between gap-3"><span>Music source</span><span className="text-right text-slate-200">{soundtracks.length ? `${soundtracks.length} uploaded MP3${soundtracks.length === 1 ? "" : "s"}` : "Royalty-free fallback"}</span></div></div><button type="button" onClick={() => void startRender()} disabled={busy !== null || isActiveJob(job) || !media.length} className="mt-5 w-full rounded-2xl bg-gradient-to-r from-orange-300 via-amber-200 to-sky-300 px-5 py-3 font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50">{busy === "render" ? "Queuing render..." : isActiveJob(job) ? "Render in progress" : `Render ${mode === "wall-frame" ? "Wall Frame Memories" : "Diary Memory Book"}`}</button>{!media.length ? <p className="mt-3 text-center text-xs text-slate-500">Upload at least one photo or video to enable rendering.</p> : null}</section>
        </div>
      </div>

      <section className="mt-7 rounded-[2rem] border border-white/10 bg-slate-950/40 p-6 md:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.3em] text-emerald-200/70">Saved results</p><h2 className="mt-2 text-3xl text-white" style={{ fontFamily: "var(--font-heading)" }}>Finished videos</h2></div><button type="button" onClick={() => void refresh(true)} className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Refresh outputs</button></div>{outputs.length ? <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{outputs.map((output) => <OutputCard key={output.id} api={api} projectId={projectId} output={output} />)}</div> : <div className="mt-6 rounded-2xl border border-dashed border-white/10 p-8 text-center"><p className="text-white">No completed videos yet</p><p className="mt-2 text-sm text-slate-500">Finished master, chapter, and wall-frame videos will stay attached to this project.</p></div>}</section>
    </main>
  );
}

function AuthenticatedApp({ projectId }: { projectId?: string }) {
  const auth = useAuth();
  const api = useMemo(() => createApiClient(auth.getIdToken), [auth.getIdToken]);
  const [profile, setProfile] = useState<CurrentUserDto | null>(null);

  useEffect(() => {
    let active = true;
    void api.getCurrentUser().then((user) => { if (active) setProfile(user); }).catch(() => undefined);
    return () => { active = false; };
  }, [api]);

  async function signOut() {
    await auth.signOut();
  }

  return projectId
    ? <ProjectStudio api={api} projectId={projectId} profile={profile} onSignOut={signOut} />
    : <Dashboard api={api} profile={profile} onSignOut={signOut} />;
}

export function HostedProjectApp({ projectId }: { projectId?: string }) {
  const auth = useAuth();
  if (auth.loading) return <LoadingScreen />;
  if (!auth.user) return <AuthScreen />;
  return <AuthenticatedApp projectId={projectId} />;
}
