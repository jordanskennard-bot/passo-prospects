// Route protection.
//
// Next 16 renamed the `middleware` file convention to `proxy`, and the exported
// function with it. The proxy runtime is nodejs and cannot be configured.
//
// This is the first of two gates, not the only one. The proxy can be deployed
// to a CDN and is documented as something not to rely on for shared logic, so
// every protected page and every Server Action independently calls
// requireOperator() from lib/session.ts, and the database refuses rows to any
// other user through RLS. Three layers, deliberately.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isOperator } from "./lib/auth";

/** Paths reachable without a session. Everything else needs one. */
const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/signout", "/robots.txt"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  // Carries refreshed auth cookies back to the browser.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates against Supabase rather than trusting the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const allowed = isOperator(user);

  // A signed-in session belonging to someone who is not the operator is signed
  // out here rather than left to linger. The database would refuse them every
  // row anyway, but an authenticated stranger should not see the shell either.
  if (user && !allowed) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?error=not_allowed";
    return NextResponse.redirect(url);
  }

  if (!allowed && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Send them back where they were headed once they are in.
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Already signed in and asking for the login page: go to the tracker.
  if (allowed && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:ttf|woff2?|png|jpg|jpeg|svg|ico|webp)$).*)"],
};
