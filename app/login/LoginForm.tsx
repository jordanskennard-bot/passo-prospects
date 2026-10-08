"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAllowedEmail } from "@/lib/auth";

export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setMessage(null);

    // A courtesy check so a typo gets an instant answer. It is not the control:
    // the callback route and the database both refuse a non-operator regardless
    // of what happens here.
    if (!isAllowedEmail(email)) {
      setState("error");
      setMessage("That address is not authorised for this site.");
      return;
    }

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
      setState("error");
      setMessage(error.message);
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

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)" }}>
      <label htmlFor="email" className="label" style={{ width: "100%" }}>
        Email address
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@passoagency.com"
        style={{ flex: "1 1 260px" }}
      />
      <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
        {state === "sending" ? "Sending" : "Email me a link"}
      </button>
      {message ? (
        <p role="alert" style={{ width: "100%", color: "var(--rosa)", margin: 0 }}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
