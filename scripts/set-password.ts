// Set the operator's password for email + password sign-in.
//
//   npm run set-password
//
// Prompts twice with hidden input and sets the password on the allow-listed
// user with the service role key. The password is never printed, logged or
// written anywhere: it lives in memory for the length of one API call.
//
// The user must already exist, which it does once they have signed in by
// magic link. This script never creates a user.

import { createSupabaseServiceClient } from "../lib/supabase/service.ts";
import { ALLOWED_EMAILS } from "../lib/auth.ts";

const MIN_LENGTH = 12;

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Read one line from the terminal without echoing it. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          // Ctrl-C: leave without changing anything.
          finish();
          die("Cancelled. Nothing was changed.");
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else if (char >= " ") {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  // A prompt only. Refusing piped input keeps the password out of shell
  // history and out of any file it might have been echoed from.
  if (!process.stdin.isTTY) die("Run this in a terminal: it prompts for the password.");

  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Fall through: the service client names the missing variables.
  }

  const email = ALLOWED_EMAILS[0];
  const db = createSupabaseServiceClient();

  // Find the operator before asking for anything, so a missing user is
  // reported up front rather than after the password has been typed twice.
  let userId: string | null = null;
  for (let page = 1; userId === null; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`Could not list users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) userId = match.id;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    die(`No user exists for ${email}. Sign in once by magic link, then run this again.`);
  }

  console.log(`Setting the password for ${email}.`);
  const first = await promptHidden("New password: ");
  if (first.length < MIN_LENGTH) die(`Too short: use at least ${MIN_LENGTH} characters. Nothing was changed.`);
  const second = await promptHidden("Repeat it: ");
  if (first !== second) die("The two entries did not match. Nothing was changed.");

  const { error } = await db.auth.admin.updateUserById(userId, { password: first });
  if (error) die(`Supabase refused the password: ${error.message}. Nothing was changed.`);

  console.log(`Password set for ${email}. Sign in at /login with it.`);
}

await main();
