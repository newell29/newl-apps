import type { WebsiteInboundFieldValue } from "@/modules/website-inbound/types";

const honeypotFields = new Set(["_gotcha", "companyUrlConfirm", "faxNumber"]);

const spamPatterns = [
  /backlink/i,
  /guest\s*post/i,
  /link\s*insertion/i,
  /domain\s*authority/i,
  /rank(?:ing)?\s+(?:on\s+)?google/i,
  /seo\s+(?:service|package|agency|expert|proposal)/i,
  /casino/i,
  /crypto/i,
  /forex/i,
  /viagra/i,
  /loan/i,
  /adult\s+traffic/i
];

function flattenFields(fields: Record<string, WebsiteInboundFieldValue>) {
  return Object.entries(fields).flatMap(([key, value]) => {
    if (Array.isArray(value)) {
      return [key, ...value];
    }

    return [key, value];
  });
}

export function stripWebsiteInboundSystemFields(fields: Record<string, WebsiteInboundFieldValue>) {
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => !honeypotFields.has(key))
  );
}

export function isLikelySpamWebsiteInboundSubmission(
  fields: Record<string, WebsiteInboundFieldValue>
) {
  for (const fieldName of honeypotFields) {
    const value = fields[fieldName];

    if (Array.isArray(value) ? value.some(Boolean) : Boolean(value)) {
      return true;
    }
  }

  const combined = flattenFields(fields).join(" ");
  const urlCount = (combined.match(/https?:\/\/|www\./gi) ?? []).length;

  if (urlCount > 1) {
    return true;
  }

  return spamPatterns.some((pattern) => pattern.test(combined));
}
