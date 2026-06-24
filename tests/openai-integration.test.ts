import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateTier1SequenceDraft,
  isOpenAiDraftGenerationConfigured
} from "@/server/integrations/openai";

describe("openai draft generation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports when live draft generation is configured", () => {
    expect(isOpenAiDraftGenerationConfigured()).toBe(true);
    vi.stubEnv("OPENAI_API_KEY", "OPENAI_API_KEY_PLACEHOLDER");
    expect(isOpenAiDraftGenerationConfigured()).toBe(false);
  });

  it("parses a valid AI draft response", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                subject: "Harbor Home import activity",
                body: "Hi Jordan,\n\nI noticed Harbor Home has recent import activity moving through Houston.\n\nNewl Group may be able to support the port move, warehousing, and final-mile side.\n\nOpen to a quick conversation?",
                personalizationNotes: "Referenced recent import activity, Houston, and the contact's supply chain role."
              })
            }
          }
        ]
      })
    } as unknown as Response);

    const result = await generateTier1SequenceDraft({
      model: "gpt-5-mini",
      companyName: "Harbor Home Retail LLC",
      contactFirstName: "Jordan",
      contactFullName: "Jordan Demo",
      contactTitle: "Director of Supply Chain",
      contactDepartment: "Logistics",
      contactSeniority: "director",
      selectedSequenceName: "Tier 1 Sequence",
      shipmentCount: 4,
      arrivalPort: "Houston",
      destinationCity: "Houston",
      destinationState: "TX",
      destinationMarket: "Houston, TX",
      originCountry: "Italy",
      originPort: "Genoa",
      foreignPort: "La Spezia",
      shipFromPort: "Milan",
      placeOfReceipt: "Milan",
      productDescription: "Residential furniture",
      hsCode: "9403",
      totalTeu: 6,
      carrier: "MSC",
      vessel: "MSC Aurora",
      voyage: "A12",
      searchProfileName: "Houston Import Leads",
      profileDestinationMarkets: ["Houston", "Dallas"],
      profileProductKeywords: ["furniture", "fixtures"],
      recurringOrigins: ["Italy", "Spain"],
      recurringDestinationPorts: ["Houston"],
      recurringCarriers: ["MSC"],
      recurringProducts: ["Residential furniture"],
      recentShipmentHighlights: ["Jun 20, 2026 | Houston, TX | Houston | Italy | Residential furniture"]
    });

    expect(result.subject).toBe("Harbor Home import activity");
    expect(result.body).toContain("Hi Jordan");
    expect(result.personalizationNotes).toContain("Houston");

    const requestBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(requestBody.messages[0].content).toContain("earn a reply");
    expect(requestBody.messages[1].content).toContain("recentShipmentHighlights");
  });

  it("fails cleanly when the model returns incomplete JSON", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                subject: "Missing body"
              })
            }
          }
        ]
      })
    } as unknown as Response);

    await expect(
      generateTier1SequenceDraft({
        model: "gpt-5-mini",
        companyName: "Harbor Home Retail LLC",
        contactFirstName: "Jordan",
        contactFullName: "Jordan Demo",
        contactTitle: "Director of Supply Chain",
        contactDepartment: "Logistics",
        contactSeniority: "director",
        selectedSequenceName: "Tier 1 Sequence",
        shipmentCount: 4,
        arrivalPort: "Houston",
        destinationCity: "Houston",
        destinationState: "TX",
        destinationMarket: "Houston, TX",
        originCountry: "Italy",
        originPort: "Genoa",
        foreignPort: "La Spezia",
        shipFromPort: "Milan",
        placeOfReceipt: "Milan",
        productDescription: "Residential furniture",
        hsCode: "9403",
        totalTeu: 6,
        carrier: "MSC",
        vessel: "MSC Aurora",
        voyage: "A12",
        searchProfileName: "Houston Import Leads",
        profileDestinationMarkets: ["Houston"],
        profileProductKeywords: ["furniture"],
        recurringOrigins: ["Italy"],
        recurringDestinationPorts: ["Houston"],
        recurringCarriers: ["MSC"],
        recurringProducts: ["Residential furniture"],
        recentShipmentHighlights: ["Jun 20, 2026 | Houston, TX | Houston | Italy | Residential furniture"]
      })
    ).rejects.toThrow("OpenAI returned an incomplete draft payload.");
  });
});
