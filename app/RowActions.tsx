"use client";

import { useState, useTransition } from "react";
import { runProspectAction, type ActionName } from "./actions";
import type { ProspectStatus } from "@/lib/prospects";

/** Which buttons a row offers, mirroring the transition table in actions.ts. */
function availableActions(status: ProspectStatus): ActionName[] {
  switch (status) {
    case "new":         return ["approve", "archive"];
    case "approved":    return ["unapprove", "archive"];
    case "built":       return ["rerun", "archive"];
    // Outreach statuses are set by the email scanner, forward only. The
    // tracker can still archive a prospect that has gone nowhere.
    case "message_sent":
    case "response_received": return ["archive"];
    case "archived":    return ["approve"];
    case "researching": return [];
  }
}

const LABELS: Record<ActionName, string> = {
  approve: "Approve",
  unapprove: "Unapprove",
  archive: "Archive",
  rerun: "Rerun",
};

export function RowActions({
  prospectId,
  brand,
  status,
}: {
  prospectId: string;
  brand: string;
  status: ProspectStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const actions = availableActions(status);

  if (status === "researching") {
    return <span className="label">Run in flight</span>;
  }

  function run(action: ActionName) {
    setError(null);
    // Archiving is easy to hit by accident on a phone and loses a row from the
    // default view, so it asks first. The others are all reversible in one tap.
    if (action === "archive" && !window.confirm(`Archive ${brand}?`)) return;

    startTransition(async () => {
      const result = await runProspectAction(action, prospectId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)", alignItems: "center" }}>
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          className={action === "approve" ? "btn" : "btn btn-quiet"}
          disabled={pending}
          onClick={() => run(action)}
        >
          {LABELS[action]}
        </button>
      ))}
      {error ? (
        <span role="alert" style={{ color: "var(--rosa)", fontSize: 13, width: "100%" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
