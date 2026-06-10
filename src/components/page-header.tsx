export function PageHeader({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header>
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold text-foreground">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-mutedForeground">{description}</p>
    </header>
  );
}
