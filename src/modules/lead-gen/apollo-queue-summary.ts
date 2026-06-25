export type ApolloQueueSummary = {
  status: "idle" | "success" | "error";
  message: string | null;
  requestedCompanies: number;
  processedCompanies: number;
  matchedCompanies: number;
  reviewNeededCompanies: number;
  companiesWithContacts: number;
  companiesWithoutContacts: number;
  contactsImported: number;
  completedAt: string | null;
};

export const EMPTY_APOLLO_QUEUE_SUMMARY: ApolloQueueSummary = {
  status: "idle",
  message: null,
  requestedCompanies: 0,
  processedCompanies: 0,
  matchedCompanies: 0,
  reviewNeededCompanies: 0,
  companiesWithContacts: 0,
  companiesWithoutContacts: 0,
  contactsImported: 0,
  completedAt: null
};
