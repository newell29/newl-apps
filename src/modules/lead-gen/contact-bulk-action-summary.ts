export type ContactBulkActionSummary = {
  status: "idle" | "success" | "error";
  operation: "sequence" | "remove" | "apollo_push" | "apollo_sync" | null;
  message: string;
  completedAt: string | null;
  selectedContacts: number;
  updatedContacts: number;
  readyContacts: number;
  protectedContacts: number;
  removedContacts: number;
  removedDrafts: number;
  pushedToApollo: boolean;
  syncedContacts: number;
  enrolledContacts: number;
  skippedContacts: number;
  failedContacts: number;
  companiesTouched: number;
};

export const EMPTY_CONTACT_BULK_ACTION_SUMMARY: ContactBulkActionSummary = {
  status: "idle",
  operation: null,
  message: "",
  completedAt: null,
  selectedContacts: 0,
  updatedContacts: 0,
  readyContacts: 0,
  protectedContacts: 0,
  removedContacts: 0,
  removedDrafts: 0,
  pushedToApollo: false,
  syncedContacts: 0,
  enrolledContacts: 0,
  skippedContacts: 0,
  failedContacts: 0,
  companiesTouched: 0
};
