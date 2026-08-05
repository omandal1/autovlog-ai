import { existsSync } from "fs";
import path from "path";

import type { VlogVibe } from "@/lib/types";

import { createMusicRecipeSet, synthesizeMusicTrack } from "@/lib/audio/synth";

export interface MusicLibraryTrack {
  id: string;
  title: string;
  category: VlogVibe;
  durationSec: number;
  sourcePath: string;
  bpm: number;
}

const MUSIC_LIBRARY_ROOT = path.resolve(process.cwd(), "assets", "music");

function buildTrackDefinitions() {
  return createMusicRecipeSet().map((recipe) => ({
    ...recipe,
    sourcePath: path.join(MUSIC_LIBRARY_ROOT, recipe.category, `${recipe.id}.wav`)
  }));
}

export function getMusicLibraryRoot() {
  return MUSIC_LIBRARY_ROOT;
}

export async function ensureMusicLibrary() {
  const definitions = buildTrackDefinitions();

  for (const definition of definitions) {
    if (!existsSync(definition.sourcePath)) {
      await synthesizeMusicTrack(definition, definition.sourcePath);
    }
  }

  return definitions satisfies MusicLibraryTrack[];
}

export async function getMusicTracksForCategory(category: VlogVibe) {
  const library = await ensureMusicLibrary();
  const matches = library.filter((track) => track.category === category);
  if (matches.length) {
    return matches;
  }
  return library.filter((track) => track.category === "cinematic");
}

export async function getDefaultMusicTrack() {
  const library = await ensureMusicLibrary();
  return library.find((track) => track.category === "cinematic") ?? library[0]!;
}
