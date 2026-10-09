"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { queueResearch } from "../actions";
import {
  ACTIVE_REFRESH_MS,
  GITHUB_WORKFLOW_RUNS_URL,
  isActive,
  researchButtonLabel,
  type ScanRequestRow,
} from "@/lib/scan-requests";

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });

/**
 * The "Run research" button, the state of the latest request, and a link to
 * the GitHub Actions run doing it. Refreshes itself every 15 seconds while a
 * request is queued or running.
 */
export function ResearchControls({
  prospectId,
  slug,
  status,
  request,
  versionHrefSuffix,
}: {
  prospectId: string;
  slug: string;
  status: string;
  request: ScanRequestRow | null;
  /** Carries the tracker filters onto the report link. */
  versionHrefSuffix: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();
  const active = isActive(request);
  const label = researchButtonLabel(status);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), ACTIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, router]);

  function run() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await queueResearch(prospectId);
      if (!result.ok) setError(result.error);
      else if (result.notice) setNotice(result.notice);
      router.refresh();
    });
  }

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)", alignItems: "center" }}>
        {label ? (
          <button type="button" className="btn btn-primary" onClick={run} disabled={pending || active}>
            {pending ? "Queuing" : label}
          </button>
        ) : null}
        {request ? <RequestState request={request} slug={slug} versionHrefSuffix={versionHrefSuffix} /> : null}
      </div>
      {request ? <RunLink request={request} /> : null}
      {notice ? <span className="label">{notice}</span> : null}
      {error ? (
        <p role="alert" style={{ color: "var(--rosa)", margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function RequestState({
  request,
  slug,
  versionHrefSuffix,
}: {
  request: ScanRequestRow;
  slug: string;
  versionHrefSuffix: string;
}) {
  switch (request.state) {
    case "queued":
      return <span className="pill pill-approved">Queued</span>;
    case "running":
      return (
        <span style={{ display: "inline-flex", gap: "var(--s-2)", alignItems: "center", flexWrap: "wrap" }}>
          <span className="pill pill-researching">Running</span>
          {request.started_at ? <span className="label">since {time(request.started_at)}</span> : null}
        </span>
      );
    case "done":
      return (
        <span style={{ display: "inline-flex", gap: "var(--s-2)", alignItems: "center", flexWrap: "wrap" }}>
          <span className="pill pill-built">Done</span>
          {request.report_version ? (
            <Link href={`/p/${slug}?v=${request.report_version}${versionHrefSuffix}#research`}>
              Version {request.report_version}
            </Link>
          ) : null}
          {request.finished_at ? <span className="label">{time(request.finished_at)}</span> : null}
        </span>
      );
    case "failed":
      return (
        <span style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)", width: "100%" }}>
          <span style={{ display: "inline-flex", gap: "var(--s-2)", alignItems: "center", flexWrap: "wrap" }}>
            <span className="pill pill-archived">Failed</span>
            {request.finished_at ? <span className="label">{time(request.finished_at)}</span> : null}
          </span>
          {request.error ? (
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, margin: 0, color: "var(--ink-2)" }}>
              {request.error}
            </pre>
          ) : null}
        </span>
      );
  }
}

/** Where to watch the run: its own Actions page once claimed, else the workflow's list. */
function RunLink({ request }: { request: ScanRequestRow }) {
  if (request.run_url) {
    return (
      <a className="label" href={request.run_url} target="_blank" rel="noopener noreferrer">
        View the run on GitHub Actions
      </a>
    );
  }
  if (request.state === "queued") {
    return (
      <a className="label" href={GITHUB_WORKFLOW_RUNS_URL} target="_blank" rel="noopener noreferrer">
        Waiting for GitHub Actions to start
      </a>
    );
  }
  return null;
}
