"use client";

import { useEffect, useState } from "react";

import type { User } from "@/lib/types";

interface SafeUser extends Omit<User, "passwordHash" | "passwordSalt"> {}

function AuthForm(props: {
  mode: "login" | "signup";
  onSuccess: (user: SafeUser) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/auth/${props.mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Request failed.");
      }
      props.onSuccess(payload.user);
      setEmail("");
      setPassword("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3">
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          placeholder="you@example.com"
          className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
        />
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          placeholder="At least 8 characters"
          className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
        />
      </div>
      {error ? <div className="text-sm text-rose-300">{error}</div> : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-60"
      >
        {busy ? "Working..." : props.mode === "login" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}

export function AccountPanel() {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [user, setUser] = useState<SafeUser>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh() {
    try {
      setError(undefined);
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const payload = await response.json();
      setUser(payload.user);
    } catch {
      setError("Unable to load account details right now.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleLogout() {
    setBusy(true);
    setError(undefined);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(undefined);
      await refresh();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Unable to log out.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-slate-950/45 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.35em] text-sky-200/70">Account</div>
          <div className="mt-2 text-lg font-medium text-white">
            {user ? user.email : "Sign in to save projects"}
          </div>
          <div className="mt-1 text-sm text-slate-400">
            {user
              ? "Your Memory Book projects and preferences stay tied to your account."
              : "Anonymous mode still works. Sign in when you want saved project history."}
          </div>
        </div>
        {user ? (
          <button
            type="button"
            onClick={handleLogout}
            disabled={busy}
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-60"
          >
            Log out
          </button>
        ) : null}
      </div>

      {!user ? (
        <div className="mt-5 space-y-4">
          <div className="flex gap-2">
            {(["signup", "login"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`rounded-full px-4 py-2 text-sm ${
                  mode === value ? "bg-white/10 text-white" : "bg-transparent text-slate-400"
                }`}
              >
                {value === "signup" ? "Create account" : "Log in"}
              </button>
            ))}
          </div>
          <AuthForm
            mode={mode}
            onSuccess={(nextUser) => {
              setUser(nextUser);
              void refresh();
            }}
          />
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          Saved projects are stored locally under your account. Uploaded MP3 soundtracks stay scoped
          to the project that received them.
        </div>
      )}

      {error ? <div className="mt-3 text-sm text-rose-300">{error}</div> : null}
    </section>
  );
}
