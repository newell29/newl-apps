"use server";

import { runTmsAutomationTestAction as runTmsAutomationTestActionImpl } from "./actions";

export async function runTmsAutomationTestAction(rawEmailInquiry?: string) {
  return runTmsAutomationTestActionImpl(rawEmailInquiry);
}
