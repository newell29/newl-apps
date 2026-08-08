import {
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  Prisma
} from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { auditEntry } from "@/modules/customer-intelligence/audit";
import {
  companyNamesCompatible,
  computeIdentityMatchScore,
  extractEmailDomain,
  isFreeMailDomain,
  phonesMatch,
  type IdentityEvidenceInput
} from "@/modules/customer-intelligence/identity";
import { IDENTITY_AUTO_LINK_THRESHOLD } from "@/modules/customer-intelligence/constants";
import {
  assertCanApproveIdentityMatch,
  findApprovedConflict
} from "@/modules/customer-intelligence/identity-approval";
import {
  requireMatchApproval,
  requireWrite
} from "@/modules/customer-intelligence/permissions";

/**
 * Deterministic identity reconciliation (CP-PHASE-02B-3).
 *
 * The read-only QuickBooks ingestion (CP-PHASE-02B-2) stages unmatched
 * customers as PROPOSED `CustomerIdentityMatch` rows carrying raw evidence.
 * Reconciliation re-scores each staged record against the tenant's canonical
 * companies using ONLY the approved identity scoring rules in `identity.ts`
 * (auto-link >= 90; exact normalized name alone never links; free-mail domains
 * never establish company identity). No new scoring heuristics are introduced.
 *
 * Routing:
 *
 * - unique best candidate with score >= 90 -> auto-approve to that tenant-valid
 *   canonical company (the existing one-approved-per-source invariant still
 *   applies; a conflicting approval keeps the record PROPOSED);
 * - score below 90, a tie for the best score, or no candidate at all -> the
 *   record stays PROPOSED and is routed to the leadership review queue;
 * - a missing canonical target never approves: a QuickBooks customer name alone
 *   never creates or approves a canonical Company (owner decision CP-02B-3-Q1,
 *   `MANUAL_ONLY`);
 * - reviewed decisions persist across re-runs: an existing APPROVED/REJECTED
 *   row for the same (tenantId, kind, operatingCompanyId, sourceRecordKey) is
 *   returned unchanged.
 *
 * Every auto-approval and every routing deferral writes an `AuditLog` entry in
 * the same transaction as its state change, and every run writes a sanitized
 * terminal summary (counts only; source identifiers never reach that summary).
 * The same transaction-scoped PostgreSQL advisory lock used by
 * ingestion serializes concurrent reconciliation/ingestion of one source, and
 * the partial unique index `CustomerIdentityMatch_one_approved_per_source_key`
 * is the database backstop for one APPROVED target per
 * `(tenantId, kind, sourceRecordKey)`.
 */

/** A PROPOSED QuickBooks match's stored source evidence, read deterministically. */
export type QuickBooksMatchEvidence = {
  displayName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: Prisma.JsonValue | null;
  shippingAddress: Prisma.JsonValue | null;
};

/** Read the QuickBooks evidence fields reconciliation may score. Nothing is invented. */
export function readQuickBooksMatchEvidence(match: {
  evidence: Prisma.JsonValue | null;
}): QuickBooksMatchEvidence {
  const raw =
    match.evidence && typeof match.evidence === "object" && !Array.isArray(match.evidence)
      ? (match.evidence as Prisma.JsonObject)
      : {};
  const stringField = (key: string): string | null => {
    const value = raw[key];
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };
  return {
    displayName: stringField("displayName"),
    companyName: stringField("companyName"),
    email: stringField("email"),
    phone: stringField("phone"),
    billingAddress: raw.billingAddress ?? null,
    shippingAddress: raw.shippingAddress ?? null
  };
}

/**
 * Deterministic address-line normalization used only to DERIVE the
 * `phoneOrAddressMatch` evidence boolean. It applies only the previously used
 * case, punctuation, and whitespace normalization; it does not infer address
 * equivalence. The score itself always comes from `computeIdentityMatchScore`.
 */
export function normalizeAddressLine(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** True when the source and candidate share an approved normalized street line. */
export function addressLinesOverlap(sourceLines: string[], candidateLines: string[]): boolean {
  const normalizedSource = sourceLines.map(normalizeAddressLine).filter((line) => line.length >= 5);
  const normalizedCandidate = candidateLines
    .map(normalizeAddressLine)
    .filter((line) => line.length >= 5);
  if (normalizedSource.length === 0 || normalizedCandidate.length === 0) {
    return false;
  }
  return normalizedSource.some((line) => normalizedCandidate.includes(line));
}

/**
 * Extract only QuickBooks street-address lines from a stored address object.
 * City, province, postal code, and country are deliberately excluded: those
 * partial fields are not approved identity evidence and commonly overlap
 * across unrelated companies.
 */
export function addressLinesFromJson(value: Prisma.JsonValue | null | undefined): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const entries = value as Record<string, unknown>;
  const approvedStreetKeys = new Set(["line1", "line2", "line3", "line4", "line5"]);
  return Object.entries(entries)
    .filter(
      (entry): entry is [string, string] =>
        approvedStreetKeys.has(entry[0].toLowerCase()) &&
        typeof entry[1] === "string" &&
        entry[1].trim() !== ""
    )
    .map(([, entry]) => entry.trim());
}

/** Canonical-company evidence used to score one reconciliation candidate. */
export type ReconciliationCandidate = {
  companyId: string;
  name: string;
  /** Company.domain plus email domains from its tenant-scoped source accounts. */
  domains: string[];
  /** Normalized phone evidence from its source accounts. */
  phones: string[];
  /** Address-line evidence from its source accounts. */
  addressLines: string[];
  /** The source record already maps to this candidate (APPROVED match or source account). */
  exactPersistedMapping: boolean;
  /** The source record was previously approved to this candidate under a stable ID. */
  previouslyApprovedStableId: boolean;
};

export type ReconciliationRoutingReason =
  | "AUTO_LINK"
  | "BELOW_THRESHOLD"
  | "AMBIGUOUS"
  | "NO_CANDIDATE";

export type ReconciliationScoringResult = {
  /** The best candidate's identity score (identity.ts rules only). */
  score: number;
  /** The unique best candidate, or null when tied or absent. */
  bestCandidateCompanyId: string | null;
  /** Multiple candidates tied for the best score. */
  ambiguous: boolean;
  reason: ReconciliationRoutingReason;
};

/**
 * Deterministic score of one QuickBooks match against the tenant's canonical
 * companies. `domainCompanyCounts` is the tenant-wide map of email domain to
 * the number of canonical companies that use it, so `uniqueDomain` means "this
 * domain belongs to exactly one canonical company in the tenant".
 */
export function scoreQuickBooksReconciliation(
  source: QuickBooksMatchEvidence,
  candidates: ReconciliationCandidate[],
  domainCompanyCounts: Record<string, number>
): ReconciliationScoringResult {
  if (candidates.length === 0) {
    return {
      score: 0,
      bestCandidateCompanyId: null,
      ambiguous: false,
      reason: "NO_CANDIDATE"
    };
  }

  const sourceName = source.displayName ?? source.companyName;
  const sourceDomain = source.email ? extractEmailDomain(source.email) : null;
  const domainIsFreeMail = sourceDomain ? isFreeMailDomain(sourceDomain) : false;
  const sourceAddressLines = [
    ...addressLinesFromJson(source.billingAddress),
    ...addressLinesFromJson(source.shippingAddress)
  ];

  const scored = candidates.map((candidate) => {
    const compatibleName =
      sourceName !== null && candidate.name.length > 0
        ? companyNamesCompatible(sourceName, candidate.name)
        : false;

    const uniqueDomain =
      sourceDomain !== null &&
      !domainIsFreeMail &&
      domainCompanyCounts[sourceDomain] === 1 &&
      candidate.domains.includes(sourceDomain);

    const phoneOrAddressMatch =
      (source.phone !== null &&
        candidate.phones.some((candidatePhone) => phonesMatch(source.phone!, candidatePhone))) ||
      addressLinesOverlap(sourceAddressLines, candidate.addressLines);

    const evidence: IdentityEvidenceInput = {
      compatibleName,
      uniqueDomain,
      phoneOrAddressMatch,
      exactPersistedMapping: candidate.exactPersistedMapping,
      previouslyApprovedStableId: candidate.previouslyApprovedStableId,
      domainIsFreeMail
    };

    return {
      companyId: candidate.companyId,
      score: computeIdentityMatchScore(evidence),
      evidence
    };
  });

  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const bestEntries = scored.filter((entry) => entry.score === bestScore);
  const ambiguous = bestEntries.length > 1;

  if (bestScore >= IDENTITY_AUTO_LINK_THRESHOLD && !ambiguous) {
    return {
      score: bestScore,
      bestCandidateCompanyId: bestEntries[0].companyId,
      ambiguous: false,
      reason: "AUTO_LINK"
    };
  }

  if (ambiguous) {
    // A tie for the best score cannot be resolved deterministically.
    return {
      score: bestScore,
      bestCandidateCompanyId: null,
      ambiguous: true,
      reason: "AMBIGUOUS"
    };
  }

  return {
    score: bestScore,
    // Suggest the unique best candidate to the reviewer when there is one.
    bestCandidateCompanyId: bestScore > 0 ? bestEntries[0].companyId : null,
    ambiguous: false,
    reason: "BELOW_THRESHOLD"
  };
}

export type IdentityReconciliationOutcome =
  | "AUTO_LINKED"
  | "ROUTED_TO_REVIEW"
  | "REVIEWED_PRESERVED"
  | "ERROR";

export type IdentityReconciliationReport = {
  tenantId: string;
  operatingCompanyId?: string;
  startedAt: string;
  completedAt: string;
  totals: {
    evaluated: number;
    autoLinked: number;
    routedToReview: number;
    reviewedPreserved: number;
    errors: number;
  };
};

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Reconcile the tenant's PROPOSED QUICKBOOKS_ACCOUNT matches (optionally for
 * one operating company) against canonical companies using the approved
 * identity scoring rules. Idempotent: reviewed decisions are preserved and a
 * re-run only re-evaluates records that are still PROPOSED. ADMIN and FINANCE
 * may trigger it (requireMatchApproval + the tenant mutation gate).
 */
export async function reconcileQuickBooksIdentityMatches(
  ctx: AuthenticatedContext,
  input: { operatingCompanyId?: string } = {}
): Promise<IdentityReconciliationReport> {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const startedAt = new Date().toISOString();

  if (input.operatingCompanyId) {
    const operatingCompany = await prisma.operatingCompany.findFirst({
      where: tenantWhere(ctx, { id: input.operatingCompanyId }),
      select: { id: true }
    });
    if (!operatingCompany) {
      throw new Error("Operating company does not exist in this tenant.");
    }
  }

  const matches = await prisma.customerIdentityMatch.findMany({
    where: tenantWhere(ctx, {
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED,
      ...(input.operatingCompanyId ? { operatingCompanyId: input.operatingCompanyId } : {})
    }),
    select: {
      id: true,
      operatingCompanyId: true,
      sourceRecordKey: true,
      companyId: true,
      candidateCompanyId: true,
      score: true,
      evidence: true
    }
  });

  const totals: IdentityReconciliationReport["totals"] = {
    evaluated: 0,
    autoLinked: 0,
    routedToReview: 0,
    reviewedPreserved: 0,
    errors: 0
  };

  for (const match of matches) {
    try {
      const outcome = await reconcileOneMatch(ctx, {
        match
      });
      totals.evaluated += 1;
      if (outcome === "AUTO_LINKED") {
        totals.autoLinked += 1;
      } else if (outcome === "ROUTED_TO_REVIEW") {
        totals.routedToReview += 1;
      } else if (outcome === "REVIEWED_PRESERVED") {
        totals.reviewedPreserved += 1;
      }
    } catch {
      // One bad record must not abort the remaining run. Classifications stay
      // deterministic; source identifiers never reach the report or audit.
      totals.evaluated += 1;
      totals.errors += 1;
    }
  }

  const report: IdentityReconciliationReport = {
    tenantId: ctx.tenantId,
    ...(input.operatingCompanyId ? { operatingCompanyId: input.operatingCompanyId } : {}),
    startedAt,
    completedAt: new Date().toISOString(),
    totals
  };

  await auditEntry({
    actor: ctx,
    action: "customer-intelligence.identity-reconciliation.run",
    entityType: "CustomerIdentityMatch",
    after: {
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      operatingCompanyId: report.operatingCompanyId ?? null,
      totals: report.totals
    }
  });

  return report;
}

/**
 * Read-only dry-run evaluation of deterministic reconciliation
 * (CP-PHASE-02B-7).
 *
 * Computes exactly the decision each PROPOSED match would receive from a live
 * reconciliation run — AUTO_LINKED, ROUTED_TO_REVIEW, or REVIEWED_PRESERVED —
 * without writing any database row or audit entry. Every read stays
 * tenant-scoped and the same scoring/invariant helpers as the live path are
 * reused, so a would-change report can never disagree with the guarded live
 * engine. The consolidated dry-run entry point
 * (`runCustomerIntelligenceDryRun` in dry-run.ts) records the verification
 * run through the existing AutomationJobRun/AuditLog patterns.
 */
export type ReconciliationDryRunMatch = {
  matchId: string;
  sourceRecordKey: string | null;
  operatingCompanyId: string | null;
  currentScore: number;
  wouldChangeTo: IdentityReconciliationOutcome;
  wouldScore: number;
  bestCandidateCompanyId: string | null;
  reason:
    | ReconciliationRoutingReason
    | "REVIEWED"
    | "MISSING_SOURCE_CONTEXT"
    | "APPROVED_CONFLICT"
    | "APPROVAL_INVARIANT_FAILED"
    | "PROCESSING_FAILED";
};

export type ReconciliationDryRunReport = {
  tenantId: string;
  dryRun: true;
  startedAt: string;
  completedAt: string;
  matches: ReconciliationDryRunMatch[];
  totals: {
    evaluated: number;
    autoLinked: number;
    routedToReview: number;
    reviewedPreserved: number;
    errors: number;
  };
};

/** A non-persisted PROPOSED match supplied by an earlier dry-run stage. */
export type ReconciliationDryRunVirtualMatch = {
  id: string;
  tenantId: string;
  operatingCompanyId: string;
  sourceRecordKey: string;
  score: number;
  evidence: Prisma.JsonValue;
};

/**
 * Read-only dry-run evaluation of the tenant's PROPOSED QUICKBOOKS_ACCOUNT
 * matches (optionally for one operating company). Reports what a live
 * reconciliation run would change and performs zero writes; a foreign or
 * nonexistent operating-company id is rejected before any evaluation.
 */
export async function evaluateReconciliationDryRun(
  ctx: AuthenticatedContext,
  input: {
    operatingCompanyId?: string;
    /** Internal would-be ingestion state; it overrides stale persisted proposals. */
    virtualMatches?: ReconciliationDryRunVirtualMatch[];
  } = {}
): Promise<ReconciliationDryRunReport> {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const startedAt = new Date().toISOString();

  if (input.operatingCompanyId) {
    const operatingCompany = await prisma.operatingCompany.findFirst({
      where: tenantWhere(ctx, { id: input.operatingCompanyId }),
      select: { id: true }
    });
    if (!operatingCompany) {
      throw new Error("Operating company does not exist in this tenant.");
    }
  }

  const persistedMatches = await prisma.customerIdentityMatch.findMany({
    where: tenantWhere(ctx, {
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED,
      ...(input.operatingCompanyId ? { operatingCompanyId: input.operatingCompanyId } : {})
    }),
    select: {
      id: true,
      operatingCompanyId: true,
      sourceRecordKey: true,
      score: true,
      evidence: true
    }
  });
  const virtualMatches = (input.virtualMatches ?? []).filter(
    (match) => !input.operatingCompanyId || match.operatingCompanyId === input.operatingCompanyId
  );
  if (virtualMatches.some((match) => match.tenantId !== ctx.tenantId)) {
    throw new Error("Virtual reconciliation evidence does not belong to this tenant.");
  }

  // A fetched customer refresh replaces source-owned evidence in a live
  // ingestion. Mirror that replacement in memory, while retaining unrelated
  // persisted proposals from the same coherent starting snapshot.
  const matchesBySource = new Map(
    persistedMatches.map((match) => [
      `${match.operatingCompanyId ?? ""}:${match.sourceRecordKey ?? ""}`,
      match
    ])
  );
  for (const match of virtualMatches) {
    matchesBySource.set(`${match.operatingCompanyId}:${match.sourceRecordKey}`, match);
  }
  const matches = [...matchesBySource.values()];

  const totals: ReconciliationDryRunReport["totals"] = {
    evaluated: 0,
    autoLinked: 0,
    routedToReview: 0,
    reviewedPreserved: 0,
    errors: 0
  };

  const evaluated: ReconciliationDryRunMatch[] = [];
  for (const match of matches) {
    try {
      const outcome = await evaluateReconciliationMatchDryRun(ctx, match);
      evaluated.push(outcome);
      totals.evaluated += 1;
      if (outcome.wouldChangeTo === "AUTO_LINKED") {
        totals.autoLinked += 1;
      } else if (outcome.wouldChangeTo === "ROUTED_TO_REVIEW") {
        totals.routedToReview += 1;
      } else if (outcome.wouldChangeTo === "REVIEWED_PRESERVED") {
        totals.reviewedPreserved += 1;
      } else {
        totals.errors += 1;
      }
    } catch {
      // Deterministic classification only; source identifiers never reach the
      // would-change report.
      totals.evaluated += 1;
      totals.errors += 1;
      evaluated.push({
        matchId: match.id,
        sourceRecordKey: match.sourceRecordKey,
        operatingCompanyId: match.operatingCompanyId,
        currentScore: match.score,
        wouldChangeTo: "ERROR",
        wouldScore: match.score,
        bestCandidateCompanyId: null,
        reason: "PROCESSING_FAILED"
      });
    }
  }

  return {
    tenantId: ctx.tenantId,
    dryRun: true,
    startedAt,
    completedAt: new Date().toISOString(),
    matches: evaluated,
    totals
  };
}

async function evaluateReconciliationMatchDryRun(
  ctx: AuthenticatedContext,
  match: {
    id: string;
    operatingCompanyId: string | null;
    sourceRecordKey: string | null;
    score: number;
    evidence: Prisma.JsonValue | null;
  }
): Promise<ReconciliationDryRunMatch> {
  const base = {
    matchId: match.id,
    sourceRecordKey: match.sourceRecordKey,
    operatingCompanyId: match.operatingCompanyId,
    currentScore: match.score
  };

  // Matches without a source key or operating company cannot be routed (the
  // live path defers them for review); the dry-run mirrors that decision.
  const sourceRecordKey = match.sourceRecordKey;
  if (!sourceRecordKey || !match.operatingCompanyId) {
    return {
      ...base,
      wouldChangeTo: "ROUTED_TO_REVIEW",
      wouldScore: match.score,
      bestCandidateCompanyId: null,
      reason: "MISSING_SOURCE_CONTEXT"
    };
  }
  const operatingCompanyId = match.operatingCompanyId;

  // Reviewed decisions are authoritative and persist across re-runs.
  const reviewed = await prisma.customerIdentityMatch.findFirst({
    where: tenantWhere(ctx, {
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      operatingCompanyId,
      sourceRecordKey,
      status: {
        in: [CustomerIdentityMatchStatus.APPROVED, CustomerIdentityMatchStatus.REJECTED]
      }
    })
  });
  if (reviewed) {
    return {
      ...base,
      wouldChangeTo: "REVIEWED_PRESERVED",
      wouldScore: match.score,
      bestCandidateCompanyId: null,
      reason: "REVIEWED"
    };
  }

  // The same candidate snapshot the live path would load after taking the
  // source advisory lock, read without any lock (a dry-run holds no locks and
  // performs no writes).
  const client = prisma as unknown as Prisma.TransactionClient;
  const snapshot = await loadLockedCandidateSnapshot(
    ctx,
    { operatingCompanyId, sourceRecordKey },
    client
  );
  const scoring = scoreQuickBooksReconciliation(
    readQuickBooksMatchEvidence(match),
    snapshot.candidates,
    snapshot.domainCompanyCounts
  );

  if (scoring.reason === "AUTO_LINK") {
    const companyId = scoring.bestCandidateCompanyId!;
    try {
      await assertCanApproveIdentityMatch(
        ctx,
        {
          kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
          companyId,
          operatingCompanyId,
          candidateCompanyId: null
        },
        client
      );
    } catch {
      return {
        ...base,
        wouldChangeTo: "ERROR",
        wouldScore: scoring.score,
        bestCandidateCompanyId: companyId,
        reason: "APPROVAL_INVARIANT_FAILED"
      };
    }
    const conflicting = await findApprovedConflict(
      ctx,
      {
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        sourceRecordKey,
        companyId,
        selfId: match.id
      },
      client
    );
    if (conflicting) {
      // One APPROVED target per source wins; the live path would route this
      // record back to the review queue instead of overriding the decision.
      return {
        ...base,
        wouldChangeTo: "ROUTED_TO_REVIEW",
        wouldScore: scoring.score,
        bestCandidateCompanyId: null,
        reason: "APPROVED_CONFLICT"
      };
    }
    return {
      ...base,
      wouldChangeTo: "AUTO_LINKED",
      wouldScore: scoring.score,
      bestCandidateCompanyId: companyId,
      reason: scoring.reason
    };
  }

  return {
    ...base,
    wouldChangeTo: "ROUTED_TO_REVIEW",
    wouldScore: scoring.score,
    bestCandidateCompanyId: scoring.bestCandidateCompanyId,
    reason: scoring.reason
  };
}

/**
 * Load every decision-critical candidate fact after the source advisory lock
 * is held. This prevents a queued reconciliation from approving with evidence
 * or relationship eligibility that ingestion changed while it waited.
 */
async function loadLockedCandidateSnapshot(
  ctx: AuthenticatedContext,
  input: {
    operatingCompanyId: string;
    sourceRecordKey: string;
  },
  transaction: Prisma.TransactionClient
): Promise<{
  candidates: ReconciliationCandidate[];
  domainCompanyCounts: Record<string, number>;
}> {
  const [relationships, companies, approvedStableMappings] = await Promise.all([
    transaction.companyOperatingRelationship.findMany({
      where: tenantWhere(ctx, { operatingCompanyId: input.operatingCompanyId }),
      select: { companyId: true }
    }),
    transaction.company.findMany({
      where: tenantWhere(ctx),
      select: {
        id: true,
        name: true,
        domain: true,
        customerSourceAccounts: {
          where: { tenantId: ctx.tenantId },
          select: {
            operatingCompanyId: true,
            email: true,
            phone: true,
            billingAddress: true,
            shippingAddress: true,
            realmId: true,
            quickBooksCustomerId: true
          }
        }
      }
    }),
    transaction.customerIdentityMatch.findMany({
      where: tenantWhere(ctx, {
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        status: CustomerIdentityMatchStatus.APPROVED,
        operatingCompanyId: input.operatingCompanyId,
        companyId: { not: null },
        sourceRecordKey: { not: null }
      }),
      select: {
        companyId: true,
        sourceRecordKey: true
      }
    })
  ]);

  const eligibleCompanyIds = new Set(relationships.map((relationship) => relationship.companyId));
  const domainCompanyCounts: Record<string, number> = {};
  const candidates: ReconciliationCandidate[] = [];

  for (const company of companies) {
    // Domain ownership remains tenant-wide, including relationship-less
    // companies, so a shared domain can never become falsely unique.
    const tenantWideDomains = new Set<string>();
    if (company.domain) {
      tenantWideDomains.add(company.domain.toLowerCase().trim());
    }
    for (const account of company.customerSourceAccounts) {
      const domain = account.email ? extractEmailDomain(account.email) : null;
      if (domain) tenantWideDomains.add(domain);
    }
    for (const domain of tenantWideDomains) {
      domainCompanyCounts[domain] = (domainCompanyCounts[domain] ?? 0) + 1;
    }

    if (!eligibleCompanyIds.has(company.id)) continue;
    const scopedAccounts = company.customerSourceAccounts.filter(
      (account) => account.operatingCompanyId === input.operatingCompanyId
    );
    const candidateDomains = new Set<string>();
    if (company.domain) {
      candidateDomains.add(company.domain.toLowerCase().trim());
    }
    for (const account of scopedAccounts) {
      const domain = account.email ? extractEmailDomain(account.email) : null;
      if (domain) candidateDomains.add(domain);
    }
    candidates.push({
      companyId: company.id,
      name: company.name,
      domains: [...candidateDomains],
      phones: scopedAccounts
        .map((account) => account.phone)
        .filter((phone): phone is string => phone !== null && phone.trim() !== ""),
      addressLines: scopedAccounts.flatMap((account) => [
        ...addressLinesFromJson(account.billingAddress),
        ...addressLinesFromJson(account.shippingAddress)
      ]),
      exactPersistedMapping: scopedAccounts.some(
        (account) => `${account.realmId}:${account.quickBooksCustomerId}` === input.sourceRecordKey
      ),
      previouslyApprovedStableId: approvedStableMappings.some(
        (mapping) =>
          mapping.companyId === company.id && mapping.sourceRecordKey === input.sourceRecordKey
      )
    });
  }

  return { candidates, domainCompanyCounts };
}

async function reconcileOneMatch(
  ctx: AuthenticatedContext,
  input: {
    match: {
      id: string;
      operatingCompanyId: string | null;
      sourceRecordKey: string | null;
      companyId: string | null;
      candidateCompanyId: string | null;
      score: number;
      evidence: Prisma.JsonValue | null;
    };
  }
): Promise<IdentityReconciliationOutcome> {
  const { match } = input;
  const sourceRecordKey = match.sourceRecordKey;

  // Matches without a source key or operating company cannot be routed (they
  // have no ownership context). Fail closed and leave them PROPOSED for review.
  if (!sourceRecordKey || !match.operatingCompanyId) {
    await prisma.$transaction(async (transaction) => {
      const lockKey = [
        "customer-intelligence.identity-match",
        ctx.tenantId,
        match.id
      ].join(":");
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
      );
      const authoritative = await transaction.customerIdentityMatch.findFirst({
        where: tenantWhere(ctx, { id: match.id })
      });
      if (!authoritative) {
        throw new Error("Identity match does not exist in this tenant.");
      }
      if (
        authoritative.status === CustomerIdentityMatchStatus.APPROVED ||
        authoritative.status === CustomerIdentityMatchStatus.REJECTED
      ) {
        return;
      }
      await transaction.customerIdentityMatch.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: match.id } },
        data: { status: CustomerIdentityMatchStatus.PROPOSED }
      });
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.identity-match.deferred",
        entityType: "CustomerIdentityMatch",
        entityId: match.id,
        before: { status: CustomerIdentityMatchStatus.PROPOSED, score: match.score },
        after: {
          status: CustomerIdentityMatchStatus.PROPOSED,
          score: match.score,
          reason: "MISSING_SOURCE_CONTEXT"
        },
        client: transaction
      });
    });
    const reviewed = await prisma.customerIdentityMatch.findFirst({
      where: tenantWhere(ctx, { id: match.id })
    });
    return reviewed?.status === CustomerIdentityMatchStatus.APPROVED ||
      reviewed?.status === CustomerIdentityMatchStatus.REJECTED
      ? "REVIEWED_PRESERVED"
      : "ROUTED_TO_REVIEW";
  }
  const operatingCompanyId = match.operatingCompanyId;

  // Same transaction-scoped advisory lock key as ingestion's proposal lock so
  // concurrent ingestion evidence refreshes and reconciliation of one source
  // serialize instead of racing reviewed decisions.
  const lockKey = [
    "customer-intelligence.quickbooks-proposal",
    ctx.tenantId,
    operatingCompanyId,
    sourceRecordKey
  ].join(":");

  let result: { outcome: IdentityReconciliationOutcome; updated?: unknown };
  let attemptedScore = match.score;
  try {
    result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
      );

      // Reviewed decisions are authoritative and persist across re-runs.
      const reviewed = await transaction.customerIdentityMatch.findFirst({
        where: tenantWhere(ctx, {
          kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
          operatingCompanyId,
          sourceRecordKey,
          status: {
            in: [CustomerIdentityMatchStatus.APPROVED, CustomerIdentityMatchStatus.REJECTED]
          }
        })
      });
      if (reviewed) {
        return { outcome: "REVIEWED_PRESERVED" as const };
      }

      const authoritative = await transaction.customerIdentityMatch.findUnique({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: match.id } }
      });
      if (!authoritative) {
        throw new Error("Identity match does not exist in this tenant.");
      }
      if (authoritative.status !== CustomerIdentityMatchStatus.PROPOSED) {
        return { outcome: "REVIEWED_PRESERVED" as const };
      }
      if (
        authoritative.kind !== CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT ||
        authoritative.operatingCompanyId !== operatingCompanyId ||
        authoritative.sourceRecordKey !== sourceRecordKey
      ) {
        throw new Error("Identity match ownership changed while reconciliation waited for its lock.");
      }

      const candidateSnapshot = await loadLockedCandidateSnapshot(
        ctx,
        {
          operatingCompanyId,
          sourceRecordKey
        },
        transaction
      );
      const scoring = scoreQuickBooksReconciliation(
        readQuickBooksMatchEvidence(authoritative),
        candidateSnapshot.candidates,
        candidateSnapshot.domainCompanyCounts
      );
      attemptedScore = scoring.score;

      if (scoring.reason === "AUTO_LINK") {
        // Shared approval invariant: the canonical target must exist in this
        // tenant and a QUICKBOOKS_ACCOUNT approval needs its operating company.
        // Cross-tenant candidate references are rejected here (defense in
        // depth; the candidate batch load is already tenant-scoped).
        const companyId = scoring.bestCandidateCompanyId!;
        await assertCanApproveIdentityMatch(ctx, {
          kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
          companyId,
          operatingCompanyId,
          candidateCompanyId: null
        }, transaction);

        const conflicting = await findApprovedConflict(ctx, {
          kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
          sourceRecordKey,
          companyId,
          selfId: authoritative.id
        }, transaction);
        if (conflicting) {
          // One APPROVED target per source wins; keep this record PROPOSED so
          // a reviewer sees it rather than silently overriding the decision.
          await transaction.customerIdentityMatch.update({
            where: { tenantId_id: { tenantId: ctx.tenantId, id: authoritative.id } },
            data: {
              status: CustomerIdentityMatchStatus.PROPOSED,
              score: scoring.score,
              candidateCompanyId: null
            }
          });
          await auditEntry({
            actor: ctx,
            action: "customer-intelligence.identity-match.deferred",
            entityType: "CustomerIdentityMatch",
            entityId: authoritative.id,
            before: { status: CustomerIdentityMatchStatus.PROPOSED, score: authoritative.score },
            after: {
              status: CustomerIdentityMatchStatus.PROPOSED,
              score: scoring.score,
              reason: "APPROVED_CONFLICT"
            },
            client: transaction
          });
          return { outcome: "ROUTED_TO_REVIEW" as const };
        }

          const updated = await transaction.customerIdentityMatch.update({
            where: { tenantId_id: { tenantId: ctx.tenantId, id: authoritative.id } },
            data: {
              companyId,
              candidateCompanyId: companyId,
              score: scoring.score,
              status: CustomerIdentityMatchStatus.APPROVED
            }
          });
          await auditEntry({
            actor: ctx,
            action: "customer-intelligence.identity-match.approved",
            entityType: "CustomerIdentityMatch",
            entityId: authoritative.id,
            before: {
              companyId: authoritative.companyId,
              candidateCompanyId: authoritative.candidateCompanyId,
              score: authoritative.score,
              status: CustomerIdentityMatchStatus.PROPOSED
            },
            after: updated,
            client: transaction
          });
          return { outcome: "AUTO_LINKED" as const, updated };
      }

      // Ambiguity, below-threshold, or no candidate: route to the leadership
      // review queue. The suggested best candidate is stored for the reviewer;
      // a missing canonical target (NO_CANDIDATE) stays PROPOSED per
      // CP-02B-3-Q1 — approval without a tenant-valid companyId is impossible.
      await transaction.customerIdentityMatch.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: authoritative.id } },
        data: {
          status: CustomerIdentityMatchStatus.PROPOSED,
          score: scoring.score,
          candidateCompanyId: scoring.bestCandidateCompanyId
        }
      });
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.identity-match.deferred",
        entityType: "CustomerIdentityMatch",
        entityId: authoritative.id,
        before: { status: CustomerIdentityMatchStatus.PROPOSED, score: authoritative.score },
        after: {
          status: CustomerIdentityMatchStatus.PROPOSED,
          score: scoring.score,
          reason: scoring.reason
        },
        client: transaction
      });
      return { outcome: "ROUTED_TO_REVIEW" as const };
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    // PostgreSQL aborts the failed transaction after a unique violation. Read
    // the authoritative winner only after rollback, then record the losing
    // proposal's deterministic deferral in a fresh transaction/audit write.
    const approved = await prisma.customerIdentityMatch.findFirst({
      where: tenantWhere(ctx, {
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        sourceRecordKey,
        status: CustomerIdentityMatchStatus.APPROVED
      })
    });
    if (!approved) {
      throw error;
    }
    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.identity-match.deferred",
      entityType: "CustomerIdentityMatch",
      entityId: match.id,
      before: { status: CustomerIdentityMatchStatus.PROPOSED, score: attemptedScore },
      after: {
        status: CustomerIdentityMatchStatus.PROPOSED,
        reason: "APPROVED_CONCURRENTLY"
      }
    });
    return "REVIEWED_PRESERVED";
  }

  return result.outcome;
}
