# Inbound opportunity permissions

The page resolves `getAuthenticatedContext()` and requires `WEBSITE_INBOUND`. Create, update and note server actions each resolve a fresh authenticated context, require module access, and require mutation access. Client-supplied tenant/actor identities are ignored. Read-only members can view details/history but have no active mutation controls.

Every table/detail/history/duplicate query uses authenticated `tenantId`. Owner IDs are validated against the same tenant's Membership and constrained by a composite database foreign key. Finance account-setup records are excluded from this queue and its mutations.

There are no new permission grants, external communication actions, Teamship writes, financial operations, or automated lifecycle transitions. Existing public form intake retains its separate token-authenticated tenant resolution.
