import { isDue, record, type Mission, type Work } from "./model";
import { needsOwner } from "./lifecycle";
import { scoutCandidates } from "./learning";

export type WorkboardItem = Work & { id: string; recipientEmail?: string | null };

type Capacity = { usedSteps: number; active: number; available: boolean } | null | undefined;

export function projectScoutWorkboard(items: WorkboardItem[], mission: Mission, capacity: Capacity, now = new Date()) {
  const open = items.filter(item => !["DONE", "DISMISSED"].includes(item.state));
  const ownerActions: WorkboardItem[] = [];
  const working: WorkboardItem[] = [];
  const due = scoutCandidates(items, now).filter(item => !needsOwner(item)) as WorkboardItem[];
  const heldCandidates: WorkboardItem[] = [];
  const scheduled: WorkboardItem[] = [];
  const external: WorkboardItem[] = [];
  const selectableIds = new Set(due.map(item => item.id));

  for (const item of open) {
    if (needsOwner(item)) ownerActions.push(item);
    else if (item.state === "WAITING" && item.evidence.externalWait === true) external.push(item);
    else if (item.state === "WORKING" && !isDue(item, now)) working.push(item);
    else if (isDue(item, now)) {
      if (!selectableIds.has(item.id)) heldCandidates.push(item);
    }
    else if (["READY", "WAITING", "WORKING"].includes(item.state)) scheduled.push(item);
  }

  const sourceCounts = {
    pages: open.filter(item => item.kind === "PAGE").length,
    replies: open.filter(item => item.kind === "RELATIONSHIP").length,
    measurements: open.filter(item => item.kind === "MEASUREMENT").length,
    exploration: open.filter(item => item.kind === "RESEARCH" && record(item.evidence).source !== "site-review").length,
    siteReview: open.filter(item => item.kind === "RESEARCH" && record(item.evidence).source === "site-review").length
  };

  let wakeStatus: string;
  if (!mission.enabled) wakeStatus = "Scout would stop because research is paused.";
  else if (capacity && capacity.usedSteps >= mission.dailySteps) wakeStatus = "Scout would stop because the rolling 24-hour research budget is used.";
  else if (capacity && capacity.active >= mission.maxActive) wakeStatus = "Scout would stop because the active-work limit is reached.";
  else if (due.length) wakeStatus = `Scout would choose one of ${due.length} due item${due.length === 1 ? "" : "s"}, work one step, and save the result.`;
  else wakeStatus = "Scout would refresh and reconcile saved sources, find nothing due, and stop without using an AI research step.";

  return { ownerActions, working, due, heldCandidates, scheduled, external, sourceCounts, wakeStatus };
}
