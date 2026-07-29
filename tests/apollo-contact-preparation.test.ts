import { ReplyStatus, SequenceStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { prepareApolloContactForEnrollment } from "@/modules/lead-gen/apollo-contact-preparation";
import type { ApolloContactRecord } from "@/server/integrations/apollo";

describe("prepareApolloContactForEnrollment", () => {
  it("recovers an existing saved Apollo contact by email without creating a duplicate", async () => {
    const createContact = vi.fn();
    const persistContactIdentity = vi.fn().mockResolvedValue(undefined);

    await expect(
      prepareApolloContactForEnrollment({
        contact: localContact(),
        company: {
          name: "VS AMERICA, INC.",
          domain: "vsamerica.example"
        },
        savedContacts: [
          apolloContact({
            apolloContactId: "apollo-saved-corey",
            apolloPersonId: "apollo-person-corey",
            email: "corey@vsamerica.example"
          })
        ],
        createContact,
        persistContactIdentity
      })
    ).resolves.toEqual({
      apolloContactId: "apollo-saved-corey",
      apolloPersonId: "apollo-person-corey",
      resolution: "EXISTING_SAVED_CONTACT"
    });

    expect(createContact).not.toHaveBeenCalled();
    expect(persistContactIdentity).toHaveBeenCalledWith({
      apolloContactId: "apollo-saved-corey",
      apolloPersonId: "apollo-person-corey"
    });
  });

  it("creates or deduplicates the Apollo contact when only a people-search ID exists", async () => {
    const createContact = vi.fn().mockResolvedValue(
      apolloContact({
        apolloContactId: "apollo-created-corey",
        apolloPersonId: null,
        email: "corey@vsamerica.example"
      })
    );
    const persistContactIdentity = vi.fn().mockResolvedValue(undefined);

    await expect(
      prepareApolloContactForEnrollment({
        contact: localContact(),
        company: {
          name: "VS AMERICA, INC.",
          domain: "vsamerica.example"
        },
        savedContacts: [],
        createContact,
        persistContactIdentity
      })
    ).resolves.toEqual({
      apolloContactId: "apollo-created-corey",
      apolloPersonId: "apollo-person-corey",
      resolution: "CREATED_OR_DEDUPED"
    });

    expect(createContact).toHaveBeenCalledWith({
      firstName: "Corey",
      lastName: "Ma****y",
      fullName: "Corey Ma****y",
      title: "Director of Operations",
      email: "corey@vsamerica.example",
      phone: null,
      companyName: "VS AMERICA, INC.",
      companyDomain: "vsamerica.example"
    });
    expect(persistContactIdentity).toHaveBeenCalledWith({
      apolloContactId: "apollo-created-corey",
      apolloPersonId: "apollo-person-corey"
    });
  });

  it("backfills a masked local identity from the same-company saved contact using strict first name and title", async () => {
    const createContact = vi.fn();
    const persistContactIdentity = vi.fn().mockResolvedValue(undefined);

    await expect(
      prepareApolloContactForEnrollment({
        contact: {
          ...localContact(),
          apolloPersonId: "apollo-person-masked",
          lastName: "Ma****y",
          fullName: "Corey Ma****y",
          email: "corey@vsamerica.example",
          linkedinUrl: null
        },
        company: {
          name: "VS AMERICA, INC.",
          domain: "vsamerica.example"
        },
        savedContacts: [
          apolloContact({
            apolloContactId: "apollo-contact-saved",
            apolloPersonId: null,
            firstName: "Corey",
            lastName: "Mackey",
            fullName: "Corey Mackey",
            title: "Director of Operations",
            email: "different-but-concrete@vsamerica.example",
            linkedinUrl: null
          })
        ],
        createContact,
        persistContactIdentity
      })
    ).resolves.toEqual({
      apolloContactId: "apollo-contact-saved",
      apolloPersonId: "apollo-person-masked",
      resolution: "EXISTING_SAVED_CONTACT"
    });

    expect(createContact).not.toHaveBeenCalled();
  });

  it("does not persist an Apollo identity when creation returns no saved contact ID", async () => {
    const persistContactIdentity = vi.fn();

    await expect(
      prepareApolloContactForEnrollment({
        contact: localContact(),
        company: {
          name: "VS AMERICA, INC.",
          domain: null
        },
        savedContacts: [],
        createContact: vi.fn().mockResolvedValue(
          apolloContact({
            apolloContactId: null,
            apolloPersonId: "apollo-person-corey",
            email: "corey@vsamerica.example"
          })
        ),
        persistContactIdentity
      })
    ).rejects.toThrow(
      "Apollo did not return the saved contact ID required for enrollment."
    );

    expect(persistContactIdentity).not.toHaveBeenCalled();
  });
});

function localContact() {
  return {
    apolloContactId: null,
    apolloPersonId: "apollo-person-corey",
    firstName: "Corey",
    lastName: "Ma****y",
    fullName: "Corey Ma****y",
    title: "Director of Operations",
    email: "corey@vsamerica.example",
    phone: null,
    linkedinUrl: "https://www.linkedin.com/in/corey-example"
  };
}

function apolloContact(
  overrides: Partial<ApolloContactRecord>
): ApolloContactRecord {
  return {
    recordSource: "SAVED_CONTACT",
    apolloContactId: "apollo-contact",
    apolloPersonId: "apollo-person",
    firstName: "Corey",
    lastName: null,
    lastNameObfuscated: "Ma****y",
    fullName: "Corey Ma****y",
    title: "Director of Operations",
    department: "Operations",
    seniority: "Director",
    email: "corey@vsamerica.example",
    phone: null,
    linkedinUrl: "https://www.linkedin.com/in/corey-example",
    hasEmailAvailable: true,
    hasPhoneAvailable: false,
    hasLinkedinAvailable: true,
    city: "Charlotte",
    state: "North Carolina",
    country: "United States",
    sequenceStatus: SequenceStatus.NOT_STARTED,
    replyStatus: ReplyStatus.NO_REPLY,
    sequenceId: null,
    sequenceName: null,
    sequenceOwnerName: null,
    sequenceOwnerUserId: null,
    lastTouchAt: null,
    lastReplyAt: null,
    rawPayload: {},
    ...overrides
  };
}
