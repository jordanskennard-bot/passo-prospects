import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth";

/**
 * Magic-link landing. This is where a non-allow-listed email is actually
 * refused: the code may exchange successfully (Supabase does not know about our
 * allow-list) and we sign the session straight back out if the address is not
 * the operator's.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, origin));

  if (!code) return fail("link_invalid");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) return fail("link_invalid");

  if (!isAllowedEmail(data.user.email)) {
    // Valid link, wrong person. Tear the session down before redirecting.
    await supabase.auth.signOut();
    return fail("not_allowed");
  }

  // Only ever redirect to a path on this origin, never to an absolute URL a
  // caller supplied, so the `next` parameter cannot become an open redirect.
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(destination, origin));
}
