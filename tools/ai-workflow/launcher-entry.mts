#!/usr/bin/env node

import { runLauncher } from "./launcher";
import {
  WorkflowCancelledError,
  WorkflowEscalationError
} from "./workflow";

const keepAlive = setInterval(() => undefined, 60_000);

try {
  await runLauncher();
} catch (error: unknown) {
  if (error instanceof WorkflowCancelledError) {
    console.error(`[ai-workflow] Cancelled: ${error.message}`);
    process.exitCode = 2;
  } else if (error instanceof WorkflowEscalationError) {
    console.error(`[ai-workflow] Manual escalation required: ${error.message}`);
    process.exitCode = 3;
  } else {
    console.error(`[ai-workflow] Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} finally {
  clearInterval(keepAlive);
}
