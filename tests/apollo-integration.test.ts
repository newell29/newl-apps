import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplyStatus, SequenceStatus } from "@prisma/client";
import {
  fetchApolloActivitySummary,
  fetchApolloContactsForCompany,
  fetchApolloRepDirectory,
  fetchApolloSequenceDirectory
} from "@/server/integrations/apollo";

describe("fetchApolloRepDirectory", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("APOLLO_MASTER_API", "master-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when the Apollo master API key is not configured", async () => {
    vi.stubEnv("APOLLO_MASTER_API", "");

    await expect(fetchApolloRepDirectory()).rejects.toThrow(
      "Apollo master API key is not configured. Add APOLLO_MASTER_API before syncing reps."
    );
  });

  it("throws when Apollo returns an unreadable success response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error("bad json"))
    } as unknown as Response);

    await expect(fetchApolloRepDirectory()).rejects.toThrow(
      "Apollo user sync returned an unreadable response body."
    );
  });

  it("dedupes users across paginated responses", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          users: [
            { id: "apollo-user-2", name: "Zalan Riaz", email: "zalan@apollo.test" },
            { id: "apollo-user-1", first_name: "Alex", last_name: "Newell", email: "alex@apollo.test" }
          ]
        })
      } as unknown as Response);

    const reps = await fetchApolloRepDirectory();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reps).toEqual([
      {
        apolloUserId: "apollo-user-1",
        sequenceOwnerName: "Alex Newell",
        email: "alex@apollo.test"
      },
      {
        apolloUserId: "apollo-user-2",
        sequenceOwnerName: "Zalan Riaz",
        email: "zalan@apollo.test"
      }
    ]);
  });

  it("filters out deleted Apollo users during rep sync", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        users: [
          { id: "apollo-user-1", name: "Active Rep", email: "active@apollo.test", deleted: false },
          { id: "apollo-user-2", name: "Former Rep", email: "former@apollo.test", deleted: true }
        ]
      })
    } as unknown as Response);

    const reps = await fetchApolloRepDirectory();

    expect(reps).toEqual([
      {
        apolloUserId: "apollo-user-1",
        sequenceOwnerName: "Active Rep",
        email: "active@apollo.test"
      }
    ]);
  });
});

describe("fetchApolloContactsForCompany", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("APOLLO_MASTER_API", "master-api-key");
    vi.stubEnv("APOLLO_API_KEY", "search-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when no Apollo search key is configured", async () => {
    vi.stubEnv("APOLLO_MASTER_API", "");
    vi.stubEnv("APOLLO_API_KEY", "");

    await expect(
      fetchApolloContactsForCompany({
        companyName: "Harbor Home Retail LLC",
        domain: "harbor-home.com"
      })
    ).rejects.toThrow(
      "Apollo API key is not configured. Add APOLLO_API_KEY or APOLLO_MASTER_API before importing contacts."
    );
  });

  it("parses contacts and preserves existing Apollo sequence history", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          organizations: [{ id: "apollo-org-1", name: "Harbor Home Retail LLC", primary_domain: "harbor-home.com" }]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          contacts: [
            {
              id: "apollo-contact-1",
              person_id: "apollo-person-1",
              first_name: "Jordan",
              last_name: "Demo",
              title: "Director of Supply Chain",
              department: "Logistics",
              seniority: "director",
              email: "jordan@harbor-home.com",
              linkedin_url: "https://linkedin.test/jordan-demo",
              apollo_sequence_status: "active",
              reply_status: "no_reply",
              apollo_sequence_name: "Houston Import Decision Maker",
              apollo_sequence_id: "sequence-1",
              updated_at: "2026-06-23T12:00:00.000Z"
            }
          ]
        })
      } as unknown as Response);

    const result = await fetchApolloContactsForCompany({
      companyName: "Harbor Home Retail LLC",
      domain: "harbor-home.com"
    });

    expect(result.organizationId).toBe("apollo-org-1");
    expect(result.domain).toBe("harbor-home.com");
    expect(result.contacts).toEqual([
      expect.objectContaining({
        apolloContactId: "apollo-contact-1",
        apolloPersonId: "apollo-person-1",
        fullName: "Jordan Demo",
        sequenceStatus: SequenceStatus.ENROLLED,
        replyStatus: ReplyStatus.NO_REPLY,
        sequenceName: "Houston Import Decision Maker",
        sequenceId: "sequence-1"
      })
    ]);
  });

  it("falls back to people search when contacts search returns empty", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          organizations: [{ id: "apollo-org-2", name: "Carolina Outdoor Supply", primary_domain: "carolina-outdoor.com" }]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          contacts: []
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          people: [
            {
              id: "apollo-person-2",
              first_name: "Taylor",
              last_name: "Sample",
              title: "Logistics Manager",
              email: "taylor@carolina-outdoor.com",
              reply_status: "meeting_booked"
            }
          ]
        })
      } as unknown as Response);

    const result = await fetchApolloContactsForCompany({
      companyName: "Carolina Outdoor Supply",
      domain: "carolina-outdoor.com"
    });

    expect(result.contacts).toEqual([
      expect.objectContaining({
        fullName: "Taylor Sample",
        replyStatus: ReplyStatus.MEETING_BOOKED
      })
    ]);
  });

  it("searches inside the matched Apollo organization without forcing the company name back into the keyword query", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          organizations: [{ id: "apollo-org-dormeo", name: "Dormeo North America", primary_domain: "dormeo.com" }]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          contacts: [
            {
              id: "apollo-contact-dormeo-1",
              first_name: "Alex",
              last_name: "Buyer",
              title: "Director of Supply Chain",
              email: "alex.buyer@dormeo.com"
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          people: []
        })
      } as unknown as Response);

    const result = await fetchApolloContactsForCompany({
      companyName: "DORMEO NORTH AMERICA",
      domain: "dormeo.com"
    });

    expect(result.organizationId).toBe("apollo-org-dormeo");
    expect(result.contacts).toEqual([
      expect.objectContaining({
        fullName: "Alex Buyer"
      })
    ]);

    const contactsRequestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(contactsRequestBody.organization_ids).toEqual(["apollo-org-dormeo"]);
    expect(contactsRequestBody.q_keywords).toBeUndefined();
  });

  it("uses targeted role queries when the organization has people but not direct contact records", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            organizations: [{ id: "apollo-org-dormeo-2", name: "Dormeo North America", primary_domain: "dormeo.com" }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: []
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        if (body.q_keywords === "logistics") {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              people: [
                {
                  id: "apollo-person-dormeo-1",
                  first_name: "Jamie",
                  last_name: "Imports",
                  title: "Logistics Manager",
                  email: "jamie.imports@dormeo.com"
                },
                {
                  id: "apollo-person-dormeo-2",
                  first_name: "Pat",
                  last_name: "Marketing",
                  title: "Marketing Manager",
                  email: "pat.marketing@dormeo.com"
                }
              ]
            })
          } as unknown as Response;
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: []
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "Carolina Outdoor Supply",
      domain: "carolina-outdoor.com"
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(result.contacts).toEqual([
      expect.objectContaining({
        fullName: "Jamie Imports",
        title: "Logistics Manager"
      })
    ]);
  });

  it("promotes a direct company match from people-search evidence when company search returns unrelated orgs", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            organizations: [
              {
                id: "apollo-org-amazon",
                name: "Amazon",
                primary_domain: "amazon.com"
              }
            ]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: []
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        if (body.q_keywords === "DORMEO NORTH AMERICA logistics") {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              people: [
                {
                  id: "apollo-person-dormeo-fallback-1",
                  first_name: "Guillermo",
                  last_name: "Dormeo",
                  title: "Director of Logistics",
                  organization: {
                    id: "apollo-org-dormeo-fallback",
                    name: "Dormeo North America",
                    primary_domain: null
                  }
                }
              ]
            })
          } as unknown as Response;
        }

        if (body.q_keywords === "DORMEO NORTH AMERICA") {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              people: [
                {
                  id: "apollo-person-dormeo-fallback-2",
                  first_name: "Marco",
                  last_name: "Dormeo",
                  title: "Operations Inventory Manager",
                  organization: {
                    id: "apollo-org-dormeo-fallback",
                    name: "Dormeo North America",
                    primary_domain: null
                  }
                }
              ]
            })
          } as unknown as Response;
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: []
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "DORMEO NORTH AMERICA"
    });

    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.organizationId).toBe("apollo-org-dormeo-fallback");
    expect(result.companyName).toBe("Dormeo North America");
    expect(result.contacts).toEqual([
      expect.objectContaining({
        fullName: "Marco Dormeo"
      })
    ]);
  });

  it("accepts strong base-name matches even when Apollo organization names include branch wording", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          organizations: [
            {
              id: "apollo-org-siemens",
              name: "Siemens Energy - Houston Service Center",
              primary_domain: "siemens-energy.com"
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          contacts: [
            {
              id: "apollo-contact-siemens-1",
              first_name: "Casey",
              last_name: "Buyer",
              title: "Procurement Manager",
              email: "casey.buyer@siemens-energy.com",
              reply_status: "no_reply"
            }
          ]
        })
      } as unknown as Response);

    const result = await fetchApolloContactsForCompany({
      companyName: "Siemens Energy",
      domain: "siemens-energy.com"
    });

    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.organizationId).toBe("apollo-org-siemens");
    expect(result.contacts).toEqual([
      expect.objectContaining({
        fullName: "Casey Buyer",
        email: "casey.buyer@siemens-energy.com"
      })
    ]);
  });

  it("strips noisy company-name suffixes before matching Apollo organizations", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          organizations: [
            {
              id: "apollo-org-siemens-2",
              name: "Siemens Energy, Inc.",
              primary_domain: "siemens-energy.com"
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          contacts: []
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          people: [
            {
              id: "apollo-person-siemens-2",
              first_name: "Morgan",
              last_name: "Energy",
              title: "Director of Logistics",
              email: "morgan.energy@siemens-energy.com",
              reply_status: "no_reply"
            }
          ]
        })
      } as unknown as Response);

    const result = await fetchApolloContactsForCompany({
      companyName: "SIEMENS ENERGY, INC. C/O PROCUREMENT TEAM",
      domain: "siemens-energy.com"
    });

    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.organizationId).toBe("apollo-org-siemens-2");
    expect(result.contacts).toEqual([
      expect.objectContaining({
        fullName: "Morgan Energy"
      })
    ]);
  });

  it("accepts branch-style Apollo company matches even without a domain when the leading base name is exact", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          organizations: [
            {
              id: "apollo-org-siemens-3",
              name: "Siemens Energy Branch Houston",
              primary_domain: null
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          contacts: [
            {
              id: "apollo-contact-siemens-3",
              first_name: "Riley",
              last_name: "Imports",
              title: "Import Manager",
              email: "riley.imports@siemens-energy.com",
              reply_status: "no_reply"
            }
          ]
        })
      } as unknown as Response);

    const result = await fetchApolloContactsForCompany({
      companyName: "SIEMENS ENERGY INC."
    });

    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.organizationId).toBe("apollo-org-siemens-3");
    expect(result.match.matchReason).toContain("strong base-name match");
    expect(result.contacts).toEqual([
      expect.objectContaining({
        fullName: "Riley Imports"
      })
    ]);
  });

  it("retries Apollo organization search with a simplified alias when the original company name is noisy", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          organizations: []
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          organizations: [
            {
              id: "apollo-org-siemens-4",
              name: "Siemens Energy",
              primary_domain: "siemens-energy.com"
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          contacts: [
            {
              id: "apollo-contact-siemens-4",
              first_name: "Avery",
              last_name: "Buyer",
              title: "Procurement Lead",
              email: "avery.buyer@siemens-energy.com",
              reply_status: "no_reply"
            }
          ]
        })
      } as unknown as Response);

    const result = await fetchApolloContactsForCompany({
      companyName: "SIEMENS ENERGY INC. C/O PROCUREMENT TEAM"
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.organizationId).toBe("apollo-org-siemens-4");
    expect(result.contacts).toEqual([
      expect.objectContaining({
        fullName: "Avery Buyer"
      })
    ]);
  });
});

describe("fetchApolloActivitySummary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("APOLLO_MASTER_API", "master-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pages through activity results and uses aggregate metrics when present", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          activities: Array.from({ length: 100 }, (_, index) => ({
            id: `activity-${index}`,
            call_id: `call-${index}`,
            duration_seconds: 60
          })),
          metrics: [{ metric_name: "# Calls logged", value: 61 }]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          activities: [
            {
              id: "activity-100",
              call_id: "call-100",
              duration_seconds: 45
            }
          ]
        })
      } as unknown as Response);

    const result = await fetchApolloActivitySummary({
      apolloUserId: "apollo-user-1",
      userName: "Zalan Riaz",
      startDate: new Date("2026-06-25T04:00:00.000Z"),
      endDate: new Date("2026-06-26T03:59:59.999Z"),
      timezone: "America/Toronto",
      kinds: ["CALL", "CONNECTED_CALL"]
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.callCount).toBe(61);
    expect(result.activities).toHaveLength(101);
    expect(result.durationSeconds).toBe(6045);
  });
});

describe("fetchApolloSequenceDirectory", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("APOLLO_MASTER_API", "master-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses active Apollo sequences", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        emailer_campaigns: [
          {
            id: "seq-1",
            name: "Tier 1 Sequence",
            active: true,
            archived: false,
            description: "Primary cadence",
            last_used_at: "2026-06-23T15:41:12.082+00:00"
          }
        ]
      })
    } as unknown as Response);

    const sequences = await fetchApolloSequenceDirectory();

    expect(sequences).toEqual([
      {
        id: "seq-1",
        name: "Tier 1 Sequence",
        active: true,
        archived: false,
        description: "Primary cadence",
        lastUsedAt: "2026-06-23T15:41:12.082+00:00"
      }
    ]);
  });
});
