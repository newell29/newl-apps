import type {
  ApolloContactCreateInput,
  ApolloContactRecord
} from "@/server/integrations/apollo";

export type ApolloEnrollmentContact = {
  apolloContactId: string | null;
  apolloPersonId: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  title: string | null;
  email: string;
  phone: string | null;
  linkedinUrl: string | null;
};

export type ApolloEnrollmentCompany = {
  name: string;
  domain: string | null;
};

export async function prepareApolloContactForEnrollment({
  contact,
  company,
  savedContacts,
  createContact,
  persistContactIdentity
}: {
  contact: ApolloEnrollmentContact;
  company: ApolloEnrollmentCompany;
  savedContacts: ApolloContactRecord[];
  createContact: (input: ApolloContactCreateInput) => Promise<ApolloContactRecord>;
  persistContactIdentity: (identity: {
    apolloContactId: string;
    apolloPersonId: string | null;
  }) => Promise<void>;
}) {
  if (contact.apolloContactId) {
    return {
      apolloContactId: contact.apolloContactId,
      apolloPersonId: contact.apolloPersonId,
      resolution: "ALREADY_SAVED" as const
    };
  }

  const existingSavedContact = findSavedApolloContact(savedContacts, contact);
  const savedContact =
    existingSavedContact ??
    (await createContact({
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      companyName: company.name,
      companyDomain: company.domain
    }));
  const apolloContactId = savedContact.apolloContactId;
  if (!apolloContactId) {
    throw new Error("Apollo did not return the saved contact ID required for enrollment.");
  }
  const apolloPersonId = contact.apolloPersonId ?? savedContact.apolloPersonId;

  await persistContactIdentity({
    apolloContactId,
    apolloPersonId
  });

  return {
    apolloContactId,
    apolloPersonId,
    resolution: existingSavedContact
      ? ("EXISTING_SAVED_CONTACT" as const)
      : ("CREATED_OR_DEDUPED" as const)
  };
}

function findSavedApolloContact(
  candidates: ApolloContactRecord[],
  contact: ApolloEnrollmentContact
) {
  const savedContacts = candidates.filter(
    (candidate) => candidate.recordSource === "SAVED_CONTACT" && candidate.apolloContactId
  );
  const normalizedEmail = normalize(contact.email);
  const normalizedLinkedin = normalize(contact.linkedinUrl);
  const normalizedFullName = normalize(contact.fullName);
  const normalizedTitle = normalize(contact.title);

  return (
    savedContacts.find(
      (candidate) =>
        contact.apolloPersonId &&
        candidate.apolloPersonId === contact.apolloPersonId
    ) ??
    savedContacts.find(
      (candidate) =>
        normalizedEmail &&
        normalize(candidate.email) === normalizedEmail
    ) ??
    savedContacts.find(
      (candidate) =>
        normalizedLinkedin &&
        normalize(candidate.linkedinUrl) === normalizedLinkedin
    ) ??
    savedContacts.find(
      (candidate) =>
        normalize(candidate.fullName) === normalizedFullName &&
        normalize(candidate.title) === normalizedTitle
    ) ??
    null
  );
}

function normalize(value: string | null) {
  return value?.trim().toLowerCase() || null;
}
