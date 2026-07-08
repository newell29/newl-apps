import { AccountingInvoiceType, QuickBooksDirectoryEntityType } from "@prisma/client";
import { normalizeInvoiceEntityName } from "./parsing";

export type DirectoryCandidate = { id: string; quickBooksId: string; displayName: string; normalizedName: string; currency: string | null; entityType: QuickBooksDirectoryEntityType; legalEntity?: string | null };
export type MatchIssue = "MISSING_QB_MATCH" | "AMBIGUOUS_QB_MATCH" | "CURRENCY_PROFILE_MISMATCH";

export function directoryEntityTypeForInvoice(invoiceType?: AccountingInvoiceType | null) {
  return invoiceType === AccountingInvoiceType.VENDOR_INVOICE ? QuickBooksDirectoryEntityType.VENDOR : QuickBooksDirectoryEntityType.CUSTOMER;
}

export function suggestQuickBooksEntity(input: { normalizedName?: string | null; rawName?: string | null; currency?: string | null; invoiceType?: AccountingInvoiceType | null; candidates: DirectoryCandidate[]; previousSelections?: DirectoryCandidate[] }) {
  const normalized = input.normalizedName || normalizeInvoiceEntityName(input.rawName);
  const wantedType = directoryEntityTypeForInvoice(input.invoiceType);
  const candidates = input.candidates.filter((c) => c.entityType === wantedType);
  const previous = (input.previousSelections ?? []).find((c) => c.normalizedName === normalized && (!input.currency || !c.currency || c.currency === input.currency));
  if (previous) return { selected: previous, suggestions: [previous], issues: [] as MatchIssue[] };
  const exact = candidates.filter((c) => c.normalizedName === normalized);
  const currencyExact = exact.filter((c) => !input.currency || !c.currency || c.currency === input.currency);
  if (new Set(exact.map((c) => c.currency).filter(Boolean)).size > 1) return { selected: null, suggestions: exact, issues: ["AMBIGUOUS_QB_MATCH"] as MatchIssue[] };
  if (currencyExact.length === 1) return { selected: currencyExact[0], suggestions: currencyExact, issues: [] as MatchIssue[] };
  if (currencyExact.length > 1) return { selected: null, suggestions: currencyExact, issues: ["AMBIGUOUS_QB_MATCH"] as MatchIssue[] };
  if (input.currency === "USD" && exact.length === 1 && exact[0].currency === "CAD") return { selected: null, suggestions: exact, issues: ["CURRENCY_PROFILE_MISMATCH"] as MatchIssue[] };
  const fuzzy = candidates.filter((c) => normalized && (c.normalizedName.includes(normalized) || normalized.includes(c.normalizedName))).slice(0, 5);
  return { selected: null, suggestions: fuzzy, issues: [fuzzy.length ? "AMBIGUOUS_QB_MATCH" : "MISSING_QB_MATCH"] as MatchIssue[] };
}
