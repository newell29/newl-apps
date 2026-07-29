import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplyStatus, SequenceStatus } from "@prisma/client";
import {
  createApolloContactForEnrollment,
  fetchApolloActivitySummary,
  fetchApolloBouncedSequenceContacts,
  fetchApolloContactById,
  fetchApolloContactsForCompany,
  fetchApolloOrganizationForMapping,
  fetchApolloRepDirectory,
  fetchApolloSequenceDirectory,
  parseApolloCompanyReference,
  parseApolloOrganizationId,
  pushApolloContactsToSequence,
  reconcileApolloContactWithBounceEvidence,
  removeApolloContactsFromSequences,
  transitionApolloContactsToSequence
} from "@/server/integrations/apollo";

describe("createApolloContactForEnrollment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("APOLLO_MASTER_API", "master-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates or recovers a saved Apollo contact with deduplication and no masked name fragment", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        contact: {
          id: "apollo-contact-corey",
          first_name: "Corey",
          email: "corey@vsamerica.example",
          organization_name: "VS AMERICA, INC."
        }
      })
    } as unknown as Response);

    await expect(
      createApolloContactForEnrollment({
        firstName: "Corey",
        lastName: "Ma****y",
        fullName: "Corey Ma****y",
        title: "Director of Operations",
        email: "Corey@VSAmerica.Example",
        phone: null,
        companyName: "VS AMERICA, INC.",
        companyDomain: "vsamerica.example"
      })
    ).resolves.toMatchObject({
      recordSource: "SAVED_CONTACT",
      apolloContactId: "apollo-contact-corey",
      email: "corey@vsamerica.example"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.apollo.io/api/v1/contacts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          first_name: "Corey",
          organization_name: "VS AMERICA, INC.",
          title: "Director of Operations",
          email: "corey@vsamerica.example",
          website_url: "https://vsamerica.example",
          run_dedupe: true
        })
      })
    );
  });

  it("fails closed if Apollo deduplication returns a different email", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        contact: {
          id: "wrong-contact",
          first_name: "Corey",
          email: "someone-else@example.com"
        }
      })
    } as unknown as Response);

    await expect(
      createApolloContactForEnrollment({
        firstName: "Corey",
        lastName: null,
        fullName: "Corey",
        title: null,
        email: "corey@example.com",
        phone: null,
        companyName: "VS AMERICA, INC.",
        companyDomain: null
      })
    ).rejects.toThrow(
      "Apollo deduplication returned a different email address. Review the contact in Apollo before enrollment."
    );
  });
});

describe("fetchApolloContactById", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("APOLLO_MASTER_API", "master-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads one saved Apollo contact and infers a reply from current campaign status", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        contact: {
          id: "apollo-contact-1",
          first_name: "Jordan",
          last_name: "Demo",
          contact_campaign_statuses: [
            {
              emailer_campaign_id: "sequence-1",
              status: "replied",
              updated_at: "2026-07-22T16:30:00.000Z"
            }
          ]
        }
      })
    } as unknown as Response);

    const contact = await fetchApolloContactById("apollo-contact-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.apollo.io/api/v1/contacts/apollo-contact-1",
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
    expect(contact).toMatchObject({
      apolloContactId: "apollo-contact-1",
      sequenceId: "sequence-1",
      sequenceStatus: SequenceStatus.REPLIED,
      replyStatus: ReplyStatus.REPLIED,
      lastReplyAt: new Date("2026-07-22T16:30:00.000Z")
    });
  });

  it("reads an active Hunter membership from the exact saved Apollo contact", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        contact: {
          id: "apollo-contact-active",
          first_name: "Taylor",
          last_name: "Active",
          email: "taylor.active@example.com",
          contact_campaign_statuses: [
            {
              emailer_campaign_id: "hunter-email-only",
              status: "active",
              added_at: "2026-07-29T18:00:00.000Z"
            }
          ]
        }
      })
    } as unknown as Response);

    await expect(fetchApolloContactById("apollo-contact-active")).resolves.toMatchObject({
      apolloContactId: "apollo-contact-active",
      sequenceId: "hunter-email-only",
      sequenceStatus: SequenceStatus.ENROLLED,
      replyStatus: ReplyStatus.NO_REPLY
    });
  });

  it("treats a bounced sequence membership as terminal even when Apollo also returns an active status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        contact: {
          id: "apollo-contact-bounced",
          first_name: "Taylor",
          last_name: "Bounce",
          email: "taylor.bounce@example.com",
          contact_campaign_statuses: [
            {
              emailer_campaign_id: "hunter-email-only",
              status: "active",
              added_at: "2026-07-29T13:00:00.000Z"
            },
            {
              emailer_campaign_id: "hunter-email-only",
              status: "bounced",
              updated_at: "2026-07-29T14:00:00.000Z"
            }
          ]
        }
      })
    } as unknown as Response);

    await expect(fetchApolloContactById("apollo-contact-bounced")).resolves.toMatchObject({
      sequenceId: "hunter-email-only",
      sequenceStatus: SequenceStatus.BOUNCED,
      replyStatus: ReplyStatus.NO_REPLY
    });
  });

  it("treats Apollo's direct bounced email status as a terminal sequence status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        contact: {
          id: "apollo-contact-bad-data",
          first_name: "Taylor",
          last_name: "Bounce",
          email: "taylor.bounce@example.com",
          email_status: "bounced",
          apollo_sequence_status: "active",
          apollo_sequence_id: "hunter-email-only"
        }
      })
    } as unknown as Response);

    await expect(fetchApolloContactById("apollo-contact-bad-data")).resolves.toMatchObject({
      sequenceId: "hunter-email-only",
      sequenceStatus: SequenceStatus.BOUNCED
    });
  });
});

describe("Apollo bounced outreach reconciliation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("APOLLO_MASTER_API", "master-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the zero-credit outreach-email search when the contact response omits a bounce", async () => {
    const fetchMock = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          contact: {
            id: "apollo-contact-1",
            first_name: "Taylor",
            last_name: "Example",
            email: "taylor@example.com"
          }
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          emailer_messages: [
            {
              id: "message-1",
              contact_id: "apollo-contact-1",
              to_email: "taylor@example.com",
              status: "bounced"
            }
          ]
        })
      } as unknown as Response);

    const contact = await fetchApolloContactById("apollo-contact-1");
    const bouncedContacts = await fetchApolloBouncedSequenceContacts("sequence-1");
    const reconciled = reconcileApolloContactWithBounceEvidence({
      contact,
      selectedSequenceId: "sequence-1",
      apolloContactId: "apollo-contact-1",
      email: "taylor@example.com",
      bouncedContacts
    });

    expect(contact.sequenceStatus).toBe(SequenceStatus.NOT_STARTED);
    expect(reconciled).toMatchObject({
      sequenceStatus: SequenceStatus.BOUNCED,
      sequenceId: "sequence-1"
    });
    const requestUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(requestUrl.pathname).toBe("/api/v1/emailer_messages/search");
    expect(requestUrl.searchParams.getAll("emailer_campaign_ids[]")).toEqual(["sequence-1"]);
    expect(requestUrl.searchParams.getAll("emailer_message_stats[]")).toEqual(["bounced"]);
  });
});

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
    const fetchMock = vi.spyOn(global, "fetch")
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
      } as unknown as Response)
      .mockResolvedValue(emptyApolloPeopleResponse());

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

    const organizationRequestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")
    ) as Record<string, unknown>;
    expect(organizationRequestBody).toEqual({
      page: 1,
      per_page: 10,
      q_organization_domains_list: ["harbor-home.com"]
    });
  });

  it("uses Apollo's documented organization-name parameter when no domain is known", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          organizations: [
            {
              id: "apollo-org-novalis",
              name: "NOVALIS US, LLC",
              primary_domain: "novalis-intl.com"
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ contacts: [] })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ people: [] })
      } as unknown as Response);

    const result = await fetchApolloContactsForCompany(
      {
        companyName: "NOVALIS US, LLC"
      },
      {
        keywordSearchLimit: 0
      }
    );

    expect(result.organizationId).toBe("apollo-org-novalis");
    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")
    ) as Record<string, unknown>;
    expect(requestBody).toEqual({
      page: 1,
      per_page: 10,
      q_organization_name: "NOVALIS US, LLC"
    });
    expect(requestBody).not.toHaveProperty("best_company_name");
    expect(requestBody).not.toHaveProperty("company_match_name");
  });

  it("parses current sequence history from Apollo contact campaign statuses", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          organizations: [{ id: "apollo-org-1", name: "Dormeo North America", primary_domain: "dormeo-na.com" }]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          contacts: [
            {
              id: "apollo-contact-1",
              first_name: "Marco",
              last_name: "Paez Romero",
              title: "Operations (Inventory)",
              email: "marco@dormeo-na.com",
              contact_campaign_statuses: [
                {
                  id: "finished-membership",
                  emailer_campaign_id: "finished-sequence",
                  status: "finished",
                  added_at: "2026-06-01T12:00:00.000Z"
                },
                {
                  id: "active-membership",
                  emailer_campaign_id: "tier-2-sequence",
                  status: "active",
                  added_at: "2026-07-21T19:21:51.192Z"
                }
              ]
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValue(emptyApolloPeopleResponse());

    const result = await fetchApolloContactsForCompany({
      companyName: "Dormeo North America",
      domain: "dormeo-na.com"
    });

    expect(result.contacts).toEqual([
      expect.objectContaining({
        apolloContactId: "apollo-contact-1",
        fullName: "Marco Paez Romero",
        sequenceStatus: SequenceStatus.ENROLLED,
        sequenceId: "tier-2-sequence"
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
      .mockResolvedValue({
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
      .mockResolvedValue({
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
    expect(contactsRequestBody.organization_ids).toBeUndefined();
    expect(contactsRequestBody.q_keywords).toBe("Dormeo North America");
  });

  it("revalidates a confirmed Apollo organization ID before employee search", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            organizations: [{
              id: "5e66b6381e05b4008c8331b8",
              name: "NOVALIS US, LLC"
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/accounts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ accounts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ contacts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        expect(body.organization_ids).toEqual(["5e66b6381e05b4008c8331b8"]);
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ people: [] })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "NOVALIS US, LLC",
      apolloOrganizationId: "5e66b6381e05b4008c8331b8"
    });

    expect(result.organizationId).toBe("5e66b6381e05b4008c8331b8");
    expect(result.match.matchReason).toContain("manually confirmed");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/mixed_companies/search"))).toBe(true);
  });

  it("merges saved and employee-search contacts while rejecting a sibling organization", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ organizations: [] })
        } as unknown as Response;
      }
      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: [{
              id: "saved-contact",
              name: "Saved Buyer",
              title: "Supply Chain Manager",
              organization: { id: "exact-org", name: "Hyosung USA" }
            }]
          })
        } as unknown as Response;
      }
      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [
              {
                id: "exact-person",
                name: "Exact Logistics",
                title: "Logistics Director",
                organization: { name: "Hyosung USA" }
              },
              {
                id: "sibling-person",
                name: "Sibling Buyer",
                title: "Supply Chain Manager",
                organization: { name: "Hyosung Holdings USA" }
              }
            ]
          })
        } as unknown as Response;
      }
      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "Hyosung USA",
      apolloOrganizationId: "exact-org"
    });

    expect(result.contacts.map((contact) => contact.fullName)).toEqual([
      "Exact Logistics",
      "Saved Buyer"
    ]);
  });

  it("keeps acronym-expanded employees from the confirmed organization scope", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            accounts: [{
              id: "aalberts-account-id",
              name: "AALBERTS IPS AMERICAS",
              organization: {
                id: "aalberts-global-org",
                name: "Aalberts integrated piping systems",
                primary_domain: "aalberts-ips.com"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: [{
              id: "aalberts-warehouse-contact",
              name: "Warehouse Associate",
              title: "Warehouse Associate",
              organization: {
                id: "aalberts-account-id",
                name: "AALBERTS IPS AMERICAS"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        expect(body.organization_ids).toEqual(["aalberts-global-org"]);
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [{
              id: "aalberts-coo",
              name: "Aalberts Executive",
              title: "COO at Aalberts IPS Americas & APAC",
              organization: {
                name: "Aalberts integrated piping systems",
                primary_domain: "aalberts.com"
              }
            }]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "AALBERTS IPS AMERICAS",
      apolloOrganizationId: "aalberts-account-id"
    });

    expect(result.organizationId).toBe("aalberts-global-org");
    expect(result.contacts).toEqual([
      expect.objectContaining({
        apolloPersonId: "aalberts-coo",
        title: "COO at Aalberts IPS Americas & APAC"
      })
    ]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("expands a partial mapped-account result through its trusted saved-contact domain", async () => {
    const accountId = "aalberts-saved-account";
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ organizations: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/accounts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ accounts: [] })
        } as unknown as Response;
      }

      if (url.endsWith(`/api/v1/accounts/${accountId}`)) {
        return {
          ok: false,
          status: 403,
          json: vi.fn().mockResolvedValue({ error: "Account View unavailable" })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: [{
              id: "aalberts-warehouse-contact",
              name: "Warehouse Associate",
              title: "Warehouse Associate",
              organization: {
                id: accountId,
                name: "AALBERTS IPS AMERICAS",
                primary_domain: "aalberts.com"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        if (Array.isArray(body.organization_ids)) {
          expect(body.organization_ids).toEqual([accountId]);
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({ people: [] })
          } as unknown as Response;
        }

        expect(body.q_organization_domains_list).toEqual(["aalberts.com"]);
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [{
              id: "aalberts-coo-domain",
              name: "Aalberts Executive",
              title: "COO at Aalberts IPS Americas & APAC",
              organization: {
                name: "Aalberts integrated piping systems",
                primary_domain: "aalberts.com"
              }
            }]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "AALBERTS IPS AMERICAS",
      apolloOrganizationId: accountId
    });

    expect(result.contacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        apolloPersonId: "aalberts-coo-domain",
        title: "COO at Aalberts IPS Americas & APAC"
      })
    ]));
    expect(result.match.matchReason).toContain("trusted saved-contact domain");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("runs the organization-scoped role search even when the generic page already has an acceptable contact", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ organizations: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/accounts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ accounts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ contacts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        const personTitles = Array.isArray(body.person_titles) ? body.person_titles : [];
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: personTitles.length > 0
              ? [{
                  id: "director-operations",
                  first_name: "Jason",
                  last_name_obfuscated: "Co***n",
                  title: "Director of Operations",
                  has_email: true,
                  has_city: true,
                  has_state: true,
                  has_country: true,
                  organization: { name: "Stabilus" }
                }]
              : [{
                  id: "distribution-manager",
                  first_name: "Mark",
                  last_name_obfuscated: "El**d",
                  title: "Distribution Manager",
                  has_email: false,
                  organization: { name: "Stabilus" }
                }]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "Stabilus",
      apolloOrganizationId: "stabilus-org"
    });

    const peopleRequests = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith("/api/v1/mixed_people/api_search"))
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    expect(peopleRequests).toHaveLength(2);
    expect(peopleRequests[0]).toMatchObject({
      per_page: 100,
      organization_ids: ["stabilus-org"]
    });
    expect(peopleRequests[0]).not.toHaveProperty("person_titles");
    expect(peopleRequests[1]).toMatchObject({
      per_page: 100,
      organization_ids: ["stabilus-org"],
      include_similar_titles: true
    });
    expect(peopleRequests[1]?.person_titles).toEqual(expect.arrayContaining([
      "logistics",
      "operations",
      "distribution",
      "purchasing",
      "director operations"
    ]));
    expect(result.contacts).toEqual([
      expect.objectContaining({
        recordSource: "PEOPLE_SEARCH",
        apolloContactId: null,
        apolloPersonId: "director-operations",
        fullName: "Jason Co***n",
        lastName: null,
        lastNameObfuscated: "Co***n",
        hasEmailAvailable: true
      }),
      expect.objectContaining({
        recordSource: "PEOPLE_SEARCH",
        apolloContactId: null,
        apolloPersonId: "distribution-manager",
        fullName: "Mark El**d",
        hasEmailAvailable: false
      })
    ]);
  });

  it("dedupes a saved contact and People Search employee by Apollo person ID without losing enriched fields", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ organizations: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/accounts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ accounts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: [{
              id: "saved-mark",
              person_id: "mark-person",
              first_name: "Mark",
              last_name: "Elrod",
              title: "Distribution Manager",
              email: "mark@stabilus.example",
              organization: { id: "stabilus-org", name: "Stabilus" }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        const people = Array.isArray(body.person_titles)
          ? [{
              id: "mark-person",
              first_name: "Mark",
              last_name_obfuscated: "El**d",
              title: "Distribution Manager",
              has_email: true,
              organization: { name: "Stabilus" }
            }]
          : [];
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ people })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "Stabilus",
      apolloOrganizationId: "stabilus-org"
    });

    expect(result.contacts).toEqual([
      expect.objectContaining({
        recordSource: "SAVED_CONTACT",
        apolloContactId: "saved-mark",
        apolloPersonId: "mark-person",
        fullName: "Mark Elrod",
        email: "mark@stabilus.example",
        hasEmailAvailable: true
      })
    ]);
  });

  it("resolves a saved Apollo account ID to the canonical organization before employee search", async () => {
    const accountId = "63fe171e83950e00f3ecaadc";
    const organizationId = "612f7790266e9500a4be058d";
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            accounts: [{
              id: accountId,
              name: "Account-level Stabilus",
              organization: {
                id: organizationId,
                name: "Stabilus",
                primary_domain: "stabilus.com"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: [{
              id: "saved-mark",
              name: "Mark Elrod",
              title: "Distribution Manager",
              organization: {
                id: organizationId,
                name: "Stabilus",
                primary_domain: "stabilus.com"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        if (Array.isArray(body.organization_ids) && body.organization_ids.includes(accountId)) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              people: [{
                id: "partial-account-result",
                name: "Legacy Account Person",
                title: "Office Manager",
                organization: {
                  id: organizationId,
                  name: "Stabilus",
                  primary_domain: "stabilus.com"
                }
              }]
            })
          } as unknown as Response;
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [
              {
                id: "jason-councilman",
                name: "Jason Councilman",
                title: "Director of Operations",
                organization: {
                  id: organizationId,
                  name: "Stabilus",
                  primary_domain: "stabilus.com"
                }
              },
              {
                id: "wrong-company",
                name: "Sibling Candidate",
                title: "Supply Chain Manager",
                organization: {
                  id: "different-organization",
                  name: "Stabilus Automotive Mexico",
                  primary_domain: "stabilus.com"
                }
              }
            ]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "STABILUS, INC.",
      apolloOrganizationId: accountId
    });

    expect(result.organizationId).toBe(organizationId);
    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.match.matchReason).toMatch(
      /(?:canonical organization ID|global organization ID)/
    );
    expect(result.contacts.map((contact) => contact.fullName)).toEqual([
      "Jason Councilman",
      "Mark Elrod"
    ]);

    const peopleBodies = fetchMock.mock.calls
      .filter(([request]) => String(request).endsWith("/api/v1/mixed_people/api_search"))
      .map(([, requestInit]) => JSON.parse(String(requestInit?.body ?? "{}")) as Record<string, unknown>);
    expect(
      peopleBodies.some(
        (body) => Array.isArray(body.organization_ids) && body.organization_ids.includes(organizationId)
      )
    ).toBe(true);
    expect(
      peopleBodies.some(
        (body) => Array.isArray(body.organization_ids) && body.organization_ids.includes(accountId)
      )
    ).toBe(false);
    expect(peopleBodies.some((body) => body.organization_ids === undefined)).toBe(false);
  });

  it("uses an exact Apollo account-to-parent relationship for a domainless legal entity", async () => {
    const accountId = "silfab-legal-account";
    const organizationId = "silfab-global-organization";
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            accounts: [{
              id: accountId,
              name: "SILFAB SOLAR PV SC INC,",
              organization: {
                id: organizationId,
                name: "Silfab Solar Inc.",
                primary_domain: "silfabsolar.com"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ contacts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        expect(body.organization_ids).toEqual([organizationId]);
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [{
              id: "silfab-logistics-lead",
              name: "Logistics Lead",
              title: "Logistics Lead",
              organization: {
                id: organizationId,
                name: "Silfab Solar Inc.",
                primary_domain: "silfabsolar.com"
              }
            }]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "SILFAB SOLAR PV SC INC,",
      apolloOrganizationId: accountId
    });

    expect(result.organizationId).toBe(organizationId);
    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.contacts.map((contact) => contact.fullName)).toEqual(["Logistics Lead"]);
    const peopleBodies = fetchMock.mock.calls
      .filter(([request]) => String(request).endsWith("/api/v1/mixed_people/api_search"))
      .map(([, requestInit]) => JSON.parse(String(requestInit?.body ?? "{}")) as Record<string, unknown>);
    expect(
      peopleBodies.every(
        (body) => Array.isArray(body.organization_ids) && body.organization_ids[0] === organizationId
      )
    ).toBe(true);
  });

  it("recovers a saved account that Apollo omits from organization search", async () => {
    const accountId = "661ec0f545d31b00076e28d9";
    const organizationId = "atlas-copco-global-organization";
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ organizations: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/accounts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            accounts: [{
              id: accountId,
              organization_id: organizationId,
              name: "ATLAS COPCO COMPRESSORS LLC",
              primary_domain: "atlascopco.com"
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ contacts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        if (Array.isArray(body.organization_ids) && body.organization_ids.includes(accountId)) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({ people: [] })
          } as unknown as Response;
        }

        expect(body.organization_ids).toEqual([organizationId]);
        expect(body.q_organization_domains_list).toBeUndefined();
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [{
              id: "atlas-supply-chain-manager",
              name: "Aaron Rowsell",
              title: "Supply Chain Manager",
              organization: {
                name: "Atlas Copco",
                primary_domain: "atlascopco.com"
              }
            }]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "ATLAS COPCO COMPRESSORS LLC",
      domain: "atlascopco.com",
      apolloOrganizationId: accountId
    });

    expect(result.organizationId).toBe(organizationId);
    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.match.matchReason).toContain("saved-account directory");
    expect(result.contacts.map((contact) => contact.fullName)).toEqual(["Aaron Rowsell"]);
    expect(
      fetchMock.mock.calls.some(([request]) => String(request).endsWith("/api/v1/accounts/search"))
    ).toBe(true);
  });

  it("retries an exact saved account by trusted domain when Apollo exposes no nested organization ID", async () => {
    const accountId = "661ec0f545d31b00076e28e0";
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ organizations: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/accounts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            accounts: [{
              id: accountId,
              name: "DANSONS US LLC",
              primary_domain: "dansons.com"
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ contacts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        if (Array.isArray(body.organization_ids)) {
          expect(body.organization_ids).toEqual([accountId]);
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({ people: [] })
          } as unknown as Response;
        }

        expect(body.q_organization_domains_list).toEqual(["dansons.com"]);
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [{
              id: "dansons-logistics-coordinator",
              name: "Derek Serran",
              title: "Senior Logistics Coordinator",
              organization: {
                name: "Dansons",
                primary_domain: "dansons.com"
              }
            }]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "DANSONS US LLC",
      domain: "dansons.com",
      apolloOrganizationId: accountId
    });

    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.match.matchReason).toContain("saved-account directory");
    expect(result.contacts.map((contact) => contact.fullName)).toEqual(["Derek Serran"]);
    expect(fetchMock.mock.calls.some(([, init]) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return Array.isArray(body.q_organization_domains_list) &&
        body.q_organization_domains_list.includes("dansons.com");
    })).toBe(true);
  });

  it("views the exact saved account by ID when Apollo account name search omits it", async () => {
    const accountId = "661ec0f545d31b00076e28e0";
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ organizations: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/accounts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ accounts: [] })
        } as unknown as Response;
      }

      if (url.endsWith(`/api/v1/accounts/${accountId}`)) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            account: {
              id: accountId,
              name: "DANSONS US LLC",
              primary_domain: "dansons.com"
            }
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ contacts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        if (Array.isArray(body.organization_ids)) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({ people: [] })
          } as unknown as Response;
        }

        expect(body.q_organization_domains_list).toEqual(["dansons.com"]);
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [{
              id: "dansons-logistics-coordinator",
              name: "Derek Serran",
              title: "Senior Logistics Coordinator",
              organization: {
                name: "Dansons",
                primary_domain: "dansons.com"
              }
            }]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany(
      {
        companyName: "DANSONS US LLC",
        apolloOrganizationId: accountId
      },
      {
        keywordSearchLimit: 0
      }
    );

    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.match.matchReason).toContain("saved-account directory");
    expect(result.contacts.map((contact) => contact.fullName)).toEqual(["Derek Serran"]);
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).endsWith(`/api/v1/accounts/${accountId}`)
      )
    ).toBe(true);
  });

  it("accepts a same-domain shortened regional brand and recovers despite a partial account-ID result", async () => {
    const accountId = "661ec0fb45d31b00076e3598";
    const organizationId = "salice-global-organization";
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            accounts: [{
              id: accountId,
              name: "Account-level Salice",
              organization: {
                id: organizationId,
                name: "Salice",
                primary_domain: "salice.com"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: [{
              id: "saved-thomas",
              name: "Thomas Mattocks",
              title: "Supply Chain and Logistics Manager",
              organization: {
                id: organizationId,
                name: "Salice",
                primary_domain: "salice.com"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        if (Array.isArray(body.organization_ids) && body.organization_ids.includes(accountId)) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              people: [{
                id: "partial-account-result",
                name: "Nitin Chavda",
                title: "Franchise Operations Manager",
                organization: {
                  id: organizationId,
                  name: "Salice",
                  primary_domain: "salice.com"
                }
              }]
            })
          } as unknown as Response;
        }
        expect(body.organization_ids).toEqual([organizationId]);
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [
              {
                id: "person-thomas",
                name: "Thomas Mattocks",
                title: "Supply Chain and Logistics Manager",
                organization: {
                  id: organizationId,
                  name: "Salice",
                  primary_domain: "salice.com"
                }
              },
              {
                id: "person-frank",
                name: "Frank Snead",
                title: "Shipping Receiving Manager",
                organization: {
                  id: organizationId,
                  name: "Salice",
                  primary_domain: "salice.com"
                }
              }
            ]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "SALICE AMERICA INC",
      apolloOrganizationId: accountId
    });

    expect(result.organizationId).toBe(organizationId);
    expect(result.match.classification).toBe("DIRECT_COMPANY");
    expect(result.contacts.map((contact) => contact.fullName)).toContain("Thomas Mattocks");
    expect(result.contacts.map((contact) => contact.fullName)).toContain("Frank Snead");
    expect(result.contacts.map((contact) => contact.fullName)).not.toContain("Nitin Chavda");
  });

  it("fails closed when account recovery resolves only to a parent or sibling Apollo organization", async () => {
    const accountId = "68d69f21611030000d743c61";
    const parentOrganizationId = "607056eaa4310d011a4aae05";
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            accounts: [{
              id: "parent-account",
              organization: {
                id: parentOrganizationId,
                name: "Hyosung Corporation",
                primary_domain: "hyosung.com"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/accounts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ accounts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: [{
              id: "saved-heather",
              name: "Heather Kim",
              title: "Supply Chain Manager",
              organization: {
                id: parentOrganizationId,
                name: "Hyosung Corporation",
                primary_domain: "hyosung.com"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        if (Array.isArray(body.organization_ids) && body.organization_ids.includes(accountId)) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({ people: [] })
          } as unknown as Response;
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [{
              id: "parent-person",
              name: "Parent Company Buyer",
              title: "Logistics Director",
              organization: {
                id: parentOrganizationId,
                name: "Hyosung Corporation",
                primary_domain: "hyosung.com"
              }
            }]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "HYOSUNG USA, INC.",
      domain: "us.hyosung.com",
      apolloOrganizationId: accountId
    });

    expect(result.organizationId).toBeNull();
    expect(result.match.organizationId).toBe(parentOrganizationId);
    expect(result.match.classification).toBe("MATCH_QUALITY_REVIEW");
    expect(result.match.matchReason).toContain("parent or sibling company");
    expect(result.contacts).toEqual([]);
  });

  it("uses the nested global organization identity from Apollo account search results", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            accounts: [{
              id: "apollo-account-id",
              organization_id: "apollo-global-organization-id",
              name: "Account-level Stabilus",
              organization: {
                id: "apollo-global-organization-id",
                name: "Stabilus",
                primary_domain: "stabilus.com"
              }
            }]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ contacts: [] })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        expect(body.organization_ids).toEqual(["apollo-global-organization-id"]);
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ people: [] })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "STABILUS, INC.",
      domain: "stabilus.com"
    });

    expect(result.organizationId).toBe("apollo-global-organization-id");
    expect(result.match.companyName).toBe("Stabilus");
    expect(fetchMock.mock.calls.some(([, init]) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return Array.isArray(body.organization_ids) && body.organization_ids.includes("apollo-account-id");
    })).toBe(false);
  });

  it("parses and validates Apollo company URLs before mapping", async () => {
    expect(
      parseApolloOrganizationId(
        "https://app.apollo.io/#/organizations/5e66b6381e05b4008c8331b8/people"
      )
    ).toBe("5e66b6381e05b4008c8331b8");
    expect(() => parseApolloOrganizationId("https://example.com/5e66b6381e05b4008c8331b8")).toThrow(
      "must be an Apollo URL"
    );
    expect(
      parseApolloCompanyReference(
        "https://app.apollo.io/#/accounts/661ec104e14548000791da78"
      )
    ).toEqual({
      id: "661ec104e14548000791da78",
      resourceType: "ACCOUNT"
    });

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        organization: {
          id: "5e66b6381e05b4008c8331b8",
          name: "NOVALIS US, LLC",
          primary_domain: "novalis-intl.com"
        }
      })
    } as unknown as Response);

    const mapping = await fetchApolloOrganizationForMapping({
      companyName: "NOVALIS US, LLC",
      apolloOrganizationId: "5e66b6381e05b4008c8331b8"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.apollo.io/api/v1/organizations/5e66b6381e05b4008c8331b8",
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
    expect(mapping).toMatchObject({
      organizationId: "5e66b6381e05b4008c8331b8",
      companyName: "NOVALIS US, LLC",
      domain: "novalis-intl.com"
    });
  });

  it("resolves a pasted Apollo account URL to its global organization before mapping", async () => {
    const accountId = "661ec104e14548000791da78";
    const organizationId = "5e66b6381e05b4008c8331b8";
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/api/v1/accounts/${accountId}`)) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            account: {
              id: accountId,
              name: "DANSONS US LLC",
              organization_id: organizationId,
              organization: {
                id: organizationId,
                name: "DANSONS US LLC",
                primary_domain: "dansons.com"
              }
            }
          })
        } as unknown as Response;
      }
      if (url.endsWith(`/api/v1/organizations/${organizationId}`)) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            organization: {
              id: organizationId,
              name: "DANSONS US LLC",
              primary_domain: "dansons.com"
            }
          })
        } as unknown as Response;
      }
      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const mapping = await fetchApolloOrganizationForMapping({
      companyName: "DANSONS US LLC",
      apolloOrganizationId: accountId,
      resourceType: "ACCOUNT"
    });

    expect(mapping).toMatchObject({
      organizationId,
      companyName: "DANSONS US LLC",
      domain: "dansons.com"
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.apollo.io/api/v1/accounts/${accountId}`,
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.apollo.io/api/v1/organizations/${organizationId}`,
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("accepts a manually confirmed facility account that resolves to its canonical parent brand", async () => {
    const accountId = "661ec104e14548000791da79";
    const organizationId = "5e66b6381e05b4008c8331b9";
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/api/v1/accounts/${accountId}`)) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            account: {
              id: accountId,
              name: "Pratt Industries",
              organization_id: organizationId,
              organization: {
                id: organizationId,
                name: "Pratt Industries",
                primary_domain: "prattindustries.com"
              }
            }
          })
        } as unknown as Response;
      }
      if (url.endsWith(`/api/v1/organizations/${organizationId}`)) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            organization: {
              id: organizationId,
              name: "Pratt Industries",
              primary_domain: "prattindustries.com"
            }
          })
        } as unknown as Response;
      }
      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    await expect(fetchApolloOrganizationForMapping({
      companyName: "PRATT (ROCK HILL CORRUGATING) LLC",
      apolloOrganizationId: accountId,
      resourceType: "ACCOUNT"
    })).resolves.toMatchObject({
      organizationId,
      companyName: "Pratt Industries",
      match: {
        classification: "DIRECT_COMPANY",
        matchReason: expect.stringContaining("operating parent/brand")
      }
    });
  });

  it.each([
    {
      companyName: "ROECHLING INDUSTRIAL GASTONIA",
      apolloName: "Roechling Industrial North America"
    },
    {
      companyName: "KIMBRELLS FURNITURE DISTRIBUTORS",
      apolloName: "Kimbrell's Home Furnishings (Furniture Distributors, Inc.)"
    }
  ])(
    "lets an authenticated reviewer override weak name similarity from $companyName to $apolloName",
    async ({ companyName, apolloName }) => {
      const accountId = "661ec104e14548000791da80";
      const organizationId = "5e66b6381e05b4008c8331c0";
      vi.spyOn(global, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith(`/api/v1/accounts/${accountId}`)) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              account: {
                id: accountId,
                name: apolloName,
                organization_id: organizationId,
                organization: {
                  id: organizationId,
                  name: apolloName,
                  primary_domain: "confirmed-company.example"
                }
              }
            })
          } as unknown as Response;
        }
        if (url.endsWith(`/api/v1/organizations/${organizationId}`)) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              organization: {
                id: organizationId,
                name: apolloName,
                primary_domain: "confirmed-company.example"
              }
            })
          } as unknown as Response;
        }
        throw new Error(`Unexpected Apollo URL in test: ${url}`);
      });

      const mapping = await fetchApolloOrganizationForMapping({
        companyName,
        apolloOrganizationId: accountId,
        resourceType: "ACCOUNT",
        reviewerConfirmed: true
      });

      expect(mapping).toMatchObject({
        organizationId,
        companyName: apolloName,
        match: {
          classification: "DIRECT_COMPANY",
          strongBaseNameMatch: false,
          matchReason: expect.stringContaining("authenticated reviewer explicitly confirmed"),
          query: expect.objectContaining({
            reviewer_confirmed_name_override: true
          })
        }
      });
    }
  );

  it("keeps weak Apollo name matches blocked when no reviewer confirmation is supplied", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        organization: {
          id: "5e66b6381e05b4008c8331c1",
          name: "Unrelated Manufacturing Company",
          primary_domain: "unrelated.example"
        }
      })
    } as unknown as Response);

    await expect(fetchApolloOrganizationForMapping({
      companyName: "ROECHLING INDUSTRIAL GASTONIA",
      apolloOrganizationId: "5e66b6381e05b4008c8331c1"
    })).rejects.toThrow(
      'Apollo URL resolved to "Unrelated Manufacturing Company", but it is not a strong enough match for "ROECHLING INDUSTRIAL GASTONIA".'
    );
  });

  it("does not let reviewer confirmation override Apollo logistics-provider safety", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        organization: {
          id: "5e66b6381e05b4008c8331c2",
          name: "Example Global Logistics",
          primary_domain: "example-logistics.test"
        }
      })
    } as unknown as Response);

    await expect(fetchApolloOrganizationForMapping({
      companyName: "ROECHLING INDUSTRIAL GASTONIA",
      apolloOrganizationId: "5e66b6381e05b4008c8331c2",
      reviewerConfirmed: true
    })).rejects.toThrow(
      'Apollo URL resolved to logistics provider "Example Global Logistics". Provider safety cannot be overridden by company-name confirmation.'
    );
  });

  it("reads later saved-contact pages so a relevant YAT employee is not hidden behind the first 100", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `apollo-contact-yat-${index}`,
      person_id: `apollo-person-yat-${index}`,
      first_name: `Marketing${index}`,
      last_name: "Contact",
      title: "Marketing Specialist",
      email: `marketing${index}@yat.com`,
      organization: {
        id: "apollo-org-yat",
        name: "YAT USA, INC.",
        primary_domain: "yat.com"
      }
    }));
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            organizations: [{
              id: "apollo-org-yat",
              name: "YAT USA, INC.",
              primary_domain: "yat.com"
            }]
          })
        } as unknown as Response;
      }
      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: body.page === 1
              ? firstPage
              : [{
                  id: "apollo-contact-yat-import",
                  person_id: "apollo-person-yat-import",
                  first_name: "Avery",
                  last_name: "Imports",
                  title: "Import Export Specialist",
                  email: "avery.imports@yat.com",
                  organization: {
                    id: "apollo-org-yat",
                    name: "YAT USA, INC.",
                    primary_domain: "yat.com"
                  }
                }]
          })
        } as unknown as Response;
      }
      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        return emptyApolloPeopleResponse();
      }
      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany({
      companyName: "YAT USA, INC.",
      domain: "yat.com"
    });

    expect(result.contacts).toEqual([
      expect.objectContaining({
        apolloContactId: "apollo-contact-yat-import",
        fullName: "Avery Imports",
        email: "avery.imports@yat.com"
      })
    ]);
    expect(result.contactRecovery.savedContactPagesRead).toBe(2);
    expect(fetchMock.mock.calls.some(([, init]) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      return body.page === 2 && body.per_page === 100;
    })).toBe(true);
  });

  it("recovers a masked shortlisted person from saved contacts before considering paid enrichment", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            organizations: [{
              id: "apollo-org-vs",
              name: "VS AMERICA, INC.",
              primary_domain: "vsamerica.com"
            }]
          })
        } as unknown as Response;
      }
      if (url.endsWith("/api/v1/contacts/search")) {
        const targeted = String(body.q_keywords ?? "").includes("Isaac");
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            contacts: targeted
              ? [{
                  id: "apollo-contact-isaac",
                  first_name: "Isaac",
                  last_name: "Watkins",
                  title: "Assistant Warehouse Manager",
                  email: "i.watkins@vsamerica.com",
                  organization: {
                    id: "apollo-org-vs",
                    name: "VS AMERICA, INC.",
                    primary_domain: "vsamerica.com"
                  }
                }]
              : []
          })
        } as unknown as Response;
      }
      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [{
              person_id: "apollo-person-isaac",
              first_name: "Isaac",
              last_name_obfuscated: "Wa***s",
              title: "Assistant Warehouse Manager",
              has_email: true,
              organization: {
                id: "apollo-org-vs",
                name: "VS AMERICA, INC.",
                primary_domain: "vsamerica.com"
              }
            }]
          })
        } as unknown as Response;
      }
      if (url.includes("/api/v1/people/match")) {
        throw new Error("Paid enrichment must not run when a saved contact was recovered.");
      }
      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany(
      {
        companyName: "VS AMERICA, INC.",
        domain: "vsamerica.com"
      },
      {
        authorizePaidEmailEnrichment: true
      }
    );

    expect(result.contacts).toEqual([
      expect.objectContaining({
        apolloContactId: "apollo-contact-isaac",
        apolloPersonId: "apollo-person-isaac",
        fullName: "Isaac Watkins",
        email: "i.watkins@vsamerica.com"
      })
    ]);
    expect(result.contactRecovery).toMatchObject({
      maskedPeopleChecked: 1,
      savedContactsRecovered: 1,
      paidEmailEnrichmentsAttempted: 0,
      paidEmailsRecovered: 0
    });
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes("/api/v1/people/match")
    )).toBe(false);
  });

  it("uses an email-only paid enrichment only after explicit authorization and a saved-contact miss", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/mixed_companies/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            organizations: [{
              id: "apollo-org-paid",
              name: "Paid Recovery Importer",
              primary_domain: "paid-recovery.test"
            }]
          })
        } as unknown as Response;
      }
      if (url.endsWith("/api/v1/contacts/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ contacts: [] })
        } as unknown as Response;
      }
      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            people: [{
              person_id: "apollo-person-paid",
              first_name: "Pat",
              last_name_obfuscated: "Bu***r",
              title: "Director of Import Operations",
              has_email: true,
              organization: {
                id: "apollo-org-paid",
                name: "Paid Recovery Importer",
                primary_domain: "paid-recovery.test"
              }
            }]
          })
        } as unknown as Response;
      }
      if (url.includes("/api/v1/people/match?")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            person: {
              id: "apollo-person-paid",
              first_name: "Pat",
              last_name: "Buyer",
              title: "Director of Import Operations",
              email: "pat@paid-recovery.test",
              organization: {
                id: "apollo-org-paid",
                name: "Paid Recovery Importer",
                primary_domain: "paid-recovery.test"
              }
            }
          })
        } as unknown as Response;
      }
      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloContactsForCompany(
      {
        companyName: "Paid Recovery Importer",
        domain: "paid-recovery.test"
      },
      {
        authorizePaidEmailEnrichment: true
      }
    );

    expect(result.contacts).toEqual([
      expect.objectContaining({
        apolloPersonId: "apollo-person-paid",
        fullName: "Pat Buyer",
        email: "pat@paid-recovery.test"
      })
    ]);
    expect(result.contactRecovery).toMatchObject({
      maskedPeopleChecked: 1,
      savedContactsRecovered: 0,
      paidEmailEnrichmentsAttempted: 1,
      paidEmailsRecovered: 1
    });
    const enrichmentUrl = new URL(
      String(
        fetchMock.mock.calls.find(([input]) =>
          String(input).includes("/api/v1/people/match?")
        )?.[0]
      )
    );
    expect(enrichmentUrl.searchParams.get("id")).toBe("apollo-person-paid");
    expect(enrichmentUrl.searchParams.get("reveal_phone_number")).toBe("false");
    expect(enrichmentUrl.searchParams.get("run_waterfall_email")).toBe("false");
    expect(enrichmentUrl.searchParams.get("run_waterfall_phone")).toBe("false");
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
        if (
          Array.isArray(body.person_titles) &&
          body.person_titles.includes("logistics")
        ) {
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
      } as unknown as Response)
      .mockResolvedValue(emptyApolloPeopleResponse());

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
      .mockResolvedValue({
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
      } as unknown as Response)
      .mockResolvedValue(emptyApolloPeopleResponse());

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
      } as unknown as Response)
      .mockResolvedValue(emptyApolloPeopleResponse());

    const result = await fetchApolloContactsForCompany({
      companyName: "SIEMENS ENERGY INC. C/O PROCUREMENT TEAM"
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
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

  it("uses Apollo phone calls, conversations, and emailer messages for assistant activity counts", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (url.endsWith("/api/v1/phone_calls/search")) {
        if (body.page === 1) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              phone_calls: Array.from({ length: 100 }, (_, index) => ({
                id: `call-${index}`,
                user_id: "apollo-user-1",
                duration_seconds: 60,
                start_time: "2026-06-25T12:00:00.000Z"
              }))
            })
          } as unknown as Response;
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            phone_calls: [
              {
                id: "call-100",
                user_id: "apollo-user-1",
                duration_seconds: 45
              }
            ]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/conversations/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            conversations: [
              {
                id: "conversation-1",
                user_id: "apollo-user-1",
                duration_seconds: 180
              },
              {
                id: "conversation-2",
                user_id: "apollo-user-1",
                duration_seconds: 120
              }
            ]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/emailer_messages/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            emailer_messages: [
              {
                id: "email-1",
                user_id: "apollo-user-1",
                status: "completed",
                replied: false,
                created_at: "2026-06-25T15:00:00.000Z",
                completed_at: "2026-06-25T15:05:00.000Z"
              },
              {
                id: "email-2",
                user_id: "apollo-user-1",
                status: "completed",
                replied: true,
                created_at: "2026-06-25T16:00:00.000Z",
                completed_at: "2026-06-25T16:05:00.000Z"
              }
            ]
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloActivitySummary({
      apolloUserId: "apollo-user-1",
      userName: "Zalan Riaz",
      startDate: new Date("2026-06-25T04:00:00.000Z"),
      endDate: new Date("2026-06-26T03:59:59.999Z"),
      timezone: "America/Toronto",
      kinds: ["CALL", "CONNECTED_CALL", "EMAIL_SENT", "REPLY"]
    });

    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(result.callCount).toBe(101);
    expect(result.connectedCount).toBe(2);
    expect(result.emailSentCount).toBe(2);
    expect(result.replyCount).toBe(1);
    expect(result.activities).toHaveLength(106);
    expect(result.durationSeconds).toBe(6345);
  });

  it("filters out records that fall outside the requested local date window", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/api/v1/phone_calls/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            phone_calls: [
              {
                id: "call-in-range",
                user_id: "apollo-user-1",
                duration_seconds: 60,
                start_time: "2026-06-25T12:00:00.000Z"
              },
              {
                id: "call-out-of-range",
                user_id: "apollo-user-1",
                duration_seconds: 45,
                start_time: "2026-06-27T12:00:00.000Z"
              }
            ]
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/conversations/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            conversations: []
          })
        } as unknown as Response;
      }

      if (url.endsWith("/api/v1/emailer_messages/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            emailer_messages: []
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloActivitySummary({
      apolloUserId: "apollo-user-1",
      userName: "Zalan Riaz",
      startDate: new Date("2026-06-25T04:00:00.000Z"),
      endDate: new Date("2026-06-26T03:59:59.999Z"),
      timezone: "America/Toronto",
      kinds: ["CALL"]
    });

    expect(result.callCount).toBe(1);
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]?.id).toBe("call-in-range");
  });

  it("stops paginating when Apollo repeats the same full page response", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/api/v1/phone_calls/search")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            phone_calls: Array.from({ length: 100 }, (_, index) => ({
              id: `repeat-call-${index}`,
              user_id: "apollo-user-1",
              duration_seconds: 30,
              start_time: "2026-06-25T12:00:00.000Z"
            }))
          })
        } as unknown as Response;
      }

      throw new Error(`Unexpected Apollo URL in test: ${url}`);
    });

    const result = await fetchApolloActivitySummary({
      apolloUserId: "apollo-user-1",
      userName: "Zalan Riaz",
      startDate: new Date("2026-06-25T04:00:00.000Z"),
      endDate: new Date("2026-06-26T03:59:59.999Z"),
      timezone: "America/Toronto",
      kinds: ["CALL"]
    });

    expect(result.callCount).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the Apollo user_ids filter instead of q_user_ids when requesting rep activity", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        phone_calls: []
      })
    } as unknown as Response);

    await fetchApolloActivitySummary({
      apolloUserId: "apollo-user-1",
      userName: "Zalan Riaz",
      startDate: new Date("2026-06-25T04:00:00.000Z"),
      endDate: new Date("2026-06-26T03:59:59.999Z"),
      timezone: "America/Toronto",
      kinds: ["CALL"]
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(requestBody.user_ids).toEqual(["apollo-user-1"]);
    expect(requestBody.q_user_ids).toBeUndefined();
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

describe("removeApolloContactsFromSequences", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("APOLLO_MASTER_API", "master-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    "hunter-email-only",
    "hunter-executive-referral"
  ])("never sends the internal Newl Apps cadence key %s to Apollo", async (sequenceId) => {
    const fetchMock = vi.spyOn(global, "fetch");

    await expect(
      pushApolloContactsToSequence({
        sequenceId,
        apolloContactIds: ["apollo-contact-1"],
        sequenceOwnerUserId: "apollo-owner",
        sendFromEmailAccountId: "mailbox-1",
        initialStatus: "active"
      })
    ).rejects.toThrow(
      `${sequenceId} is an internal Newl Apps cadence key, not an Apollo sequence ID.`
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when Apollo returns a successful HTTP response with an enrollment error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        success: false,
        message: "Contact is not eligible for this sequence."
      })
    } as unknown as Response);

    await expect(
      pushApolloContactsToSequence({
        sequenceId: "hunter-sequence",
        apolloContactIds: ["apollo-contact-1"],
        sequenceOwnerUserId: "apollo-owner",
        sendFromEmailAccountId: "mailbox-1",
        initialStatus: "active"
      })
    ).rejects.toThrow("Contact is not eligible for this sequence.");
  });

  it("uses Apollo's zero-credit remove endpoint before cadence re-enrollment", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('{"success":true}')
    } as unknown as Response);

    await expect(removeApolloContactsFromSequences({
      sequenceIds: ["legacy-sequence"],
      apolloContactIds: ["apollo-contact-1"]
    })).resolves.toMatchObject({
      sequenceIds: ["legacy-sequence"],
      apolloContactIds: ["apollo-contact-1"]
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(requestUrl).toContain("/api/v1/emailer_campaigns/remove_or_stop_contact_ids?");
    expect(requestUrl).toContain("mode=remove");
    expect(requestUrl).toContain("emailer_campaign_ids%5B%5D=legacy-sequence");
    expect(requestUrl).toContain("contact_ids%5B%5D=apollo-contact-1");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST", cache: "no-store" })
    );
  });

  it("removes active prior cadence membership before adding the contact to Hunter", async () => {
    const fetchMock = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('{"success":true}')
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ contacts: ["apollo-contact-1"] })
      } as unknown as Response);

    await transitionApolloContactsToSequence({
      sequenceId: "hunter-sequence",
      apolloContactIds: ["apollo-contact-1"],
      sequenceOwnerUserId: "apollo-owner",
      sendFromEmailAccountId: "mailbox-1",
      initialStatus: "active",
      previousSequenceByContactId: {
        "apollo-contact-1": "legacy-sequence"
      }
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/emailer_campaigns/remove_or_stop_contact_ids?"
    );
    const addRequestUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(`${addRequestUrl.origin}${addRequestUrl.pathname}`).toBe(
      "https://api.apollo.io/api/v1/emailer_campaigns/hunter-sequence/add_contact_ids"
    );
    expect(addRequestUrl.searchParams.getAll("contact_ids[]")).toEqual(["apollo-contact-1"]);
    expect(addRequestUrl.searchParams.get("emailer_campaign_id")).toBe("hunter-sequence");
    expect(addRequestUrl.searchParams.get("send_email_from_email_account_id")).toBe("mailbox-1");
    expect(addRequestUrl.searchParams.get("user_id")).toBe("apollo-owner");
    expect(addRequestUrl.searchParams.get("status")).toBe("active");
    expect(addRequestUrl.searchParams.get("sequence_active_in_other_campaigns")).toBe("true");
    expect(addRequestUrl.searchParams.get("sequence_finished_in_other_campaigns")).toBe("true");
    expect(addRequestUrl.searchParams.get("sequence_same_company_in_same_campaign")).toBe("true");
    expect(addRequestUrl.searchParams.get("contacts_without_ownership_permission")).toBe("true");
    expect(addRequestUrl.searchParams.get("add_if_in_queue")).toBe("true");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: "{}"
      })
    );
  });
});

function emptyApolloPeopleResponse() {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ people: [] })
  } as unknown as Response;
}
