// Who may use this site.
//
// IMPORTANT: this list is duplicated in supabase/migrations/001_prospects.sql
// as public.prospects_is_operator(). Changing who may use this site means
// editing BOTH places. The duplication is deliberate: the database refuses
// rows on its own authority, so a mistake in the application layer does not
// expose data, and vice versa.
export const ALLOWED_EMAILS = ["jordan@passoagency.com"] as const;

/** Case-insensitive, whitespace-tolerant allow-list check. */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalised = email.trim().toLowerCase();
  return ALLOWED_EMAILS.some((allowed) => allowed.toLowerCase() === normalised);
}
