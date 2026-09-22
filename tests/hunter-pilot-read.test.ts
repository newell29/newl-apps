import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tenantModuleAccess: { findFirst: vi.fn() }, hunterAutomationPolicy: { findUnique: vi.fn() },
  company: { findMany: vi.fn() }, hunterOutreachSuppression: { findMany: vi.fn() },
  contact: { findMany: vi.fn() }
}));
vi.mock("@/server/db", () => ({ prisma: db }));
import { readHunterPilot as readPilotService, searchPilotPeople } from "@/modules/lead-gen/hunter-pilot-read";
const readHunterPilot = (input: Parameters<typeof readPilotService>[0]) => readPilotService(input,
  { tenantId: "tenant-a", tenantSlug: "synthetic", tenantName: "Synthetic" });

const identity = { id: "company-a", name: "Synthetic Supply Inc", normalizedName: "synthetic-supply", domain: "supply.example" };
const safe = { ...identity, doNotProspect: false, candidateStatus: "NEW", cashflowCustomers: [],
  operatingRelationships: [], customerSourceAccounts: [], leads: [], contacts: [] };
const companyInput = { action: "company", name: "Synthetic Supply", domain: "supply.example" };

describe("Hunter pilot read-only bridge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("HUNTER_PILOT_ENABLED", "true");
    vi.stubEnv("APOLLO_MASTER_API", "synthetic-key");
    db.tenantModuleAccess.findFirst.mockResolvedValue({ id: "access-a" });
    db.hunterAutomationPolicy.findUnique.mockResolvedValue({ mode: "DRY_RUN", killSwitch: false });
    db.company.findMany.mockResolvedValue([]);
    db.hunterOutreachSuppression.findMany.mockResolvedValue([]);
    db.contact.findMany.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ people: [] }) }));
  });

  it("requires explicit enablement before authentication or data access", async () => {
    vi.stubEnv("HUNTER_PILOT_ENABLED", "false");
    await expect(readHunterPilot({ action: "context" })).rejects.toThrow("PILOT_DISABLED");
    expect(db.company.findMany).not.toHaveBeenCalled();
  });
  it("rejects failed authentication", async () => {
    await expect(readPilotService(companyInput, { tenantId: "", tenantSlug: "", tenantName: "" })).rejects.toThrow("TENANT_REQUIRED");
    expect(db.company.findMany).not.toHaveBeenCalled();
  });
  it.each([{ mode: "OFF", killSwitch: false }, { mode: "ASSISTED", killSwitch: true }])("honors off/kill controls %j", async policy => {
    db.hunterAutomationPolicy.findUnique.mockResolvedValue(policy);
    await expect(readHunterPilot(companyInput)).rejects.toThrow("HUNTER_DISABLED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed without module access or a stored policy", async () => {
    db.tenantModuleAccess.findFirst.mockResolvedValue(null);
    await expect(readHunterPilot(companyInput)).rejects.toThrow("HUNTER_DISABLED");
    db.tenantModuleAccess.findFirst.mockResolvedValue({ id: "access-a" });
    db.hunterAutomationPolicy.findUnique.mockResolvedValue(null);
    await expect(readHunterPilot(companyInput)).rejects.toThrow("HUNTER_DISABLED");
  });
  it("scopes every shared lookup to the authenticated tenant, ignoring injected tenant input", async () => {
    const result = await readHunterPilot({ ...companyInput, tenantId: "attacker" } as typeof companyInput);
    expect(result).toMatchObject({ tenantId: "tenant-a", allowed: true });
    for (const mock of [db.company.findMany, db.hunterOutreachSuppression.findMany, db.tenantModuleAccess.findFirst, db.hunterAutomationPolicy.findUnique]) {
      expect(mock.mock.calls[0][0].where.tenantId).toBe("tenant-a");
    }
  });
  it.each(["send", "enrich", "approve", "enroll", "save_contact"])("has no %s capability", async action => {
    await expect(readHunterPilot({ action })).rejects.toThrow("ACTION_NOT_ALLOWED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { doNotProspect: true }, { candidateStatus: "DISQUALIFIED" }, { cashflowCustomers: [{ id: "customer-a" }] },
    { operatingRelationships: [{ id: "relationship-a" }] }, { customerSourceAccounts: [{ id: "source-a" }] },
    { leads: [{ id: "lead-a" }] }, { contacts: [{ id: "contact-a" }] }
  ])("preserves customer/pipeline/contact holds %j", async hold => {
    db.company.findMany.mockResolvedValueOnce([identity]).mockResolvedValueOnce([{ ...safe, ...hold }]);
    expect(await readHunterPilot(companyInput)).toMatchObject({ allowed: false, reason: "EXISTING_RELATIONSHIP_OR_CONTACT_HOLD" });
  });
  it("does not remap a conflicting operating company domain", async () => {
    db.company.findMany.mockResolvedValueOnce([{ ...identity, domain: "other.example" }])
      .mockResolvedValueOnce([{ ...safe, domain: "other.example" }]);
    expect(await readHunterPilot(companyInput)).toMatchObject({ allowed: false, reason: "IDENTITY_CONFLICT" });
  });
  it.each([
    { scope: "DOMAIN", value: "https://www.supply.example", companyId: null },
    { scope: "COMPANY", value: "Synthetic Supply LLC", companyId: null },
    { scope: "COMPANY", value: "company-a", companyId: "company-a" }
  ])("honors suppression variants %j", async suppression => {
    db.company.findMany.mockResolvedValue([identity]);
    db.hunterOutreachSuppression.findMany.mockResolvedValue([suppression]);
    expect(await readHunterPilot(companyInput)).toMatchObject({ allowed: false, reason: "SUPPRESSED" });
  });
  it("does not silently truncate safety lookups", async () => {
    db.company.findMany.mockResolvedValue(Array(20001).fill(identity));
    await expect(readHunterPilot(companyInput)).rejects.toThrow("SAFETY_LOOKUP_LIMIT");
  });
  it("retains plausible buyers with masked names and unrevealed emails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ people: [
      { id: "person-a", first_name: "Synthetic", last_name_obfuscated: "T***", title: "Director of Operations",
        has_email: true, last_refreshed_at: "2026-09-20T12:00:00Z",
        linkedin_url: "https://www.linkedin.com/in/synthetic-person/", organization: { name: "Synthetic Supply" } }
    ] }) } as Response);
    const result = await readHunterPilot({ ...companyInput, action: "people", titles: ["operations"] });
    expect(result).toMatchObject({ result: "PEOPLE_FOUND_EMAIL_NOT_REVEALED", candidates: [
      { id: "person-a", firstName: "Synthetic", lastNameHint: "T***", emailAvailable: true,
        emailState: "NOT_REVEALED", employmentVerified: false,
        employmentSource: "APOLLO_PEOPLE_SEARCH_UNVERIFIED", lastRefreshedAt: "2026-09-20T12:00:00Z",
        linkedinUrl: "https://www.linkedin.com/in/synthetic-person/" }
    ] });
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.apollo.io/api/v1/mixed_people/api_search");
    expect(JSON.parse(String(request?.body))).toMatchObject({ per_page: 10, page: 1, q_organization_domains_list: ["supply.example"] });
    expect(db.contact.findMany.mock.calls[0][0].where.tenantId).toBe("tenant-a");
  });
  it("distinguishes an empty roster from missing emails", async () => {
    expect(await readHunterPilot({ ...companyInput, action: "people", titles: ["operations"] })).toMatchObject({ result: "NO_PEOPLE_RETURNED", candidates: [] });
  });
  it("discards an explicit employer-domain mismatch without treating absent employer data as verified", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ people: [
      { id: "wrong-company", title: "Owner", organization: { primary_domain: "unrelated.example" } },
      { id: "partial", title: "Owner" },
      { id: "same-domain", title: "Operations", organization: { primary_domain: "www.supply.example" } }
    ] }) } as Response);
    const people = await searchPilotPeople("supply.example", ["owner"]);
    expect(people.map(p => p.id)).toEqual(["partial", "same-domain"]);
    expect(people.every(p => p.employmentVerified === false)).toBe(true);
  });
  it("keeps referral commercial roles instead of imposing a logistics-buyer filter", async () => {
    await readHunterPilot({ ...companyInput, action: "people", titles: ["business development", "owner"] });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).person_titles).toEqual(["business development", "owner"]);
  });
  it("omits tracked contacts across company aliases", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ people: [{ id: "person-a", title: "Owner" }] }) } as Response);
    db.contact.findMany.mockResolvedValue([{ id: "contact-a", apolloPersonId: "person-a" }]);
    expect(await readHunterPilot({ ...companyInput, action: "people", titles: ["owner"] })).toMatchObject({ result: "TRACKED_OR_SUPPRESSED_CONTACTS", candidates: [] });
  });
  it("fails closed on malformed or unavailable Apollo data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    await expect(searchPilotPeople("supply.example", ["owner"])).rejects.toThrow("APOLLO_INVALID_RESPONSE");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429 } as Response);
    await expect(searchPilotPeople("supply.example", ["owner"])).rejects.toThrow("APOLLO_HTTP_429");
  });
  it("does not turn incomplete person records into usable contacts", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ people: [{ title: "Owner" }, { id: "p" }, { id: "q", title: "Operations" }] }) } as Response);
    expect(await searchPilotPeople("supply.example", ["operations"])).toEqual([
      { id: "q", title: "Operations", firstName: null, lastNameHint: null, organization: null,
        lastRefreshedAt: null, linkedinUrl: null, emailAvailable: false, emailState: "NOT_REVEALED",
        employmentVerified: false, employmentSource: "APOLLO_PEOPLE_SEARCH_UNVERIFIED", nameMasked: true }
    ]);
  });

  it("rejects unsafe or malformed public-profile metadata", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ people: [
      { id: "person-a", title: "Operations", linkedin_url: "https://example.com/not-linkedin",
        last_refreshed_at: "not-a-date" }
    ] }) } as Response);
    expect(await searchPilotPeople("supply.example", ["operations"])).toEqual([
      expect.objectContaining({ id: "person-a", linkedinUrl: null, lastRefreshedAt: null,
        employmentVerified: false })
    ]);
  });
});
