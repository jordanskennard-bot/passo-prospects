import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Passo prospects" };

const ERRORS: Record<string, string> = {
  not_allowed:
    "That email address is not on the allow-list for this site. If it should be, add it in lib/auth.ts and to the operator check in the database.",
  link_invalid:
    "That sign-in link has expired or has already been used. Request a new one.",
};

export default async function LoginPage({
  searchParams,
}: {
  // searchParams is a promise in Next 16.
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.not_allowed) : null;

  return (
    <main className="page reading">
      <div className="masthead">
        <h1>Passo prospects</h1>
        <span className="label">Private</span>
      </div>

      <p>
        This site is private. Sign in with your Passo address and we will email you a
        link.
      </p>

      {message ? (
        <div className="caveat" role="alert">
          {message}
        </div>
      ) : null}

      <LoginForm next={next ?? null} />

      <hr className="rule" />
      <p className="label">
        One address is authorised. Any other is refused by the database, not just hidden.
      </p>
    </main>
  );
}
