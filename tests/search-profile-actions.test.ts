import { beforeEach, describe, expect, it, vi } from "vitest";

const createSearchProfile = vi.fn();
const updateSearchProfile = vi.fn();
const deleteSearchProfile = vi.fn();
const revalidatePath = vi.fn();
const getAuthenticatedContext = vi.fn();
const requireAdmin = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    tradeMiningSearchProfile: {
      create: (...args: unknown[]) => createSearchProfile(...args),
      update: (...args: unknown[]) => updateSearchProfile(...args),
      delete: (...args: unknown[]) => deleteSearchProfile(...args)
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
  updateTradeMiningSearchProfileAction
} from "@/modules/lead-gen/actions";

describe("trade mining search profile actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedContext.mockResolvedValue({
      tenantId: "tenant-1",
      tenantSlug: "newl-group",
      tenantName: "Newl Group"
    });
    createSearchProfile.mockResolvedValue({});
    updateSearchProfile.mockResolvedValue({});
    deleteSearchProfile.mockResolvedValue({});
  });

  it("creates a tenant-scoped search profile from form input", async () => {
    const formData = buildValidFormData();

    await createTradeMiningSearchProfileAction(formData);

    expect(createSearchProfile).toHaveBeenCalledTimes(1);
    const args = createSearchProfile.mock.calls[0][0];
    expect(args.data.tenantId).toBe("tenant-1");
    expect(args.data.destinationMarkets).toEqual(["Houston", "Dallas"]);
    expect(args.data.originCountries).toEqual(["Italy", "Germany"]);
    expect(args.data.enabled).toBe(true);
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

  it("deletes a profile by id", async () => {
    const formData = new FormData();
    formData.set("profileId", "profile-123");

    await deleteTradeMiningSearchProfileAction(formData);

    expect(deleteSearchProfile).toHaveBeenCalledWith({
      where: {
        id: "profile-123"
      }
    });
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
  formData.set("lookbackWindowDays", "90");
  formData.set("minShipmentCount", "1");
  formData.set("minShipmentVolume", "10");
  formData.set("scheduleFrequency", "daily");
  formData.set("scheduleTimezone", "America/Toronto");
  formData.set("priorityWeight", "80");
  return formData;
}
