import { describe, expect, it, vi } from "vitest";

import {
  buildDryRunEvidence,
  buildTeamshipUpdatePayload,
  executeTeamshipPhase2Job
} from "@/modules/shipment-documents/teamship-phase2-agent-execution";
import { buildTeamshipPhase2DryRunPlan, compactGarlandSpecialInstructions } from "@/modules/shipment-documents/teamship-phase2-dry-run";
import type { GarlandTeamshipReviewResponse } from "@/modules/shipment-documents/teamship-review-types";

describe("Teamship Phase 2 agent execution", () => {
  it("builds the live update payload from approved field and pallet plans", () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());
    const payload = buildTeamshipUpdatePayload(plan.orders[0]!);

    expect(payload).toMatchObject({
      edi_field_3: "PPADD-CD",
      pallets_count: 2,
      pallet_1: 1,
      pallet_1_length: 48,
      pallet_1_width: 40,
      pallet_1_height: 50,
      pallet_1_weight: 500,
      pallet_1_weight_unit: "lbs",
      pallet_1_commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908",
      pallet_2: 4,
      pallet_2_commodity: "SKU: 8030445 QTY: 4"
    });
    expect(payload.pallet_dims).toEqual([
      expect.objectContaining({
        quantity: 1,
        length: 48,
        width: 40,
        height: 50,
        weight: 500,
        commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908"
      }),
      expect.objectContaining({
        quantity: 4,
        length: 10,
        width: 10,
        height: 10,
        weight: 25,
        commodity: "SKU: 8030445 QTY: 4"
      })
    ]);
  });

  it("compacts Garland special instructions before planning bot updates", () => {
    expect(
      compactGarlandSpecialInstructions(`PLEASE DELIVER TO ARLEIGH NELLA @ 647-308-0048

TAG: SPIRIT OF YORK

****************************************
***DANGEROUS GOODS - C-CLEAN-FORTE***
PROPER NAME:
UN1814, POTASSIUM HYDROXIDE SOLUTION, CLASS 8 PG II`)
    ).toBe(
      "PLEASE DELIVER TO ARLEIGH NELLA @ 647-308-0048 TAG: SPIRIT OF YORK DANGEROUS GOODS - C-CLEAN-FORTE PROPER NAME: UN1814, POTASSIUM HYDROXIDE SOLUTION, CLASS 8 PG II"
    );
  });

  it("plans special-instructions compaction even when Garland and Teamship values match", () => {
    const messyInstructions = `PLEASE DELIVER TO ARLEIGH NELLA @ 647-308-0048
TAG: SPIRIT OF YORK
****************************************
***DANGEROUS GOODS - C-CLEAN-FORTE***
PROPER NAME: UN1814`;
    const plan = buildTeamshipPhase2DryRunPlan({
      ...sampleReview(),
      reviews: [
        {
          ...sampleReview().reviews[0]!,
          fields: [
            {
              key: "shipping_instructions",
              label: "Shipping instructions",
              status: "MATCH",
              pdfValue: messyInstructions,
              teamshipValue: messyInstructions,
              message: "Values match."
            }
          ]
        }
      ]
    });

    expect(plan.orders[0]?.plannedFieldUpdates).toEqual([
      expect.objectContaining({
        reviewFieldKey: "shipping_instructions",
        teamshipField: "edi_field_4",
        proposedValue:
          "PLEASE DELIVER TO ARLEIGH NELLA @ 647-308-0048 TAG: SPIRIT OF YORK DANGEROUS GOODS - C-CLEAN-FORTE PROPER NAME: UN1814",
        reason: expect.stringContaining("compacted for BOL space")
      })
    ]);
  });

  it("tells browser workers to click Add Another Pallet Size before filling row 2+", () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());
    const evidence = buildDryRunEvidence({
      job: { id: "job_1" },
      plan,
      agentId: "agent"
    });

    expect(evidence.orders[0]?.palletActions).toEqual([
      expect.objectContaining({
        rowNumber: 1,
        browserInstruction: expect.objectContaining({
          targetPage: "TEAMSHIP_ORDER_PALLETS",
          routeTemplate: "/ship-inventories/{teamshipOrderId}",
          actionBeforeFill: "FILL_EXISTING_PALLET_ROW",
          addAnotherPalletSizeButtonText: null,
          fieldSelectors: expect.objectContaining({
            packages: '[data-field-content="line_item_0_packages"]',
            commodity: '[data-field-content="line_item_0_commodity"]',
            dimensions: '[data-field-content="line_item_0_dimensions"]'
          })
        })
      }),
      expect.objectContaining({
        rowNumber: 2,
        browserInstruction: expect.objectContaining({
          actionBeforeFill: "CLICK_ADD_ANOTHER_PALLET_SIZE",
          addAnotherPalletSizeButtonText: "Add Another Pallet Size",
          targetRowNumber: 2
        })
      })
    ]);
  });

  it("gives browser workers exact order-field locations and save instructions", () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());
    const evidence = buildDryRunEvidence({
      job: { id: "job_1" },
      plan,
      agentId: "agent"
    });

    expect(evidence.orders[0]?.fieldActions[0]).toMatchObject({
      teamshipField: "edi_field_3",
      browserInstruction: {
        preferredExecution: "TEAMSHIP_API",
        browserFallbackPage: "TEAMSHIP_SHIPPING_ORDER",
        routeTemplate: "/ship-inventories/{teamshipOrderId}",
        fieldLabel: "Freight Terms Code",
        primaryLocator: {
          strategy: "LABEL_OR_NAME",
          label: "Freight Terms Code"
        },
        bolEditorFallback: {
          selector: '[data-field-content="instructions"]'
        },
        saveInstruction: {
          action: "CLICK_SAVE_BUTTON_AFTER_EDIT",
          buttonNames: ["Save", "Update", "Save Changes"]
        }
      }
    });
    expect(evidence.orders[0]?.saveInstruction).toMatchObject({
      action: "CLICK_SAVE_BUTTON_AFTER_EDIT",
      buttonNames: ["Save", "Update", "Save Changes"]
    });
  });

  it("uses the configured Teamship test app URL for browser update instructions", async () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());
    const result = await executeTeamshipPhase2Job({
      job: {
        id: "job_1",
        agentMode: "DRY_RUN",
        dryRun: true
      },
      plan,
      credentials: {
        email: "teamship@example.com",
        password: "secret",
        apiBaseUrl: "https://teamship-test.example/api",
        appBaseUrl: "https://teamship-test.example"
      },
      options: {
        agentId: "agent",
        allowLiveUpdates: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      }
    });

    expect(result.orders[0]?.fieldActions[0]?.browserInstruction.absoluteUrl).toBe(
      "https://teamship-test.example/ship-inventories/30202"
    );
    expect(result.orders[0]?.palletActions[0]?.browserInstruction.absoluteUrl).toBe(
      "https://teamship-test.example/ship-inventories/30202"
    );
  });

  it("derives the Teamship browser host from the configured API URL when no app URL is set", async () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());
    const result = await executeTeamshipPhase2Job({
      job: {
        id: "job_1",
        agentMode: "DRY_RUN",
        dryRun: true
      },
      plan,
      credentials: {
        email: "teamship@example.com",
        password: "secret",
        apiBaseUrl: "https://teamship-test.example/api"
      },
      options: {
        agentId: "agent",
        allowLiveUpdates: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      }
    });

    expect(result.orders[0]?.palletActions[0]?.browserInstruction.absoluteUrl).toBe(
      "https://teamship-test.example/ship-inventories/30202"
    );
  });

  it("blocks live jobs unless the VM worker explicitly allows live updates", async () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());

    await expect(
      executeTeamshipPhase2Job({
        job: {
          id: "job_1",
          agentMode: "LIVE_API",
          dryRun: false
        },
        plan,
        credentials: {
          email: "teamship@example.com",
          password: "secret",
          apiBaseUrl: "https://teamship.example/api"
        },
        options: {
          agentId: "agent",
          allowLiveUpdates: false,
          liveAllowlistSrNumbers: ["SR808478"],
          fetchImpl: vi.fn() as unknown as typeof fetch
        }
      })
    ).rejects.toThrow("Live Teamship updates require");
  });

  it("blocks live jobs before Teamship login when the SR is not allowlisted", async () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());
    const fetchImpl = vi.fn();

    await expect(
      executeTeamshipPhase2Job({
        job: {
          id: "job_1",
          agentMode: "LIVE_API",
          dryRun: false
        },
        plan,
        credentials: {
          email: "teamship@example.com",
          password: "secret",
          apiBaseUrl: "https://teamship.example/api"
        },
        options: {
          agentId: "agent",
          allowLiveUpdates: true,
          liveAllowlistSrNumbers: ["SR000000"],
          fetchImpl: fetchImpl as unknown as typeof fetch
        }
      })
    ).rejects.toThrow("not allowlisted");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("logs in and submits a live PATCH for each ready order when allowed", async () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { token: "token_123" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 30202 } }, 200));

    const result = await executeTeamshipPhase2Job({
      job: {
        id: "job_1",
        agentMode: "LIVE_API",
        dryRun: false
      },
      plan,
      credentials: {
        email: "teamship@example.com",
        password: "secret",
        apiBaseUrl: "https://teamship.example/api"
      },
      options: {
        agentId: "agent",
        allowLiveUpdates: true,
        liveAllowlistSrNumbers: ["SR808478"],
        fetchImpl: fetchImpl as unknown as typeof fetch
      }
    });

    expect(result).toMatchObject({
      mode: "LIVE_API",
      dryRun: false,
      wouldUpdateTeamship: true
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://teamship.example/api/v1/ship-inventories/30202",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          authorization: "Bearer token_123"
        }),
        body: expect.stringContaining("\"edi_field_3\":\"PPADD-CD\"")
      })
    );
  });

  it("preserves per-order evidence when a live Teamship update fails", async () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { token: "token_123" } }))
      .mockResolvedValueOnce(jsonResponse({ error: "bad request" }, 400));

    const result = await executeTeamshipPhase2Job({
      job: {
        id: "job_1",
        agentMode: "LIVE_API",
        dryRun: false
      },
      plan,
      credentials: {
        email: "teamship@example.com",
        password: "secret",
        apiBaseUrl: "https://teamship.example/api"
      },
      options: {
        agentId: "agent",
        allowLiveUpdates: true,
        liveAllowlistSrNumbers: ["SR808478"],
        fetchImpl: fetchImpl as unknown as typeof fetch
      }
    });

    expect(result.hasFailures).toBe(true);
    expect(result.orders[0]).toMatchObject({
      srNumber: "SR808478",
      status: "FAILED",
      error: "Teamship update failed with status 400.",
      updatePayload: expect.objectContaining({
        edi_field_3: "PPADD-CD"
      })
    });
  });
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function sampleReview(): GarlandTeamshipReviewResponse {
  return {
    summary: {
      pdfOrderCount: 1,
      teamshipMatchedCount: 1,
      passedCount: 0,
      failedCount: 1,
      missingTeamshipCount: 0,
      pendingTeamshipCount: 0,
      noPdfCount: 0,
      skippedAlreadyReviewedCount: 0
    },
    fetchedAt: "2026-07-12T00:00:00.000Z",
    teamshipAlerts: [],
    pdfOrders: [
      {
        pageNumbers: [1],
        psNumber: "PS210206",
        srNumber: "SR808478",
        shipToCode: null,
        shipToName: "J.R. MAHONEY LTD.",
        shipToAddress1: "1810 KINGS ROAD",
        shipToCity: "SYDNEY",
        shipToState: "NS",
        shipToPostalCode: "B1L 1C5",
        shipToCountry: "Canada",
        shipToPo: "0000037656",
        freightTerms: "PPADD-CD",
        orderDate: null,
        shipVia: "MIDLAND",
        instructions: "MIDLAND THIRD PARTY ACCOUNT",
        rawText: "",
        items: [
          {
            lineNumber: 1,
            sku: "E1SGHMV6XHU3US",
            description: "",
            quantity: 1,
            dueShipDate: null,
            serialNumbers: ["2604816191908"]
          },
          {
            lineNumber: 2,
            sku: "8030445",
            description: "",
            quantity: 4,
            dueShipDate: null,
            serialNumbers: []
          }
        ]
      }
    ],
    reviews: [
      {
        psNumber: "PS210206",
        srNumber: "SR808478",
        pageNumbers: [1],
        status: "FAIL",
        teamshipOrderId: "30202",
        teamshipUrl: "https://members.fulfillit.io/ship-inventories/30202",
        issueCount: 1,
        alert: null,
        fields: [
          {
            key: "freight_terms",
            label: "Freight terms",
            status: "MISSING",
            pdfValue: "PPADD-CD",
            teamshipValue: null,
            message: "PDF has a value, but Teamship does not."
          }
        ],
        pdfItems: [
          {
            sku: "E1SGHMV6XHU3US",
            quantity: "1",
            serialNumbers: ["2604816191908"]
          },
          {
            sku: "8030445",
            quantity: "4",
            serialNumbers: []
          }
        ],
        teamshipItems: [
          {
            sku: "E1SGHMV6XHU3US",
            quantity: "1",
            serialNumbers: ["2604816191908"]
          },
          {
            sku: "8030445",
            quantity: "4",
            serialNumbers: []
          }
        ],
        productDimensions: [
          {
            sku: "E1SGHMV6XHU3US",
            source: "TEAMSHIP_LEARNED",
            productType: null,
            quantity: null,
            lengthIn: 48,
            widthIn: 40,
            heightIn: 50,
            weightLb: 500,
            weightUnit: "lbs",
            confidence: "HIGH",
            note: "Learned from Teamship."
          },
          {
            sku: "8030445",
            source: "GARLAND_REFERENCE",
            productType: null,
            quantity: null,
            lengthIn: 10,
            widthIn: 10,
            heightIn: 10,
            weightLb: 25,
            weightUnit: "lbs",
            confidence: "MEDIUM",
            note: "Garland reference."
          }
        ]
      }
    ]
  };
}
