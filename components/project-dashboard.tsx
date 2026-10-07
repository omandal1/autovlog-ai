"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  AUDIO_EMPHASIS_LABELS,
  DECORATION_LEVEL_LABELS,
  ORDERING_LABELS,
  PACING_MODE_LABELS,
  PREVIEW_PLAN_LIMIT,
  STORY_STYLE_LABELS,
  SUBJECT_EMPHASIS_LABELS,
  THEME_PRESET_LABELS,
  TITLE_STYLE_LABELS
} from "@/lib/constants";
import type { GenerationSettings, PreviewRegenerationMode, ProjectRecord } from "@/lib/types";
import { normalizeProjectSettings } from "@/lib/user-controls/generation-settings";
import { cn, formatDate, formatSeconds } from "@/lib/utils";

interface ProjectDashboardProps {
  initialProject: ProjectRecord;
}

function StatusBadge({ value }: { value: string }) {
  const color =
    value === "ready"
      ? "bg-emerald-300/15 text-emerald-100"
      : value === "failed"
        ? "bg-rose-300/15 text-rose-100"
        : value === "preview"
          ? "bg-amber-300/15 text-amber-100"
          : "bg-sky-300/15 text-sky-100";
  return <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.25em] ${color}`}>{value}</span>;
}

function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="space-y-2">
      <div className="text-sm font-medium text-slate-100">{props.label}</div>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as T)}
        className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
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

function assetThumbnailRoute(projectId: string, assetId: string) {
  return `/api/projects/${projectId}/media/${assetId}/thumbnail`;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectDashboard({ initialProject }: ProjectDashboardProps) {
  const normalizeProjectRecordForState = (nextProject: ProjectRecord) => ({
    ...nextProject,
    settings: normalizeProjectSettings(nextProject.settings)
  });

  const [project, setProject] = useState(
    normalizeProjectRecordForState({
      ...initialProject,
      settings: normalizeProjectSettings(initialProject.settings)
    })
  );
  const [controls, setControls] = useState<GenerationSettings>(
    normalizeProjectSettings(initialProject.settings).generation!
  );
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setControls(project.settings.generation!);
  }, [project.settings]);

  useEffect(() => {
    if (project.status === "ready" || project.status === "failed" || project.stage === "preview") {
      return;
    }

    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/projects/${project.id}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      setProject(normalizeProjectRecordForState(payload.project));
    }, 3000);

    return () => window.clearInterval(interval);
  }, [project.id, project.stage, project.status]);

  const selectedPlan =
    project.previewPlans?.find((plan) => plan.id === project.selectedPlanId) ??
    project.previewPlans?.find((plan) => plan.isPrimary) ??
    project.previewPlans?.[0];
  const renderInFlight = busyAction === "render" || project.stage === "render";

  const representativeAssets = useMemo(
    () =>
      (selectedPlan?.representativeAssetIds ?? [])
        .map((assetId) => project.assets.find((asset) => asset.id === assetId))
        .filter((asset): asset is ProjectRecord["assets"][number] => Boolean(asset)),
    [project.assets, selectedPlan]
  );

  async function requestProject(url: string, init?: RequestInit, optimistic?: Partial<ProjectRecord>) {
    setError(undefined);
    const previousProject = project;
    if (optimistic) {
      setProject((current) => ({ ...current, ...optimistic }));
    }
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (optimistic) {
        setProject(previousProject);
      }
      throw new Error(payload.error ?? "Request failed.");
    }
    if (payload.project) {
      setProject(normalizeProjectRecordForState(payload.project));
    }
    return payload.project as ProjectRecord | undefined;
  }

  async function runAction(actionKey: string, work: () => Promise<void>) {
    setBusyAction(actionKey);
    try {
      await work();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleControlsApply() {
    await runAction("controls", async () => {
      await requestProject(`/api/projects/${project.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation: controls })
      });
    });
  }

  async function handleRegenerate(mode: PreviewRegenerationMode) {
    await runAction(`regen:${mode}`, async () => {
      await requestProject(`/api/projects/${project.id}/preview/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode })
      });
    });
  }

  async function handleSelectPlan(planId: string) {
    await runAction(`plan:${planId}`, async () => {
      await requestProject(`/api/projects/${project.id}/preview/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId })
      }, {
        selectedPlanId: planId
      });
    });
  }

  async function handleRenderSelected() {
    if (!selectedPlan) {
      setError("Generate a preview plan before rendering.");
      return;
    }
    await runAction("render", async () => {
      await requestProject(
        `/api/projects/${project.id}/render`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId: selectedPlan.id, background: true })
        },
        {
          stage: "render",
          status: "processing",
          selectedPlanId: selectedPlan.id
        }
      );
    });
  }

  async function handleMediaState(assetId: string, patch: { pinned?: boolean; excluded?: boolean }) {
    await runAction(`asset:${assetId}`, async () => {
      await requestProject(`/api/projects/${project.id}/media/${assetId}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
    });
  }

  async function handleAddSoundtracks(files: FileList | null) {
    const selected = Array.from(files ?? []).filter((file) => file.size > 0);
    if (!selected.length) {
      return;
    }
    await runAction("soundtracks:add", async () => {
      const formData = new FormData();
      selected.forEach((file) => formData.append("soundtracks", file));
      await requestProject(`/api/projects/${project.id}/soundtracks`, {
        method: "POST",
        body: formData
      });
    });
  }

  async function handleRemoveSoundtrack(soundtrackId: string) {
    await runAction(`soundtrack:${soundtrackId}`, async () => {
      await requestProject(`/api/projects/${project.id}/soundtracks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soundtrackId })
      });
    });
  }

  async function handleRetry() {
    await runAction("retry", async () => {
      await requestProject(`/api/projects/${project.id}/retry`, { method: "POST" });
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-sky-200/80">Premium project</p>
            <h1 className="mt-3 text-4xl text-white md:text-5xl" style={{ fontFamily: "var(--font-heading)" }}>
              {project.name}
            </h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              Uploaded {project.assetCount} assets on {formatDate(project.createdAt)}. AutoVlog
              builds comparable preview plans before the final physical memory-book render.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {project.status === "failed" ? (
              <button
                type="button"
                onClick={handleRetry}
                disabled={busyAction === "retry"}
                className="rounded-full border border-orange-300/30 px-4 py-2 text-sm text-orange-100 hover:bg-orange-300/10 disabled:opacity-60"
              >
                {busyAction === "retry" ? "Retrying..." : "Retry"}
              </button>
            ) : null}
            {selectedPlan &&
            (project.stage === "preview" ||
              project.status === "ready" ||
              project.stage === "render") ? (
              <button
                type="button"
                onClick={handleRenderSelected}
                disabled={renderInFlight}
                className="rounded-full bg-gradient-to-r from-orange-300 via-amber-200 to-sky-300 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60"
              >
                {renderInFlight ? "Rendering selected plan..." : "Render selected plan"}
              </button>
            ) : null}
            <StatusBadge value={project.status} />
            <StatusBadge value={project.stage} />
          </div>
        </div>
      </div>

      {error || project.error ? (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
          {error ?? project.error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <article className="rounded-3xl border border-white/10 bg-slate-950/45 p-5"><div className="text-xs uppercase tracking-[0.25em] text-slate-400">Assets</div><div className="mt-3 text-3xl font-semibold text-white">{project.assetCount}</div></article>
        <article className="rounded-3xl border border-white/10 bg-slate-950/45 p-5"><div className="text-xs uppercase tracking-[0.25em] text-slate-400">Chapters</div><div className="mt-3 text-3xl font-semibold text-white">{project.chapters.length}</div></article>
        <article className="rounded-3xl border border-white/10 bg-slate-950/45 p-5"><div className="text-xs uppercase tracking-[0.25em] text-slate-400">Preview variants</div><div className="mt-3 text-3xl font-semibold text-white">{project.previewPlans?.length ?? 0}</div></article>
        <article className="rounded-3xl border border-white/10 bg-slate-950/45 p-5"><div className="text-xs uppercase tracking-[0.25em] text-slate-400">Outputs</div><div className="mt-3 text-3xl font-semibold text-white">{project.outputs.length}</div></article>
      </div>

      <section className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
        <div className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Steering controls</h2>
              <p className="mt-1 text-sm text-slate-400">These feed the real planner and renderer.</p>
            </div>
            <button
              type="button"
              onClick={handleControlsApply}
              disabled={busyAction === "controls"}
              className="rounded-full border border-orange-300/30 px-4 py-2 text-sm text-orange-100 hover:bg-orange-300/10 disabled:opacity-60"
            >
              {busyAction === "controls" ? "Updating..." : "Update preview"}
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <SelectField label="Story style" value={controls.storyStyle} options={STORY_STYLE_LABELS} onChange={(value) => setControls((current) => ({ ...current, storyStyle: value }))} />
            <SelectField label="Subject emphasis" value={controls.subjectEmphasis} options={SUBJECT_EMPHASIS_LABELS} onChange={(value) => setControls((current) => ({ ...current, subjectEmphasis: value }))} />
            <SelectField label="Audio emphasis" value={controls.audioEmphasis} options={AUDIO_EMPHASIS_LABELS} onChange={(value) => setControls((current) => ({ ...current, audioEmphasis: value }))} />
            <SelectField label="Pacing" value={controls.pacing} options={PACING_MODE_LABELS} onChange={(value) => setControls((current) => ({ ...current, pacing: value }))} />
            <SelectField label="Ordering" value={controls.ordering} options={ORDERING_LABELS} onChange={(value) => setControls((current) => ({ ...current, ordering: value }))} />
            <SelectField label="Theme preset" value={controls.themePreset} options={THEME_PRESET_LABELS} onChange={(value) => setControls((current) => ({ ...current, themePreset: value }))} />
            <SelectField label="Title style" value={controls.titleStyle} options={TITLE_STYLE_LABELS} onChange={(value) => setControls((current) => ({ ...current, titleStyle: value }))} />
            <SelectField label="Decoration level" value={controls.decorationLevel} options={DECORATION_LEVEL_LABELS} onChange={(value) => setControls((current) => ({ ...current, decorationLevel: value }))} />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {([
              ["full-plan", "Regenerate plans"],
              ["titles-only", "Titles only"],
              ["chapter-grouping", "Chapter grouping"],
              ["styling", "Styling"],
              ["opening-ending", "Opening / ending"],
              ["music-mood", "Music mood"]
            ] as Array<[PreviewRegenerationMode, string]>).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleRegenerate(mode)}
                disabled={busyAction === `regen:${mode}`}
                className="rounded-full border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-orange-300/40 hover:bg-white/5 disabled:opacity-60"
              >
                {busyAction === `regen:${mode}` ? "Working..." : label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Selected preview</h2>
              <p className="mt-1 text-sm text-slate-400">Compare variants before you render.</p>
            </div>
            <Link href="/" className="text-sm text-orange-200 hover:text-orange-100">New upload</Link>
          </div>
          {selectedPlan ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{selectedPlan.variantLabel}</div>
                    <h3 className="mt-2 text-2xl text-white" style={{ fontFamily: "var(--font-heading)" }}>{selectedPlan.recapTitle}</h3>
                    {selectedPlan.recapSubtitle ? <p className="mt-2 text-sm text-slate-300">{selectedPlan.recapSubtitle}</p> : null}
                  </div>
                  <div className="text-right text-sm text-slate-300">
                    <div>Memory Book</div>
                    <div>{THEME_PRESET_LABELS[selectedPlan.themePreset]}</div>
                    <div>{TITLE_STYLE_LABELS[selectedPlan.titleStyle]}</div>
                    <div>{DECORATION_LEVEL_LABELS[selectedPlan.decorationLevel]}</div>
                    <div>{selectedPlan.musicVibe}</div>
                    <div>{formatSeconds(selectedPlan.estimatedDurationSec)}</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {representativeAssets.map((asset) => (
                  <article key={asset.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                    <img src={assetThumbnailRoute(project.id, asset.id)} alt={asset.filename} className="aspect-[4/3] w-full object-cover" />
                    <div className="p-3">
                      <div className="truncate text-sm font-medium text-white">{asset.filename}</div>
                      <div className="mt-1 text-xs text-slate-400">{asset.analysis?.selectionReasons?.[0]?.label ?? "Selected"}</div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-400">Preview plans will appear here after analysis and story planning complete.</div>
          )}
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">MP3 soundtrack</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Attach one or more MP3 files before rendering. When tracks are attached, AutoVlog
              uses only those MP3s for background music and keeps source video audio layered above them.
            </p>
          </div>
          <label className="cursor-pointer rounded-full border border-orange-300/30 px-4 py-2 text-sm text-orange-100 hover:bg-orange-300/10">
            <input
              type="file"
              multiple
              accept="audio/mpeg,.mp3"
              className="hidden"
              onChange={(event) => void handleAddSoundtracks(event.target.files)}
            />
            {busyAction === "soundtracks:add" ? "Analyzing..." : "Add MP3s"}
          </label>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {(project.settings.musicSelection?.uploadedSoundtracks ?? []).map((track) => (
            <article key={track.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-white">{track.filename}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {formatBytes(track.byteSize)}
                    {track.analysis?.durationSec ? ` - ${formatSeconds(track.analysis.durationSec)}` : ""}
                    {track.analysis?.estimatedBpm ? ` - ${track.analysis.estimatedBpm} bpm est.` : ""}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Energy {Math.round((track.analysis?.energyScore ?? 0.5) * 100)} - {track.status}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveSoundtrack(track.id)}
                  disabled={busyAction === `soundtrack:${track.id}`}
                  className="rounded-full bg-rose-300/10 px-3 py-1 text-xs text-rose-100 disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
          {!project.settings.musicSelection?.uploadedSoundtracks?.length ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400">
              No MP3s attached. Built-in royalty-free music will be used as the fallback soundtrack.
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Preview variants</h2>
          <p className="text-sm text-slate-400">Compare up to {PREVIEW_PLAN_LIMIT} plans</p>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-3">
          {(project.previewPlans ?? []).map((plan) => (
            <article key={plan.id} className={cn("rounded-[1.75rem] border p-5", project.selectedPlanId === plan.id ? "border-orange-300/50 bg-orange-300/10" : "border-white/10 bg-white/5")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{plan.variantLabel}</div>
                  <h3 className="mt-2 text-xl text-white">{plan.recapTitle}</h3>
                  <p className="mt-2 text-sm text-slate-300">{plan.name}</p>
                </div>
                {project.selectedPlanId === plan.id ? <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white">Selected</span> : null}
              </div>
              <div className="mt-4 space-y-2 text-sm text-slate-300">
                <div>{plan.chapterCount} chapters</div>
                <div>Memory Book</div>
                <div>{THEME_PRESET_LABELS[plan.themePreset]}</div>
                <div>{TITLE_STYLE_LABELS[plan.titleStyle]}</div>
                <div>{DECORATION_LEVEL_LABELS[plan.decorationLevel]}</div>
                <div>{formatSeconds(plan.estimatedDurationSec)}</div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {plan.chapterTitles.slice(0, 4).map((title, index) => <span key={`${plan.id}:${index}:${title}`} className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200">{title}</span>)}
              </div>
              <button
                type="button"
                onClick={() => handleSelectPlan(plan.id)}
                disabled={busyAction === `plan:${plan.id}` || project.selectedPlanId === plan.id}
                className="mt-5 rounded-full border border-orange-300/30 px-4 py-2 text-sm text-orange-100 hover:bg-orange-300/10 disabled:opacity-60"
              >
                {busyAction === `plan:${plan.id}` ? "Selecting..." : project.selectedPlanId === plan.id ? "Selected" : "Choose plan"}
              </button>
            </article>
          ))}
          {!project.previewPlans?.length ? <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-400">Preview variants are generated after the story planner finishes.</div> : null}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.88fr,1.12fr]">
        <div className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-6">
          <div className="flex items-center justify-between"><h2 className="text-xl font-semibold text-white">Chapters</h2><p className="text-sm text-slate-400">{project.chapters.length} groups</p></div>
          <div className="mt-5 grid gap-3">
            {project.chapters.map((chapter) => (
              <article key={chapter.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div><h3 className="text-lg font-medium text-white">{chapter.title}</h3><p className="mt-1 text-sm text-slate-400">{chapter.stats.totalAssets} assets, {chapter.stats.videoCount} videos, {chapter.stats.imageCount} images</p></div>
                  <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{Math.round(chapter.labelConfidence * 100)}% confidence</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-6">
          <div className="flex items-center justify-between"><h2 className="text-xl font-semibold text-white">Rendered videos</h2><p className="text-sm text-slate-400">Final outputs</p></div>
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            {project.outputs.map((output) => (
              <article key={output.id} className="rounded-[1.75rem] border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div><h3 className="text-lg font-medium text-white">{output.title}</h3><p className="mt-1 text-sm text-slate-400">{output.kind} output · {formatSeconds(output.durationSec)}</p></div>
                  <a href={output.downloadRoute} className="rounded-full border border-orange-300/30 px-4 py-2 text-sm text-orange-100 hover:bg-orange-300/10">Download MP4</a>
                </div>
                <video controls preload="metadata" className="mt-4 max-h-[32rem] w-full rounded-2xl border border-white/10 bg-black object-contain" src={output.downloadRoute} />
              </article>
            ))}
            {!project.outputs.length ? <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-400">Final outputs appear here after you render a selected preview plan.</div> : null}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-6">
        <div className="flex items-center justify-between">
          <div><h2 className="text-xl font-semibold text-white">Media review</h2><p className="mt-1 text-sm text-slate-400">Pin clips to preserve them. Exclude clips to keep them out of every plan and render.</p></div>
          <div className="text-sm text-slate-400">{project.assets.length} processed assets</div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {project.assets.map((asset) => (
            <article key={asset.id} className={cn("overflow-hidden rounded-[1.5rem] border bg-white/5", asset.userState?.excluded ? "border-rose-300/20 opacity-70" : "border-white/10", asset.userState?.pinned && "border-orange-300/35")}>
              <img src={assetThumbnailRoute(project.id, asset.id)} alt={asset.filename} className="aspect-[4/3] w-full object-cover" />
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="truncate text-sm font-medium text-white">{asset.filename}</div>
                    <div className="mt-1 text-xs text-slate-400">{asset.analysis?.qualityTier ?? "usable"} · score {Math.round((asset.score?.total ?? 0) * 100)}</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleMediaState(asset.id, { pinned: !asset.userState?.pinned, excluded: false })} disabled={busyAction === `asset:${asset.id}`} className={cn("rounded-full px-3 py-1 text-xs", asset.userState?.pinned ? "bg-orange-300/15 text-orange-100" : "bg-white/5 text-slate-300")}>{asset.userState?.pinned ? "Pinned" : "Pin"}</button>
                    <button type="button" onClick={() => handleMediaState(asset.id, { excluded: !asset.userState?.excluded })} disabled={busyAction === `asset:${asset.id}`} className={cn("rounded-full px-3 py-1 text-xs", asset.userState?.excluded ? "bg-rose-300/15 text-rose-100" : "bg-white/5 text-slate-300")}>{asset.userState?.excluded ? "Excluded" : "Exclude"}</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(asset.analysis?.selectionReasons ?? []).slice(0, 2).map((reason, index) => <span key={`${asset.id}:select:${reason.kind}:${index}`} className="rounded-full bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">{reason.label}</span>)}
                  {(asset.analysis?.skipReasons ?? []).slice(0, 1).map((reason, index) => <span key={`${asset.id}:skip:${reason.kind}:${index}`} className="rounded-full bg-rose-300/10 px-3 py-1 text-xs text-rose-100">{reason.label}</span>)}
                </div>
                <div className="text-xs text-slate-400">
                  {asset.analysis?.transcriptResult?.snippet
                    ? `Dialogue: ${asset.analysis.transcriptResult.snippet}`
                    : asset.analysis?.skipReasons?.[0]?.detail ?? asset.analysis?.selectionReasons?.[0]?.detail ?? "Available for planning."}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
