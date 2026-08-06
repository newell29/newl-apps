import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync
} from "node:fs";

import { featureDirectory, featureEventsPath, FeatureState, WorkflowStage } from "./state";

export type ProgressReporter = {
  emit(input: {
    stage: WorkflowStage;
    type: string;
    message: string;
    phaseId?: string | null;
    data?: Record<string, string | number | boolean | null>;
  }): void;
  sequence(): number;
};

function elapsed(startedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function createProgressReporter(
  coordinationRoot: string,
  state: FeatureState,
  output: (message: string) => void = console.log
): ProgressReporter {
  const startedAt = Date.now();
  const eventsPath = featureEventsPath(coordinationRoot, state.featureSlug);
  let sequence = state.eventSequence;
  if (existsSync(eventsPath)) {
    const lastLine = readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean).at(-1);
    if (lastLine) {
      try {
        const previous = JSON.parse(lastLine) as { sequence?: unknown };
        if (typeof previous.sequence === "number" && Number.isInteger(previous.sequence)) {
          sequence = Math.max(sequence, previous.sequence);
        }
      } catch {
        throw new Error("Workflow event log is malformed; refusing to append ambiguous progress.");
      }
    }
  }
  const directory = featureDirectory(coordinationRoot, state.featureSlug);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return {
    emit(input) {
      sequence += 1;
      const event = {
        schemaVersion: 1,
        sequence,
        timestamp: new Date().toISOString(),
        featureSlug: state.featureSlug,
        phaseId: input.phaseId ?? state.currentPhaseId,
        stage: input.stage,
        type: input.type,
        message: input.message,
        data: input.data
      };
      appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
      chmodSync(eventsPath, 0o600);
      const context = `[${state.featureTitle}${event.phaseId ? ` / ${event.phaseId}` : ""}]`;
      output(`${context} ${input.message.padEnd(52)} ${elapsed(startedAt)}`);
    },
    sequence: () => sequence
  };
}
