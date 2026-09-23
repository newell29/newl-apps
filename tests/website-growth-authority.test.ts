import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_JOB, authorityId, CAMPAIGN_JOB, parsePlan, placementEvidence, readAction, type Plan } from "@/modules/website-growth/authority/model";
import { authorityOutcomes, beginAuthorityAction, claimAuthorityAction, executeAuthorityAction, finishAuthorityAction,
  prepareAuthorityExecution, proposeAuthorityActions, rejectLegacyAuthority, reviewAuthorityAction } from "@/modules/website-growth/authority/store";
import { record } from "@/modules/website-growth/scout/model";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({ send: vi.fn(), sync: vi.fn(), fetch: vi.fn(), graph: vi.fn(), token: vi.fn(),
  db: { automationJobRun: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    websiteGrowthBacklinkOpportunity: { findFirst: vi.fn(), findFirstOrThrow: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    websiteGrowthOutreachSuppression: { findUnique: vi.fn() }, websiteGrowthOutreachMessage: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]) }));
vi.mock("@/server/db", () => ({ prisma: mocks.db }));
vi.mock("@/modules/website-growth/backlink-outreach", async original => ({ ...await original<object>(), sendWebsiteGrowthOutreachEmail: mocks.send,
  syncWebsiteGrowthOutreachReplies: mocks.sync, fetchWebsiteGrowthPublicContactEvidence: mocks.fetch,
  readWebsiteGrowthOutreachIdentity: () => ({ publicBrandName: "Example", senderName: "Editor", publicPhone: "+1 555 0100", website: "https://brand.example.com", mailbox: "partnerships@example.com", usLegalName: "Example", usAddress: "Example address", canadianLegalName: "Example", canadianAddress: "Example address" }) }));
vi.mock("@/server/integrations/microsoft-graph-application", () => ({ getMicrosoftGraphApplicationAccessToken: mocks.token }));
vi.mock("@/server/integrations/microsoft-graph-mail", () => ({ createAndSendMicrosoftGraphMailboxMessage: mocks.graph }));

type Row = { id: string; tenantId: string; jobType: string; input?: unknown; output?: unknown; startedAt?: Date; status?: string };
const rows = new Map<string, Row>();
const tenant = "tenant-synthetic";
const now = new Date("2026-09-23T14:00:00Z");
const opportunity = () => ({ id: "publisher-synthetic", tenantId: tenant, title: "Operations resource", sourceDomain: "publisher.example.com",
  category: "RESOURCE_PAGE", status: "NEEDS_REVIEW", updatedAt: now, lastReplyAt: null as Date | null, unsubscribedAt: null,
  messages: [] as Array<{ kind: string; externalMessageId: string | null; conversationId: string | null }>, followUpCount: 0,
  targetPage: "https://brand.example.com/resources/guide", contactedAt: null as Date | null, submittedAt: null as Date | null,
  nextFollowUpAt: null as Date | null, recipientEmail: "editor@publisher.example.com", recipientCountry: "US", consentBasis: "US_BUSINESS_OUTREACH" });
let publisher = opportunity();
const plan = () => ({ opportunityId: publisher.id, method: "EMAIL", route: "https://publisher.example.com/contact", recipientEmail: "editor@publisher.example.com",
  recipientCountry: "US", consentBasis: "US_BUSINESS_OUTREACH", subject: "Useful distribution checklist", body: "Would a practical checklist help your readers?",
  fields: [] as Plan["fields"], evidence: "The current contact page publishes this editorial address and invites relevant resources.", checkedAt: now.toISOString(),
  completion: "Microsoft accepts exact copy; later verify the public placement separately.", reason: "Relevant operational audience", free: true, accountRequired: false, termsUrl: "" });
function matches(row: Row, where: Record<string, unknown>) {
  if (where.tenantId && row.tenantId !== where.tenantId) return false;
  if (where.id && row.id !== where.id) return false;
  if (where.jobType && row.jobType !== where.jobType) return false;
  const filter = record(where.output);
  if (Array.isArray(filter.path)) {
    let value: unknown = row.output;
    for (const part of filter.path) value = record(value)[String(part)];
    if (value !== filter.equals) return false;
  }
  return true;
}
function action(id: string) { return readAction(rows.get(id)?.output)!; }
async function proposal(value = plan()) {
  return (await proposeAuthorityActions(mocks.db as unknown as Prisma.TransactionClient, tenant, [value], now))[0];
}
async function approveClaim(value = plan()) {
  const id = await proposal(value);
  await reviewAuthorityAction(tenant, "owner-synthetic", id, 0, "APPROVE", "Exact action reviewed.");
  const claimed = await claimAuthorityAction(tenant, "claim-synthetic", now);
  return { id, lease: claimed!.lease! };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never); vi.useFakeTimers(); vi.setSystemTime(now); rows.clear(); publisher = opportunity();
  rows.set("campaign", { id: authorityId(tenant, "pilot"), tenantId: tenant, jobType: CAMPAIGN_JOB,
    input: { version: 1, title: "Synthetic pilot", targetPage: publisher.targetPage, enabled: true } });
  mocks.db.$transaction.mockImplementation(async fn => Array.isArray(fn) ? Promise.all(fn) : fn(mocks.db));
  mocks.db.automationJobRun.findFirst.mockImplementation(async ({ where }) => [...rows.values()].find(row => matches(row, where)) ?? null);
  mocks.db.automationJobRun.findMany.mockImplementation(async ({ where }) => [...rows.values()].filter(row => matches(row, where)));
  mocks.db.automationJobRun.upsert.mockImplementation(async ({ create }) => { if (!rows.has(create.id)) rows.set(create.id, create); return rows.get(create.id); });
  mocks.db.automationJobRun.create.mockImplementation(async ({ data }) => { const row = { ...data, id: `row-${rows.size}` }; rows.set(row.id, row); return row; });
  mocks.db.automationJobRun.updateMany.mockImplementation(async ({ where, data }) => {
    const row = [...rows.values()].find(row => matches(row, where)); if (!row) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  mocks.db.websiteGrowthBacklinkOpportunity.findFirst.mockImplementation(async ({ where }) => where.tenantId === tenant && where.id === publisher.id ? { ...publisher } : null);
  mocks.db.websiteGrowthBacklinkOpportunity.findFirstOrThrow.mockImplementation(async () => ({ ...publisher }));
  mocks.db.websiteGrowthBacklinkOpportunity.findMany.mockResolvedValue([publisher]);
  mocks.db.websiteGrowthBacklinkOpportunity.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.tenantId !== tenant || where.id !== publisher.id) return { count: 0 };
    Object.assign(publisher, data, { updatedAt: new Date(now.getTime() + 1) }); return { count: 1 };
  });
  mocks.db.websiteGrowthOutreachSuppression.findUnique.mockResolvedValue(null);
  mocks.db.websiteGrowthOutreachMessage.count.mockResolvedValue(0);
  mocks.db.websiteGrowthOutreachMessage.create.mockImplementation(async ({ data }) => data);
  mocks.db.websiteGrowthOutreachMessage.update.mockResolvedValue({});
  mocks.db.websiteGrowthBacklinkOpportunity.update.mockImplementation(async ({ data }) => Object.assign(publisher, data));
  mocks.sync.mockResolvedValue({ replies: 0 }); mocks.send.mockResolvedValue({ status: "CONTACTED" });
  mocks.graph.mockResolvedValue({ id: "message-synthetic", conversationId: "conversation-synthetic" });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("authority feasibility and placement evidence", () => {
  it("rejects completely missing and partially populated email evidence", () => {
    expect(() => parsePlan({})).toThrow();
    expect(() => parsePlan({ ...plan(), recipientCountry: "" })).toThrow("exact recipient");
    expect(() => parsePlan({ ...plan(), checkedAt: "2026-08-01" })).toThrow("seven days");
    expect(() => parsePlan({ ...plan(), route: "https://127.0.0.1" })).toThrow("public HTTPS");
  });
  it("routes account-dependent, paid, and unknown form work away from executable approval", () => {
    expect(() => parsePlan({ ...plan(), method: "FORM", fields: [] })).toThrow();
    expect(() => parsePlan({ ...plan(), accountRequired: true })).toThrow("human-action");
    expect(() => parsePlan({ ...plan(), free: false })).toThrow("human-action");
    expect(() => parsePlan({ ...plan(), fields: [{ label: "Password", value: "synthetic" }] })).toThrow("Protected");
  });
  it("does not turn mentions, comments, scripts or different pages into verified placements", () => {
    const target = publisher.targetPage, source = plan().route;
    expect(placementEvidence(`<!-- <a href="${target}">hidden</a> --><script><a href="${target}">script</a></script>${target}`, source, target)).toBeNull();
    expect(placementEvidence('<a href="https://brand.example.com/different">Wrong</a>', source, target)).toBeNull();
    expect(placementEvidence(`<a rel="nofollow" href="${target}?utm_source=publisher">Guide</a>`, source, target)).toMatchObject({ rel: "nofollow", anchor: "Guide" });
  });
});
describe("supervisor to executor walkthroughs", () => {
  it("walks through the real mail service state/consent/reservation/footer contract with only network transports mocked", async () => {
    const actual = await vi.importActual<typeof import("@/modules/website-growth/backlink-outreach")>("@/modules/website-growth/backlink-outreach");
    for (const [key, value] of Object.entries({ MAILBOX: "partnerships@example.com", SENDER_NAME: "Editor", PUBLIC_BRAND: "Example Logistics", PUBLIC_PHONE: "+1 555 0100", WEBSITE: "https://brand.example.com", CANADA_LEGAL_NAME: "Example Canada", CANADA_ADDRESS: "Synthetic Canadian business address", US_LEGAL_NAME: "Example US", US_ADDRESS: "Synthetic US business address" })) vi.stubEnv(`WEBSITE_GROWTH_OUTREACH_${key}`, value);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('<a href="mailto:editor@publisher.example.com">Editorial submissions</a>', { headers: { "content-type": "text/html" } })));
    let mailFailure: unknown = null;
    mocks.send.mockImplementation(async input => { try { return await actual.sendWebsiteGrowthOutreachEmail(input); } catch (error) { mailFailure = error; throw error; } });
    const { id, lease } = await approveClaim();
    const result = await executeAuthorityAction(tenant, id, lease);
    expect(mailFailure).toBeNull();
    expect(result).toMatchObject({ state: "SUBMITTED" });
    expect(mocks.graph).toHaveBeenCalledOnce();
    expect(mocks.graph.mock.calls[0][2]).toMatchObject({ recipientEmail: plan().recipientEmail, subject: plan().subject, body: expect.stringContaining("unsubscribe") });
    expect(publisher.status).toBe("CONTACTED");
    expect(mocks.db.websiteGrowthOutreachMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: tenant, kind: "INITIAL" }) }));
  });
  it("keeps new proposals unexecuted until exact approval, then sends once", async () => {
    const id = await proposal();
    expect(action(id).state).toBe("REVIEW"); expect(await claimAuthorityAction(tenant, "not-approved", now)).toBeNull();
    await reviewAuthorityAction(tenant, "owner-synthetic", id, 0, "APPROVE", "Exact action reviewed.");
    const claimed = await claimAuthorityAction(tenant, "claim-synthetic", now);
    expect((await claimAuthorityAction(tenant, "claim-synthetic", now))?.lease).toBe(claimed?.lease);
    expect(await claimAuthorityAction(tenant, "competing-claim", now)).toBeNull();
    expect(await executeAuthorityAction(tenant, id, claimed!.lease!)).toMatchObject({ state: "SUBMITTED" });
    expect(mocks.send).toHaveBeenCalledOnce(); expect(action(id).state).toBe("SUBMITTED");
    await expect(executeAuthorityAction(tenant, id, claimed!.lease!)).rejects.toThrow("lease");
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it("completes a positive reply's guest submission and independently verifies a placement", async () => {
    publisher.status = "REPLIED"; publisher.lastReplyAt = now;
    const { id, lease } = await approveClaim({ ...plan(), method: "FORM", fields: [{ label: "Business name", value: "Example Logistics" }], termsUrl: "https://publisher.example.com/terms" });
    await beginAuthorityAction(tenant, id, lease);
    await expect(beginAuthorityAction(tenant, id, lease)).rejects.toThrow("already reserved");
    await finishAuthorityAction(tenant, id, lease, { state: "SUBMITTED", detail: "Publisher displayed submission receipt reference SYNTHETIC-123." });
    expect((await finishAuthorityAction(tenant, id, lease, { state: "SUBMITTED", detail: "Same acknowledgement" })).state).toBe("SUBMITTED");
    await expect(proposal({ ...plan(), method: "FORM", fields: [{ label: "Name", value: "Example" }], termsUrl: "https://publisher.example.com/terms" })).rejects.toThrow("already attempted");
    const verification = await proposal({ ...plan(), method: "VERIFY", route: "https://publisher.example.com/listing" });
    const claimed = await claimAuthorityAction(tenant, "verification-claim", now);
    mocks.fetch.mockResolvedValue(`<a href="${publisher.targetPage}">Distribution guide</a>`);
    expect(await executeAuthorityAction(tenant, verification, claimed!.lease!)).toMatchObject({ state: "LIVE" });
    expect(authorityOutcomes([...rows.values()].filter(r => r.jobType === ACTION_JOB).map(r => ({ id: r.id, ...readAction(r.output)! }))).verifiedPlacements).toBe(1);
  });
  it("holds an interrupted send and never recycles it as fresh approved work", async () => {
    const { id, lease } = await approveClaim(); mocks.send.mockRejectedValue(new Error("Synthetic timeout"));
    expect(await executeAuthorityAction(tenant, id, lease)).toMatchObject({ state: "UNCERTAIN" });
    expect(await claimAuthorityAction(tenant, "new-claim", now)).toBeNull();
    expect(await proposal()).toBeUndefined();
    await expect(reviewAuthorityAction(tenant, "owner", id, action(id).revision, "APPROVE", "Try again")).rejects.toThrow("Reconcile");
  });
  it("isolates a blocked form and records concrete evidence without marking it live", async () => {
    const { id, lease } = await approveClaim({ ...plan(), method: "FORM", fields: [{ label: "Name", value: "Example" }], termsUrl: "https://publisher.example.com/terms" });
    await expect(finishAuthorityAction(tenant, id, lease, { state: "LIVE", detail: "Model says it worked" })).rejects.toThrow("server verification");
    await finishAuthorityAction(tenant, id, lease, { state: "BLOCKED", detail: "Publisher now requires phone verification. Owner must verify account; retrying will not help." });
    expect(action(id).state).toBe("BLOCKED"); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("holds unavailable verification rather than inventing a lost or zero result", async () => {
    const id = await proposal({ ...plan(), method: "VERIFY" }); const claimed = await claimAuthorityAction(tenant, "verify", now);
    mocks.fetch.mockRejectedValue(new Error("403")); await executeAuthorityAction(tenant, id, claimed!.lease!);
    expect(action(id).state).toBe("BLOCKED"); expect(publisher.status).toBe("NEEDS_REVIEW");
  });
  it("records an empty wake without claiming or sending and expires interrupted reservations", async () => {
    expect(await prepareAuthorityExecution(tenant, now)).toMatchObject({ ready: 0, sync: "OK" });
    expect(mocks.send).not.toHaveBeenCalled();
    const { id, lease } = await approveClaim(); await beginAuthorityAction(tenant, id, lease);
    await prepareAuthorityExecution(tenant, new Date(now.getTime() + 16 * 60_000)); expect(action(id).state).toBe("UNCERTAIN");
  });
  it("rejects tenant leaks, changed evidence, stale approvals, wrong leases and legacy bypass", async () => {
    const id = await proposal();
    await expect(reviewAuthorityAction("other-tenant", "owner", id, 0, "APPROVE", "Reviewed")).rejects.toThrow("not found");
    await expect(reviewAuthorityAction(tenant, "owner", id, 99, "APPROVE", "Reviewed")).rejects.toThrow("no longer current");
    publisher.updatedAt = new Date(now.getTime() + 5000);
    await expect(reviewAuthorityAction(tenant, "owner", id, 0, "APPROVE", "Reviewed")).rejects.toThrow("evidence changed");
    await expect(beginAuthorityAction(tenant, id, "wrong-lease")).rejects.toThrow("lease");
    await expect(rejectLegacyAuthority(tenant)).rejects.toThrow("retired");
    await expect(rejectLegacyAuthority("other-tenant")).resolves.toBeUndefined();
  });
  it("checks new replies and opt-outs again immediately before the external action", async () => {
    const { id, lease } = await approveClaim(); publisher.updatedAt = new Date(now.getTime() + 10_000); publisher.lastReplyAt = publisher.updatedAt;
    await executeAuthorityAction(tenant, id, lease); expect(action(id).state).toBe("BLOCKED"); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not automatically send a second response to the same reply", async () => {
    publisher.status = "REPLIED"; publisher.lastReplyAt = now;
    const { id, lease } = await approveClaim({ ...plan(), method: "REPLY" });
    expect(await executeAuthorityAction(tenant, id, lease)).toMatchObject({ state: "SUBMITTED" });
    expect(mocks.graph).toHaveBeenCalledOnce();
    await expect(proposal({ ...plan(), method: "REPLY" })).rejects.toThrow("already has an attempted response");
  });
});
