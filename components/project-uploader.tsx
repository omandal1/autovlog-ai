"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  AUDIO_EMPHASIS_LABELS,
  DECORATION_LEVEL_LABELS,
  MAX_PROJECT_CHAPTERS,
  MIN_PROJECT_CHAPTERS,
  ORDERING_LABELS,
  PACING_MODE_LABELS,
  STORY_STYLE_LABELS,
  SUBJECT_EMPHASIS_LABELS,
  THEME_PRESET_LABELS,
  TITLE_STYLE_LABELS
} from "@/lib/constants";
import type { GenerationSettings } from "@/lib/types";
import { deriveLegacySettingsFromGeneration } from "@/lib/user-controls/generation-settings";
import { cn, formatSeconds } from "@/lib/utils";

const defaultGeneration: GenerationSettings = {
  generationMode: "memory-book",
  storyStyle: "balanced",
  subjectEmphasis: "balanced",
  audioEmphasis: "balanced",
  pacing: "balanced",
  ordering: "mostly-chronological",
  themePreset: "scrapbook",
  titleStyle: "nostalgic",
  decorationLevel: "balanced",
  aspectRatio: "landscape-16x9"
};

interface SoundtrackUploadState {
  id: string;
  file: File;
  durationSec?: number;
  status: "checking" | "ready" | "invalid";
  error?: string;
}

function SelectField<T extends string>(props: {
  label: string;
  hint?: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-100">{props.label}</div>
        {props.hint ? <div className="text-xs text-slate-500">{props.hint}</div> : null}
      </div>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as T)}
        className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-slate-100"
      >
        {(Object.entries(props.options) as Array<[T, string]>).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function readAudioDuration(file: File) {
  return new Promise<number | undefined>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const cleanup = () => URL.revokeObjectURL(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : undefined;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    audio.src = url;
  });
}

async function buildSoundtrackState(file: File): Promise<SoundtrackUploadState> {
  const isMp3 = file.name.toLowerCase().endsWith(".mp3") && (file.type === "audio/mpeg" || !file.type);
  if (!isMp3) {
    return {
      id: `${file.name}:${file.lastModified}:${file.size}`,
      file,
      status: "invalid",
      error: "Only MP3 soundtrack files are supported."
    };
  }

  const durationSec = await readAudioDuration(file);
  return {
    id: `${file.name}:${file.lastModified}:${file.size}`,
    file,
    durationSec,
    status: "ready"
  };
}

export function ProjectUploader() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [generation, setGeneration] = useState<GenerationSettings>(defaultGeneration);
  const [soundtracks, setSoundtracks] = useState<SoundtrackUploadState[]>([]);
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  async function handleSoundtrackSelect(selected: FileList | null) {
    const nextFiles = Array.from(selected ?? []);
    if (!nextFiles.length) {
      return;
    }
    const checking = nextFiles.map((file) => ({
      id: `${file.name}:${file.lastModified}:${file.size}`,
      file,
      status: "checking" as const
    }));
    setSoundtracks((current) => [...current, ...checking]);
    const analyzed = await Promise.all(nextFiles.map(buildSoundtrackState));
    setSoundtracks((current) =>
      current.map((entry) => analyzed.find((item) => item.id === entry.id) ?? entry)
    );
  }

  function moveSoundtrack(index: number, direction: -1 | 1) {
    setSoundtracks((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item!);
      return copy;
    });
  }

  async function handleSubmit() {
    if (!files.length) {
      setError("Choose at least one supported image or video.");
      return;
    }
    const invalidSoundtrack = soundtracks.find((track) => track.status === "invalid");
    if (invalidSoundtrack) {
      setError(invalidSoundtrack.error ?? "Remove unsupported soundtrack files before uploading.");
      return;
    }

    setError(undefined);
    const legacy = deriveLegacySettingsFromGeneration(generation);
    const formData = new FormData();
    formData.set("tone", legacy.tone);
    formData.set("clipDensity", legacy.clipDensity);
    formData.set("musicStyle", legacy.musicStyle);
    formData.set("storyStyle", generation.storyStyle);
    formData.set("subjectEmphasis", generation.subjectEmphasis);
    formData.set("audioEmphasis", generation.audioEmphasis);
    formData.set("pacing", generation.pacing);
    formData.set("ordering", generation.ordering);
    formData.set("themePreset", generation.themePreset);
    formData.set("titleStyle", generation.titleStyle);
    formData.set("decorationLevel", generation.decorationLevel);
    formData.set("musicSourcePolicy", soundtracks.length ? "user-uploaded-audio" : "internal-licensed");
    files.forEach((file) => formData.append("files", file));
    soundtracks
      .filter((track) => track.status === "ready")
      .forEach((track) => formData.append("soundtracks", track.file));

    startTransition(async () => {
      const response = await fetch("/api/projects", {
        method: "POST",
        body: formData
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Upload failed.");
        return;
      }

      router.push(`/projects/${payload.project.id}`);
    });
  }

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur md:p-8">
      <div className="grid gap-8 lg:grid-cols-[1.08fr,0.92fr]">
        <div className="space-y-5">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-orange-200/80">Memory-book pipeline</p>
            <h2 className="mt-3 text-4xl text-white md:text-5xl" style={{ fontFamily: "var(--font-heading)" }}>
              Upload a semester of media. Render it as a tactile AI memory book.
            </h2>
            <p className="mt-3 text-base text-slate-300 md:text-lg">
              AutoVlog analyzes your photos, clips, duplicate bursts, dialogue, faces, chapters,
              and story arc, then renders a physical bookstyle recap with page turns and optional
              uploaded MP3 soundtracks.
            </p>
          </div>

          <label
            className={cn(
              "flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-white/20 bg-slate-950/40 px-6 py-8 text-center transition hover:border-orange-300/60 hover:bg-slate-900/60",
              isPending && "pointer-events-none opacity-60"
            )}
          >
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 300))}
            />
            <span className="rounded-full border border-orange-300/25 px-4 py-2 text-sm text-orange-100">Bulk upload</span>
            <p className="mt-4 max-w-xl text-lg text-slate-100">
              The planner generates {MIN_PROJECT_CHAPTERS} to {MAX_PROJECT_CHAPTERS} chapters, one
              full recap, and chapter mini-vlogs with a unified scrapbook visual language.
            </p>
            <p className="mt-3 text-sm text-slate-400">
              {files.length ? `${files.length} files selected` : "Supported: JPG, PNG, WEBP, HEIC, MP4, MOV, AVI, WEBM"}
            </p>
          </label>

          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/40 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">Uploaded MP3 soundtrack</div>
                <div className="mt-1 text-sm text-slate-400">
                  Add one or more MP3 files. If provided, the final render uses only these uploaded
                  tracks as background music; built-in royalty-free music is used only when this list is empty.
                </div>
              </div>
              <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">optional</span>
            </div>
            <label className="mt-4 flex cursor-pointer items-center justify-between rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300 hover:border-orange-300/30">
              <input
                type="file"
                multiple
                accept="audio/mpeg,.mp3"
                className="hidden"
                onChange={(event) => void handleSoundtrackSelect(event.target.files)}
              />
              <span>Add MP3 soundtrack files</span>
              <span className="text-xs text-slate-500">{soundtracks.length} selected</span>
            </label>
            {soundtracks.length ? (
              <div className="mt-4 space-y-2">
                {soundtracks.map((track, index) => (
                  <div key={track.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">{track.file.name}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {formatBytes(track.file.size)}
                          {track.durationSec ? ` - ${formatSeconds(track.durationSec)}` : ""}
                          {track.status === "checking" ? " - checking" : ""}
                          {track.status === "invalid" ? ` - ${track.error}` : ""}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => moveSoundtrack(index, -1)} className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">Up</button>
                        <button type="button" onClick={() => moveSoundtrack(index, 1)} className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">Down</button>
                        <button
                          type="button"
                          onClick={() => setSoundtracks((current) => current.filter((item) => item.id !== track.id))}
                          className="rounded-full bg-rose-300/10 px-3 py-1 text-xs text-rose-100"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-5 rounded-[1.75rem] border border-white/10 bg-slate-950/40 p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-sky-200/70">Creative steering</p>
            <p className="mt-2 text-sm text-slate-300">
              Every control feeds the Memory Book planner, layout engine, audio mix, and renderer.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            Physical scrapbook pages, decorated spreads, warm paper texture, deeper book shadows,
            and page-turn transitions are now the default format.
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <SelectField label="Story style" value={generation.storyStyle} options={STORY_STYLE_LABELS} onChange={(value) => setGeneration((current) => ({ ...current, storyStyle: value }))} />
            <SelectField label="Subject emphasis" value={generation.subjectEmphasis} options={SUBJECT_EMPHASIS_LABELS} onChange={(value) => setGeneration((current) => ({ ...current, subjectEmphasis: value }))} />
            <SelectField label="Audio emphasis" value={generation.audioEmphasis} options={AUDIO_EMPHASIS_LABELS} onChange={(value) => setGeneration((current) => ({ ...current, audioEmphasis: value }))} />
            <SelectField label="Pacing" value={generation.pacing} options={PACING_MODE_LABELS} onChange={(value) => setGeneration((current) => ({ ...current, pacing: value }))} />
            <SelectField label="Ordering" value={generation.ordering} options={ORDERING_LABELS} onChange={(value) => setGeneration((current) => ({ ...current, ordering: value }))} />
            <SelectField label="Theme preset" value={generation.themePreset} options={THEME_PRESET_LABELS} onChange={(value) => setGeneration((current) => ({ ...current, themePreset: value }))} />
            <SelectField label="Title style" value={generation.titleStyle} options={TITLE_STYLE_LABELS} onChange={(value) => setGeneration((current) => ({ ...current, titleStyle: value }))} />
            <SelectField label="Decoration level" value={generation.decorationLevel} options={DECORATION_LEVEL_LABELS} onChange={(value) => setGeneration((current) => ({ ...current, decorationLevel: value }))} />
          </div>

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="w-full rounded-2xl bg-gradient-to-r from-orange-300 via-amber-200 to-sky-300 px-5 py-3 font-medium text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending ? "Uploading and analyzing..." : "Create Memory Book preview project"}
          </button>
        </div>
      </div>
    </section>
  );
}
