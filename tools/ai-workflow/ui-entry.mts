#!/usr/bin/env node

import { runOperatorUi } from "./ui";

try {
  await runOperatorUi();
} catch (error) {
  console.error(`[ai-workflow-ui] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
