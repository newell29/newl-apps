# Inventory Workflows

Status: Draft. Not approved or complete. These are candidate read-only workflows, not approved automations.

## Navigate To Inventory

Classification: `documentation only` or `read-only browser helper`.

Inputs:

- Desired warehouse/customer context.
- Optional inventory view: Details, Ship by LPN, or Inventory by Location.

End condition:

- Inventory page is visible in the correct view and context.

Verification:

- Page header says Inventory.
- Correct tab/view is active.
- Correct warehouse/customer context is selected.

## Search Customer Inventory

Classification: `candidate deterministic Playwright tool`, read-only only.

Inputs:

- Customer/warehouse context.
- SKU, product name, LPN, location, or other approved search term.

End condition:

- Filtered inventory results are visible.

Verification:

- Search value is present.
- Result table is populated or visibly empty.
- Active view/filter context is captured.

Safety:

- Do not click add/edit/import/action controls.
- Do not change inventory state.

## Read Inventory Result

Classification: `candidate API tool` if Teamship/Newl Apps can expose structured inventory state; otherwise `candidate deterministic Playwright tool`.

Inputs:

- Result row selector or identifiers such as SKU/LPN/location.

Output:

- Sanitized product/SKU, LPN, location, quantities, and status fields.
- Evidence screenshot/readback.

Open questions:

- Which fields determine available inventory?
- Which statuses require warehouse-management review?
