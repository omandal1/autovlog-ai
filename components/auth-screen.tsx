"use client";

import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth-provider";
import { readableAuthError } from "@/lib/firebase/errors";

export function AuthScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy("email");
    try {
      if (mode === "signup") await auth.signUpWithEmail(email, password);
      else await auth.signInWithEmail(email, password);
    } catch (submitError) {
      setError(readableAuthError(submitError));
    } finally {
      setBusy(null);
    }
  }

  async function handleGoogle() {
    setError(null);
    setBusy("google");
    try {
      await auth.signInWithGoogle();
    } catch (submitError) {
      setError(readableAuthError(submitError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 md:px-8">
      <div className="pointer-events-none absolute inset-0 opacity-60" aria-hidden="true">
        <div className="absolute left-[8%] top-[12%] h-40 w-32 -rotate-6 rounded-md border-[10px] border-amber-100/10 bg-white/[0.03] shadow-2xl" />
        <div className="absolute bottom-[10%] right-[10%] h-32 w-44 rotate-6 rounded-md border-[10px] border-orange-200/10 bg-white/[0.03] shadow-2xl" />
      </div>

      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[2.25rem] border border-white/10 bg-slate-950/70 shadow-2xl backdrop-blur-xl lg:grid-cols-[1.05fr,0.95fr]">
        <div className="border-b border-white/10 p-8 lg:border-b-0 lg:border-r lg:p-12">
          <p className="text-xs uppercase tracking-[0.45em] text-orange-200/80">AutoVlog AI</p>
          <h1 className="mt-5 text-5xl leading-[0.95] text-white md:text-6xl" style={{ fontFamily: "var(--font-heading)" }}>
            Your memories, kept in motion.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-300">
            Build a tactile diary film or glide through an original wall of framed moments. Your
            projects, uploads, soundtracks, and finished videos stay connected to your account.
          </p>
          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-orange-200/10 bg-orange-200/[0.05] p-4">
              <div className="text-sm font-medium text-orange-100">Diary memory book</div>
              <p className="mt-1 text-xs leading-5 text-slate-400">Page turns, warm paper, chapters, and personal notes.</p>
            </div>
            <div className="rounded-2xl border border-sky-200/10 bg-sky-200/[0.05] p-4">
              <div className="text-sm font-medium text-sky-100">Wall frame memories</div>
              <p className="mt-1 text-xs leading-5 text-slate-400">Cinematic movement across a cozy gallery of moments.</p>
            </div>
          </div>
        </div>

        <div className="p-8 lg:p-12">
          {auth.configurationError ? (
            <div className="rounded-2xl border border-amber-200/20 bg-amber-200/10 p-5">
              <div className="font-medium text-amber-100">Authentication setup needed</div>
              <p className="mt-2 text-sm leading-6 text-amber-50/70">{auth.configurationError}</p>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                Copy the public Firebase web-app values into your frontend environment. No private
                Firebase Admin credentials belong in the browser.
              </p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-sky-200/70">Welcome</p>
                <h2 className="mt-3 text-3xl text-white" style={{ fontFamily: "var(--font-heading)" }}>
                  {mode === "signin" ? "Continue your story" : "Start your memory library"}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => void handleGoogle()}
                disabled={busy !== null}
                className="mt-7 flex w-full items-center justify-center gap-3 rounded-2xl border border-white/15 bg-white px-4 py-3 font-medium text-slate-900 transition hover:bg-slate-100 disabled:opacity-60"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-sky-400 via-emerald-400 to-amber-400 text-xs font-bold text-white">G</span>
                {busy === "google" ? "Opening Google..." : "Continue with Google"}
              </button>

              <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.25em] text-slate-500">
                <span className="h-px flex-1 bg-white/10" /> or use email <span className="h-px flex-1 bg-white/10" />
              </div>

              <form className="space-y-4" onSubmit={handleEmail}>
                <label className="block">
                  <span className="mb-2 block text-sm text-slate-300">Email address</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-orange-200/50"
                    placeholder="you@example.com"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm text-slate-300">Password</span>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-orange-200/50"
                    placeholder="At least 6 characters"
                  />
                </label>
                {error ? <p className="rounded-xl bg-rose-400/10 px-3 py-2 text-sm text-rose-200" role="alert">{error}</p> : null}
                <button
                  type="submit"
                  disabled={busy !== null}
                  className="w-full rounded-2xl bg-gradient-to-r from-orange-300 via-amber-200 to-sky-300 px-5 py-3 font-semibold text-slate-950 transition hover:brightness-105 disabled:opacity-60"
                >
                  {busy === "email" ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
                </button>
              </form>

              <button
                type="button"
                onClick={() => { setMode((current) => current === "signin" ? "signup" : "signin"); setError(null); }}
                className="mt-5 w-full text-sm text-slate-400 transition hover:text-white"
              >
                {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
