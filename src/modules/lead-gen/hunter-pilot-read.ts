/** Read-only bridge for the isolated Hunter pilot. No persistence or enrichment imports. */
import { prisma } from "@/server/db";
import { normalizeHunterCompanyDomain } from "@/modules/lead-gen/hunter-company-identity";
import { normalizeHunterCompanyIdentity } from "@/modules/lead-gen/hunter-company-key";
import type { TenantContext } from "@/server/tenant-context";

const MAX_IDENTITIES = 20_000;
type Input = { action?: unknown; name?: unknown; domain?: unknown; titles?: unknown };

export function pilotDomain(value: unknown) {
  if (typeof value !== "string" || value.length > 253) throw new Error("INVALID_DOMAIN");
  const domain = normalizeHunterCompanyDomain(value);
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) || domain.endsWith(".local")) {
    throw new Error("INVALID_DOMAIN");
  }
  return domain;
}

export async function readHunterPilot(input: Input, tenant: TenantContext) {
  if (process.env.HUNTER_PILOT_ENABLED !== "true") throw new Error("PILOT_DISABLED");
  if (!tenant.tenantId) throw new Error("TENANT_REQUIRED");
  const [access, policy] = await Promise.all([
    prisma.tenantModuleAccess.findFirst({
      where: { tenantId: tenant.tenantId, enabled: true, module: { key: "LEAD_GEN" } },
      select: { id: true }
    }),
    prisma.hunterAutomationPolicy.findUnique({ where: { tenantId: tenant.tenantId } })
  ]);
  if (!access || !policy || policy.killSwitch || policy.mode === "OFF") throw new Error("HUNTER_DISABLED");
  const context = { tenantId: tenant.tenantId, tenantSlug: tenant.tenantSlug, readOnly: true,
    apolloAvailable: Boolean(process.env.APOLLO_MASTER_API || process.env.APOLLO_API_KEY) };
  if (input.action === "context") return context;
  if (input.action !== "company" && input.action !== "people") throw new Error("ACTION_NOT_ALLOWED");
  const domain = pilotDomain(input.domain);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 200) throw new Error("INVALID_NAME");
  const identity = normalizeHunterCompanyIdentity(input.name);
  // Check all bounded canonical identities so suffix/alias variations cannot bypass suppression.
  // No customer/contact facts from this lookup are passed to the model.
  const [identities, suppressions] = await Promise.all([
    prisma.company.findMany({ where: { tenantId: tenant.tenantId }, take: MAX_IDENTITIES + 1,
      select: { id: true, name: true, normalizedName: true, domain: true } }),
    prisma.hunterOutreachSuppression.findMany({ where: { tenantId: tenant.tenantId, active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, take: MAX_IDENTITIES + 1,
      select: { scope: true, value: true, companyId: true } })
  ]);
  if (identities.length > MAX_IDENTITIES || suppressions.length > MAX_IDENTITIES) throw new Error("SAFETY_LOOKUP_LIMIT");
  const matches = identities.filter(c => normalizeHunterCompanyDomain(c.domain) === domain ||
    normalizeHunterCompanyIdentity(c.name) === identity || normalizeHunterCompanyIdentity(c.normalizedName) === identity);
  const blocked = (reason: string) => ({ ...context, allowed: false, reason });
  if (suppressions.some(s => (s.companyId && matches.some(c => c.id === s.companyId)) ||
    (s.scope === "DOMAIN" && normalizeHunterCompanyDomain(s.value) === domain) ||
    (s.scope === "COMPANY" && (normalizeHunterCompanyIdentity(s.value) === identity || matches.some(c => c.id === s.value))))) {
    return blocked("SUPPRESSED");
  }
  const companies = matches.length ? await prisma.company.findMany({
    where: { tenantId: tenant.tenantId, id: { in: matches.map(c => c.id) } },
    select: { id: true, domain: true, doNotProspect: true, candidateStatus: true,
      cashflowCustomers: { where: { tenantId: tenant.tenantId }, select: { id: true }, take: 1 },
      operatingRelationships: { where: { tenantId: tenant.tenantId, lifecycle: { not: "PROSPECT" } }, select: { id: true }, take: 1 },
      customerSourceAccounts: { where: { tenantId: tenant.tenantId }, select: { id: true }, take: 1 },
      leads: { where: { tenantId: tenant.tenantId }, select: { id: true }, take: 1 },
      contacts: { where: { tenantId: tenant.tenantId, OR: [
        { contactStatus: { in: ["REJECTED", "DO_NOT_CONTACT"] } }, { replyStatus: { not: "NO_REPLY" } },
        { sequenceStatus: { in: ["ENROLLED", "PAUSED", "REPLIED", "BOUNCED"] } }
      ] }, select: { id: true }, take: 1 }
    }
  }) : [];
  if (companies.some(c => c.doNotProspect || ["REJECTED", "DISQUALIFIED"].includes(c.candidateStatus) ||
    c.cashflowCustomers.length || c.operatingRelationships.length || c.customerSourceAccounts.length || c.leads.length || c.contacts.length)) {
    return blocked("EXISTING_RELATIONSHIP_OR_CONTACT_HOLD");
  }
  if (companies.some(c => c.domain && normalizeHunterCompanyDomain(c.domain) !== domain)) return blocked("IDENTITY_CONFLICT");
  if (input.action === "company") return { ...context, allowed: true, existingCompany: matches.length > 0 };
  if (!Array.isArray(input.titles) || input.titles.length < 1 || input.titles.length > 8 ||
      input.titles.some(t => typeof t !== "string" || !t.trim() || t.length > 80)) throw new Error("INVALID_TITLES");
  const people = await searchPilotPeople(domain, input.titles as string[]);
  const existing = people.length ? await prisma.contact.findMany({
    where: { tenantId: tenant.tenantId, OR: [
      { apolloPersonId: { in: people.map(p => p.id) } }, { apolloContactId: { in: people.map(p => p.id) } }
    ] }, select: { id: true, apolloPersonId: true, apolloContactId: true }
  }) : [];
  // Never silently re-prospect a tracked contact, even when a different company alias was supplied.
  const candidates = people.filter(p => !existing.some(c => c.apolloPersonId === p.id || c.apolloContactId === p.id) &&
    !suppressions.some(s => s.scope === "CONTACT" && s.value === p.id));
  return { ...context, allowed: true, candidates, result: people.length === 0 ? "NO_PEOPLE_RETURNED" :
    candidates.length === 0 ? "TRACKED_OR_SUPPRESSED_CONTACTS" : "PEOPLE_FOUND_EMAIL_NOT_REVEALED",
    note: "Search results are candidates only. Verify current employer and role; email availability is not a revealed or verified address." };
}

export async function searchPilotPeople(domain: string, titles: string[]) {
  const key = process.env.APOLLO_MASTER_API || process.env.APOLLO_API_KEY;
  if (!key) throw new Error("APOLLO_NOT_CONFIGURED");
  // Apollo documents this exact endpoint as zero-credit. No organization enrichment,
  // people match, saved-contact creation, or sequence API is reachable from this adapter.
  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(25_000),
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ q_organization_domains_list: [domain], person_titles: titles,
      include_similar_titles: true, per_page: 10, page: 1 })
  });
  if (!response.ok) throw new Error(`APOLLO_HTTP_${response.status}`);
  const data = await response.json() as { people?: Array<Record<string, unknown>> };
  if (!Array.isArray(data.people)) throw new Error("APOLLO_INVALID_RESPONSE");
  return data.people.slice(0, 10).flatMap(p => {
    if (typeof p.id !== "string" || typeof p.title !== "string") return [];
    const org = p.organization && typeof p.organization === "object" ? p.organization as Record<string, unknown> : {};
    const employerDomain = typeof org.primary_domain === "string" ? normalizeHunterCompanyDomain(org.primary_domain) : null;
    if (employerDomain && employerDomain !== domain) return [];
    return [{ id: p.id.slice(0, 100), title: p.title.slice(0, 200),
      firstName: typeof p.first_name === "string" ? p.first_name.slice(0, 100) : null,
      lastNameHint: typeof p.last_name_obfuscated === "string" ? p.last_name_obfuscated.slice(0, 100) : null,
      organization: typeof org.name === "string" ? org.name.slice(0, 200) : null,
      emailAvailable: p.has_email === true, emailState: "NOT_REVEALED" as const,
      employmentVerified: false, nameMasked: true }];
  });
}
