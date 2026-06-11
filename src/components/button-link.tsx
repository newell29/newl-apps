import Link from "next/link";
import type { ReactNode } from "react";

type ButtonLinkVariant = "primary" | "secondary" | "ghost";

const variantClasses: Record<ButtonLinkVariant, string> = {
  primary: "bg-primary text-primaryForeground shadow-sm hover:bg-primary/90",
  secondary: "border border-border bg-card text-primary shadow-sm hover:bg-muted",
  ghost: "text-primary hover:bg-muted"
};

export function ButtonLink({
  href,
  children,
  variant = "primary"
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonLinkVariant;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-10 items-center rounded-md px-4 py-2 text-sm font-semibold transition-colors ${variantClasses[variant]}`}
    >
      {children}
    </Link>
  );
}
