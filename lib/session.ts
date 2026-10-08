import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabase/server";
import { isAllowedEmail } from "./auth";

/**
 * The server-side gate. Every protected page and every Server Action calls
 * this; none of them trust the proxy to have run.
 *
 * Returns the operator's user, or redirects to the login page. Never returns
 * for a non-allow-listed email, so a caller cannot forget to check.
 */
export async function requireOperator(): Promise<User> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAllowedEmail(user.email)) {
    redirect("/login?error=not_allowed");
  }
  return user;
}
