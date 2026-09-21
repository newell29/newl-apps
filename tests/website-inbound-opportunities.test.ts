import { describe, expect, it } from "vitest";
import {
  buildOpportunityWhere,
  dateValue,
  inboundUrl,
  normalizePhone,
  parseFilters,
  parseNote,
  parseOpportunity,
  safeReturnUrl,
  todayDate
} from "@/modules/website-inbound/opportunities";

export function opportunityForm(overrides: Record<string, string | undefined> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    company: "Synthetic Example",
    name: "Test Contact",
    phone: "+1 (202) 555-0100",
    primaryNeed: "Warehousing and fulfillment",
    status: "NEW",
    contactChannel: "PHONE",
    receivedOn: "2026-09-16",
    ...overrides
  })) {
    if (value !== undefined) form.set(key, value);
  }
  return form;
}

describe("inbound opportunity validation", () => {
  it("accepts a phone-only manual enquiry and normalizes duplicate evidence", () => {
    const data = parseOpportunity(opportunityForm({ company: "", name: "" }), true);
    expect(data.email).toBeNull();
    expect(data.phoneNormalized).toBe("12025550100");
    expect(normalizePhone(null)).toBeNull();
  });
  it.each([
    { company: "", name: "", phone: "", email: "" },
    { company: "", name: "", phone: "202-555-0100", email: "" }
  ])("lets historical submissions with absent or partial contact evidence be updated", (fields) => {
    const data = parseOpportunity(
      opportunityForm({
        ...fields,
        contactChannel: "WEBSITE_FORM",
        primaryNeed: "Storage and trucking"
      })
    );
    expect(data.primaryNeed).toBe("Storage and trucking");
    expect(data.email).toBeNull();
  });
  it("requires identity only for new manual entries and never fabricates missing values", () => {
    expect(() =>
      parseOpportunity(opportunityForm({ company: "", name: "", phone: "" }), true)
    ).toThrow("Enter a company");
    expect(() =>
      parseOpportunity(opportunityForm({ contactChannel: "WEBSITE_FORM" }), true)
    ).toThrow("manual enquiry");
  });
  it.each([
    { status: "toString" },
    { status: "INVALID" },
    { contactChannel: "__proto__" },
    { email: "not-an-email" },
    { receivedOn: "2026-02-30" },
    { followUpOn: "2026-13-01" },
    { receivedOn: "" },
    { primaryNeed: "x".repeat(2001) },
    { status: "LOST", closedReason: " " }
  ])("rejects invalid input: %j", (fields) =>
    expect(() => parseOpportunity(opportunityForm(fields))).toThrow()
  );
  it("requires a lost reason and bounds notes", () => {
    expect(
      parseOpportunity(opportunityForm({ status: "LOST", closedReason: " Project cancelled " }))
        .closedReason
    ).toBe("Project cancelled");
    expect(() => parseNote(opportunityForm({ note: " " }))).toThrow();
    expect(() => parseNote(opportunityForm({ note: "x".repeat(5001) }))).toThrow();
    expect(parseNote(opportunityForm({ note: " Customer requested a quote " }))).toBe(
      "Customer requested a quote"
    );
  });
});

describe("opportunity queue filters", () => {
  it("keeps every view tenant-scoped, excludes finance records, and uses date-only Toronto boundaries", () => {
    expect(todayDate(new Date("2026-09-17T02:30:00Z"))).toBe("2026-09-16");
    expect(todayDate(new Date("2026-01-17T04:30:00Z"))).toBe("2026-01-16");
    const where = buildOpportunityWhere(
      "tenant-a",
      "user-a",
      parseFilters({ view: "OVERDUE" }),
      "2026-09-16"
    );
    expect(where).toMatchObject({
      tenantId: "tenant-a",
      NOT: { formType: "account_setup" },
      AND: expect.arrayContaining([{ followUpOn: { lt: new Date("2026-09-16T00:00:00Z") } }])
    });
    expect(JSON.stringify(where)).toContain(
      '"notIn":["WON","LOST","DISQUALIFIED","TEST","CONVERTED","CLOSED"]'
    );
    expect(dateValue("2026-09-16", "date")?.toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });
  it("allows selecting a closed status from the default open view", () => {
    const where = buildOpportunityWhere("tenant-a", "user-a", parseFilters({ status: "WON" }));
    expect(where.AND).toEqual([{ status: "WON" }]);
  });
  it("combines owner, channel, service, source and inclusive enquiry-date filters", () => {
    const filters = parseFilters({
      view: "MINE",
      channel: "EMAIL",
      formType: "assessment",
      service: "storage",
      source: "Website",
      from: "2026-09-01",
      to: "2026-09-16",
      search: "555-0100"
    });
    const where = buildOpportunityWhere("tenant-a", "user-a", filters);
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { ownerUserId: "user-a" },
        { formType: "assessment" },
        { contactChannel: "EMAIL" },
        { primaryNeed: { contains: "storage", mode: "insensitive" } },
        { receivedOn: { gte: new Date("2026-09-01Z"), lte: new Date("2026-09-16Z") } }
      ])
    );
    expect(JSON.stringify(where)).toContain('"phone":{"contains":"555-0100"');
  });
  it("normalizes malformed filters and preserves All and selected records in local URLs", () => {
    expect(
      parseFilters({ status: "__proto__", view: "toString", page: "NaN", from: "2026-02-30" })
    ).toMatchObject({ status: "ALL", view: "OPEN", page: 1, from: "" });
    expect(inboundUrl(parseFilters({ view: "ALL" }), { selected: "row-a" })).toContain("view=ALL");
    expect(safeReturnUrl("https://example.com/phishing", "row-a")).toMatch(/^\/website-inbound\?/);
    expect(safeReturnUrl("/website-inbound?view=ALL&search=storage&add=1", "row-a")).toContain(
      "search=storage"
    );
    expect(safeReturnUrl("/website-inbound?add=1", "row-a")).not.toContain("add=");
  });
});
