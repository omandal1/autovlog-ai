import { NextResponse } from "next/server";

import { getOptionalSessionUser } from "@/lib/auth/session";
import { createProjectFromFiles, listProjectsForUser } from "@/lib/project-service";
import { normalizeProjectSettings } from "@/lib/user-controls/generation-settings";
import type {
  AudioEmphasis,
  ClipDensity,
  DecorationLevel,
  MusicSelectionSettings,
  MusicStyle,
  OrderingPreference,
  PacingMode,
  StoryStyle,
  SubjectEmphasis,
  ThemePreset,
  TitleStyle,
  Tone
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSettings(formData: FormData) {
  const musicSelection: MusicSelectionSettings | undefined =
    formData.get("musicSourcePolicy") === "user-uploaded-audio"
      ? {
          sourcePolicy: "user-uploaded-audio",
          exportPolicy: "direct-user-audio",
          note: "Uploaded MP3 tracks will be used exclusively for the final soundtrack.",
          uploadedSoundtracks: [],
          preferredTrackOrder: [],
          soundtrackStrategy: "auto-select-best-segments"
        }
      : undefined;

  return normalizeProjectSettings({
    tone: (formData.get("tone") as Tone | null) ?? "balanced",
    clipDensity: (formData.get("clipDensity") as ClipDensity | null) ?? "fast-cuts",
    musicStyle: (formData.get("musicStyle") as MusicStyle | null) ?? "cinematic",
    musicSelection,
    generation: {
      generationMode: "memory-book",
      storyStyle: (formData.get("storyStyle") as StoryStyle | null) ?? "balanced",
      subjectEmphasis:
        (formData.get("subjectEmphasis") as SubjectEmphasis | null) ?? "balanced",
      audioEmphasis:
        (formData.get("audioEmphasis") as AudioEmphasis | null) ?? "balanced",
      pacing: (formData.get("pacing") as PacingMode | null) ?? "balanced",
      ordering:
        (formData.get("ordering") as OrderingPreference | null) ?? "mostly-chronological",
      themePreset: (formData.get("themePreset") as ThemePreset | null) ?? "scrapbook",
      titleStyle: (formData.get("titleStyle") as TitleStyle | null) ?? "nostalgic",
      decorationLevel:
        (formData.get("decorationLevel") as DecorationLevel | null) ?? "balanced",
      aspectRatio: "landscape-16x9"
    }
  });
}

export async function GET() {
  const user = await getOptionalSessionUser();
  const projects = await listProjectsForUser(user?.id);
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const user = await getOptionalSessionUser();
    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);
    const soundtrackFiles = formData
      .getAll("soundtracks")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    const project = await createProjectFromFiles(files, parseSettings(formData), {
      ownerUserId: user?.id,
      soundtrackFiles
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create project."
      },
      { status: 400 }
    );
  }
}
