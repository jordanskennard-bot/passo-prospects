"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAllowedEmail } from "@/lib/auth";

type State = "idle" | "signing-in" | "sending" | "sent" | "error";

/** Same rule as the callback route: a path on this origin, never a URL. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);

  function fail(text: string) {
    setState("error");
    setMessage(text);
  }

  // A courtesy check so a typo gets an instant answer, and so a password is
  // never sent for an address that could not get in anyway. It is not the
  // control: the proxy, every page and the database all refuse a non-operator
  // regardless of what happens here.
  function emailIsAllowed(): boolean {
    if (isAllowedEmail(email)) return true;
    fail("That address is not authorised for this site.");
    return false;
  }

  async function onPasswordSignIn(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (!emailIsAllowed()) return;
    setState("signing-in");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setPassword("");
      // One message for every credential failure, so the form never says
      // whether it was the address or the password that was wrong.
      fail(
        error.status === 400
          ? "That email and password do not match."
          : error.message,
      );
      return;
    }

    // A full navigation, so the proxy sees the new session cookies and applies
    // the allow-list before the tracker renders.
    window.location.assign(safeNext(next));
  }

  async function onSendLink() {
    setMessage(null);
    if (!email.trim()) {
      fail("Enter your email address first.");
      return;
    }
    if (!emailIsAllowed()) return;
    setState("sending");

    const supabase = createSupabaseBrowserClient();
    const redirectTo = new URL(
      "/auth/callback",
      process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin,
    );
    if (next) redirectTo.searchParams.set("next", next);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo.toString(), shouldCreateUser: true },
    });

    if (error) {
      fail(error.message);
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="panel">
        <p style={{ marginBottom: 0 }}>
          Check <strong>{email}</strong>. The link signs you straight in and expires
          after one use.
        </p>
      </div>
    );
  }

  const busy = state === "signing-in" || state === "sending";

  return (
    <form
      onSubmit={onPasswordSignIn}
      style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)" }}
    >
      <label htmlFor="email" className="label" style={{ width: "100%" }}>
        Email address
      </label>
      <input
        id="email"
        name="username"
        type="email"
        required
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@passoagency.com"
        style={{ flex: "1 1 100%" }}
      />
      <label htmlFor="password" className="label" style={{ width: "100%" }}>
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ flex: "1 1 100%" }}
      />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {state === "signing-in" ? "Signing in" : "Sign in"}
      </button>
      <button type="button" className="btn btn-quiet" onClick={onSendLink} disabled={busy}>
        {state === "sending" ? "Sending" : "Email me a link instead"}
      </button>
      {message ? (
        <p role="alert" style={{ width: "100%", color: "var(--rosa)", margin: 0 }}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
