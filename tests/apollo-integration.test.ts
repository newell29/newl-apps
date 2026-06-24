import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplyStatus, SequenceStatus } from "@prisma/client";
import {
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
