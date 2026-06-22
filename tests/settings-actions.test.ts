import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertTradeMiningScoringConfig = vi.fn();
const findIntegrationCredential = vi.fn();
const createIntegrationCredential = vi.fn();
const updateIntegrationCredential = vi.fn();
const revalidatePath = vi.fn();
const getAuthenticatedContext = vi.fn();
const requireAdmin = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    integrationCredential: {
      findFirst: (...args: unknown[]) => findIntegrationCredential(...args),
      create: (...args: unknown[]) => createIntegrationCredential(...args),
      update: (...args: unknown[]) => updateIntegrationCredential(...args)
    },
    tradeMiningScoringConfig: {
      upsert: (...args: unknown[]) => upsertTradeMiningScoringConfig(...args)
    }
  }
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args)
}));

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: (...args: unknown[]) => getAuthenticatedContext(...args)
}));

vi.mock("@/server/auth/authorization", () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args)
}));

import {
  saveApolloRepMappingAction,
  saveTradeMiningScoringSettingsAction
} from "@/modules/settings/actions";

describe("saveTradeMiningScoringSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedContext.mockResolvedValue({
      tenantId: "tenant-1",
      tenantSlug: "newl-group",
      tenantName: "Newl Group"
    });
    upsertTradeMiningScoringConfig.mockResolvedValue({});
    findIntegrationCredential.mockResolvedValue(null);
    createIntegrationCredential.mockResolvedValue({});
    updateIntegrationCredential.mockResolvedValue({});
  });

  it("upserts scoring settings and revalidates dependent surfaces", async () => {
    const formData = new FormData();
    formData.set("recentWindowDays", "30");
    formData.set("comparisonWindowDays", "30");
    formData.set("lookbackWindowDays", "90");
    formData.set("momentumWeight", "30");
    formData.set("marketFitWeight", "20");
    formData.set("industryFitWeight", "15");
    formData.set("companySizeWeight", "15");
    formData.set("roleWeight", "10");
    formData.set("confidenceWeight", "5");
    formData.set("workflowWeight", "5");
    formData.set("preferredOriginCountries", "Italy\nGermany");
    formData.set("penalizedOriginCountries", "China");
    formData.set("preferredOriginPorts", "Genoa");
    formData.set("penalizedOriginPorts", "Ningbo");
    formData.set("preferredDestinationMarkets", "Houston");
    formData.set("penalizedDestinationMarkets", "Los Angeles");
    formData.set("preferredIndustryKeywords", "furniture");
    formData.set("penalizedIndustryKeywords", "broker");
    formData.set("preferredHsCodePrefixes", "9403");
    formData.set("penalizedHsCodePrefixes", "9999");
    formData.set("oversizeTeuThreshold", "30");
    formData.set("oversizeShipmentCount30dThreshold", "18");
    formData.set("oversizePenalty", "10");
    formData.set("midMarketTeuMin", "2");
    formData.set("midMarketTeuMax", "15");
    formData.set("midMarketBoost", "6");
    formData.set("aiClassificationEnabled", "true");
    formData.set("aiModel", "gpt-5-mini");

    await saveTradeMiningScoringSettingsAction(formData);

    expect(upsertTradeMiningScoringConfig).toHaveBeenCalledTimes(1);
    const upsertArgs = upsertTradeMiningScoringConfig.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ tenantId: "tenant-1" });
    expect(upsertArgs.update.preferredOriginCountries).toEqual(["Italy", "Germany"]);
    expect(upsertArgs.update.penalizedOriginCountries).toEqual(["China"]);
    expect(upsertArgs.update.preferredDestinationMarkets).toEqual(["Houston"]);
    expect(upsertArgs.update.aiClassificationEnabled).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/lead-gen/candidates");
  });

  it("saves tenant-scoped Apollo rep mapping entries", async () => {
    const formData = new FormData();
    formData.append("apolloRepActiveIndex", "0");
    formData.append("apolloRepSequenceOwnerName", "Zalan Riaz");
    formData.append("apolloRepUserId", "apollo-user-1");
    formData.append("apolloRepSendFromEmail", "zalan@newlgroup.com");
    formData.append("apolloRepSendFromEmailAccountId", "email-account-1");
    formData.append("apolloRepSequenceOwnerName", "");
    formData.append("apolloRepUserId", "");
    formData.append("apolloRepSendFromEmail", "");
    formData.append("apolloRepSendFromEmailAccountId", "");

    await saveApolloRepMappingAction(formData);

    expect(createIntegrationCredential).toHaveBeenCalledTimes(1);
    const args = createIntegrationCredential.mock.calls[0][0];
    expect(args.data.tenantId).toBe("tenant-1");
    expect(args.data.provider).toBe("APOLLO");
    expect(args.data.publicConfig.apolloUserMapping).toEqual([
      {
        id: "apollo-rep-1",
        sequence_owner_name: "Zalan Riaz",
        active: true,
        apollo_user_id: "apollo-user-1",
        send_from_email: "zalan@newlgroup.com",
        send_from_email_account_id: "email-account-1"
      }
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/lead-gen/pipeline");
  });
});
