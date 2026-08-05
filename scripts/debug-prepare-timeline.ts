import { appendFileSync, writeFileSync } from "fs";
import path from "path";

import { enrichAssetsWithTranscription } from "@/lib/analysis/transcription";
import { analyzeTimelineBeats } from "@/lib/audio/beat-analysis";
import { planLayeredMusicMix } from "@/lib/audio/music-mixer";
import { alignTimelineToMusicBeats } from "@/lib/audio/music-sync";
import { attachAudioPlan, attachFallbackAudioPlan } from "@/lib/audio/music-selector";
import { analyzeTimelineSourceAudio } from "@/lib/audio/source-audio-analysis";
import { buildBookRenderPlan } from "@/lib/render/book-render-plan-builder";
import { validateAndRepairRenderPlan } from "@/lib/render/render-plan-validator";
import type { Timeline } from "@/lib/types";
import {
  assignAdvancedTimelineTransitions,
  buildFallbackAdvancedTransitions
} from "@/lib/transitions/advanced-transition-engine";
import { readProjectRecord } from "@/storage/local-storage";

const projectId = process.argv[2] ?? "proj_57e3586f5d";
const logPath = path.join("storage", "projects", projectId, "debug-prepare.log");

function log(message: string) {
  appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

async function main() {
  writeFileSync(logPath, "");
  const project = await readProjectRecord(projectId);
  const plan =
    project.previewPlans?.find((candidate) => candidate.id === project.selectedPlanId) ??
    project.previewPlans?.find((candidate) => candidate.isPrimary) ??
    project.previewPlans?.[0];
  if (!plan) {
    throw new Error("No plan");
  }

  let prepared: Timeline = plan.masterTimeline;
  log(`start timeline=${prepared.id} clips=${prepared.clips.length}`);

  log("assignAdvancedTimelineTransitions:start");
  try {
    prepared = assignAdvancedTimelineTransitions(project, prepared);
  } catch {
    prepared = buildFallbackAdvancedTransitions(prepared);
  }
  log("assignAdvancedTimelineTransitions:done");

  log("analyzeTimelineSourceAudio:start");
  try {
    prepared = await analyzeTimelineSourceAudio(prepared);
  } catch (error) {
    log(`analyzeTimelineSourceAudio:error ${error instanceof Error ? error.message : String(error)}`);
  }
  log("analyzeTimelineSourceAudio:done");

  log("buildBookRenderPlan:start");
  try {
    prepared = buildBookRenderPlan(project, prepared);
  } catch (error) {
    log(`buildBookRenderPlan:error ${error instanceof Error ? error.message : String(error)}`);
    prepared = validateAndRepairRenderPlan(project, prepared);
  }
  log(`buildBookRenderPlan:done pages=${prepared.book?.pages.length ?? 0}`);

  log("validateAndRepairRenderPlan:start");
  prepared = validateAndRepairRenderPlan(project, prepared);
  log(`validateAndRepairRenderPlan:done pages=${prepared.book?.pages.length ?? 0}`);

  log("attachAudioPlan:start");
  try {
    prepared = await attachAudioPlan(project, prepared);
  } catch (error) {
    log(`attachAudioPlan:error ${error instanceof Error ? error.message : String(error)}`);
    prepared = await attachFallbackAudioPlan(project, prepared);
  }
  log(`attachAudioPlan:done tracks=${prepared.audioTracks?.length ?? 0}`);

  log("analyzeTimelineBeats:start");
  prepared = {
    ...prepared,
    beatAnalysis: await analyzeTimelineBeats(prepared)
  };
  log(`analyzeTimelineBeats:done beats=${prepared.beatAnalysis?.beatGridSec.length ?? 0}`);

  log("alignTimelineToMusicBeats:start");
  prepared = alignTimelineToMusicBeats(prepared);
  log("alignTimelineToMusicBeats:done");

  log("planLayeredMusicMix:start");
  prepared = planLayeredMusicMix(prepared);
  log(`planLayeredMusicMix:done tracks=${prepared.audioTracks?.length ?? 0}`);
}

main().catch((error) => {
  log(`failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});

