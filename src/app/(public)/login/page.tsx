import { NewlLogo } from "@/components/newl-logo";
import { signInWithEntraAction } from "@/server/auth/actions";
import { isDevLoginEnabled } from "@/server/auth/constants";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const errorMessages: Record<string, string> = {
  missing_credentials: "Enter both an email and password.",
  invalid_credentials: "Those credentials did not match a provisioned account.",
  AccessDenied: "This account is not provisioned for Newl Apps. Contact an administrator.",
  Configuration: "Sign-in is not configured. Contact an administrator.",
  default: "Sign-in failed. Please try again."
};

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const callbackUrl = sanitizeCallbackUrl(readParam(params.callbackUrl));
  const errorCode = readParam(params.error);
  const errorMessage = errorCode ? (errorMessages[errorCode] ?? errorMessages.default) : null;
  const devLoginEnabled = isDevLoginEnabled();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <NewlLogo />
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h1>
            <p className="text-sm text-mutedForeground">
              Use your Newl Group account to access the operations platform.
            </p>
          </div>

          {errorMessage ? (
            <div className="mt-5 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </div>
          ) : null}

          <form action={signInWithEntraAction} className="mt-6">
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <button
              type="submit"
              className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover"
            >
              Sign in with Microsoft
            </button>
          </form>

          {devLoginEnabled ? (
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                  Dev login
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                Local development bypass is active (AUTH_DEV_BYPASS). This panel never appears in production.
              </div>

              <form action="/api/auth/dev-login" method="post" className="space-y-3">
                <input type="hidden" name="callbackUrl" value={callbackUrl} />
                <label className="block space-y-1 text-sm font-medium text-foreground">
                  <span>Email</span>
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    defaultValue="admin@example.com"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <label className="block space-y-1 text-sm font-medium text-foreground">
                  <span>Password</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="SEED_ADMIN_PASSWORD value"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <button
                  type="submit"
                  className="w-full rounded-md border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-accentBorder hover:bg-accentSoft"
                >
                  Continue with dev login
                </button>
              </form>
            </div>
          ) : null}
        </div>

        <p className="text-center text-xs text-mutedForeground">
          Access is granted by an administrator. There is no self-service signup.
        </p>
      </div>
    </main>
  );
}

function readParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function sanitizeCallbackUrl(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}
