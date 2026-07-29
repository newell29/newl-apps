import { JobStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  partitionHunterResearchSignals,
  summarizeHunterOutreachHandoffRun
} from "@/modules/lead-gen/hunter-queries";

describe("Hunter contact-discovery run summary", () => {
  it("separates queued companies, evaluated candidates, and generated plans", () => {
    const summary = summarizeHunterOutreachHandoffRun({
      id: "handoff-1",
      status: JobStatus.SUCCESS,
      startedAt: new Date("2026-07-28T10:00:00.000Z"),
      finishedAt: new Date("2026-07-28T10:02:00.000Z"),
      errorMessage: null,
      input: {
        items: [
          { companyId: "company-1" },
          { companyId: "company-2" }
        ]
      },
      output: {
        results: [
          {
            companyName: "Company One",
            state: "PLANS_GENERATED",
            apolloContactsFound: 100,
            contactsRanked: 10,
            contactsImported: 10,
            plansGenerated: 2,
            plansCreated: 1,
            existingPlansFound: 1,
            actionablePlans: 2,
            qaFailedPlans: 1,
            message: "Two plans created."
          },
          {
            companyName: "Company Two",
            state: "CONTACT_REVIEW_REQUIRED",
            apolloContactsFound: 59,
            contactsRanked: 9,
            contactsImported: 9,
            plansGenerated: 0,
            plansCreated: 0,
            existingPlansFound: 0,
            actionablePlans: 0,
            qaFailedPlans: 0,
            message: "No contact cleared buyer-role review."
          }
        ]
      }
    });

    expect(summary).toMatchObject({
      companiesQueued: 2,
      companiesProcessed: 2,
      apolloContactsFound: 159,
      contactsRanked: 19,
      contactsEvaluated: 19,
      plansCreated: 1,
      existingPlansFound: 1,
      actionablePlans: 2,
      qaFailedPlans: 1
    });
    expect(summary?.results).toEqual([
      expect.objectContaining({
        companyName: "Company One",
        apolloContactsFound: 100,
        contactsRanked: 10,
        contactsEvaluated: 10,
        plansCreated: 1,
        existingPlansFound: 1,
        actionablePlans: 2
      }),
      expect.objectContaining({
        companyName: "Company Two",
        contactsEvaluated: 9,
        plansCreated: 0,
        existingPlansFound: 0,
        actionablePlans: 0
      })
    ]);
  });

  it("fails closed on malformed historical JSON", () => {
    const summary = summarizeHunterOutreachHandoffRun({
      id: "handoff-legacy",
      status: JobStatus.RUNNING,
      startedAt: new Date("2026-07-28T10:00:00.000Z"),
      finishedAt: null,
      errorMessage: null,
      input: "legacy",
      output: { results: ["bad-row"] }
    });

    expect(summary).toMatchObject({
      companiesQueued: 0,
      companiesProcessed: 0,
      contactsEvaluated: 0,
      plansCreated: 0,
      existingPlansFound: 0,
      actionablePlans: 0,
      results: []
    });
  });
});

describe("Hunter daily research cohorts", () => {
  it("separates the latest run from still-actionable carry-forward outreach", () => {
    const signal = (
      id: string,
      runId: string,
      opportunityTier: string
    ) => ({
      id,
      sourceName: "Hunter company research",
      rawJson: { runId },
      evidence: { research: { opportunityTier } }
    });
    const result = partitionHunterResearchSignals(
      [
        signal("today-hot", "run-today", "HOT_OPPORTUNITY"),
        signal("old-qualified", "run-old", "QUALIFIED_CURRENT_ACCOUNT"),
        signal("old-watch", "run-old", "WATCHLIST")
      ],
      "run-today"
    );

    expect(result.latestResearchSignals.map((row) => row.id)).toEqual([
      "today-hot"
    ]);
    expect(result.carryForwardResearchSignals.map((row) => row.id)).toEqual([
      "old-qualified"
    ]);
  });
});
