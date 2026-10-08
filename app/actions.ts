"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/session";
import {
  createProspect,
  supabaseProspectWriter,
  type AddProspectInput,
  type ProspectStatus,
} from "@/lib/prospects";

export type ActionName = "approve" | "unapprove" | "archive" | "rerun";

/**
 * Which statuses each action may be applied to, and what it leaves behind.
 *
 * Enforced here rather than in the UI, so a stale page or a hand-made request
 * cannot drive a row into a state that makes no sense. 'researching' is absent
 * from every `from` list on purpose: a run is in flight and the operator should
 * not be able to yank it out from under the agent.
 */
const TRANSITIONS: Record<
  ActionName,
  { from: ProspectStatus[]; to: ProspectStatus; stamp?: "approved_at" | null }
> = {
  approve:   { from: ["new", "archived"],            to: "approved", stamp: "approved_at" },
  unapprove: { from: ["approved"],                   to: "new",      stamp: null },
  archive:   { from: ["new", "approved", "built"],   to: "archived" },
  // A built prospect goes back in the queue. built_at is left alone: it records
  // that a report exists, and the previous versions are all still there.
  rerun:     { from: ["built"],                      to: "approved", stamp: "approved_at" },
};

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function runProspectAction(
  action: ActionName,
  prospectId: string,
): Promise<ActionResult> {
  // Never trust the proxy to have run.
  await requireOperator();

  const rule = TRANSITIONS[action];
  if (!rule) return { ok: false, error: `Unknown action: ${action}` };

  const supabase = await createSupabaseServerClient();

  const { data: current, error: readError } = await supabase
    .from("prospects")
    .select("id, brand, status")
    .eq("id", prospectId)
    .maybeSingle();

  // RLS makes this indistinguishable from "not yours", which is the point.
  if (readError) return { ok: false, error: readError.message };
  if (!current) return { ok: false, error: "That prospect could not be found." };

  const status = current.status as ProspectStatus;
  if (!rule.from.includes(status)) {
    return {
      ok: false,
      error:
        status === "researching"
          ? `${current.brand} is being researched right now. Wait for the run to finish.`
          : `${current.brand} is ${status}, so it cannot be ${action}d.`,
    };
  }

  const patch: Record<string, unknown> = { status: rule.to };
  if (rule.stamp === "approved_at") patch.approved_at = new Date().toISOString();
  if (rule.stamp === null) patch.approved_at = null;

  const { error: writeError } = await supabase
    .from("prospects")
    .update(patch)
    // Re-assert the expected status so two tabs racing cannot both win.
    .eq("id", prospectId)
    .eq("status", status);

  if (writeError) return { ok: false, error: writeError.message };

  revalidatePath("/");
  return { ok: true };
}

export async function saveProspectNotes(
  prospectId: string,
  notes: string,
): Promise<ActionResult> {
  await requireOperator();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("prospects")
    .update({ notes: notes.trim() === "" ? null : notes })
    .eq("id", prospectId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

/**
 * Add a prospect by hand, for anything that is not in the spreadsheet.
 *
 * Writes through the operator's own session, so RLS applies exactly as it does
 * to every other write from the app. The service role client is deliberately
 * not used here: nothing about adding a row needs to bypass the policies, and
 * reaching for it would put a key that ignores RLS on a path reachable from a
 * browser form.
 */
export async function addProspect(
  input: AddProspectInput,
): Promise<ActionResult & { slug?: string }> {
  await requireOperator();

  const supabase = await createSupabaseServerClient();

  try {
    const result = await createProspect(supabaseProspectWriter(supabase), input);
    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath("/");
    return { ok: true, slug: result.slug };
  } catch (error) {
    // A unique-violation here means another tab inserted the same slug between
    // our check and our insert. The database is the one that settles it.
    const message = error instanceof Error ? error.message : String(error);
    if (/duplicate key|unique constraint/i.test(message)) {
      return {
        ok: false,
        error: "That prospect was added a moment ago, in another tab or window. Nothing was added twice.",
      };
    }
    if (/prospects_source_tab_check|violates check constraint/i.test(message)) {
      return {
        ok: false,
        error:
          "The database does not yet allow manually added prospects. Apply migration 002_manual_prospects.sql, then try again.",
      };
    }
    return { ok: false, error: message };
  }
}

