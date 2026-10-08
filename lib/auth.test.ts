// The allow-list is the whole of who may use this site, so its edge cases are
// worth pinning. The lookalike cases are the ones that matter: an attacker
// controlling a domain that merely contains the allowed one must not get in.
//
//   node --experimental-strip-types --test lib/auth.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedEmail, isOperator, ALLOWED_EMAILS } from "./auth.ts";

test("exactly one address is allowed", () => {
  assert.deepEqual([...ALLOWED_EMAILS], ["jordan@passoagency.com"]);
});

test("the operator is allowed, however they type it", () => {
  for (const email of [
    "jordan@passoagency.com",
    "Jordan@PassoAgency.com",
    "JORDAN@PASSOAGENCY.COM",
    "  jordan@passoagency.com  ",
  ]) {
    assert.equal(isAllowedEmail(email), true, email);
  }
});

test("everything else is refused", () => {
  for (const email of [
    // Absent or empty.
    null, undefined, "", "   ",
    // Another person at the same company.
    "someone@passoagency.com",
    // The right local part at the wrong domain.
    "jordan@gmail.com",
    "jordan@passo.com",
    // Lookalike domains. These are the dangerous ones.
    "jordan@passoagency.com.evil.com",
    "jordan@notpassoagency.com",
    "jordan@passoagency.co",
    "jordan@passoagencyx.com",
    // Display-name and comment smuggling.
    "jordan@passoagency.com@evil.com",
    "evil@evil.com <jordan@passoagency.com>",
    "jordan@passoagency.com, evil@evil.com",
    // Unicode lookalike: Cyrillic о in place of Latin o.
    "jordan@passоagency.com",
  ]) {
    assert.equal(isAllowedEmail(email as string | null | undefined), false, String(email));
  }
});

// A password proves who you are to Supabase, not that you may use this site.
// These are the user objects a successful signInWithPassword hands back; the
// server gates see exactly this, and only the email on it decides access.
test("a correct password for any other address is still refused", () => {
  const signedInWithPassword = (email: string) => ({
    id: "00000000-0000-0000-0000-000000000000",
    email,
    email_confirmed_at: "2026-10-08T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] },
    aud: "authenticated",
    role: "authenticated",
  });

  assert.equal(isOperator(signedInWithPassword("jordan@passoagency.com")), true);

  for (const email of [
    "someone@passoagency.com",
    "jordan@gmail.com",
    "jordan@passoagency.com.evil.com",
    "jordan@passоagency.com",
  ]) {
    assert.equal(isOperator(signedInWithPassword(email)), false, email);
  }
});

test("no user, or a user with no email, is refused", () => {
  for (const user of [null, undefined, {}, { email: null }, { email: "" }]) {
    assert.equal(isOperator(user), false, JSON.stringify(user));
  }
});
