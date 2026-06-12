import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getAuthenticatedContext, type AuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Guarded layout for all authenticated pages. Resolves the authenticated
 * context (session -> user -> membership -> tenant) and passes the current
 * user/tenant/role to the AppShell. Any failure to resolve a valid membership
 * sends the visitor to /login. Middleware also gates these routes, but this is
 * the authoritative server-side validation.
 */
export default async function AuthenticatedLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  let context: AuthenticatedContext;

  try {
    context = await getAuthenticatedContext();
  } catch {
    redirect("/login");
  }

  return (
    <AppShell
      userName={context.userName}
      userEmail={context.userEmail}
      role={context.role}
      tenantName={context.tenantName}
    >
      {children}
    </AppShell>
  );
}
