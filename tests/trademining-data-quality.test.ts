import { describe, expect, it } from "vitest";
import { summarizeTradeMiningDataQuality } from "@/modules/operations/trademining-data-quality";

describe("summarizeTradeMiningDataQuality", () => {
  it("marks complete canonical rows as score-ready", () => {
    const summary = summarizeTradeMiningDataQuality([
      {
        id: "record-1",
        rawRecordKey: "record-1",
        arrivalDate: new Date("2026-06-22T12:00:00.000Z"),
        importerName: "Acme Imports",
        consigneeName: null,
        shipperName: null,
        destinationCity: "Houston",
        destinationState: "TX",
        originCountry: "China",
        productDescription: "Industrial pumps",
        company: { name: "Acme Imports" },
        rawJson: {
          record: {
            teu: 2,
            destinationPort: "Houston",
            hsCode: "8413.70"
          }
        }
      }
    ]);

    expect(summary.summary.sampleSize).toBe(1);
    expect(summary.summary.scoreReadyCount).toBe(1);
    expect(summary.summary.attentionCount).toBe(0);
    expect(summary.coverage.find((item) => item.key === "volumeSignal")?.coveragePercent).toBe(100);
    expect(summary.samples[0]?.missingFields).toEqual([]);
  });

  it("flags missing critical fields and accepts snake_case raw data", () => {
    const summary = summarizeTradeMiningDataQuality([
      {
        id: "record-1",
        rawRecordKey: "record-1",
        arrivalDate: null,
        importerName: null,
        consigneeName: "Beta Trading",
        shipperName: null,
        destinationCity: null,
        destinationState: null,
        originCountry: null,
        productDescription: null,
        company: null,
        rawJson: {
          rawData: {
            destination_market: "Charlotte",
            origin_country: "Vietnam",
            product_description: "Home fixtures",
            container_count: 3
          }
        }
      }
    ]);

    expect(summary.summary.scoreReadyCount).toBe(0);
    expect(summary.summary.attentionCount).toBe(1);
    expect(summary.coverage.find((item) => item.key === "destinationSignal")?.coveragePercent).toBe(100);
    expect(summary.coverage.find((item) => item.key === "originSignal")?.coveragePercent).toBe(100);
    expect(summary.coverage.find((item) => item.key === "volumeSignal")?.coveragePercent).toBe(100);
    expect(summary.samples[0]?.missingFields).toContain("Shipment date");
  });
});
