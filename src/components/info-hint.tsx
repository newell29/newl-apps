export function InfoHint({ text, widthClassName = "w-64" }: { text: string; widthClassName?: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold text-mutedForeground"
        aria-label={text}
        title={text}
      >
        i
      </span>
      <span
        className={`pointer-events-none absolute left-1/2 top-6 z-20 hidden -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs font-normal leading-5 text-foreground shadow-lg group-hover:block ${widthClassName}`}
      >
        {text}
      </span>
    </span>
  );
}
