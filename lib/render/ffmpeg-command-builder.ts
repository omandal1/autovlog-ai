import type {
  AudioEmphasis,
  Timeline,
  TimelineClip,
  TimelineTransition
} from "@/lib/types";

interface TransitionGraphOptions {
  xfadeOffsetSec?: number;
  outputDurationSec?: number;
}

function easedProgress(durationSec: number) {
  const duration = Math.max(0.001, durationSec);
  return `0.5-0.5*cos(PI*min(t/${duration.toFixed(3)},1))`;
}

export function buildTransitionSegmentGraph(
  transition: TimelineTransition,
  options: TransitionGraphOptions = {}
) {
  if (transition.type === "book-open") {
    return buildBookOpenTransitionGraph(transition);
  }
  if (transition.type === "page-flip") {
    return buildPageFlipTransitionGraph(transition);
  }
  return buildStandardTransitionGraph(transition, options);
}

function buildStandardTransitionGraph(
  transition: TimelineTransition,
  options: TransitionGraphOptions
) {
  const durationSec = Number(transition.durationSec.toFixed(3));
  const offsetSec = Number(Math.max(0, options.xfadeOffsetSec ?? 0).toFixed(3));
  const trim =
    options.outputDurationSec !== undefined
      ? `,trim=duration=${Math.max(0.001, options.outputDurationSec).toFixed(
          3
        )},setpts=PTS-STARTPTS`
      : "";
  return {
    filterComplex: `[0:v]setpts=PTS-STARTPTS[v0];[1:v]setpts=PTS-STARTPTS[v1];[v0][v1]xfade=transition=${transition.filterName}:duration=${durationSec.toFixed(
      3
    )}:offset=${offsetSec.toFixed(3)}${trim},setsar=1,format=yuv420p[vout]`,
    outputLabel: "[vout]"
  };
}

function buildPageFlipTransitionGraph(transition: TimelineTransition) {
  const progress = easedProgress(transition.durationSec);
  const curve = Number((transition.curveStrength ?? 0.74).toFixed(3));
  const shadowStrength = Number((transition.shadowStrength ?? 0.3).toFixed(3));
  const liftPx = transition.liftPx ?? 42;
  const directionSeed =
    transition.fromClipId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) +
    transition.toClipId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const flipToRight = directionSeed % 2 === 0;
  const pageWidth = `'max(iw*(1-${(0.84 + curve * 0.1).toFixed(3)}*${progress}),iw*0.08)'`;
  const pageHeight = `'max(ih*(1-${(0.03 + curve * 0.08).toFixed(3)}*${progress}),ih*0.9)'`;
  const pageX = flipToRight
    ? `'(main_w-overlay_w)*(0.06+0.46*${progress})'`
    : `'(main_w-overlay_w)*(0.52-0.46*${progress})'`;
  const shadowX = flipToRight
    ? `'(main_w-overlay_w)*(0.1+0.48*${progress})'`
    : `'(main_w-overlay_w)*(0.48-0.48*${progress})'`;
  const liftY = `'(main_h-overlay_h)/2-${Math.max(18, liftPx)}*sin(${progress}*PI)*0.18'`;
  const rotate = flipToRight
    ? `'${(0.025 + curve * 0.04).toFixed(3)}*sin(${progress}*PI)'`
    : `'-${(0.025 + curve * 0.04).toFixed(3)}*sin(${progress}*PI)'`;

  return {
    filterComplex: [
      `[1:v]format=rgba,gblur=sigma='1.4+4*(1-${progress})',eq=contrast='1.03+0.04*${progress}':brightness='0.01+0.02*${progress}'[bgbase]`,
      `[bgbase]fade=t=in:st=0:d=${transition.durationSec.toFixed(3)}:alpha=1[bg]`,
      `[0:v]format=rgba,split[pagefrontseed][pagebackseed]`,
      `[pagebackseed]scale=w=${pageWidth}:h=${pageHeight}:eval=frame,eq=brightness='0.06*${progress}':saturation='0.66',rotate=${rotate}:ow=rotw(iw):oh=roth(ih):c=none,fade=t=out:st=0:d=${transition.durationSec.toFixed(
        3
      )}:alpha=1[pageback]`,
      `[pagefrontseed]scale=w=${pageWidth}:h=${pageHeight}:eval=frame,eq=brightness='-0.04*${progress}':contrast='1.04',rotate=${rotate}:ow=rotw(iw):oh=roth(ih):c=none,fade=t=out:st=0:d=${transition.durationSec.toFixed(
        3
      )}:alpha=1[pagefront]`,
      `[pagefront]split[pagefg][pageshadowseed]`,
      `[pageshadowseed]colorchannelmixer=rr=0:gg=0:bb=0:aa=${shadowStrength},boxblur=24:3[pageshadow]`,
      `[bg][pageshadow]overlay=x=${shadowX}:y=${liftY}[shadowed]`,
      `[shadowed][pageback]overlay=x=${pageX}:y=${liftY}[backed]`,
      `[backed][pagefg]overlay=x=${pageX}:y=${liftY},format=yuv420p[vout]`
    ].join(";"),
    outputLabel: "[vout]"
  };
}

function buildBookOpenTransitionGraph(transition: TimelineTransition) {
  const progress = easedProgress(transition.durationSec);
  const curve = Number((transition.curveStrength ?? 0.86).toFixed(3));
  const shadowStrength = Number((transition.shadowStrength ?? 0.34).toFixed(3));
  const liftPx = transition.liftPx ?? 54;
  const coverWidth = `'max(iw*(1-${(0.88 + curve * 0.08).toFixed(3)}*${progress}),iw*0.09)'`;
  const coverHeight = `'max(ih*(1-${(0.04 + curve * 0.06).toFixed(3)}*${progress}),ih*0.88)'`;
  const coverX = `'(main_w-overlay_w)*(0.14-0.08*${progress})'`;
  const coverY = `'(main_h-overlay_h)/2-${Math.max(24, liftPx)}*sin(${progress}*PI)*0.12'`;
  const rotate = `'-${(0.05 + curve * 0.03).toFixed(3)}*sin(${progress}*PI/1.6)'`;
  const shadowX = `'(main_w-overlay_w)*(0.18-0.04*${progress})'`;

  return {
    filterComplex: [
      `[1:v]format=rgba,gblur=sigma='2.6*(1-${progress})',eq=brightness='0.02+0.03*${progress}':contrast='1.02+0.05*${progress}'[opened]`,
      `[opened]fade=t=in:st=0:d=${transition.durationSec.toFixed(3)}:alpha=1[bg]`,
      `[0:v]format=rgba,split[coversurface][coverbackseed]`,
      `[coverbackseed]scale=w=${coverWidth}:h=${coverHeight}:eval=frame,eq=brightness='0.07*${progress}':saturation='0.74',rotate=${rotate}:ow=rotw(iw):oh=roth(ih):c=none,fade=t=out:st=0:d=${transition.durationSec.toFixed(
        3
      )}:alpha=1[coverback]`,
      `[coversurface]scale=w=${coverWidth}:h=${coverHeight}:eval=frame,eq=brightness='-0.06*${progress}':contrast='1.06',rotate=${rotate}:ow=rotw(iw):oh=roth(ih):c=none,fade=t=out:st=0:d=${transition.durationSec.toFixed(
        3
      )}:alpha=1[coverfg]`,
      `[coverfg]split[coverpaint][covershadowseed]`,
      `[covershadowseed]colorchannelmixer=rr=0:gg=0:bb=0:aa=${shadowStrength},boxblur=26:4[covershadow]`,
      `[bg][covershadow]overlay=x=${shadowX}:y=${coverY}[shadowed]`,
      `[shadowed][coverback]overlay=x=${coverX}:y=${coverY}[backed]`,
      `[backed][coverpaint]overlay=x=${coverX}:y=${coverY},format=yuv420p[vout]`
    ].join(";"),
    outputLabel: "[vout]"
  };
}

export function buildSourceAudioBedGraph(options: {
  timeline: Timeline;
  clips: TimelineClip[];
  clipStartTimes: Map<string, number>;
}) {
  const audioClips = options.clips.filter(
    (clip) => clip.sourceAudio?.hasAudio && clip.audioSourcePath
  );
  if (!audioClips.length) {
    return undefined;
  }

  const filterChains = audioClips.map((clip, index) => {
    const delayMs = Math.max(
      0,
      Math.round((options.clipStartTimes.get(clip.id) ?? 0) * 1000)
    );
    const gainDb = clip.sourceAudio?.gainDb ?? 0;
    const audioDurationSec = Math.max(
      0.1,
      Math.min(clip.trimDurationSec, clip.displayDurationSec)
    );
    const fadeInSec = Number(Math.min(0.14, audioDurationSec / 4).toFixed(3));
    const fadeOutSec = Number(Math.min(0.18, audioDurationSec / 4).toFixed(3));
    const fadeOutStart = Math.max(0, audioDurationSec - fadeOutSec).toFixed(3);

    return (
      `[${index}:a]atrim=0:${audioDurationSec.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `aresample=48000,pan=stereo|FL<c0|FR<c0,` +
      `highpass=f=80,lowpass=f=8200,volume=${gainDb}dB,` +
      `acompressor=threshold=-21dB:ratio=2.0:attack=10:release=110:makeup=1.0,` +
      `afade=t=in:st=0:d=${fadeInSec.toFixed(3)},` +
      `afade=t=out:st=${fadeOutStart}:d=${fadeOutSec.toFixed(3)},` +
      `adelay=${delayMs}|${delayMs}[src${index}]`
    );
  });

  filterChains.push(
    `${audioClips.map((_, index) => `[src${index}]`).join("")}amix=inputs=${audioClips.length}:normalize=0,` +
      `acompressor=threshold=-17dB:ratio=2.0:attack=15:release=180:makeup=1.4,` +
      `alimiter=limit=0.95[sourcebed]`
  );

  return {
    filterComplex: filterChains.join(";"),
    outputLabel: "[sourcebed]"
  };
}

export function buildMusicBedGraph(timeline: Timeline) {
  if (!timeline.audioTracks?.length) {
    return undefined;
  }

  const filterChains = timeline.audioTracks.map((track, index) => {
    const fadeInSec = Number(Math.min(track.crossfadeSec || 0.24, track.durationSec / 3).toFixed(3));
    const fadeOutSec = Number(Math.min(track.crossfadeSec || 0.24, track.durationSec / 3).toFixed(3));
    const fadeOutStart = Math.max(0, track.durationSec - fadeOutSec).toFixed(3);
    const delayMs = Math.max(0, Math.round(track.startSec * 1000));

    return (
      `[${index}:a]atrim=0:${track.durationSec.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,` +
      `volume=${track.volumeDb}dB,` +
      `afade=t=in:st=0:d=${fadeInSec.toFixed(3)},` +
      `afade=t=out:st=${fadeOutStart}:d=${fadeOutSec.toFixed(3)},` +
      `adelay=${delayMs}|${delayMs}[music${index}]`
    );
  });

  filterChains.push(
    `${timeline.audioTracks.map((_, index) => `[music${index}]`).join("")}amix=inputs=${timeline.audioTracks.length}:normalize=0,` +
      `loudnorm=I=-22:TP=-1.8:LRA=10,alimiter=limit=0.92[musicbed]`
  );

  return {
    filterComplex: filterChains.join(";"),
    outputLabel: "[musicbed]"
  };
}

export function buildFinalAudioMixGraph(
  mode: "music-only" | "source-only" | "source+music",
  emphasis: AudioEmphasis = "balanced"
) {
  switch (mode) {
    case "source-only":
      return {
        filterComplex:
          "[0:a]acompressor=threshold=-18dB:ratio=1.8:attack=14:release=180:makeup=1.2," +
          "loudnorm=I=-15:TP=-1.2:LRA=8,alimiter=limit=0.97[finalmix]",
        outputLabel: "[finalmix]"
      };
    case "source+music":
      {
        const weights =
          emphasis === "music-forward"
            ? "1 1.05"
            : emphasis === "original-audio-forward"
              ? "1 1.65"
              : "1 1.35";
        const threshold =
          emphasis === "music-forward" ? "0.024" : emphasis === "original-audio-forward" ? "0.012" : "0.017";
        return {
          filterComplex:
            `[0:a][1:a]sidechaincompress=threshold=${threshold}:ratio=10:attack=20:release=320:makeup=1[duckedmusic];` +
            `[duckedmusic][1:a]amix=inputs=2:weights='${weights}':normalize=0,` +
            "loudnorm=I=-14:TP=-1.1:LRA=8,alimiter=limit=0.97[finalmix]",
          outputLabel: "[finalmix]"
        };
      }
    default:
      return {
        filterComplex:
          "[0:a]loudnorm=I=-16:TP=-1.2:LRA=9,alimiter=limit=0.95[finalmix]",
        outputLabel: "[finalmix]"
      };
  }
}
