import { CustomerIntelligenceServiceLine, QuickBooksServiceMappingDimension } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { resolveServiceLine, type ServiceMappingRuleInput } from "@/modules/customer-intelligence/service-lines";
import { NEWELLS_EXPRESS_SLUG } from "@/modules/customer-intelligence/constants";

function rule(
  dimension: QuickBooksServiceMappingDimension,
  matchValue: string,
  serviceLine: CustomerIntelligenceServiceLine,
  priority = 0
): ServiceMappingRuleInput {
  return { dimension, matchValue, serviceLine, priority };
}

const OCEAN = CustomerIntelligenceServiceLine.OCEAN;
const AIR = CustomerIntelligenceServiceLine.AIR;
const TRUCKING = CustomerIntelligenceServiceLine.TRUCKING_DRAYAGE;
const LOCAL = CustomerIntelligenceServiceLine.LOCAL_TRUCKING;
const WAREHOUSING = CustomerIntelligenceServiceLine.WAREHOUSING_FULFILLMENT;
const CUSTOMS = CustomerIntelligenceServiceLine.CUSTOMS_BROKERAGE;
const OTHER = CustomerIntelligenceServiceLine.OTHER;

describe("resolveServiceLine", () => {
  it("resolves the seven approved service lines", () => {
    expect(OCEAN).toBeDefined();
    expect(AIR).toBeDefined();
    expect(TRUCKING).toBeDefined();
    expect(LOCAL).toBeDefined();
    expect(WAREHOUSING).toBeDefined();
    expect(CUSTOMS).toBeDefined();
    expect(OTHER).toBeDefined();
  });

  it("applies precedence: item beats class, class beats income account", () => {
    const rules = [
      rule(QuickBooksServiceMappingDimension.INCOME_ACCOUNT, "Shipping Income", AIR, 5),
      rule(QuickBooksServiceMappingDimension.CLASS, "Freight", TRUCKING, 5),
      rule(QuickBooksServiceMappingDimension.ITEM, "Ocean Freight", OCEAN, 5)
    ];
    expect(
      resolveServiceLine({ item: "Ocean Freight", classRef: "Freight", incomeAccount: "Shipping Income" }, rules)
    ).toBe(OCEAN);
  });

  it("falls through to class/department when no item rule matches", () => {
    const rules = [
      rule(QuickBooksServiceMappingDimension.ITEM, "Ocean Freight", OCEAN, 5),
      rule(QuickBooksServiceMappingDimension.DEPARTMENT, "Warehousing", WAREHOUSING, 5)
    ];
    expect(resolveServiceLine({ item: "Something Else", department: "Warehousing" }, rules)).toBe(
      WAREHOUSING
    );
  });

  it("falls through to income account and then file prefix", () => {
    const rules = [
      rule(QuickBooksServiceMappingDimension.INCOME_ACCOUNT, "Customs Clearance", CUSTOMS, 5),
      rule(QuickBooksServiceMappingDimension.FILE_PREFIX, "IMP", CUSTOMS, 5)
    ];
    expect(resolveServiceLine({ incomeAccount: "Customs Clearance", filePrefix: "IMP-123" }, rules)).toBe(
      CUSTOMS
    );
    expect(resolveServiceLine({ filePrefix: "IMP-123" }, rules)).toBe(CUSTOMS);
  });

  it("uses the highest-priority rule within the same dimension", () => {
    const rules = [
      rule(QuickBooksServiceMappingDimension.ITEM, "Ocean Freight", OCEAN, 1),
      rule(QuickBooksServiceMappingDimension.ITEM, "Ocean Freight", TRUCKING, 9)
    ];
    expect(resolveServiceLine({ item: "Ocean Freight" }, rules)).toBe(TRUCKING);
  });

  it("defaults unmatched income to OTHER for most operating companies", () => {
    expect(resolveServiceLine({ item: "Unmapped" }, [])).toBe(OTHER);
    expect(resolveServiceLine({ item: "Unmapped", operatingCompanySlug: "newl-usa" }, [])).toBe(OTHER);
  });

  it("defaults unmatched income to LOCAL_TRUCKING for Newell's Express only", () => {
    expect(
      resolveServiceLine({ item: "Unmapped", operatingCompanySlug: NEWELLS_EXPRESS_SLUG }, [])
    ).toBe(LOCAL);
  });

  it("lets an explicit rule override the Newell's Express default", () => {
    const rules = [rule(QuickBooksServiceMappingDimension.ITEM, "Ocean", OCEAN, 5)];
    expect(
      resolveServiceLine({ item: "Ocean", operatingCompanySlug: NEWELLS_EXPRESS_SLUG }, rules)
    ).toBe(OCEAN);
  });

  it("treats match values case-insensitively", () => {
    const rules = [rule(QuickBooksServiceMappingDimension.CLASS, "air freight", AIR, 5)];
    expect(resolveServiceLine({ classRef: "AIR FREIGHT" }, rules)).toBe(AIR);
  });
});
