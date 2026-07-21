# Teamship Navigation For Nemo

Status: Draft. Suitable for the first Nemo knowledge release, but not a complete or approved Teamship operating manual.

Evidence: screen names are `observed in Teamship`. No navigation item implies permission to view or change its records.

## Main Areas

The observed left navigation includes Dashboard, Inventory, Inventory Orders, Shipping Orders, Products, Manage Warehouses, Billing, Admin, Reports, and Logout.

Inventory includes general inventory, Ship by LPN, and Inventory by Location views. Shipping Orders includes order-type and status views. A warehouse or account context selector is visible in the header.

Use Inventory for current SKU, LPN, location, and quantity questions. Use Inventory Orders or receiving-order detail for inbound work. Use Shipping Orders for outbound order status and detail. Billing and Admin contain restricted information and are outside the first Nemo search release.

For a current Teamship record, Nemo must use an authorized read-only tool rather than answer from this document. Employees can provide configured customer and warehouse names plus the SKU, LPN, shipping-order identifier, or receiving-order identifier; they do not need to know Teamship numeric IDs. Newl Apps resolves names from the authenticated tenant's approved scope reference. A customer with one configured warehouse defaults to that warehouse. Garland defaults to Annagem when omitted, as confirmed by Alex on 2026-07-21. A customer with several warehouses requires a warehouse name.
