import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertTradeMiningScoringConfig = vi.fn();
const findIntegrationCredential = vi.fn();
const createIntegrationCredential = vi.fn();
const updateIntegrationCredential = vi.fn();
const findTradeMiningSearchProfile = vi.fn();
const updateTradeMiningSearchProfile = vi.fn();
const revalidatePath = vi.fn();
const getAuthenticatedContext = vi.fn();
const requireAdmin = vi.fn();
const fetchApolloRepDirectory = vi.fn();
const fetchApolloSequenceDirectory = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    integrationCredential: {
      findFirst: (...args: unknown[]) => findIntegrationCredential(...args),
      create: (...args: unknown[]) => createIntegrationCredential(...args),
      update: (...args: unknown[]) => updateIntegrationCredential(...args)
    },
    tradeMiningSearchProfile: {
      findFirst: (...args: unknown[]) => findTradeMiningSearchProfile(...args),
      update: (...args: unknown[]) => updateTradeMiningSearchProfile(...args)
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

vi.mock("@/server/integrations/apollo", () => ({
  fetchApolloRepDirectory: (...args: unknown[]) => fetchApolloRepDirectory(...args),
  fetchApolloSequenceDirectory: (...args: unknown[]) => fetchApolloSequenceDirectory(...args)
}));

import {
  saveAssistantProviderSettingsAction,
  saveMicrosoftGraphSettingsAction,
  saveApolloRepMappingAction,
  saveApolloSequenceMappingAction,
  saveSearchProfileApolloSequenceMappingAction,
  saveTradeMiningScoringSettingsAction,
  syncApolloRepMappingAction,
  syncApolloSequenceMappingAction
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
    findTradeMiningSearchProfile.mockResolvedValue({
      id: "profile-1"
    });
    updateTradeMiningSearchProfile.mockResolvedValue({});
    fetchApolloRepDirectory.mockResolvedValue([]);
    fetchApolloSequenceDirectory.mockResolvedValue([]);
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
    formData.set("contactDecisionMakerWeight", "20");
    formData.set("contactManagerWeight", "12");
    formData.set("contactLogisticsDepartmentWeight", "15");
    formData.set("contactWeakFunctionPenalty", "6");
    formData.set("contactCompanyContextWeight", "15");
    formData.set("contactEmailWeight", "6");
    formData.set("contactLinkedinWeight", "4");
    formData.set("contactPhoneWeight", "2");
    formData.set("contactPrimaryContactBoost", "6");
    formData.set("contactApprovedStatusBoost", "3");
    formData.set("contactReviewingStatusBoost", "2");
    formData.set("contactTier1Threshold", "78");
    formData.set("contactTier2Threshold", "58");
    formData.set("contactTier3Threshold", "36");
    formData.set("preferredContactTitleKeywords", "director");
    formData.set("penalizedContactTitleKeywords", "assistant");
    formData.set("preferredContactDepartments", "logistics");
    formData.set("penalizedContactDepartments", "finance");
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

  it("saves tenant-scoped assistant provider settings", async () => {
    const formData = new FormData();
    formData.set("assistantProvider", "OPENAI");
    formData.set("assistantDefaultModel", "gpt-5-mini");
    formData.set("assistantFallbackModel", "gpt-5-nano");
    formData.set("assistantTemperature", "0.2");
    formData.set("assistantMaxTokens", "900");
    formData.set("assistantLiveResponsesEnabled", "true");

    await saveAssistantProviderSettingsAction(formData);

    expect(createIntegrationCredential).toHaveBeenCalledTimes(1);
    const args = createIntegrationCredential.mock.calls[0][0];
    expect(args.data.tenantId).toBe("tenant-1");
    expect(args.data.provider).toBe("OPENAI");
    expect(args.data.name).toBe("Company Assistant Provider");
    expect(args.data.status).toBe("ACTIVE");
    expect(args.data.publicConfig).toMatchObject({
      liveResponsesEnabled: true,
      defaultModel: "gpt-5.4-mini",
      fallbackModel: "gpt-5.4-nano",
      temperature: 0.2,
      maxTokens: 900,
      endpointUrl: null
    });
    expect(revalidatePath).toHaveBeenCalledWith("/assistant");
  });

  it("saves tenant-scoped Microsoft Graph integration settings", async () => {
    const formData = new FormData();
    formData.set("microsoftClientId", "client-id-1");
    formData.set("microsoftTenantId", "tenant-id-1");
    formData.set("microsoftRedirectUri", "https://newl-apps.vercel.app/api/auth/callback/microsoft-entra-id");
    formData.set("microsoftMailboxAccessMode", "ADMIN_SELECTED_MAILBOXES");
    formData.set("microsoftAdminMailboxTargets", "shared@newl.ca\nops@newl.ca");
    formData.set("microsoftMailSyncEnabled", "true");
    formData.set("microsoftFileSyncEnabled", "true");

    await saveMicrosoftGraphSettingsAction(formData);

    expect(createIntegrationCredential).toHaveBeenCalledTimes(1);
    const args = createIntegrationCredential.mock.calls[0][0];
    expect(args.data.tenantId).toBe("tenant-1");
    expect(args.data.provider).toBe("MICROSOFT_GRAPH");
    expect(args.data.name).toBe("Microsoft 365 Assistant");
    expect(args.data.publicConfig).toMatchObject({
      clientId: "client-id-1",
      tenantId: "tenant-id-1",
      redirectUri: "https://newl-apps.vercel.app/api/auth/callback/microsoft-entra-id",
      adminMailboxTargets: ["shared@newl.ca", "ops@newl.ca"],
      mailboxAccessMode: "ADMIN_SELECTED_MAILBOXES",
      mailSyncEnabled: true,
      fileSyncEnabled: true,
      draftingEnabled: false
    });
    expect(args.data.publicConfig.scopes).toContain("Mail.Read");
    expect(revalidatePath).toHaveBeenCalledWith("/assistant");
  });

  it("syncs Apollo reps and preserves manual email routing fields", async () => {
    findIntegrationCredential.mockResolvedValue({
      id: "credential-1",
      publicConfig: {
        apolloUserMapping: [
          {
            id: "apollo-rep-1",
            sequence_owner_name: "Zalan Riaz",
            active: false,
            apollo_user_id: "apollo-user-1",
            send_from_email: "zalan@newlgroup.com",
            send_from_email_account_id: "email-account-1"
          }
        ]
      }
    });
    fetchApolloRepDirectory.mockResolvedValue([
      {
        apolloUserId: "apollo-user-1",
        sequenceOwnerName: "Zalan Riaz",
        email: "zalan@apollo.test"
      },
      {
        apolloUserId: "apollo-user-2",
        sequenceOwnerName: "Alex Newell",
        email: "alex@apollo.test"
      }
    ]);

    await syncApolloRepMappingAction();

    expect(updateIntegrationCredential).toHaveBeenCalledTimes(1);
    const args = updateIntegrationCredential.mock.calls[0][0];
    expect(args.where).toEqual({ id: "credential-1" });
    expect(args.data.publicConfig.apolloUserMapping).toEqual([
      {
        id: "apollo-rep-1",
        sequence_owner_name: "Zalan Riaz",
        active: false,
        apollo_user_id: "apollo-user-1",
        send_from_email: "zalan@newlgroup.com",
        send_from_email_account_id: "email-account-1"
      },
      {
        id: "apollo-rep-apollo-user-2",
        sequence_owner_name: "Alex Newell",
        active: true,
        apollo_user_id: "apollo-user-2",
        send_from_email: "alex@apollo.test",
        send_from_email_account_id: null
      }
    ]);
  });

  it("saves profile-specific cadence overrides without changing tenant defaults", async () => {
    findIntegrationCredential.mockResolvedValue({
      id: "credential-1",
      publicConfig: {
        apolloSequenceDirectory: [
          { id: "seq-1", name: "Tier 1 Sequence", active: true, archived: false, automation_mode: "AI_CUSTOM" },
          { id: "seq-2", name: "Tier 2 - AI Personalized", active: true, archived: false, automation_mode: "APOLLO_AI" },
          { id: "seq-3", name: "NEWL - Tier 3 - Email Only", active: true, archived: false, automation_mode: "EMAIL_ONLY" }
        ]
      }
    });

    const formData = new FormData();
    formData.set("profileId", "profile-1");
    formData.append("apolloSequenceTier", "TIER_1");
    formData.append("apolloSequenceLabel", "Tier 1 strong-fit custom");
    formData.append("apolloSequenceId", "seq-1");
    formData.append("apolloSequenceRequiresAiDraft", "TIER_1");
    formData.append("apolloSequenceTier", "TIER_2");
    formData.append("apolloSequenceLabel", "Tier 2 AI personalized");
    formData.append("apolloSequenceId", "seq-2");
    formData.append("apolloSequenceTier", "TIER_3");
    formData.append("apolloSequenceLabel", "Tier 3 email only");
    formData.append("apolloSequenceId", "seq-3");

    await saveSearchProfileApolloSequenceMappingAction(formData);

    expect(updateTradeMiningSearchProfile).toHaveBeenCalledTimes(1);
    const args = updateTradeMiningSearchProfile.mock.calls[0][0];
    expect(args.where).toEqual({ id: "profile-1" });
    expect(args.data.contactCadenceConfig.apolloSequenceMapping).toEqual([
      expect.objectContaining({
        tier: "TIER_1",
        apollo_sequence_id: "seq-1",
        requires_ai_draft: true
      }),
      expect.objectContaining({
        tier: "TIER_2",
        apollo_sequence_id: "seq-2",
        requires_ai_draft: false
      }),
      expect.objectContaining({
        tier: "TIER_3",
        apollo_sequence_id: "seq-3",
        requires_ai_draft: false
      })
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/lead-gen/search-profiles");
  });

  it("fails closed when Apollo sync returns no users", async () => {
    fetchApolloRepDirectory.mockResolvedValue([]);

    await expect(syncApolloRepMappingAction()).rejects.toThrow(
      "Apollo returned no teammates to sync. The existing rep mapping was left unchanged."
    );
    expect(updateIntegrationCredential).not.toHaveBeenCalled();
    expect(createIntegrationCredential).not.toHaveBeenCalled();
  });

  it("saves Apollo tier-to-cadence mappings without dropping rep routing config", async () => {
    findIntegrationCredential.mockResolvedValue({
      id: "credential-1",
      publicConfig: {
        apolloUserMapping: [
          {
            id: "apollo-rep-1",
            sequence_owner_name: "Alex Newell",
            active: true,
            apollo_user_id: "apollo-user-1",
            send_from_email: "alex@newlgroup.com",
            send_from_email_account_id: "email-account-1"
          }
        ],
        apolloSequenceDirectory: [
          { id: "seq-1", name: "Tier 1 Sequence", active: true, archived: false, automation_mode: "AI_CUSTOM" },
          { id: "seq-2", name: "Tier 2 - AI Personalized", active: true, archived: false, automation_mode: "APOLLO_AI" },
          { id: "seq-3", name: "NEWL - Tier 3 - Email Only", active: true, archived: false, automation_mode: "EMAIL_ONLY" }
        ]
      }
    });

    const formData = new FormData();
    formData.append("apolloSequenceTier", "TIER_1");
    formData.append("apolloSequenceLabel", "Tier 1 strong-fit custom");
    formData.append("apolloSequenceId", "seq-1");
    formData.append("apolloSequenceRequiresAiDraft", "TIER_1");
    formData.append("apolloSequenceTier", "TIER_2");
    formData.append("apolloSequenceLabel", "Tier 2 AI personalized");
    formData.append("apolloSequenceId", "seq-2");
    formData.append("apolloSequenceRequiresAiDraft", "TIER_2");
    formData.append("apolloSequenceTier", "TIER_3");
    formData.append("apolloSequenceLabel", "Tier 3 email only");
    formData.append("apolloSequenceId", "seq-3");

    await saveApolloSequenceMappingAction(formData);

    expect(updateIntegrationCredential).toHaveBeenCalledTimes(1);
    const args = updateIntegrationCredential.mock.calls[0][0];
    expect(args.data.publicConfig.apolloUserMapping).toHaveLength(1);
    expect(args.data.publicConfig.apolloSequenceMapping).toEqual([
      expect.objectContaining({
        tier: "TIER_1",
        apollo_sequence_id: "seq-1",
        apollo_sequence_name: "Tier 1 Sequence",
        requires_ai_draft: true
      }),
      expect.objectContaining({
        tier: "TIER_2",
        apollo_sequence_id: "seq-2",
        apollo_sequence_name: "Tier 2 - AI Personalized",
        requires_ai_draft: true
      }),
      expect.objectContaining({
        tier: "TIER_3",
        apollo_sequence_id: "seq-3",
        apollo_sequence_name: "NEWL - Tier 3 - Email Only",
        requires_ai_draft: false
      })
    ]);
  });

  it("syncs Apollo cadences and auto-fills default tier mappings", async () => {
    fetchApolloSequenceDirectory.mockResolvedValue([
      {
        id: "seq-1",
        name: "Tier 1 Sequence",
        active: true,
        archived: false,
        description: null,
        lastUsedAt: "2026-06-23T15:00:00.000Z"
      },
      {
        id: "seq-2",
        name: "Tier 2 - AI Personalized",
        active: true,
        archived: false,
        description: null,
        lastUsedAt: "2026-06-23T15:00:00.000Z"
      },
      {
        id: "seq-3",
        name: "NEWL - Tier 3 - Email Only",
        active: true,
        archived: false,
        description: null,
        lastUsedAt: "2026-06-23T15:00:00.000Z"
      }
    ]);

    await syncApolloSequenceMappingAction();

    expect(createIntegrationCredential).toHaveBeenCalledTimes(1);
    const args = createIntegrationCredential.mock.calls[0][0];
    expect(args.data.publicConfig.apolloSequenceDirectory).toHaveLength(3);
    expect(args.data.publicConfig.apolloSequenceMapping).toEqual([
      expect.objectContaining({ tier: "TIER_1", apollo_sequence_id: "seq-1" }),
      expect.objectContaining({ tier: "TIER_2", apollo_sequence_id: "seq-2" }),
      expect.objectContaining({ tier: "TIER_3", apollo_sequence_id: "seq-3" })
    ]);
  });

  it("only reuses name-based routing metadata for legacy rows without an Apollo user ID", async () => {
    findIntegrationCredential.mockResolvedValue({
      id: "credential-1",
      publicConfig: {
        apolloUserMapping: [
          {
            id: "apollo-rep-legacy",
            sequence_owner_name: "Alex Newell",
            active: true,
            apollo_user_id: null,
            send_from_email: "alex@newlgroup.com",
            send_from_email_account_id: "email-account-legacy"
          },
          {
            id: "apollo-rep-other",
            sequence_owner_name: "Jamie Smith",
            active: true,
            apollo_user_id: "apollo-user-existing",
            send_from_email: "jamie@newlgroup.com",
            send_from_email_account_id: "email-account-existing"
          }
        ]
      }
    });
    fetchApolloRepDirectory.mockResolvedValue([
      {
        apolloUserId: "apollo-user-new",
        sequenceOwnerName: "Alex Newell",
        email: "alex@apollo.test"
      },
      {
        apolloUserId: "apollo-user-existing-renamed",
        sequenceOwnerName: "Jamie Smith",
        email: "jamie@apollo.test"
      }
    ]);

    await syncApolloRepMappingAction();

    const args = updateIntegrationCredential.mock.calls[0][0];
    expect(args.data.publicConfig.apolloUserMapping).toEqual([
      {
        id: "apollo-rep-legacy",
        sequence_owner_name: "Alex Newell",
        active: true,
        apollo_user_id: "apollo-user-new",
        send_from_email: "alex@newlgroup.com",
        send_from_email_account_id: "email-account-legacy"
      },
      {
        id: "apollo-rep-apollo-user-existing-renamed",
        sequence_owner_name: "Jamie Smith",
        active: true,
        apollo_user_id: "apollo-user-existing-renamed",
        send_from_email: "jamie@apollo.test",
        send_from_email_account_id: null
      }
    ]);
  });
});
