import { describe, expect, it } from "vitest";

import { formatInvoiceMoney } from "@/modules/invoice-automation/components";

describe("invoice automation components", () => {
  it("does not crash while a currency code is partially edited", () => {
    expect(formatInvoiceMoney(404.31, "C")).toBe("C 404.31");
    expect(formatInvoiceMoney(404.31, "CA")).toBe("CA 404.31");
    expect(formatInvoiceMoney(404.31, "CAD")).toBe("CA$404.31");
  });
});
