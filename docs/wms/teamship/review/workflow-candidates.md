# Teamship Workflow Candidates

Status: Draft. Planning only. No workflow is approved automation.

Documentation workflows explain a task and its meaning. Automation workflows are separate, focused candidates with explicit safety boundaries. The overview must not become one large Teamship replay.

## Documentation Workflows

| Candidate | User intent | Start / end | Evidence | Classification |
| --- | --- | --- | --- | --- |
| Understand Teamship navigation | Identify the correct module without changing state. | Dashboard -> named list/detail screen. | T003-T009 | Documentation only. |
| Read Inventory All | Explain available/reserved/on-hand/backordered/status columns in a user-scoped warehouse context. | Inventory All -> interpreted result with pending-rule labels. | T010-T015 | Documentation only; warehouse confirmation required. |
| Find inventory by LPN | Find SKUs, quantity, warehouse, and location for an LPN or customer. | Ship by LPN -> filtered grouped rows. | T016-T023 | Documentation plus read-only helper candidate. |
| Find inventory by location | Find locations containing a SKU. | Inventory by Location -> filtered location groups. | T024-T025 | Documentation plus read-only helper candidate. |
| Assess a missing-order stock question | Check SKU, requested serial, alternatives, and quarantine without promising availability. | Inventory search -> evidence-led status summary. | T026-T028 | Documentation plus API-preferred read-only helper. |
| Inspect view/filter state | Report user-specific selected views and active filters before interpreting a search. Users have no saved views by default. | Any table -> verified and reported filter context. | T029, T041; Alex follow-up F04 | Documentation; clear a temporary filter only when explicitly requested and never persist/delete saved views. |
| Read Inventory Orders by customer/date | Count or list inbound orders for a customer/date range. | Inventory Orders -> filtered order list. | T031-T035 | Documentation plus read-only helper candidate. |
| Check inbound stock by SKU | Identify candidate open inbound orders, then inspect each order for the SKU because list search failed. | Inventory Orders -> candidate order detail(s). | T035-T037 | Documentation plus read-only helper candidate. |
| Read completed receiving detail | Report received SKU/serial/quantity/LPN/location from a Complete Receiving Order. | Complete Inventory Orders -> Receiving Order detail. | T038 | Documentation plus read-only helper candidate. |
| Understand inbound statuses | Explain Open/Complete/Draft as Alex described them, with confirmation warnings. | Inventory Orders tabs -> status explanation. | T031, T036, T039 | Documentation only until warehouse sign-off. |
| Read bulk shipping-order status | Find an order and report Open/On Hold/Draft/Complete plus visible reason/evidence. | Bulk Orders -> order list/detail. | T040-T047 | Documentation plus read-only helper candidate. |
| Read bulk shipping-order detail | Report customer/warehouse, products, ship-to, transport, attachments, EDI, history, pallet, and charge-control presence. | Shipping order -> sanitized structured summary. | T049-T056 | Documentation plus API-preferred read-only helper. |
| Explain BOL data provenance | Identify which BOL fields originate on the shipping order and which may be overridden. | Existing BOL editor -> field map, no edits. | T050-T054 | Documentation only; read-only inspection is high risk because editor autosaves changes. |
| Read bulk pick status | Report SKU, LPN, location, required/picked quantity, hold state, and completion evidence. | Shipping order -> pick screen. | T057-T058 | Documentation plus restricted read-only helper candidate. |
| Inspect document controls | Identify Picking List, Packing List, BOL, and outbound-label controls without clicking Print/Generate/Void. | Shipping order -> control-presence report. | T059-T068 | Documentation plus read-only Playwright candidate. |
| Read e-commerce fulfillment stage | Report Open/Picking/Packing/Complete and visible package/label/tracking state. | E-Commerce Orders -> list/detail. | T069-T075 | Documentation plus read-only helper candidate. |
| Read Product Details | Report SKU/barcode/stock attributes/templates/dimensions and active/quarantine indicators without editing. | Products -> Product Details. | T076-T081 | Documentation plus read-only helper candidate. |
| Summarize product history | Report inbound, outbound, and adjustment history for a SKU. | Product Details -> Inventory History. | T079, T082 | Documentation plus read-only helper candidate. |
| Look up LPN history | Find warehouse-history evidence for an LPN. | Manage Warehouses -> LPN history. | T083 | Documentation candidate; needs focused capture first. |
| Read billing transaction | Find order-linked charges and verify Order No versus Transaction match. | Billing -> transaction detail. | T084-T087, T090-T091 | Restricted read-only finance workflow. |
| Read generated invoice | Explain invoice summary and supporting order breakdown. | Generated Invoices -> invoice/PDF view. | T089 | Restricted read-only finance workflow. |
| Review Teamship access context | Identify user role, visible warehouses, and customer account options without exposing personal details. | User Directory/customer profile -> sanitized access summary. | T092-T098 | Restricted admin/security documentation. |

## Write Or Print Workflows Requiring Separate Approval

These are not part of the overview documentation workflow and must not be executed from this Draft:

| Focused candidate | Mutation / side effect | Required separate controls |
| --- | --- | --- |
| Add SKU inventory to a shipping order | Changes order inventory and quantities. | Exact order/SKU/serial approval, availability readback, role authorization, dry-run, post-save verification. |
| Edit BOL fields | Inline editor may autosave immediately. | Approved field-by-field plan, before/after evidence, autosave readback, audit record. |
| Add/remove pallet rows | Changes dimensions, weight, quantity, unit, commodity, and BOL output. | Existing approved Phase 2 job path or separate reviewed workflow; API preferred. |
| Start/complete picking | Changes fulfillment state and warehouse work queue. | Warehouse authorization, scan validation, exact order confirmation, rollback/escalation plan. |
| Release Hold | Removes a safety/business hold. | Hold-reason validation and explicit authorized approver. |
| Pack order / Fetch Rates / Generate Label | Changes package data, may buy/select service, and creates a live carrier label. | Cost preview, carrier/service confirmation, package verification, cancellation/audit path. |
| Print Picking List/Packing List/BOL | May download, preview, or send a real print job depending on the control. | Controlled printer, document preview/readback, copy count, destination confirmation. |
| Print outbound labels | Likely sends a real 4-by-6 printer job. | Exact queue, pallet count, label preview if available, duplicate/reprint safeguards. |
| Deactivate/quarantine product | Blocks product/order availability. | Warehouse/admin approval, scope (SKU versus LPN), impact preview, audit. |
| Create invoice | Consolidates live charges into finance records. | Finance role, customer/transaction review, totals preview, approval, audit. |
| Change user/customer profile | Changes access, notifications, account options, or customer configuration. | Admin/security approval, tenant/customer verification, before/after audit. |

## Candidate Focused Record & Replay Sessions

Each session should use a controlled account, avoid private values in reusable outputs, and stop before mutation unless that session receives separate explicit approval.

Alex's written follow-up resolved the business meaning for search behavior, core statuses, printing behavior, and access scoping. The sessions below now provide UI/tool evidence rather than owner approval. Highest-priority remaining sessions are quarantine indicators, Complete/Closed plus carrier status, controlled printer verification, and role-by-screen visibility.

1. **Navigation and role visibility**: dashboard, left navigation, expanded submenus, warehouse context, Teamship role differences.
2. **Inventory table search and filter semantics**: All, Ship by LPN, Inventory by Location, saved views, per-column filters, global Search, clear-filter verification.
3. **Quarantine indicators**: one quarantined LPN, one quarantined SKU, visible lock/icon, API fields, and blocked actions without attempting shipment.
4. **Inventory Orders and Receiving Order statuses**: Open/Complete/Draft, partial receipt visibility, SKU lookup limitation, completed Locations/LPNs detail.
5. **Bulk Shipping Orders and status reasons**: Open/On Hold/Draft/Complete, hold reason, URL identity, read-only order detail.
6. **BOL field map and autosave boundary**: existing BOL only, field provenance, controls, and proof that inspection does not enter edit mode.
7. **Document and printer behavior using a controlled printer**: Picking List, Packing List, BOL, outbound labels, PDF/download/modal/direct-print outcomes, queue names, copy counts.
8. **E-commerce pick/pack/status**: Open -> Picking -> Packing -> Complete screens using already-completed examples or a non-mutating test environment.
9. **Carrier tracking status mapping**: Teamship label state versus external carrier states such as Label Created, Accepted, In Transit, and Delivered.
10. **Product Details and history**: stock attributes, quarantine, thresholds, templates, active state, Product History -> Inventory History navigation.
11. **Billing read-only orientation**: Outstanding transactions, Generated Invoices, All transactions, order-number false positives, invoice PDF.
12. **Admin access model**: Teamship roles, warehouse access, customer users, account options, EDI mappings, pricing-table location; sanitized and restricted.
