const stageLabels: Record<string, string> = {
  NEW: "New",
  RESEARCHING: "Researching",
  ENRICHED: "Enriched",
  QUALIFIED: "Qualified",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  MEETING_BOOKED: "Meeting Booked",
  QUOTED: "Quoted",
  WON: "Won",
  LOST: "Lost",
  DISQUALIFIED: "Disqualified"
};

export function StageBadge({ stage }: { stage: string }) {
  const label = stageLabels[stage] ?? stage;
  const stageClass = getStageClass(stage);

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${stageClass}`}>
      {label}
    </span>
  );
}

function getStageClass(stage: string) {
  if (["WON", "MEETING_BOOKED", "REPLIED", "QUALIFIED"].includes(stage)) {
    return "border-success/20 bg-success/10 text-success";
  }

  if (["LOST", "DISQUALIFIED"].includes(stage)) {
    return "border-danger/20 bg-danger/10 text-danger";
  }

  if (["CONTACTED", "QUOTED"].includes(stage)) {
    return "border-warning/20 bg-warning/10 text-warning";
  }

  return "border-border bg-muted text-mutedForeground";
}
