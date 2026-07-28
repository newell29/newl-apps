import { ReplyStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildHunterCompanyResearchWhere } from "@/modules/lead-gen/hunter-company-research";

describe("Hunter company research selection", () => {
  it("does not suppress a company because it has legacy leads or prior cadence history", () => {
    const where = buildHunterCompanyResearchWhere({
      tenantId: "tenant-a",
      requestedKeys: [],
      recentlyResearchedIds: []
    });

    expect(where).not.toHaveProperty("leads");
    expect(where).not.toHaveProperty(
      "contacts.none.sequenceStatus"
    );
    expect(where).toMatchObject({
      tenantId: "tenant-a",
      contacts: {
        none: {
          replyStatus: { not: ReplyStatus.NO_REPLY }
        }
      }
    });
  });
});
