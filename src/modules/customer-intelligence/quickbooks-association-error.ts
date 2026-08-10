export type QuickBooksAssociationFailureCode =
  | "REALM_INPUT_MISSING"
  | "OPERATING_COMPANY_NOT_FOUND"
  | "CREDENTIAL_NOT_FOUND"
  | "CREDENTIAL_PROVIDER_INVALID"
  | "CREDENTIAL_INACTIVE"
  | "CREDENTIAL_REALM_MISSING"
  | "CREDENTIAL_REALM_MISMATCH"
  | "CREDENTIAL_LEGAL_ENTITY_INVALID"
  | "CREDENTIAL_LEGAL_ENTITY_MISMATCH"
  | "CONFLICT"
  | "CONFLICT_CHECK_FAILED"
  | "ASSOCIATION_UPDATE_FAILED"
  | "AUDIT_FAILED"
  | "TRANSACTION_FAILED"
  | "SERIALIZATION_RETRY_EXHAUSTED";

export class QuickBooksAssociationError extends Error {
  constructor(
    readonly code: QuickBooksAssociationFailureCode,
    message: string
  ) {
    super(message);
    this.name = "QuickBooksAssociationError";
  }
}
