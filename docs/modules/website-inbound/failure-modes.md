# Inbound opportunity failure modes

- Invalid or oversized input returns an inline error; controlled fields retain the entered values.
- A duplicate warning creates no record until the user selects a separate enquiry or opens an existing record.
- A concurrent edit or stale revision returns a reload message and writes no activity or audit event.
- Invalid tenant record IDs, foreign owner IDs, account-setup IDs, and read-only requests fail before authorized persistence.
- Activity and audit failures roll back the corresponding transaction. Unexpected error details are not displayed to users.
- Concurrent serializable creation can return a retry error; the request key prevents an ordinary retried create from making a second record.
- Partially populated or empty historical contact evidence is valid for editing and notes. Missing fields display as unspecified instead of being invented.
- Pagination clamps out-of-range page numbers; a selected unavailable record displays a not-found message without querying its history.
- A database without the approved additive migration cannot run the new queue. Production migrations and deployment remain separate owner actions.
