// Starting the research workflow from the website. Server-side only: it reads
// GITHUB_DISPATCH_TOKEN, a fine-grained token with Actions write on this one
// repository. Never throws: a failed dispatch leaves the request queued for
// the Mac runner, and the caller only needs to know whether it went.

import { GITHUB_REF, GITHUB_REPO, GITHUB_WORKFLOW } from "./scan-requests.ts";

export type DispatchResult = { ok: true } | { ok: false; reason: string };

export async function dispatchScopeWorkflow(
  requestId: string,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<DispatchResult> {
  if (!token?.trim()) return { ok: false, reason: "GITHUB_DISPATCH_TOKEN is not set" };
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token.trim()}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: GITHUB_REF, inputs: { request_id: requestId } }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    // 204 historically; 200 when the API returns run details.
    if (response.status === 204 || response.ok) return { ok: true };
    return { ok: false, reason: `GitHub returned ${response.status}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
