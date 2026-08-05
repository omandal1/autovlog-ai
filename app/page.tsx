import Link from "next/link";

import { AccountPanel } from "@/components/account-panel";
import { ProjectUploader } from "@/components/project-uploader";
import { MAX_PROJECT_CHAPTERS, MIN_PROJECT_CHAPTERS } from "@/lib/constants";
import { getOptionalSessionUser } from "@/lib/auth/session";
import { listProjectsForUser } from "@/lib/project-service";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getOptionalSessionUser();
  const projects = await listProjectsForUser(user?.id);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-10 md:px-8">
      <div className="space-y-10">
        <header className="max-w-4xl">
          <p className="text-xs uppercase tracking-[0.45em] text-orange-200/80">AutoVlog AI V2</p>
          <h1
            className="mt-4 text-5xl text-white md:text-7xl"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Turn a semester of photos and clips into a polished college vlog.
          </h1>
          <p className="mt-4 text-lg text-slate-300 md:text-xl">
            Ingests 100 to 300 mixed uploads, analyzes story signals, builds preview variants,
            and renders a five-minute recap plus {MIN_PROJECT_CHAPTERS} to {MAX_PROJECT_CHAPTERS}{" "}
            chapter mini-vlogs with FFmpeg after you steer the final cut, connect your account,
            and optionally upload MP3 soundtracks for the final mix.
          </p>
        </header>

        <AccountPanel />

        <ProjectUploader />

        <section className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-white">
              {user ? "Your saved projects" : "Recent local projects"}
            </h2>
            <p className="text-sm text-slate-400">
              {user ? `${projects.length} linked to your account` : `${projects.length} stored locally`}
            </p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 transition hover:border-orange-300/30 hover:bg-white/10"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="rounded-full bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
                    {project.status}
                  </span>
                  <span className="text-xs text-slate-400">{project.assetCount} assets</span>
                </div>
                <h3
                  className="mt-4 text-2xl text-white"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {project.name}
                </h3>
                <p className="mt-3 text-sm text-slate-400">
                  {formatDate(project.createdAt)} · stage {project.stage}
                </p>
              </Link>
            ))}

            {!projects.length ? (
              <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-400">
                Your rendered recap projects will appear here after the first upload.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
