import {
  type CustomerIdentityMatch,
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  CustomerSourceAccountStatus,
  IntegrationProvider,
  IntegrationStatus,
  Prisma
} from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { auditEntry } from "@/modules/customer-intelligence/audit";
import { upsertSourceAccount } from "@/modules/customer-intelligence/actions";
import { requireIngestionAdmin } from "@/modules/customer-intelligence/permissions";
import {
  decryptQuickBooksSecret,
  encryptQuickBooksSecret,
  getQuickBooksApiBaseUrl,
  refreshQuickBooksAccessToken
} from "@/server/integrations/quickbooks";

/**
 * Read-only, idempotent QuickBooks customer ingestion (CP-PHASE-02B-2).
 *
 * GET-only toward the Intuit Accounting API: customer records are fetched per
 * connected operating company and persisted under the owner-approved staging
 * model:
 *
 * - matched customers upsert the tenant-scoped `CustomerSourceAccount` keyed by
 *   `(tenantId, realmId, quickBooksCustomerId)` and refresh `lastSyncedAt`;
 * - unmatched customers stay `PROPOSED` `CustomerIdentityMatch` rows with the
 *   available evidence (owner decision CP-02B-2-Q1, `MATCH_EVIDENCE`); no
 *   `Company` is created or approved (owner decision CP-02B-3-Q1,
 *   `MANUAL_ONLY`);
 * - reviewed identity decisions are never overwritten: re-runs return the
 *   existing `APPROVED`/`REJECTED` match unchanged;
 * - partial or completely missing QuickBooks fields are stored as missing and
 *   never invented;
 * - `dryRun` performs zero database writes and returns the would-be report.
 *
 * Operating companies without an associated tenant-scoped, ACTIVE QuickBooks
 * credential are skipped with an audited warning. Token refresh reuses
 * `refreshQuickBooksAccessToken`; the rotated tokens are persisted back to the
 * tenant-scoped `IntegrationCredential` (never in dry-run mode).
 */

/** Maximum records QuickBooks returns for a single query page. */
export const QUICKBOOKS_CUSTOMER_PAGE_SIZE = 1000;

/** Refresh the access token pre-emptively inside this buffer before expiry. */
const ACCESS_TOKEN_FRESHNESS_BUFFER_MS = 120000;

/**
 * A QuickBooks Customer entity as returned by the Intuit Accounting `query`
 * endpoint. Only the fields this ingestion reads are declared; every field is
 * optional so partial or completely missing evidence is stored as missing and
 * never invented.
 */
export type QuickBooksCustomerPayload = {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  BillAddr?: {
    Line1?: string;
    Line2?: string;
    Line3?: string;
    Line4?: string;
    Line5?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
    Country?: string;
  };
  ShipAddr?: Record<string, string | undefined>;
  CurrencyRef?: { value?: string; name?: string };
  ParentRef?: { value?: string };
  Active?: boolean;
  Notes?: string;
  MetaData?: { LastUpdatedTime?: string };
  sparse?: boolean;
  domain?: string;
  status?: string;
};

/** Deterministic normalization of a QuickBooks Customer record. */
export type NormalizedQuickBooksCustomer = {
  realmId: string;
  quickBooksCustomerId: string;
  displayName: string | null;
  companyName: string | null;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: Prisma.InputJsonValue | null;
  shippingAddress: Prisma.InputJsonValue | null;
  currency: string | null;
  parentQuickBooksCustomerId: string | null;
  active: boolean | null;
  notes: string | null;
  lastUpdatedAt: string | null;
};

/**
 * Normalize a QuickBooks customer payload. Missing fields stay `null` (or are
 * omitted from JSON evidence) — nothing is invented. Addresses are stored as
 * JSON with empty lines removed.
 */
export function normalizeQuickBooksCustomer(
  payload: QuickBooksCustomerPayload,
  realmId: string
): NormalizedQuickBooksCustomer {
  return {
    realmId,
    quickBooksCustomerId: payload.Id?.trim() ?? "",
    displayName: payload.DisplayName?.trim() || payload.CompanyName?.trim() || null,
    companyName: payload.CompanyName?.trim() || null,
    givenName: payload.GivenName?.trim() || null,
    familyName: payload.FamilyName?.trim() || null,
    email: payload.PrimaryEmailAddr?.Address?.trim() || null,
    phone: payload.PrimaryPhone?.FreeFormNumber?.trim() || null,
    billingAddress: toAddressJson(payload.BillAddr),
    shippingAddress: toAddressJson(payload.ShipAddr),
    currency: payload.CurrencyRef?.value?.trim() || null,
    parentQuickBooksCustomerId: payload.ParentRef?.value?.trim() || null,
    active: typeof payload.Active === "boolean" ? payload.Active : null,
    notes: payload.Notes?.trim() || null,
    lastUpdatedAt: payload.MetaData?.LastUpdatedTime || null
  };
}

function toAddressJson(
  address: Record<string, string | undefined> | undefined
): Prisma.InputJsonValue | null {
  if (!address) {
    return null;
  }
  const entries = Object.entries(address)
    .filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[1].trim() !== ""
    )
    .map(([key, value]) => [key, value.trim()] as const);
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(entries) as Prisma.InputJsonValue;
}

/** The deterministic identity source record key for a QuickBooks customer. */
export function quickBooksSourceRecordKey(realmId: string, quickBooksCustomerId: string): string {
  return `${realmId}:${quickBooksCustomerId}`;
}

/** Build the GET-only Intuit Accounting query URL for Customer records. */
export function buildQuickBooksCustomerQueryUrl({
  realmId,
  startPosition,
  maxResults
}: {
  realmId: string;
  startPosition: number;
  maxResults: number;
}): string {
  const url = new URL(`${getQuickBooksApiBaseUrl()}/v3/company/${realmId}/query`);
  url.searchParams.set(
    "query",
    `select * from Customer startposition ${startPosition} maxresults ${maxResults}`
  );
  return url.toString();
}

/** Fetch one page of QuickBooks customers (GET-only). */
export async function fetchQuickBooksCustomerPage({
  realmId,
  accessToken,
  startPosition,
  maxResults = QUICKBOOKS_CUSTOMER_PAGE_SIZE
}: {
  realmId: string;
  accessToken: string;
  startPosition: number;
  maxResults?: number;
}): Promise<QuickBooksCustomerPayload[]> {
  const url = buildQuickBooksCustomerQueryUrl({ realmId, startPosition, maxResults });
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    // Never surface the arbitrary upstream response body. This error can flow
    // into a local report and AuditLog, so only the bounded numeric status is
    // safe diagnostic evidence.
    throw new Error(`QuickBooks customer query failed with status ${response.status}.`);
  }

  const json = (await response.json()) as {
    QueryResponse?: { Customer?: QuickBooksCustomerPayload[] };
  };
  return json.QueryResponse?.Customer ?? [];
}

/** Fetch every QuickBooks customer record for a realm using GET pagination. */
export async function fetchAllQuickBooksCustomers({
  realmId,
  accessToken
}: {
  realmId: string;
  accessToken: string;
}): Promise<QuickBooksCustomerPayload[]> {
  const customers: QuickBooksCustomerPayload[] = [];
  let startPosition = 1;
  while (true) {
    const page = await fetchQuickBooksCustomerPage({
      realmId,
      accessToken,
      startPosition,
      maxResults: QUICKBOOKS_CUSTOMER_PAGE_SIZE
    });
    customers.push(...page);
    if (page.length < QUICKBOOKS_CUSTOMER_PAGE_SIZE) {
      break;
    }
    startPosition += page.length;
  }
  return customers;
}

/**
 * Return a usable access token for a tenant-scoped QuickBooks credential,
 * refreshing through `refreshQuickBooksAccessToken` when the stored token is
 * expired. The rotated tokens are persisted back to the credential, so dry-run
 * mode (zero writes) reports the limitation by returning `null` instead of
 * refreshing.
 */
export async function getUsableQuickBooksAccessToken({
  credential,
  tenantId,
  expectedRealmId,
  dryRun
}: {
  credential: {
    id: string;
    tenantId: string;
    secretRef: string | null;
    publicConfig: Prisma.JsonValue | null;
  };
  tenantId: string;
  expectedRealmId: string;
  dryRun: boolean;
}): Promise<string | null> {
  if (credential.tenantId !== tenantId) {
    throw new Error("QuickBooks credential does not belong to the authenticated tenant.");
  }
  if (!credential.secretRef) {
    throw new Error("QuickBooks credential is missing encrypted OAuth tokens.");
  }

  const config = readCredentialPublicConfig(credential.publicConfig);
  if (!config.realmId) {
    throw new Error("QuickBooks credential is missing a realm ID.");
  }
  if (config.realmId !== expectedRealmId) {
    throw new Error(
      "QuickBooks credential realm does not match the operating company's associated realm."
    );
  }

  const secret = decryptQuickBooksSecret(credential.secretRef);
  const expiresAt = config.accessTokenExpiresAt
    ? new Date(config.accessTokenExpiresAt).getTime()
    : 0;
  if (secret.accessToken && expiresAt - Date.now() > ACCESS_TOKEN_FRESHNESS_BUFFER_MS) {
    return secret.accessToken;
  }

  if (!secret.refreshToken) {
    throw new Error("QuickBooks credential is missing a refresh token.");
  }
  if (dryRun) {
    return null;
  }

  const refreshed = await refreshQuickBooksAccessToken({ refreshToken: secret.refreshToken });
  const persisted = await prisma.integrationCredential.updateMany({
    where: { id: credential.id, tenantId },
    data: {
      publicConfig: {
        ...config.raw,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt
      },
      secretRef: encryptQuickBooksSecret({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenType: refreshed.tokenType,
        realmId: config.realmId
      })
    }
  });
  if (persisted.count !== 1) {
    throw new Error("QuickBooks token refresh could not update exactly one tenant-owned credential.");
  }

  return refreshed.accessToken;
}

function readCredentialPublicConfig(value: Prisma.JsonValue | null | undefined): {
  realmId: string | null;
  accessTokenExpiresAt: string | null;
  raw: Prisma.JsonObject;
} {
  const raw: Prisma.JsonObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Prisma.JsonObject)
      : {};
  return {
    realmId: typeof raw.realmId === "string" ? raw.realmId : null,
    accessTokenExpiresAt:
      typeof raw.accessTokenExpiresAt === "string" ? raw.accessTokenExpiresAt : null,
    raw
  };
}

export type OperatingCompanyIngestionSection = {
  operatingCompanyId: string;
  slug: string;
  displayName: string;
  status: "ASSOCIATED" | "SKIPPED_UNASSOCIATED" | "ERROR";
  reason?: string;
  fetchedCustomers: number;
  matched: number;
  /** New proposals created (or that would be created in dry-run). */
  unmatchedProposed: number;
  /** Existing unreviewed proposals whose source evidence was refreshed. */
  unmatchedRefreshed: number;
  /** Existing unreviewed proposals already identical to the source evidence. */
  unmatchedUnchanged: number;
  reviewedDecisionsPreserved: number;
  skipped: number;
  /** Per-record failures handled without aborting the remaining run. */
  recordErrors: number;
  warnings: string[];
};

export type QuickBooksCustomerIngestionReport = {
  tenantId: string;
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  operatingCompanies: OperatingCompanyIngestionSection[];
  totals: {
    fetchedCustomers: number;
    matched: number;
    unmatchedProposed: number;
    unmatchedRefreshed: number;
    unmatchedUnchanged: number;
    reviewedDecisionsPreserved: number;
    skipped: number;
    recordErrors: number;
    unassociatedCompanies: number;
    erroredCompanies: number;
  };
};

type ResolvedCanonicalTarget = {
  companyId: string;
  operatingCompanyId: string;
};

type UnmatchedProposalResult = {
  match: CustomerIdentityMatch;
  before?: CustomerIdentityMatch;
  outcome: UnmatchedProposalOutcome;
};

type UnmatchedProposalOutcome =
  | "CREATED"
  | "REFRESHED"
  | "UNCHANGED"
  | "REVIEWED_PRESERVED";

function unmatchedMatchWhere(
  ctx: AuthenticatedContext,
  operatingCompanyId: string,
  sourceRecordKey: string
) {
  return tenantWhere(ctx, {
    kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
    operatingCompanyId,
    sourceRecordKey
  });
}

/**
 * Persist one unmatched QuickBooks proposal behind a transaction-scoped
 * PostgreSQL advisory lock. The schema's nullable companyId unique key cannot
 * serialize concurrent null-company inserts, so this migration-free lock uses
 * the complete tenant/source ownership key. A concurrent rerun waits, then
 * returns the proposal (or reviewed decision) that won instead of creating a
 * duplicate.
 */
async function persistUnmatchedProposal(
  ctx: AuthenticatedContext,
  input: {
    operatingCompanyId: string;
    sourceRecordKey: string;
    sourceLabel: string | null;
    evidence: Prisma.InputJsonValue;
  }
): Promise<UnmatchedProposalResult> {
  const lockKey = [
    "customer-intelligence.quickbooks-proposal",
    ctx.tenantId,
    input.operatingCompanyId,
    input.sourceRecordKey
  ].join(":");

  const result: UnmatchedProposalResult = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
    );

    // Reviewed decisions are authoritative regardless of whether a reviewer
    // selected a canonical company before approving or rejecting the match.
    const reviewed = await transaction.customerIdentityMatch.findFirst({
      where: {
        ...unmatchedMatchWhere(ctx, input.operatingCompanyId, input.sourceRecordKey),
        status: {
          in: [
            CustomerIdentityMatchStatus.APPROVED,
            CustomerIdentityMatchStatus.REJECTED
          ]
        }
      }
    });
    if (reviewed) {
      return {
        match: reviewed,
        outcome: "REVIEWED_PRESERVED"
      };
    }

    // Resolve the source-owned proposal independently of companyId. A reviewer
    // may select a canonical/candidate company while leaving the decision
    // PROPOSED; ingestion must preserve those human-selected fields and must
    // never create a second null-company proposal for the same source.
    const existing = await transaction.customerIdentityMatch.findFirst({
      where: {
        ...unmatchedMatchWhere(ctx, input.operatingCompanyId, input.sourceRecordKey),
        status: CustomerIdentityMatchStatus.PROPOSED
      }
    });
    if (existing) {
      if (
        existing.sourceLabel === input.sourceLabel &&
        jsonValuesEqual(existing.evidence, input.evidence)
      ) {
        return {
          match: existing,
          outcome: "UNCHANGED"
        };
      }

      const match = await transaction.customerIdentityMatch.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: existing.id } },
        // Only unreviewed source-owned fields are refreshed. In particular,
        // companyId, candidateCompanyId, score, reviewerUserId, and reviewedAt
        // remain exactly as the human review workflow left them. Replacing the
        // complete evidence object also removes evidence absent from this sync.
        data: {
          sourceLabel: input.sourceLabel,
          evidence: input.evidence
        }
      });
      return {
        match,
        before: existing,
        outcome: "REFRESHED"
      };
    }

    const match = await transaction.customerIdentityMatch.create({
      data: {
        tenantId: ctx.tenantId,
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        companyId: null,
        operatingCompanyId: input.operatingCompanyId,
        sourceRecordKey: input.sourceRecordKey,
        sourceLabel: input.sourceLabel,
        candidateCompanyId: null,
        score: 0,
        status: CustomerIdentityMatchStatus.PROPOSED,
        evidence: input.evidence
      }
    });
    return {
      match,
      outcome: "CREATED"
    };
  });

  if (result.outcome === "CREATED") {
    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.identity-match.proposed",
      entityType: "CustomerIdentityMatch",
      entityId: result.match.id,
      after: result.match
    });
  } else if (result.outcome === "REFRESHED") {
    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.identity-match.evidence-refreshed",
      entityType: "CustomerIdentityMatch",
      entityId: result.match.id,
      before: result.before,
      after: result.match
    });
  }

  return result;
}

/**
 * Resolve the same proposal outcomes as the locked persistence path using
 * reads only. This is deliberately separate from the advisory-lock transaction
 * so dry-run cannot update evidence, timestamps, or audit rows.
 */
async function inspectUnmatchedProposal(
  ctx: AuthenticatedContext,
  input: {
    operatingCompanyId: string;
    sourceRecordKey: string;
    sourceLabel: string | null;
    evidence: Prisma.InputJsonValue;
  }
): Promise<UnmatchedProposalOutcome> {
  const reviewed = await prisma.customerIdentityMatch.findFirst({
    where: {
      ...unmatchedMatchWhere(ctx, input.operatingCompanyId, input.sourceRecordKey),
      status: {
        in: [CustomerIdentityMatchStatus.APPROVED, CustomerIdentityMatchStatus.REJECTED]
      }
    }
  });
  if (reviewed) {
    return "REVIEWED_PRESERVED";
  }

  const existing = await prisma.customerIdentityMatch.findFirst({
    where: {
      ...unmatchedMatchWhere(ctx, input.operatingCompanyId, input.sourceRecordKey),
      status: CustomerIdentityMatchStatus.PROPOSED
    }
  });
  if (!existing) {
    return "CREATED";
  }
  return existing.sourceLabel === input.sourceLabel &&
    jsonValuesEqual(existing.evidence, input.evidence)
    ? "UNCHANGED"
    : "REFRESHED";
}

function countUnmatchedProposalOutcome(
  section: OperatingCompanyIngestionSection,
  outcome: UnmatchedProposalOutcome
) {
  if (outcome === "CREATED") {
    section.unmatchedProposed += 1;
  } else if (outcome === "REFRESHED") {
    section.unmatchedRefreshed += 1;
  } else if (outcome === "UNCHANGED") {
    section.unmatchedUnchanged += 1;
  } else {
    section.reviewedDecisionsPreserved += 1;
  }
}

/** Compare JSON structurally so database object-key order cannot cause writes. */
function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && jsonValuesEqual(leftRecord[key], rightRecord[key])
    )
  );
}

/**
 * Resolve the canonical Company for a QuickBooks customer. An `APPROVED`
 * identity match is authoritative (reviewed decisions are never overwritten and
 * the database enforces one approved target per source); a previously persisted
 * source account is an exact persisted mapping. Returns `null` when the
 * customer is unmatched.
 */
async function resolveCanonicalTarget(
  ctx: AuthenticatedContext,
  input: {
    realmId: string;
    quickBooksCustomerId: string;
    sourceRecordKey: string;
    operatingCompanyId: string;
  }
): Promise<ResolvedCanonicalTarget | null> {
  const approvedMatch = await prisma.customerIdentityMatch.findFirst({
    where: tenantWhere(ctx, {
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      sourceRecordKey: input.sourceRecordKey,
      operatingCompanyId: input.operatingCompanyId,
      status: CustomerIdentityMatchStatus.APPROVED
    })
  });
  if (
    approvedMatch?.companyId &&
    approvedMatch.operatingCompanyId === input.operatingCompanyId
  ) {
    return {
      companyId: approvedMatch.companyId,
      operatingCompanyId: approvedMatch.operatingCompanyId
    };
  }

  const existingAccount = await prisma.customerSourceAccount.findFirst({
    where: tenantWhere(ctx, {
      realmId: input.realmId,
      quickBooksCustomerId: input.quickBooksCustomerId,
      operatingCompanyId: input.operatingCompanyId
    })
  });
  if (existingAccount?.operatingCompanyId === input.operatingCompanyId) {
    return {
      companyId: existingAccount.companyId,
      operatingCompanyId: existingAccount.operatingCompanyId
    };
  }

  return null;
}

async function ingestQuickBooksCustomersForOperatingCompany(
  ctx: AuthenticatedContext,
  operatingCompany: {
    id: string;
    slug: string;
    displayName: string;
    homeCurrency: string;
    quickBooksRealmId: string | null;
    quickBooksCredentialId: string | null;
  },
  dryRun: boolean
): Promise<OperatingCompanyIngestionSection> {
  const section: OperatingCompanyIngestionSection = {
    operatingCompanyId: operatingCompany.id,
    slug: operatingCompany.slug,
    displayName: operatingCompany.displayName,
    status: "ASSOCIATED",
    fetchedCustomers: 0,
    matched: 0,
    unmatchedProposed: 0,
    unmatchedRefreshed: 0,
    unmatchedUnchanged: 0,
    reviewedDecisionsPreserved: 0,
    skipped: 0,
    recordErrors: 0,
    warnings: []
  };

  // Requirement: resolve operating company to its associated tenant credential
  // and skip unassociated companies with an audited warning.
  if (!operatingCompany.quickBooksCredentialId || !operatingCompany.quickBooksRealmId) {
    section.status = "SKIPPED_UNASSOCIATED";
    section.reason = "Operating company has no associated QuickBooks credential.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.quickbooks-ingestion.skipped-unassociated",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }

  const credential = await prisma.integrationCredential.findFirst({
    where: tenantWhere(ctx, { id: operatingCompany.quickBooksCredentialId })
  });
  if (
    !credential ||
    credential.provider !== IntegrationProvider.QUICKBOOKS ||
    credential.status !== IntegrationStatus.ACTIVE
  ) {
    section.status = "SKIPPED_UNASSOCIATED";
    section.reason =
      "Associated QuickBooks credential is missing, is not a QuickBooks credential, or is not ACTIVE.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.quickbooks-ingestion.skipped-unassociated",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }

  const realmId = operatingCompany.quickBooksRealmId;

  let accessToken: string | null;
  try {
    accessToken = await getUsableQuickBooksAccessToken({
      credential,
      tenantId: ctx.tenantId,
      expectedRealmId: realmId,
      dryRun
    });
  } catch {
    section.status = "ERROR";
    // Token helpers may contain upstream provider text in thrown errors. Keep
    // reports and audits on a deterministic classification only.
    section.reason = "Unable to obtain a usable QuickBooks access token.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.quickbooks-ingestion.error",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }
  if (!accessToken) {
    section.status = "ERROR";
    section.reason =
      "Access token is expired and token refresh writes are disabled in dry-run mode.";
    return section;
  }

  let customers: QuickBooksCustomerPayload[];
  try {
    customers = await fetchAllQuickBooksCustomers({ realmId, accessToken });
  } catch {
    section.status = "ERROR";
    // Do not persist arbitrary QuickBooks response bodies or thrown values in
    // the report/audit trail.
    section.reason = "QuickBooks customer fetch failed.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.quickbooks-ingestion.error",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }
  section.fetchedCustomers = customers.length;

  for (const payload of customers) {
    try {
    const customerId = payload.Id?.trim();
    if (!customerId) {
      section.skipped += 1;
      section.warnings.push(
        "A QuickBooks customer record has no Id; skipped (nothing would be invented)."
      );
      continue;
    }

    const normalized = normalizeQuickBooksCustomer(payload, realmId);
    const sourceRecordKey = quickBooksSourceRecordKey(realmId, customerId);
    const conflictingSourceAccount = await prisma.customerSourceAccount.findFirst({
      where: tenantWhere(ctx, {
        realmId,
        quickBooksCustomerId: customerId,
        operatingCompanyId: { not: operatingCompany.id }
      })
    });
    if (
      conflictingSourceAccount &&
      conflictingSourceAccount.operatingCompanyId !== operatingCompany.id
    ) {
      section.skipped += 1;
      section.warnings.push(
        `Customer ${customerId} already belongs to another operating company; skipped without moving or updating that source account.`
      );
      continue;
    }
    const resolved = await resolveCanonicalTarget(ctx, {
      realmId,
      quickBooksCustomerId: customerId,
      sourceRecordKey,
      operatingCompanyId: operatingCompany.id
    });

    if (!resolved) {
      // Unmatched customer: keep it as a proposed match with the available
      // evidence (CP-02B-2-Q1 MATCH_EVIDENCE). No Company is created or
      // approved (CP-02B-3-Q1 MANUAL_ONLY); re-runs never overwrite a reviewed
      // APPROVED/REJECTED decision, including a rejection carrying companyId.
      const proposalInput = {
        operatingCompanyId: operatingCompany.id,
        sourceRecordKey,
        sourceLabel: normalized.displayName,
        evidence: buildMatchEvidence(normalized)
      };
      if (dryRun) {
        countUnmatchedProposalOutcome(
          section,
          await inspectUnmatchedProposal(ctx, proposalInput)
        );
      } else {
        const proposal = await persistUnmatchedProposal(ctx, proposalInput);
        countUnmatchedProposalOutcome(section, proposal.outcome);
      }
      continue;
    }

    // CustomerSourceAccount.displayName is required. An unmatched ID-only
    // record is retained above as a reviewable proposal, but an already
    // approved match cannot invent a persisted account label.
    if (!normalized.displayName) {
      section.skipped += 1;
      section.warnings.push(
        `Customer ${customerId} is matched but has no display name; skipped without inventing source-account evidence.`
      );
      continue;
    }

    // Matched customer: persist the tenant-scoped source account keyed by
    // (tenantId, realmId, quickBooksCustomerId). Re-runs refresh lastSyncedAt
    // and never touch reviewed identity decisions.
    const relationship = await prisma.companyOperatingRelationship.findFirst({
      where: tenantWhere(ctx, {
        companyId: resolved.companyId,
        operatingCompanyId: resolved.operatingCompanyId
      })
    });
    if (!relationship) {
      section.skipped += 1;
      section.warnings.push(
        `Customer ${customerId} matched company ${resolved.companyId} but no operating-company relationship exists; skipped.`
      );
      continue;
    }

    // currency and active are required by CustomerSourceAccount. There is no
    // owner-approved fallback for missing QuickBooks evidence, so fail this
    // record closed rather than retaining or inventing status/financial data.
    if (!normalized.currency || normalized.active === null) {
      section.skipped += 1;
      const missing = [
        !normalized.currency ? "currency" : null,
        normalized.active === null ? "active status" : null
      ].filter((value): value is string => value !== null);
      section.warnings.push(
        `Customer ${customerId} is missing required QuickBooks ${missing.join(
          " and "
        )}; skipped without changing existing source-account evidence.`
      );
      continue;
    }

    if (!dryRun) {
      await upsertSourceAccount(ctx, {
        realmId,
        quickBooksCustomerId: customerId,
        companyId: resolved.companyId,
        operatingCompanyId: resolved.operatingCompanyId,
        companyOperatingRelationshipId: relationship.id,
        currency: normalized.currency,
        displayName: normalized.displayName,
        active: normalized.active,
        status: normalized.active
          ? CustomerSourceAccountStatus.ACTIVE
          : CustomerSourceAccountStatus.INACTIVE,
        // Nullable evidence is explicitly cleared when QuickBooks no longer
        // supplies it, preventing stale values from surviving a refresh.
        email: normalized.email,
        phone: normalized.phone,
        billingAddress: normalized.billingAddress ?? Prisma.JsonNull,
        shippingAddress: normalized.shippingAddress ?? Prisma.JsonNull,
        parentQuickBooksCustomerId: normalized.parentQuickBooksCustomerId,
        lastSyncedAt: new Date()
      });
    }
    section.matched += 1;
    } catch {
      // One bad persistence/read operation must not hide the terminal outcome
      // of a partially completed run. Never place the source ID, customer
      // evidence, or arbitrary exception text in this classification.
      section.skipped += 1;
      section.recordErrors += 1;
      section.warnings.push(
        "A QuickBooks customer record failed during local processing; skipped."
      );
    }
  }

  return section;
}

/**
 * Tenant-scoped, ADMIN-guarded, idempotent ingestion entry. `dryRun` reports
 * what would be written without writing anything. The guard is enforced here
 * (defense in depth) and at the ADMIN-triggered action in actions.ts.
 */
export async function ingestQuickBooksCustomers(
  ctx: AuthenticatedContext,
  input: { operatingCompanyId?: string; dryRun?: boolean } = {}
): Promise<QuickBooksCustomerIngestionReport> {
  await requireIngestionAdmin(ctx);

  const dryRun = input.dryRun === true;
  const startedAt = new Date().toISOString();

  const operatingCompanies = input.operatingCompanyId
    ? [
        await prisma.operatingCompany.findFirst({
          where: tenantWhere(ctx, { id: input.operatingCompanyId })
        })
      ]
    : await prisma.operatingCompany.findMany({
        where: tenantWhere(ctx, { active: true }),
        orderBy: [{ displayName: "asc" }]
      });

  if (input.operatingCompanyId && !operatingCompanies[0]) {
    throw new Error("Operating company does not exist in this tenant.");
  }

  const sections: OperatingCompanyIngestionSection[] = [];
  for (const operatingCompany of operatingCompanies) {
    if (!operatingCompany) {
      continue;
    }
    sections.push(
      await ingestQuickBooksCustomersForOperatingCompany(ctx, operatingCompany, dryRun)
    );
  }

  const totals = sections.reduce(
    (acc, section) => {
      acc.fetchedCustomers += section.fetchedCustomers;
      acc.matched += section.matched;
      acc.unmatchedProposed += section.unmatchedProposed;
      acc.unmatchedRefreshed += section.unmatchedRefreshed;
      acc.unmatchedUnchanged += section.unmatchedUnchanged;
      acc.reviewedDecisionsPreserved += section.reviewedDecisionsPreserved;
      acc.skipped += section.skipped;
      acc.recordErrors += section.recordErrors;
      if (section.status === "SKIPPED_UNASSOCIATED") {
        acc.unassociatedCompanies += 1;
      }
      if (section.status === "ERROR") {
        acc.erroredCompanies += 1;
      }
      return acc;
    },
    {
      fetchedCustomers: 0,
      matched: 0,
      unmatchedProposed: 0,
      unmatchedRefreshed: 0,
      unmatchedUnchanged: 0,
      reviewedDecisionsPreserved: 0,
      skipped: 0,
      recordErrors: 0,
      unassociatedCompanies: 0,
      erroredCompanies: 0
    }
  );

  const report: QuickBooksCustomerIngestionReport = {
    tenantId: ctx.tenantId,
    dryRun,
    startedAt,
    completedAt: new Date().toISOString(),
    operatingCompanies: sections,
    totals
  };

  if (!dryRun) {
    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.quickbooks-ingestion.run",
      entityType: "QuickBooksIngestion",
      // The caller receives the detailed ADMIN report, but AuditLog stores
      // classifications and counts only. Never copy customer IDs, names,
      // warnings, evidence, or provider content into generated audit output.
      after: buildIngestionAuditSummary(report)
    });
  }

  return report;
}

function buildIngestionAuditSummary(report: QuickBooksCustomerIngestionReport) {
  const operatingCompanyStatuses = report.operatingCompanies.reduce(
    (counts, section) => {
      if (section.status === "ASSOCIATED") counts.associated += 1;
      if (section.status === "SKIPPED_UNASSOCIATED") counts.skippedUnassociated += 1;
      if (section.status === "ERROR") counts.error += 1;
      return counts;
    },
    { associated: 0, skippedUnassociated: 0, error: 0 }
  );

  return {
    dryRun: report.dryRun,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    operatingCompanyCount: report.operatingCompanies.length,
    operatingCompanyStatuses,
    totals: report.totals
  };
}

function buildMatchEvidence(normalized: NormalizedQuickBooksCustomer): Prisma.InputJsonValue {
  // Prisma.InputJsonObject's index signature is read-only, so evidence is
  // assembled in a mutable record and returned as InputJsonValue.
  const evidence: Record<string, Prisma.InputJsonValue> = {
    source: "QUICKBOOKS"
  };
  if (normalized.displayName) {
    evidence.displayName = normalized.displayName;
  }
  if (normalized.companyName) {
    evidence.companyName = normalized.companyName;
  }
  if (normalized.givenName) {
    evidence.givenName = normalized.givenName;
  }
  if (normalized.familyName) {
    evidence.familyName = normalized.familyName;
  }
  if (normalized.email) {
    evidence.email = normalized.email;
  }
  if (normalized.phone) {
    evidence.phone = normalized.phone;
  }
  if (normalized.currency) {
    evidence.currency = normalized.currency;
  }
  if (normalized.billingAddress) {
    evidence.billingAddress = normalized.billingAddress;
  }
  if (normalized.shippingAddress) {
    evidence.shippingAddress = normalized.shippingAddress;
  }
  if (normalized.parentQuickBooksCustomerId) {
    evidence.parentQuickBooksCustomerId = normalized.parentQuickBooksCustomerId;
  }
  if (normalized.active !== null) {
    evidence.active = normalized.active;
  }
  if (normalized.lastUpdatedAt) {
    evidence.lastUpdatedAt = normalized.lastUpdatedAt;
  }
  if (normalized.notes) {
    evidence.notes = normalized.notes;
  }
  return evidence;
}
