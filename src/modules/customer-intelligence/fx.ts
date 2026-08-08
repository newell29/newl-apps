import { CustomerFxRateStatus } from "@prisma/client";

/**
 * Deterministic FX helpers for Customer Intelligence financial materialization
 * (CP-PHASE-02B-5). Business rules traced to the approved plan and
 * docs/modules/customer-intelligence/business-rules.md:
 *
 * - CAD consolidation is directional management reporting, not a statutory
 *   accounting entry.
 * - Closed months use Bank of Canada monthly average rates marked FINAL; the
 *   current month uses an available-to-date average marked PROVISIONAL.
 * - Month keys are "YYYY-MM" computed in UTC so classification is stable
 *   regardless of the runtime timezone.
 */

/** Directional management reporting disclosure carried by every CAD consolidation. */
export const CAD_CONSOLIDATION_DISCLOSURE =
  "Directional management reporting: CAD consolidation is not a statutory accounting entry.";

/** Native/home currency of the Newl operating companies (schema default). */
export const CAD_CURRENCY = "CAD";

/** Source label for Bank of Canada monthly average FX rates. */
export const FX_SOURCE_BANK_OF_CANADA = "BANK_OF_CANADA";

/** Deterministic "YYYY-MM" key for a date, computed in UTC. */
export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" key for the current month (or the supplied reference date). */
export function currentMonthKey(now: Date = new Date()): string {
  return monthKeyOf(now);
}

/** Validates a "YYYY-MM" month key. */
export function validateMonthKey(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

/**
 * Closed months (strictly before the current month) use FINAL Bank of Canada
 * monthly average rates; the current month uses an available-to-date average
 * marked PROVISIONAL. A future month (never expected from a trailing window)
 * also classifies PROVISIONAL because no finalized rate exists for it yet.
 */
export function fxStatusForMonthKey(
  monthKey: string,
  now: Date = new Date()
): CustomerFxRateStatus {
  if (!validateMonthKey(monthKey)) {
    throw new Error("monthKey must use YYYY-MM.");
  }
  return monthKey < currentMonthKey(now)
    ? CustomerFxRateStatus.FINAL
    : CustomerFxRateStatus.PROVISIONAL;
}

/** True when a month is closed (strictly before the current month). */
export function isClosedMonth(monthKey: string, now: Date = new Date()): boolean {
  return fxStatusForMonthKey(monthKey, now) === CustomerFxRateStatus.FINAL;
}

/**
 * Deterministic `fxSource` label embedding the FINAL/PROVISIONAL classification
 * so every materialized revenue line records whether its conversion used a
 * closed-month average or a provisional current-month rate.
 */
export function fxSourceForMonthKey(monthKey: string, now: Date = new Date()): string {
  return fxStatusForMonthKey(monthKey, now) === CustomerFxRateStatus.FINAL
    ? `${FX_SOURCE_BANK_OF_CANADA}_FINAL`
    : `${FX_SOURCE_BANK_OF_CANADA}_PROVISIONAL`;
}

/**
 * Convert a native amount to CAD at the given rate and round to the schema's
 * two-decimal precision (Decimal(14, 2)). Deterministic: symmetric half-up
 * rounding at the cent, including credits and vendor credits. Rounding the
 * absolute magnitude before restoring the sign avoids JavaScript Math.round's
 * asymmetric treatment of negative half-cent values.
 */
export function toCadAmount(amount: number, rateToCad: number): number {
  return roundCurrencyAmount(amount * rateToCad);
}

/** Shared sign-safe decimal half-up cent rounding for monthly financials. */
export function roundCurrencyAmount(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Currency amount must be finite.");
  }
  const sign = value < 0 ? -1 : 1;
  const scaledMagnitude = Math.abs(value) * 100;
  const tolerance = Number.EPSILON * Math.max(1, scaledMagnitude);
  const rounded = sign * (Math.floor(scaledMagnitude + 0.5 + tolerance) / 100);
  return Object.is(rounded, -0) ? 0 : rounded;
}
