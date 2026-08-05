import { readProjectRecord } from "@/storage/local-storage";
import {
  processProject,
  renderSelectedPreview
} from "@/lib/project-service";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatOutputs(project: Awaited<ReturnType<typeof readProjectRecord>>) {
  return project.outputs.map((output) => ({
    id: output.id,
    kind: output.kind,
    title: output.title,
    path: output.outputPath
  }));
}

async function waitForPreview(projectId: string) {
  let attemptedRepair = false;

  for (;;) {
    const project = await readProjectRecord(projectId);
    const previewCount = project.previewPlans?.length ?? 0;
    const outputCount = project.outputs?.length ?? 0;
    console.log(
      `[${new Date().toISOString()}] status=${project.status} stage=${project.stage} previews=${previewCount} outputs=${outputCount}`
    );

    if (project.stage === "complete" && outputCount > 0) {
      return project;
    }

    if (previewCount > 0) {
      return project;
    }

    if (project.stage === "failed") {
      if (attemptedRepair) {
        throw new Error(project.error ?? "Project failed while rebuilding previews.");
      }
      attemptedRepair = true;
      console.log(`[${new Date().toISOString()}] Preview rebuild failed; retrying project processing once.`);
      await processProject(projectId);
      continue;
    }

    if (project.status === "uploaded" || project.stage === "queued") {
      if (!attemptedRepair) {
        attemptedRepair = true;
        console.log(`[${new Date().toISOString()}] Project is queued without a local worker; starting processing.`);
        await processProject(projectId);
        continue;
      }
    }

    await sleep(30_000);
  }
}

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    throw new Error("Usage: process-and-render-project <projectId>");
  }

  const previewProject = await waitForPreview(projectId);
  if (previewProject.stage === "complete" && previewProject.outputs.length > 0) {
    console.log(`[${new Date().toISOString()}] Project already complete.`);
    console.log(JSON.stringify(formatOutputs(previewProject), null, 2));
    return;
  }

  const plan =
    previewProject.previewPlans?.find((candidate) => candidate.id === previewProject.selectedPlanId) ??
    previewProject.previewPlans?.find((candidate) => candidate.isPrimary) ??
    previewProject.previewPlans?.[0];

  if (!plan) {
    throw new Error("No preview plan is available to render.");
  }

  console.log(`[${new Date().toISOString()}] Rendering selected plan ${plan.id} (${plan.variantLabel}).`);
  const rendered = await renderSelectedPreview(projectId, plan.id, previewProject.ownerUserId);
  console.log(`[${new Date().toISOString()}] Render complete.`);
  console.log(JSON.stringify(formatOutputs(rendered), null, 2));
}

main().catch((error) => {
  console.error(`[${new Date().toISOString()}] Overnight render failed.`);
  console.error(error);
  process.exit(1);
});
