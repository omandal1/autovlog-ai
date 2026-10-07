import { createId } from "@/lib/ids";
import type {
  CandidateSegment,
  EditDecisionList,
  EditorialAnalysis,
  EditorialShotType,
  EditorialStoryRole,
  MatchCutCandidate,
  MediaAsset,
  Timeline
} from "@/lib/types";

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function stableFraction(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0xffffffff;
}

function semanticTags(asset: MediaAsset) {
  const source = [asset.analysis?.semanticHint, asset.analysis?.transcriptResult?.snippet, asset.filename]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const vocabulary = [
    "travel", "station", "airport", "campus", "class", "dorm", "concert", "party",
    "food", "restaurant", "beach", "city", "night", "friends", "family", "game",
    "walk", "arrival", "home", "graduation", "birthday"
  ];
  return vocabulary.filter((tag) => source.includes(tag)).slice(0, 8);
}

function eventStrength(asset: MediaAsset, event: string) {
  return asset.analysis?.transcriptResult?.events.some((item) => item.toLowerCase().includes(event))
    ? Math.max(0.7, asset.analysis.transcriptResult.confidence)
    : undefined;
}

function shotType(asset: MediaAsset): EditorialShotType {
  const face = asset.analysis?.faceCluster?.faceScore ?? asset.score?.faceHint ?? 0;
  const motion = asset.score?.motion ?? 0;
  if (face >= 0.72) return "reaction";
  if (face >= 0.45) return "tight";
  if (motion >= 0.58) return "action";
  if (asset.analysis?.semanticHint?.match(/scenic|landscape|campus|city|beach/i)) return "establishing";
  if (asset.mediaType === "image") return "wide";
  return "medium";
}

function chooseStoryRole(position: number, hook: number, reaction: number): EditorialStoryRole {
  if (hook >= 0.73) return "hook";
  if (reaction >= 0.62) return "reaction";
  if (position <= 0.2) return "setup";
  if (position >= 0.82) return "payoff";
  return "progression";
}

function candidateSegment(options: {
  asset: MediaAsset;
  role: EditorialStoryRole;
  score: number;
  emotion: number;
  audio: number;
  visual: number;
  continuity: number;
  technical: number;
}): CandidateSegment {
  const { asset } = options;
  if (asset.mediaType === "image") {
    const duration = options.role === "reaction" || options.role === "payoff" ? 4.6 : 3.1;
    return {
      mediaAssetId: asset.id,
      startTime: 0,
      endTime: duration,
      duration,
      segmentScore: options.score,
      storyRole: options.role,
      emotionScore: options.emotion,
      audioScore: 0,
      visualScore: options.visual,
      continuityScore: options.continuity,
      technicalScore: options.technical,
      reason: options.role === "payoff" ? "Held longer as an ending memory." : "Selected for visual and shot-scale variety."
    };
  }

  const sourceDuration = Math.max(0.2, asset.metadata.durationSec ?? 4);
  const target = clamp(
    options.role === "hook" ? 7 : options.audio >= 0.55 ? 6.5 : options.emotion >= 0.6 ? 5.2 : 3.6,
    0.8,
    Math.min(9, sourceDuration)
  );
  const peak = sourceDuration * (0.38 + stableFraction(asset.id) * 0.3);
  const preRoll = options.emotion >= 0.55 ? Math.min(1.2, target * 0.28) : target * 0.18;
  const startTime = clamp(peak - preRoll, 0, Math.max(0, sourceDuration - target));
  const endTime = Math.min(sourceDuration, startTime + target);
  return {
    mediaAssetId: asset.id,
    startTime: Number(startTime.toFixed(3)),
    endTime: Number(endTime.toFixed(3)),
    duration: Number((endTime - startTime).toFixed(3)),
    segmentScore: options.score,
    storyRole: options.role,
    emotionScore: options.emotion,
    audioScore: options.audio,
    visualScore: options.visual,
    continuityScore: options.continuity,
    technicalScore: options.technical,
    reason:
      options.emotion >= 0.55
        ? "Includes lead-in and reaction tail around the strongest supported micro-moment."
        : options.audio >= 0.55
          ? "Keeps a longer natural speech window instead of a fixed-percent trim."
          : "Uses the strongest sampled motion/visual window."
  };
}

export function enrichAssetsWithEditorialAnalysis(assets: MediaAsset[]) {
  return assets.map((asset, index) => {
    const position = assets.length <= 1 ? 0.5 : index / (assets.length - 1);
    const visual = clamp(
      (asset.score?.visualClarity ?? 0.4) * 0.32 +
        (asset.score?.contrast ?? 0.35) * 0.18 +
        (asset.score?.uniqueness ?? 0.4) * 0.32 +
        (asset.score?.motion ?? 0.1) * 0.18
    );
    const technical = clamp(
      (asset.score?.visualClarity ?? 0.4) * 0.56 +
        (asset.score?.brightness ?? 0.5) * 0.18 +
        (asset.score?.contrast ?? 0.35) * 0.26
    );
    const dialogue = asset.analysis?.transcriptResult?.dialogueScore ?? 0;
    const speechConfidence = asset.analysis?.transcriptResult?.confidence ?? 0;
    const laughter = eventStrength(asset, "laugh");
    const excitement = Math.max(
      eventStrength(asset, "cheer") ?? 0,
      eventStrength(asset, "applause") ?? 0,
      eventStrength(asset, "crowd") ?? 0
    ) || undefined;
    const reaction = clamp(
      (laughter ?? 0) * 0.46 + (excitement ?? 0) * 0.34 +
        (asset.analysis?.faceCluster?.faceScore ?? asset.score?.faceHint ?? 0) * 0.2
    );
    const emotion = clamp(reaction * 0.74 + dialogue * 0.16 + (asset.score?.motion ?? 0) * 0.1);
    const duplicateScore = asset.analysis?.duplicateAnalysis?.similarityScore ?? 0;
    const redundancy = asset.analysis?.duplicateAnalysis?.isDuplicate ? Math.max(0.78, duplicateScore) : 1 - (asset.score?.uniqueness ?? 0.5);
    const audio = asset.mediaType === "video" ? clamp(dialogue * 0.72 + speechConfidence * 0.28) : 0;
    const context = clamp((semanticTags(asset).length ? 0.58 : 0.28) + dialogue * 0.22 + (position < 0.25 ? 0.12 : 0));
    const hook = clamp(emotion * 0.3 + visual * 0.28 + audio * 0.13 + (asset.score?.motion ?? 0) * 0.16 + (1 - redundancy) * 0.13 - (technical < 0.25 ? 0.25 : 0));
    const usability = clamp(technical * 0.42 + visual * 0.25 + (1 - redundancy) * 0.23 + Math.max(audio, emotion) * 0.1);
    const role = chooseStoryRole(position, hook, reaction);
    const importance = clamp(hook * 0.22 + context * 0.18 + emotion * 0.22 + usability * 0.38);
    const continuity = clamp(0.35 + (asset.analysis?.faceCluster?.recurrenceCount ?? 0) * 0.08 + (semanticTags(asset).length ? 0.12 : 0));
    const segment = candidateSegment({ asset, role, score: importance, emotion, audio, visual, continuity, technical });
    const analysis: EditorialAnalysis = {
      mediaAssetId: asset.id,
      mediaType: asset.mediaType,
      timestamp: asset.metadata.capturedAt,
      duration: asset.metadata.durationSec ?? segment.duration,
      sceneSummary: asset.analysis?.semanticHint ?? asset.analysis?.transcriptResult?.snippet ?? `Memory from ${asset.filename}`,
      semanticTags: semanticTags(asset),
      peopleCount: asset.analysis?.faceCluster?.faceLike ? Math.max(1, asset.analysis.faceCluster.recurrenceCount > 2 ? 2 : 1) : 0,
      facePresence: asset.analysis?.faceCluster?.faceScore ?? asset.score?.faceHint ?? 0,
      dominantSubjects: asset.analysis?.faceCluster?.faceLike ? ["people"] : [],
      activityType:
        semanticTags(asset)[0] ?? ((asset.score?.motion ?? 0) > 0.48 ? "activity" : "memory"),
      hookScore: hook,
      contextScore: context,
      setupScore: clamp(context * (1 - position * 0.55)),
      conflictScore: 0,
      resolutionScore: clamp(importance * (0.4 + position * 0.6)),
      storyImportanceScore: importance,
      emotionIntensityScore: emotion,
      candidnessScore: clamp(reaction * 0.65 + (asset.score?.motion ?? 0) * 0.2 + dialogue * 0.15),
      humanReactionScore: reaction,
      microMomentScore: Math.max(reaction, audio * 0.8),
      laughterProbability: laughter,
      excitementProbability: excitement,
      speechPresence: dialogue,
      speechConfidence,
      silenceRegions: [],
      pauseRegions: [],
      audioQualityScore: asset.mediaType === "video" ? clamp(0.42 + speechConfidence * 0.38) : 0,
      shotScale: shotType(asset),
      cameraMotion: (asset.score?.motion ?? 0) >= 0.62 ? "high" : (asset.score?.motion ?? 0) >= 0.35 ? "medium" : (asset.score?.motion ?? 0) >= 0.12 ? "low" : "static",
      brightness: asset.score?.brightness ?? 0.5,
      colorfulness: asset.score?.contrast ?? 0.35,
      visualNovelty: asset.score?.uniqueness ?? 0.5,
      compositionScore: asset.score?.visualClarity ?? 0.4,
      sharpness: asset.score?.visualClarity ?? 0.4,
      blurScore: 1 - (asset.score?.visualClarity ?? 0.4),
      exposureScore: 1 - Math.abs((asset.score?.brightness ?? 0.5) - 0.5) * 2,
      motionDirection: (asset.score?.motion ?? 0) < 0.12 ? "static" : "mixed",
      dominantColor: (asset.score?.brightness ?? 0.5) < 0.33 ? "dark" : (asset.score?.brightness ?? 0.5) > 0.67 ? "light" : "mid",
      subjectIdentityCluster: asset.analysis?.faceCluster?.clusterId,
      actionTags: semanticTags(asset),
      entryMotion: (asset.score?.motion ?? 0) < 0.12 ? "still" : "mixed",
      exitMotion: (asset.score?.motion ?? 0) < 0.12 ? "still" : "mixed",
      technicalQualityScore: technical,
      duplicateScore,
      redundancyScore: clamp(redundancy),
      usabilityScore: usability,
      candidateSegments: [segment],
      confidence: asset.analysis?.semanticHint || speechConfidence > 0 ? 0.68 : 0.48
    };
    return { ...asset, analysis: { ...asset.analysis, editorial: analysis } };
  });
}

function visualContrast(left: MediaAsset, right: MediaAsset) {
  const a = left.analysis?.editorial;
  const b = right.analysis?.editorial;
  if (!a || !b) return 0.3;
  return clamp(
    Math.abs(a.brightness - b.brightness) * 0.35 +
      (a.shotScale !== b.shotScale ? 0.3 : 0) +
      (a.cameraMotion !== b.cameraMotion ? 0.2 : 0) +
      (a.dominantColor !== b.dominantColor ? 0.15 : 0)
  );
}

export function planEditorialSequence(assets: MediaAsset[]) {
  const usable = assets.filter((asset) =>
    asset.userState?.pinned ||
    (!asset.analysis?.duplicateAnalysis?.isDuplicate && asset.analysis?.qualityTier !== "weak")
  );
  const pool = usable.length ? usable : assets;
  if (pool.length <= 2) return pool;
  const rankedHooks = [...pool]
    .filter((_, index) => pool.length < 5 || index >= Math.floor(pool.length * 0.12))
    .sort((a, b) => (b.analysis?.editorial?.hookScore ?? 0) - (a.analysis?.editorial?.hookScore ?? 0));
  const hook = rankedHooks[0] ?? pool[0];
  const chronological = [...pool].sort((a, b) =>
    (a.metadata.capturedAt ?? "").localeCompare(b.metadata.capturedAt ?? "") || a.uploadOrder - b.uploadOrder
  );
  const remaining = chronological.filter((asset) => asset.id !== hook.id);
  const result = [hook];
  while (remaining.length) {
    const recent = result.slice(-3);
    const tooUniform = recent.length === 3 && recent.every((item) => item.analysis?.editorial?.shotScale === recent[0]?.analysis?.editorial?.shotScale);
    let nextIndex = 0;
    if (tooUniform) {
      let best = -1;
      for (let index = 0; index < Math.min(remaining.length, 5); index += 1) {
        const contrast = visualContrast(result[result.length - 1]!, remaining[index]!);
        if (contrast > best) { best = contrast; nextIndex = index; }
      }
    }
    result.push(remaining.splice(nextIndex, 1)[0]!);
  }
  return result;
}

export function findMatchCutCandidate(
  from: MediaAsset,
  to: MediaAsset
): MatchCutCandidate {
  const left = from.analysis?.editorial;
  const right = to.analysis?.editorial;
  if (!left || !right) {
    return {
      fromAssetId: from.id,
      toAssetId: to.id,
      matchCutScore: 0,
      matchType: "none",
      recommendedTransitionDuration: 0.28
    };
  }
  const motion = left.exitMotion !== "still" && left.exitMotion === right.entryMotion ? 0.78 : 0;
  const scale = left.shotScale === right.shotScale ? 0.62 : 0;
  const color = left.dominantColor === right.dominantColor ? 0.54 : 0;
  const subject = left.subjectIdentityCluster && left.subjectIdentityCluster === right.subjectIdentityCluster ? 0.82 : 0;
  const candidates = [
    { type: "subject" as const, score: subject },
    { type: "motion" as const, score: motion },
    { type: "shot-scale" as const, score: scale },
    { type: "color" as const, score: color }
  ].sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  return {
    fromAssetId: from.id,
    toAssetId: to.id,
    matchCutScore: best.score,
    matchType: best.score >= 0.5 ? best.type : "none",
    recommendedTransitionDuration: best.score >= 0.72 ? 0.18 : best.score >= 0.5 ? 0.28 : 0.4
  };
}

export function createEditDecisionList(timeline: Timeline): EditDecisionList {
  let cursor = 0;
  // Preserve the actual editorial sequence. A master hook can deliberately
  // come from a later chapter before the chronological setup; regrouping by
  // chapterOrder would move it back and make the persisted EDL disagree with
  // the video that is rendered.
  const sceneGroups = timeline.clips.reduce<typeof timeline.clips[]>((groups, clip) => {
    const current = groups[groups.length - 1];
    if (!current || current[0]?.chapterId !== clip.chapterId) {
      groups.push([clip]);
    } else {
      current.push(clip);
    }
    return groups;
  }, []);
  const scenes = sceneGroups.map((sceneClips, sceneIndex) => {
    const clips = sceneClips.map((clip) => {
      const decision = {
        mediaAssetId: clip.assetId,
        sourceStart: clip.trimStartSec,
        sourceEnd: clip.trimStartSec + clip.trimDurationSec,
        timelineStart: cursor,
        duration: clip.displayDurationSec,
        storyRole: (clip.storyRole === "opening" ? "hook" : clip.storyRole === "closing" ? "payoff" : clip.storyRole === "highlight" ? "reaction" : clip.storyRole === "chapter-intro" ? "setup" : clip.storyRole ?? "progression") as EditorialStoryRole,
        shotType: clip.shotType ?? "medium",
        audioMode: clip.sourceAudio?.hasAudio ? "mixed" as const : "music" as const,
        transitionType: clip.transitionName,
        jCut: Boolean(clip.jCutEnabled),
        lCut: Boolean(clip.lCutEnabled),
        audioLeadIn: clip.audioLeadInSec ?? 0,
        audioTailOut: clip.audioTailOutSec ?? 0,
        reasonSelected: clip.reasonSelected ?? ["Selected for balanced story coverage."],
        scoreBreakdown: clip.editorialScoreBreakdown ?? { overall: clip.score }
      };
      cursor += Math.max(0, clip.displayDurationSec - timeline.renderProfile.transitionSec);
      return decision;
    });
    return {
      sceneId: createId(`scene${sceneIndex + 1}`, 6),
      purpose: sceneIndex === 0 ? "Hook and setup" : sceneIndex === sceneGroups.length - 1 ? "Payoff and resolution" : "Story progression",
      startTime: clips[0]?.timelineStart ?? cursor,
      targetDuration: clips.reduce((sum, clip) => sum + clip.duration, 0),
      clips,
      transitionIn: clips[0]?.transitionType,
      transitionOut: clips[clips.length - 1]?.transitionType
    };
  });
  const hookClip = timeline.clips.find((clip) => clip.storyRole === "opening" || clip.storyRole === "hook");
  return {
    projectId: timeline.projectId,
    outputType: timeline.kind,
    narrativeSummary: `${timeline.title}: a hook-led, chapter-based memory story with varied visual rhythm and an intentional ending.`,
    hookSegment: hookClip ? {
      mediaAssetId: hookClip.assetId,
      startTime: hookClip.trimStartSec,
      endTime: hookClip.trimStartSec + hookClip.trimDurationSec,
      duration: hookClip.trimDurationSec,
      segmentScore: hookClip.score,
      storyRole: "hook",
      emotionScore: hookClip.editorialScoreBreakdown?.emotion ?? 0,
      audioScore: hookClip.editorialScoreBreakdown?.audio ?? 0,
      visualScore: hookClip.editorialScoreBreakdown?.visual ?? hookClip.score,
      continuityScore: hookClip.editorialScoreBreakdown?.continuity ?? 0,
      technicalScore: hookClip.editorialScoreBreakdown?.technical ?? hookClip.score,
      reason: hookClip.reasonSelected?.[0] ?? "Selected as the strongest context-independent opening moment."
    } : undefined,
    scenes,
    pacingCurve: timeline.settings.generation?.storyStyle === "energetic" ? [0.9, 0.62, 0.78, 1, 0.58] : [0.82, 0.55, 0.72, 0.9, 0.52],
    totalDuration: timeline.actualDurationSec,
    generatedAt: new Date().toISOString()
  };
}
