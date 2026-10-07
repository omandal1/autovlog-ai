import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface LegacyProjectShape {
  id?: string;
  ownerUserId?: string;
  name?: string;
  createdAt?: string;
  settings?: {
    generation?: {
      generationMode?: string;
    };
  };
}

async function main() {
  const legacyRoot = path.resolve(
    process.cwd(),
    process.env.LEGACY_STORAGE_ROOT ?? "storage/projects"
  );
  const entries = await readdir(legacyRoot, { withFileTypes: true }).catch(() => []);
  const projects: Array<{
    id: string;
    name: string;
    ownerState: "owned-legacy" | "unowned";
    generationMode: string;
    createdAt?: string;
  }> = [];
  const malformed: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const raw = JSON.parse(
        await readFile(path.join(legacyRoot, entry.name, "project.json"), "utf8")
      ) as LegacyProjectShape;
      projects.push({
        id: raw.id || entry.name,
        name: raw.name || "Untitled legacy project",
        ownerState: raw.ownerUserId ? "owned-legacy" : "unowned",
        generationMode: raw.settings?.generation?.generationMode || "memory-book",
        createdAt: raw.createdAt
      });
    } catch {
      malformed.push(entry.name);
    }
  }

  const report = {
    legacyRoot,
    total: projects.length,
    unowned: projects.filter((project) => project.ownerState === "unowned").length,
    ownedLegacy: projects.filter((project) => project.ownerState === "owned-legacy").length,
    unknownModes: projects.filter(
      (project) => !["memory-book", "diary-notebook", "wall-frame"].includes(project.generationMode)
    ).length,
    malformed,
    projects
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Legacy project root: ${legacyRoot}`);
  console.log(
    `Found ${report.total} readable projects (${report.unowned} unowned, ${report.ownedLegacy} with a legacy owner).`
  );
  console.log(`Projects with removed or unknown generation modes: ${report.unknownModes}.`);
  if (malformed.length) {
    console.log(`Skipped ${malformed.length} malformed project directories.`);
  }
  console.log(
    "This audit is read-only. Legacy projects are never attached to a Firebase user automatically; keep them untouched until ownership is explicitly verified."
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
