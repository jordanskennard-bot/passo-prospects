import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Request-scoped client carrying the signed-in operator's session.
 *
 * Reads and writes through this client are subject to RLS, which is what
 * actually protects the data. `cookies()` is async in Next 16, hence the await.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Server Components cannot set cookies. Supabase calls setAll when it
          // refreshes a token; in a read-only render that throws, and the
          // refreshed token is simply picked up on the next request that can
          // write (a Server Action, a Route Handler, or proxy.ts).
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Intentionally ignored. See comment above.
          }
        },
      },
    },
  );
}

