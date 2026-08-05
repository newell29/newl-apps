import {
  CustomerIntelligenceServiceLine,
  CustomerLifecycle,
  QuickBooksServiceMappingDimension
} from "@prisma/client";

/**
 * Deterministic constants for the Customer Intelligence foundation.
 *
 * Business rules here are traced to the approved Customer Intelligence plan.
 * Where a value was inferred rather than explicitly approved it is marked in
 * docs/modules/customer-intelligence/open-questions.md.
 */

/** Domains that never establish company identity. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "mail.com",
  "gmx.com",
  "yandex.com",
  "hey.com"
]);

/** Auto-link only when the identity match score is at least this value. */
export const IDENTITY_AUTO_LINK_THRESHOLD = 90;

/** Identity match score for a previously approved stable QuickBooks ID or alias. */
export const IDENTITY_SCORE_APPROVED_STABLE_ID = 100;
/** Identity match score for an exact persisted realm/customer mapping. */
export const IDENTITY_SCORE_EXACT_PERSISTED_MAPPING = 100;
/** Identity match score for a unique domain plus a compatible normalized name. */
export const IDENTITY_SCORE_UNIQUE_DOMAIN_PLUS_NAME = 95;
/** Identity match score for a compatible normalized name plus phone or address. */
export const IDENTITY_SCORE_NAME_PLUS_PHONE_OR_ADDRESS = 92;

/**
 * Service-line mapping precedence. QuickBooks item wins, then class/department,
 * then income account, then shipment/file prefix. Anything unmatched falls back
 * to the operating-company default.
 */
export const SERVICE_MAPPING_DIMENSION_PRECEDENCE: QuickBooksServiceMappingDimension[] = [
  QuickBooksServiceMappingDimension.ITEM,
  QuickBooksServiceMappingDimension.CLASS,
  QuickBooksServiceMappingDimension.DEPARTMENT,
  QuickBooksServiceMappingDimension.INCOME_ACCOUNT,
  QuickBooksServiceMappingDimension.FILE_PREFIX
];

export const DEFAULT_SERVICE_LINE = CustomerIntelligenceServiceLine.OTHER;

/** Newell's Express defaults unmapped income to local trucking. */
export const NEWELLS_EXPRESS_SLUG = "newells-express";
export const NEWELLS_EXPRESS_DEFAULT_SERVICE_LINE = CustomerIntelligenceServiceLine.LOCAL_TRUCKING;

/**
 * Lifecycle rollup order for a canonical company across its operating-company
 * relationships. ACTIVE beats DORMANT beats FORMER beats PROSPECT.
 */
export const LIFECYCLE_STRENGTH: Record<CustomerLifecycle, number> = {
  [CustomerLifecycle.PROSPECT]: 0,
  [CustomerLifecycle.FORMER_CUSTOMER]: 1,
  [CustomerLifecycle.DORMANT_CUSTOMER]: 2,
  [CustomerLifecycle.ACTIVE_CUSTOMER]: 3
};
