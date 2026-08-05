import { CustomerIntelligenceServiceLine } from "@prisma/client";

import {
  DEFAULT_SERVICE_LINE,
  NEWELLS_EXPRESS_DEFAULT_SERVICE_LINE,
  NEWELLS_EXPRESS_SLUG,
  SERVICE_MAPPING_DIMENSION_PRECEDENCE
} from "@/modules/customer-intelligence/constants";

export type ServiceMappingRuleInput = {
  dimension: string;
  matchValue: string;
  serviceLine: CustomerIntelligenceServiceLine;
  priority: number;
};

export type ServiceMappingContext = {
  item?: string;
  classRef?: string;
  department?: string;
  incomeAccount?: string;
  filePrefix?: string;
  operatingCompanySlug?: string;
};

const FIELD_BY_DIMENSION: Record<string, (context: ServiceMappingContext) => string | undefined> = {
  ITEM: (context) => context.item,
  CLASS: (context) => context.classRef,
  DEPARTMENT: (context) => context.department,
  INCOME_ACCOUNT: (context) => context.incomeAccount,
  FILE_PREFIX: (context) => context.filePrefix
};

function normalizeMatchValue(value: string): string {
  return value.trim().toLowerCase();
}

function matchesRule(rule: ServiceMappingRuleInput, fieldValue: string | undefined): boolean {
  if (!fieldValue) {
    return false;
  }
  const normalizedField = normalizeMatchValue(fieldValue);
  const normalizedMatch = normalizeMatchValue(rule.matchValue);
  if (normalizedMatch.length === 0) {
    return false;
  }
  return normalizedField === normalizedMatch || normalizedField.includes(normalizedMatch);
}

/**
 * Deterministic service-line resolution per the approved plan:
 *
 * - Precedence: QuickBooks item, class/department, income account, shipment/file
 *   prefix, then the operating-company default.
 * - Explicit rules override the operating-company default.
 * - Newell's Express defaults unmapped income to LOCAL_TRUCKING; every other
 *   operating company defaults to OTHER.
 */
export function resolveServiceLine(
  context: ServiceMappingContext,
  rules: ServiceMappingRuleInput[]
): CustomerIntelligenceServiceLine {
  const activeRules = rules.filter((rule) => rule.serviceLine);
  const byDimension = (dimension: string) =>
    activeRules
      .filter((rule) => rule.dimension === dimension)
      .sort((a, b) => b.priority - a.priority);

  for (const dimension of SERVICE_MAPPING_DIMENSION_PRECEDENCE) {
    const field = FIELD_BY_DIMENSION[dimension];
    if (!field) {
      continue;
    }
    const fieldValue = field(context);
    const rule = byDimension(dimension).find((candidate) =>
      matchesRule(candidate, fieldValue)
    );
    if (rule) {
      return rule.serviceLine;
    }
  }

  if (context.operatingCompanySlug === NEWELLS_EXPRESS_SLUG) {
    return NEWELLS_EXPRESS_DEFAULT_SERVICE_LINE;
  }

  return DEFAULT_SERVICE_LINE;
}
