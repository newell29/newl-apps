export type ExistingQuickBooksAssociationActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  code?: string;
};

export const EMPTY_EXISTING_QUICKBOOKS_ASSOCIATION_STATE: ExistingQuickBooksAssociationActionState = {
  status: "idle"
};

export const EXISTING_QUICKBOOKS_ASSOCIATION_CONFIRMATION =
  "ASSOCIATE_EXISTING_QUICKBOOKS_CONNECTION";
