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

  return (
    <span className="inline-flex rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-700">
      {label}
    </span>
  );
}
