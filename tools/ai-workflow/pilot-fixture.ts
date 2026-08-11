export function formatPilotFeatureLabel(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "(untitled)";
  return trimmed.replace(/\s+/g, " ");
}
