import { readdir, readFile, stat } from "fs/promises";
import path from "path";

import {
  createProjectFromFiles,
  enqueueProjectProcessing,
  getProject,
  renderSelectedPreview
} from "../lib/project-service";
import type { ClipDensity, MusicStyle, Tone } from "../lib/types";

const mimeByExt: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo"
};

async function main() {
  const inputDir = process.argv[2];
  const tone = (process.argv[3] as Tone | undefined) ?? "balanced";
  const clipDensity = (process.argv[4] as ClipDensity | undefined) ?? "fast-cuts";
  const musicStyle = (process.argv[5] as MusicStyle | undefined) ?? "cinematic";

  if (!inputDir) {
    throw new Error("Usage: npm run demo -- <media-directory> [tone] [clipDensity] [musicStyle]");
  }

  const absoluteInputDir = path.resolve(process.cwd(), inputDir);
  const fileNames = await readdir(absoluteInputDir);
  const files: File[] = [];

  for (const fileName of fileNames) {
    const filePath = path.join(absoluteInputDir, fileName);
    const extension = path.extname(fileName).toLowerCase();
    const buffer = await readFile(filePath);
    const fileStats = await stat(filePath);
    files.push(
      new File([buffer], fileName, {
        type: mimeByExt[extension] ?? "application/octet-stream",
        lastModified: fileStats.mtimeMs
      })
    );
  }

  const project = await createProjectFromFiles(files, {
    tone,
    clipDensity,
    musicStyle,
    generation: {
      generationMode: "memory-book",
      storyStyle: tone === "energetic" ? "energetic" : tone === "emotional" ? "emotional" : "balanced",
      subjectEmphasis: "balanced",
      audioEmphasis: "balanced",
      pacing: clipDensity === "slow-cuts" ? "slow-sentimental" : "fast",
      ordering: "mostly-chronological",
      themePreset: "scrapbook",
      titleStyle: "nostalgic",
      decorationLevel: "balanced",
      aspectRatio: "landscape-16x9"
    }
  });
  await enqueueProjectProcessing(project.id);
  const previewed = await getProject(project.id);
  if (previewed.previewPlans?.length) {
    await renderSelectedPreview(previewed.id, previewed.selectedPlanId);
  }
  const completed = await getProject(project.id);

  console.log(`Project: ${completed.id}`);
  console.log(`Status: ${completed.status}`);
  console.log(`Preview plans: ${completed.previewPlans?.length ?? 0}`);
  console.log(`Outputs:`);
  for (const output of completed.outputs) {
    console.log(`- ${output.title}: ${output.outputPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
