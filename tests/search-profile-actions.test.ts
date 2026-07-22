import { beforeEach, describe, expect, it, vi } from "vitest";

const createSearchProfile = vi.fn();
const updateSearchProfile = vi.fn();
const deleteSearchProfile = vi.fn();
const findSearchProfile = vi.fn();
const findAutomationJobRun = vi.fn();
const createAutomationJobRun = vi.fn();
const updateAutomationJobRuns = vi.fn();
const createAuditLog = vi.fn();
const revalidatePath = vi.fn();
const getAuthenticatedContext = vi.fn();
const requireAdmin = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    tradeMiningSearchProfile: {
      create: (...args: unknown[]) => createSearchProfile(...args),
      update: (...args: unknown[]) => updateSearchProfile(...args),
      delete: (...args: unknown[]) => deleteSearchProfile(...args),
      findFirst: (...args: unknown[]) => findSearchProfile(...args)
    },
    automationJobRun: {
      findFirst: (...args: unknown[]) => findAutomationJobRun(...args),
      create: (...args: unknown[]) => createAutomationJobRun(...args),
      updateMany: (...args: unknown[]) => updateAutomationJobRuns(...args)
    },
    auditLog: {
      create: (...args: unknown[]) => createAuditLog(...args)
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
  createTradeMiningSearchProfileAction,
  deleteTradeMiningSearchProfileAction,
  requestTradeMiningSearchProfileRunAction,
  updateTradeMiningSearchProfileAction
} from "@/modules/lead-gen/actions";

describe("trade mining search profile actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedContext.mockResolvedValue({
      tenantId: "tenant-1",
      tenantSlug: "newl-group",
      tenantName: "Newl Group",
      userId: "user-1",
      userEmail: "alex@newl.ca",
      userName: "Alex Newell"
    });
    createSearchProfile.mockResolvedValue({});
    updateSearchProfile.mockResolvedValue({});
    deleteSearchProfile.mockResolvedValue({});
    findSearchProfile.mockResolvedValue({ id: "profile-123", name: "Houston Import Leads", enabled: true });
    findAutomationJobRun.mockResolvedValue(null);
    createAutomationJobRun.mockResolvedValue({});
    updateAutomationJobRuns.mockResolvedValue({ count: 0 });
    createAuditLog.mockResolvedValue({});
  });

  it("creates a tenant-scoped search profile from form input", async () => {
    const formData = buildValidFormData();

    await createTradeMiningSearchProfileAction(formData);

    expect(createSearchProfile).toHaveBeenCalledTimes(1);
    const args = createSearchProfile.mock.calls[0][0];
    expect(args.data.tenantId).toBe("tenant-1");
    expect(args.data.destinationMarkets).toEqual(["Houston", "Dallas"]);
    expect(args.data.destinationPorts).toEqual(["Houston, Texas"]);
    expect(args.data.originCountries).toEqual(["Italy", "Germany"]);
    expect(args.data.allowedCompanyIdentityRoles).toEqual(["consignee_name", "importer_name"]);
    expect(args.data.excludedCompanyKeywords).toEqual(["maersk", "msc"]);
    expect(args.data.enabled).toBe(true);
    expect(args.data.scheduleFrequency).toBe("daily");
    expect(revalidatePath).toHaveBeenCalledWith("/lead-gen/search-profiles");
  });

  it("updates an existing profile", async () => {
    const formData = buildValidFormData();
    formData.set("profileId", "profile-123");

    await updateTradeMiningSearchProfileAction(formData);

    expect(updateSearchProfile).toHaveBeenCalledTimes(1);
    const args = updateSearchProfile.mock.calls[0][0];
    expect(args.where).toEqual({ id: "profile-123" });
    expect(args.data.priorityWeight).toBe(80);
  });

  it("cancels pending runs when a profile is disabled", async () => {
    const formData = buildValidFormData();
    formData.set("profileId", "profile-123");
    formData.delete("enabled");

    await updateTradeMiningSearchProfileAction(formData);

    expect(updateAutomationJobRuns).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: "tenant-1",
        input: {
          path: ["searchProfileId"],
          equals: "profile-123"
        }
      }),
      data: expect.objectContaining({
        status: "CANCELLED",
        output: {
          cancellationReason: "Search profile disabled"
        }
      })
    });
  });

  it("deletes a profile by id", async () => {
    const formData = new FormData();
    formData.set("profileId", "profile-123");

    await deleteTradeMiningSearchProfileAction(formData);

    expect(deleteSearchProfile).toHaveBeenCalledWith({
      where: {
        id: "profile-123"
      }
    });
    expect(updateAutomationJobRuns).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: "tenant-1",
        jobType: "trademining.run_request",
        input: {
          path: ["searchProfileId"],
          equals: "profile-123"
        }
      }),
      data: expect.objectContaining({
        status: "CANCELLED"
      })
    });
  });

  it("queues an immediate run request for an enabled profile", async () => {
    const formData = new FormData();
    formData.set("profileId", "profile-123");

    await requestTradeMiningSearchProfileRunAction(formData);

    expect(createAutomationJobRun).toHaveBeenCalledTimes(1);
    const args = createAutomationJobRun.mock.calls[0][0];
    expect(args.data.tenantId).toBe("tenant-1");
    expect(args.data.jobType).toBe("trademining.run_request");
    expect(args.data.status).toBe("QUEUED");
    expect(args.data.input.searchProfileId).toBe("profile-123");
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });
});

function buildValidFormData() {
  const formData = new FormData();
  formData.set("name", "Houston Import Leads");
  formData.set("description", "Trial pull for Houston-area importers");
  formData.set("enabled", "true");
  formData.set("destinationMarkets", "Houston\nDallas");
  formData.set("destinationPorts", "Houston, Texas");
  formData.set("originPorts", "Genoa");
  formData.set("shipFromPorts", "Genoa");
  formData.set("originCountries", "Italy\nGermany");
  formData.set("productKeywords", "furniture");
  formData.set("hsCodes", "9403");
  formData.append("allowedCompanyIdentityRole", "consignee_name");
  formData.append("allowedCompanyIdentityRole", "importer_name");
  formData.set("excludedCompanyKeywords", "maersk\nmsc");
  formData.set("lookbackWindowDays", "90");
  formData.set("minShipmentCount", "1");
  formData.set("minShipmentVolume", "10");
  formData.set("scheduleTimezone", "America/Toronto");
  formData.set("priorityWeight", "80");
  return formData;
}
