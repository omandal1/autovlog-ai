import { mkdir, writeFile } from "fs/promises";
import path from "path";

import type { VlogVibe } from "@/lib/types";

type Waveform = "sine" | "triangle" | "saw" | "square";
type Groove = "driving" | "floating" | "steady" | "anthemic";
type ScaleMode = "major" | "minor" | "dorian";

interface StereoBuffer {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

interface TrackRecipe {
  id: string;
  title: string;
  category: VlogVibe;
  bpm: number;
  bars: number;
  mode: ScaleMode;
  groove: Groove;
  progression: number[][];
  leadWaveform: Waveform;
  bassWaveform: Waveform;
  padWaveform: Waveform;
  leadOctaveShift: number;
  bassOctaveShift: number;
  ambientNoise: number;
  sparkleGain: number;
  delayMs: number;
  delayFeedback: number;
  masterGain: number;
}

interface NoteConfig {
  startSec: number;
  durationSec: number;
  midi: number;
  gain: number;
  pan: number;
  waveform: Waveform;
  attackSec: number;
  decaySec: number;
  sustainLevel: number;
  releaseSec: number;
  vibratoHz?: number;
  vibratoDepthCents?: number;
}

const SAMPLE_RATE = 48_000;
const BEATS_PER_BAR = 4;
const STEPS_PER_BAR = 16;
const SCALE_INTERVALS: Record<ScaleMode, number[]> = {
  major: [0, 2, 4, 7, 9, 12, 14],
  minor: [0, 3, 5, 7, 10, 12, 15],
  dorian: [0, 2, 3, 7, 9, 12, 14]
};

const GROOVE_PATTERNS: Record<
  Groove,
  {
    leadDegrees: Array<number | null>;
    bassOffsets: Array<number | null>;
    kick: number[];
    snare: number[];
    hat: number[];
    shaker: number[];
    swing: number;
    hatDecaySec: number;
  }
> = {
  driving: {
    leadDegrees: [0, null, 2, 4, 2, null, 4, 5, 4, 2, null, 6, 5, 4, 2, null],
    bassOffsets: [0, null, 7, null, 0, null, 7, null, 0, null, 10, null, 7, null, 5, null],
    kick: [1, 0, 0.2, 0, 0.85, 0, 0.2, 0, 1, 0, 0.24, 0, 0.92, 0, 0.3, 0],
    snare: [0, 0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0, 0, 0.82, 0, 0, 0],
    hat: [0.35, 0.08, 0.28, 0.08, 0.32, 0.08, 0.28, 0.08, 0.35, 0.08, 0.28, 0.08, 0.32, 0.08, 0.28, 0.12],
    shaker: [0, 0.08, 0, 0.06, 0, 0.08, 0, 0.06, 0, 0.08, 0, 0.06, 0, 0.08, 0, 0.1],
    swing: 0.06,
    hatDecaySec: 0.04
  },
  floating: {
    leadDegrees: [0, null, null, 2, null, 4, null, null, 5, null, null, 4, null, 2, null, null],
    bassOffsets: [0, null, null, null, 7, null, null, null, 0, null, null, null, 5, null, null, null],
    kick: [0.62, 0, 0, 0, 0, 0, 0, 0, 0.28, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 0.34, 0, 0, 0, 0, 0, 0, 0, 0.42, 0, 0, 0],
    hat: [0.09, 0, 0.05, 0, 0.1, 0, 0.05, 0, 0.09, 0, 0.05, 0, 0.1, 0, 0.05, 0],
    shaker: [0.02, 0, 0.04, 0, 0.03, 0, 0.04, 0, 0.02, 0, 0.04, 0, 0.03, 0, 0.04, 0],
    swing: 0.02,
    hatDecaySec: 0.06
  },
  steady: {
    leadDegrees: [0, null, 2, null, 4, null, 2, null, 5, null, 4, null, 2, null, 0, null],
    bassOffsets: [0, null, 7, null, 0, null, 7, null, 0, null, 7, null, 5, null, 7, null],
    kick: [0.88, 0, 0.1, 0, 0.32, 0, 0.08, 0, 0.84, 0, 0.12, 0, 0.28, 0, 0.08, 0],
    snare: [0, 0, 0, 0, 0.56, 0, 0, 0, 0, 0, 0, 0, 0.62, 0, 0, 0],
    hat: [0.16, 0.05, 0.12, 0.05, 0.18, 0.05, 0.12, 0.05, 0.16, 0.05, 0.12, 0.05, 0.18, 0.05, 0.12, 0.07],
    shaker: [0, 0.05, 0, 0.04, 0, 0.05, 0, 0.04, 0, 0.05, 0, 0.04, 0, 0.05, 0, 0.06],
    swing: 0.04,
    hatDecaySec: 0.05
  },
  anthemic: {
    leadDegrees: [0, 2, 4, 5, 4, 2, 0, null, 4, 5, 6, 5, 4, 2, 0, null],
    bassOffsets: [0, null, 7, null, 0, null, 7, null, 0, null, 12, null, 7, null, 5, null],
    kick: [1, 0, 0.18, 0, 0.4, 0, 0.18, 0, 0.96, 0, 0.16, 0, 0.42, 0, 0.18, 0],
    snare: [0, 0, 0, 0, 0.64, 0, 0, 0, 0, 0, 0, 0, 0.72, 0, 0, 0],
    hat: [0.22, 0.06, 0.18, 0.06, 0.22, 0.06, 0.18, 0.06, 0.22, 0.06, 0.18, 0.06, 0.22, 0.06, 0.18, 0.08],
    shaker: [0, 0.04, 0, 0.04, 0, 0.04, 0, 0.04, 0, 0.04, 0, 0.04, 0, 0.04, 0, 0.04],
    swing: 0.03,
    hatDecaySec: 0.05
  }
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function createStereoBuffer(durationSec: number): StereoBuffer {
  const sampleCount = Math.max(1, Math.round(durationSec * SAMPLE_RATE));
  return {
    left: new Float32Array(sampleCount),
    right: new Float32Array(sampleCount),
    sampleRate: SAMPLE_RATE
  };
}

function waveformSample(type: Waveform, phase: number) {
  const wrapped = phase - Math.floor(phase);
  switch (type) {
    case "triangle":
      return 1 - 4 * Math.abs(wrapped - 0.5);
    case "saw":
      return 2 * wrapped - 1;
    case "square":
      return wrapped < 0.5 ? 1 : -1;
    default:
      return Math.sin(phase * Math.PI * 2);
  }
}

function panGains(pan: number) {
  const normalized = clamp((pan + 1) / 2, 0, 1);
  return {
    left: Math.cos(normalized * Math.PI * 0.5),
    right: Math.sin(normalized * Math.PI * 0.5)
  };
}

function envelopeSample(
  elapsedSec: number,
  durationSec: number,
  attackSec: number,
  decaySec: number,
  sustainLevel: number,
  releaseSec: number
) {
  if (elapsedSec < 0 || elapsedSec >= durationSec) {
    return 0;
  }

  const releaseStart = Math.max(attackSec + decaySec, durationSec - releaseSec);
  if (elapsedSec < attackSec) {
    return clamp(elapsedSec / Math.max(attackSec, 0.0001), 0, 1);
  }
  if (elapsedSec < attackSec + decaySec) {
    const progress = (elapsedSec - attackSec) / Math.max(decaySec, 0.0001);
    return 1 - progress * (1 - sustainLevel);
  }
  if (elapsedSec < releaseStart) {
    return sustainLevel;
  }

  const releaseProgress = (elapsedSec - releaseStart) / Math.max(releaseSec, 0.0001);
  return sustainLevel * (1 - clamp(releaseProgress, 0, 1));
}

function addNote(buffer: StereoBuffer, config: NoteConfig) {
  const startIndex = Math.max(0, Math.floor(config.startSec * buffer.sampleRate));
  const endIndex = Math.min(
    buffer.left.length,
    Math.ceil((config.startSec + config.durationSec) * buffer.sampleRate)
  );
  const { left: leftGain, right: rightGain } = panGains(config.pan);
  const baseFrequency = midiToFrequency(config.midi);
  const detunedFrequency = baseFrequency * 1.0035;

  for (let index = startIndex; index < endIndex; index += 1) {
    const elapsedSec = index / buffer.sampleRate - config.startSec;
    const envelope = envelopeSample(
      elapsedSec,
      config.durationSec,
      config.attackSec,
      config.decaySec,
      config.sustainLevel,
      config.releaseSec
    );
    if (envelope <= 0) {
      continue;
    }

    const vibrato =
      config.vibratoHz && config.vibratoDepthCents
        ? Math.sin(elapsedSec * config.vibratoHz * Math.PI * 2) *
          (config.vibratoDepthCents / 1200)
        : 0;
    const currentFrequency = baseFrequency * 2 ** vibrato;
    const detunedCurrentFrequency = detunedFrequency * 2 ** vibrato;
    const phase = elapsedSec * currentFrequency;
    const detunedPhase = elapsedSec * detunedCurrentFrequency;
    const body =
      waveformSample(config.waveform, phase) * 0.74 +
      waveformSample(config.waveform, detunedPhase) * 0.26;
    const harmonic =
      waveformSample("sine", phase * 2) * 0.14 +
      waveformSample("triangle", phase * 0.5) * 0.08;
    const sample = (body + harmonic) * envelope * config.gain;

    buffer.left[index] += sample * leftGain;
    buffer.right[index] += sample * rightGain;
  }
}

function addChord(
  buffer: StereoBuffer,
  chord: number[],
  startSec: number,
  durationSec: number,
  waveform: Waveform,
  gain: number,
  panSpread: number
) {
  chord.forEach((midi, index) => {
    addNote(buffer, {
      startSec,
      durationSec,
      midi,
      gain,
      pan: clamp((index - (chord.length - 1) / 2) * panSpread, -1, 1),
      waveform,
      attackSec: 0.16,
      decaySec: 0.55,
      sustainLevel: 0.72,
      releaseSec: 0.42,
      vibratoHz: 0.24,
      vibratoDepthCents: 3
    });
  });
}

function addKick(buffer: StereoBuffer, startSec: number, gain: number) {
  const durationSec = 0.24;
  const startIndex = Math.max(0, Math.floor(startSec * buffer.sampleRate));
  const endIndex = Math.min(
    buffer.left.length,
    Math.ceil((startSec + durationSec) * buffer.sampleRate)
  );

  for (let index = startIndex; index < endIndex; index += 1) {
    const elapsedSec = index / buffer.sampleRate - startSec;
    const progress = elapsedSec / durationSec;
    const frequency = 135 - progress * 95;
    const amplitude = Math.exp(-elapsedSec * 20) * gain;
    const click = Math.exp(-elapsedSec * 45) * 0.18 * Math.sin(elapsedSec * 1200);
    const sample = Math.sin(elapsedSec * frequency * Math.PI * 2) * amplitude + click;
    buffer.left[index] += sample;
    buffer.right[index] += sample;
  }
}

function addSnare(buffer: StereoBuffer, startSec: number, gain: number) {
  const durationSec = 0.18;
  const startIndex = Math.max(0, Math.floor(startSec * buffer.sampleRate));
  const endIndex = Math.min(
    buffer.left.length,
    Math.ceil((startSec + durationSec) * buffer.sampleRate)
  );

  for (let index = startIndex; index < endIndex; index += 1) {
    const elapsedSec = index / buffer.sampleRate - startSec;
    const noise = (Math.random() * 2 - 1) * Math.exp(-elapsedSec * 26) * gain * 0.62;
    const body = Math.sin(elapsedSec * 190 * Math.PI * 2) * Math.exp(-elapsedSec * 18) * gain * 0.22;
    const sample = noise + body;
    buffer.left[index] += sample;
    buffer.right[index] += sample;
  }
}

function addHat(buffer: StereoBuffer, startSec: number, gain: number, decaySec: number) {
  const durationSec = Math.max(0.03, decaySec);
  const startIndex = Math.max(0, Math.floor(startSec * buffer.sampleRate));
  const endIndex = Math.min(
    buffer.left.length,
    Math.ceil((startSec + durationSec) * buffer.sampleRate)
  );

  for (let index = startIndex; index < endIndex; index += 1) {
    const elapsedSec = index / buffer.sampleRate - startSec;
    const noise = (Math.random() * 2 - 1) * Math.exp(-elapsedSec * 42) * gain;
    const left = noise * 0.85 + Math.sin(elapsedSec * 6400) * gain * 0.08;
    const right = noise * 0.78 + Math.sin(elapsedSec * 7100) * gain * 0.08;
    buffer.left[index] += left;
    buffer.right[index] += right;
  }
}

function addAmbientNoise(buffer: StereoBuffer, amount: number) {
  if (amount <= 0) {
    return;
  }

  let previousLeft = 0;
  let previousRight = 0;
  for (let index = 0; index < buffer.left.length; index += 1) {
    previousLeft = previousLeft * 0.98 + (Math.random() * 2 - 1) * amount;
    previousRight = previousRight * 0.98 + (Math.random() * 2 - 1) * amount;
    buffer.left[index] += previousLeft * 0.12;
    buffer.right[index] += previousRight * 0.12;
  }
}

function applyStereoDelay(buffer: StereoBuffer, delayMs: number, feedback: number) {
  const delaySamples = Math.max(1, Math.round((delayMs / 1000) * buffer.sampleRate));
  for (let index = delaySamples; index < buffer.left.length; index += 1) {
    buffer.left[index] += buffer.right[index - delaySamples] * feedback;
    buffer.right[index] += buffer.left[index - delaySamples] * feedback;
  }
}

function normalizeBuffer(buffer: StereoBuffer, targetPeak = 0.82) {
  let peak = 0.0001;
  for (let index = 0; index < buffer.left.length; index += 1) {
    peak = Math.max(peak, Math.abs(buffer.left[index]), Math.abs(buffer.right[index]));
  }

  const gain = targetPeak / peak;
  for (let index = 0; index < buffer.left.length; index += 1) {
    buffer.left[index] = Math.tanh(buffer.left[index] * gain);
    buffer.right[index] = Math.tanh(buffer.right[index] * gain);
  }
}

function writeWavBuffer(buffer: StereoBuffer) {
  const dataSize = buffer.left.length * 4;
  const fileBuffer = Buffer.alloc(44 + dataSize);
  fileBuffer.write("RIFF", 0);
  fileBuffer.writeUInt32LE(36 + dataSize, 4);
  fileBuffer.write("WAVE", 8);
  fileBuffer.write("fmt ", 12);
  fileBuffer.writeUInt32LE(16, 16);
  fileBuffer.writeUInt16LE(1, 20);
  fileBuffer.writeUInt16LE(2, 22);
  fileBuffer.writeUInt32LE(buffer.sampleRate, 24);
  fileBuffer.writeUInt32LE(buffer.sampleRate * 4, 28);
  fileBuffer.writeUInt16LE(4, 32);
  fileBuffer.writeUInt16LE(16, 34);
  fileBuffer.write("data", 36);
  fileBuffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let index = 0; index < buffer.left.length; index += 1) {
    const leftSample = Math.round(clamp(buffer.left[index], -1, 1) * 32_767);
    const rightSample = Math.round(clamp(buffer.right[index], -1, 1) * 32_767);
    fileBuffer.writeInt16LE(leftSample, offset);
    fileBuffer.writeInt16LE(rightSample, offset + 2);
    offset += 4;
  }

  return fileBuffer;
}

function getBarStartSec(barIndex: number, bpm: number) {
  return (barIndex * BEATS_PER_BAR * 60) / bpm;
}

function getStepDurationSec(bpm: number) {
  return (60 / bpm) / 4;
}

function applyGroove(track: TrackRecipe, buffer: StereoBuffer) {
  const groove = GROOVE_PATTERNS[track.groove];
  const stepDurationSec = getStepDurationSec(track.bpm);
  const scale = SCALE_INTERVALS[track.mode];

  for (let barIndex = 0; barIndex < track.bars; barIndex += 1) {
    const chord = track.progression[barIndex % track.progression.length]!;
    const root = chord[0]!;
    const barStartSec = getBarStartSec(barIndex, track.bpm);

    addChord(
      buffer,
      chord,
      barStartSec,
      (60 / track.bpm) * BEATS_PER_BAR,
      track.padWaveform,
      0.075 * track.masterGain,
      0.32
    );
    addChord(
      buffer,
      chord.map((note) => note + 12),
      barStartSec,
      (60 / track.bpm) * BEATS_PER_BAR,
      "sine",
      track.sparkleGain,
      0.42
    );

    for (let stepIndex = 0; stepIndex < STEPS_PER_BAR; stepIndex += 1) {
      const swingOffset =
        stepIndex % 2 === 1 ? stepDurationSec * groove.swing : 0;
      const stepStartSec = barStartSec + stepIndex * stepDurationSec + swingOffset;
      const beatStrength = stepIndex % 4 === 0 ? 1 : 0.72;

      const kickLevel = groove.kick[stepIndex] ?? 0;
      if (kickLevel > 0) {
        addKick(buffer, stepStartSec, kickLevel * 0.26 * track.masterGain);
      }

      const snareLevel = groove.snare[stepIndex] ?? 0;
      if (snareLevel > 0) {
        addSnare(buffer, stepStartSec, snareLevel * 0.22 * track.masterGain);
      }

      const hatLevel = groove.hat[stepIndex] ?? 0;
      if (hatLevel > 0) {
        addHat(buffer, stepStartSec, hatLevel * 0.12 * track.masterGain, groove.hatDecaySec);
      }

      const shakerLevel = groove.shaker[stepIndex] ?? 0;
      if (shakerLevel > 0) {
        addHat(buffer, stepStartSec + 0.01, shakerLevel * 0.08 * track.masterGain, 0.03);
      }

      const bassOffset = groove.bassOffsets[stepIndex];
      if (bassOffset !== null && bassOffset !== undefined) {
        addNote(buffer, {
          startSec: stepStartSec,
          durationSec: stepDurationSec * 1.6,
          midi: root + bassOffset + track.bassOctaveShift,
          gain: 0.12 * beatStrength * track.masterGain,
          pan: -0.05,
          waveform: track.bassWaveform,
          attackSec: 0.01,
          decaySec: 0.16,
          sustainLevel: 0.68,
          releaseSec: 0.12
        });
      }

      const leadDegree = groove.leadDegrees[stepIndex];
      if (leadDegree !== null && leadDegree !== undefined) {
        const scaleOffset = scale[leadDegree % scale.length] ?? scale[0];
        addNote(buffer, {
          startSec: stepStartSec,
          durationSec: stepDurationSec * 0.92,
          midi: root + scaleOffset + track.leadOctaveShift,
          gain: 0.065 * beatStrength * track.masterGain,
          pan: Math.sin((barIndex * STEPS_PER_BAR + stepIndex) * 0.42) * 0.38,
          waveform: track.leadWaveform,
          attackSec: 0.012,
          decaySec: 0.12,
          sustainLevel: 0.58,
          releaseSec: 0.16,
          vibratoHz: 4.8,
          vibratoDepthCents: 6
        });
      }
    }
  }
}

export function createMusicRecipeSet() {
  const recipes: TrackRecipe[] = [
    {
      id: "energetic-city-lights",
      title: "City Lights",
      category: "energetic",
      bpm: 128,
      bars: 12,
      mode: "major",
      groove: "driving",
      progression: [[57, 61, 64], [52, 56, 59], [54, 57, 61], [50, 54, 57]],
      leadWaveform: "saw",
      bassWaveform: "triangle",
      padWaveform: "triangle",
      leadOctaveShift: 12,
      bassOctaveShift: -12,
      ambientNoise: 0.0022,
      sparkleGain: 0.016,
      delayMs: 160,
      delayFeedback: 0.16,
      masterGain: 1,
    },
    {
      id: "energetic-sunrise-run",
      title: "Sunrise Run",
      category: "energetic",
      bpm: 132,
      bars: 12,
      mode: "dorian",
      groove: "anthemic",
      progression: [[59, 62, 66], [55, 59, 62], [57, 60, 64], [54, 57, 61]],
      leadWaveform: "square",
      bassWaveform: "saw",
      padWaveform: "triangle",
      leadOctaveShift: 12,
      bassOctaveShift: -12,
      ambientNoise: 0.0018,
      sparkleGain: 0.014,
      delayMs: 145,
      delayFeedback: 0.13,
      masterGain: 1
    },
    {
      id: "emotional-yearbook",
      title: "Yearbook Glow",
      category: "emotional",
      bpm: 90,
      bars: 8,
      mode: "major",
      groove: "floating",
      progression: [[60, 64, 67], [57, 60, 64], [55, 59, 62], [53, 57, 60]],
      leadWaveform: "sine",
      bassWaveform: "triangle",
      padWaveform: "saw",
      leadOctaveShift: 12,
      bassOctaveShift: -12,
      ambientNoise: 0.0026,
      sparkleGain: 0.018,
      delayMs: 280,
      delayFeedback: 0.22,
      masterGain: 0.94
    },
    {
      id: "emotional-fall-letter",
      title: "Fall Letter",
      category: "emotional",
      bpm: 84,
      bars: 8,
      mode: "minor",
      groove: "floating",
      progression: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [55, 58, 62]],
      leadWaveform: "triangle",
      bassWaveform: "sine",
      padWaveform: "triangle",
      leadOctaveShift: 12,
      bassOctaveShift: -12,
      ambientNoise: 0.0032,
      sparkleGain: 0.02,
      delayMs: 320,
      delayFeedback: 0.24,
      masterGain: 0.92
    },
    {
      id: "chill-dorm-window",
      title: "Dorm Window",
      category: "chill",
      bpm: 86,
      bars: 10,
      mode: "dorian",
      groove: "steady",
      progression: [[57, 60, 64], [60, 64, 67], [55, 59, 62], [53, 57, 60]],
      leadWaveform: "triangle",
      bassWaveform: "triangle",
      padWaveform: "sine",
      leadOctaveShift: 12,
      bassOctaveShift: -12,
      ambientNoise: 0.004,
      sparkleGain: 0.012,
      delayMs: 260,
      delayFeedback: 0.2,
      masterGain: 0.9
    },
    {
      id: "chill-night-drive",
      title: "Night Drive",
      category: "chill",
      bpm: 82,
      bars: 10,
      mode: "minor",
      groove: "steady",
      progression: [[55, 58, 62], [57, 60, 64], [52, 55, 59], [53, 57, 60]],
      leadWaveform: "sine",
      bassWaveform: "triangle",
      padWaveform: "saw",
      leadOctaveShift: 12,
      bassOctaveShift: -12,
      ambientNoise: 0.0046,
      sparkleGain: 0.012,
      delayMs: 300,
      delayFeedback: 0.18,
      masterGain: 0.88
    },
    {
      id: "cinematic-campus-rise",
      title: "Campus Rise",
      category: "cinematic",
      bpm: 98,
      bars: 10,
      mode: "minor",
      groove: "anthemic",
      progression: [[50, 53, 57], [55, 58, 62], [57, 60, 64], [53, 57, 60]],
      leadWaveform: "triangle",
      bassWaveform: "saw",
      padWaveform: "saw",
      leadOctaveShift: 12,
      bassOctaveShift: -12,
      ambientNoise: 0.0028,
      sparkleGain: 0.02,
      delayMs: 240,
      delayFeedback: 0.22,
      masterGain: 0.96
    },
    {
      id: "cinematic-afterglow",
      title: "Afterglow Hall",
      category: "cinematic",
      bpm: 102,
      bars: 10,
      mode: "major",
      groove: "floating",
      progression: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]],
      leadWaveform: "sine",
      bassWaveform: "triangle",
      padWaveform: "triangle",
      leadOctaveShift: 12,
      bassOctaveShift: -12,
      ambientNoise: 0.0024,
      sparkleGain: 0.019,
      delayMs: 250,
      delayFeedback: 0.2,
      masterGain: 0.94
    }
  ];

  return recipes.map((recipe) => ({
    ...recipe,
    durationSec: Number(((recipe.bars * BEATS_PER_BAR * 60) / recipe.bpm).toFixed(2))
  }));
}

export async function synthesizeMusicTrack(
  recipe: TrackRecipe & { durationSec: number },
  outputPath: string
) {
  const buffer = createStereoBuffer(recipe.durationSec);
  applyGroove(recipe, buffer);
  addAmbientNoise(buffer, recipe.ambientNoise);
  applyStereoDelay(buffer, recipe.delayMs, recipe.delayFeedback);
  normalizeBuffer(buffer);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, writeWavBuffer(buffer));
}
