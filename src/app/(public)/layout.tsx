/**
 * Minimal layout for public, unauthenticated pages (e.g. /login). It does NOT
 * render the AppShell or attempt any tenant/session resolution.
 */
export default function PublicLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
