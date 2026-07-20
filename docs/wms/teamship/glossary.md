# Teamship Glossary

Status: Draft. Not approved or complete.

Definitions remain Draft. Entries labeled `confirmed by Alex` reflect his 2026-07-20 written follow-up; they are approved business meanings but do not authorize Teamship actions or live automation.

| Term | Draft meaning | Evidence |
| --- | --- | --- |
| Annagem | Official warehouse name for the Mississauga warehouse. Teamship may display a composite city-and-name label such as `Mississauga - Annagem`. | confirmed by Alex; composite label observed in Teamship |
| Nemo | Employee-facing name for Newl's WMS assistant. | confirmed by Alex |
| Inventory Order | An inbound inventory order. Open means not marked received; Complete means warehouse receiving is finished and the inventory is available for customer orders. Draft is outside the current documentation scope. | confirmed by Alex; tabs observed in Teamship |
| Shipping Order | An outbound order. Open means created but not closed out. Alex describes Closed as picked, charged, and closed; sampled UI uses a Complete tab, so exact label mapping remains open. | confirmed by Alex; status UI observed in Teamship |
| Receiving Order | An inbound order/warehouse receipt workflow. | observed in Teamship; requires warehouse-management confirmation |
| Inventory | Product/SKU/LPN/location quantity state inside Teamship. | observed in Teamship; requires warehouse-management confirmation |
| Ship by LPN | Inventory view or workflow grouped around LPNs. | observed in Teamship; requires warehouse-management confirmation |
| Inventory by Location | Inventory view grouped by warehouse location/bin. | observed in Teamship; requires warehouse-management confirmation |
| LPN | License plate number: a handling-unit identifier. It represents a pallet about 95% of the time but can represent another handling unit. | confirmed by Alex; observed in Teamship |
| SKU | Product identifier used in inventory, receiving, and shipping rows. | observed in Teamship; requires warehouse-management confirmation |
| Serial | Product serial number, visible in some existing Teamship/Newl Apps contexts and likely important for serialized products. | inferred by Codex; requires warehouse-management confirmation |
| Bulk order | A non-e-commerce shipping order that does not require individual-unit picking and does not originate from an e-commerce storefront. | confirmed by Alex |
| E-commerce order | Usually an individual-unit, small-parcel order picked, packed, and shipped directly to a customer or business. | confirmed by Alex |
| Picking | E-commerce stage in which pickers travel to locations and retrieve individual items. | confirmed by Alex; observed in Teamship |
| Packing | Stage after Picking in which units are placed into shipping cases, labels are added, and a small-parcel carrier is selected. | confirmed by Alex; observed in Teamship |
| Picking List | Shipping-order document/control that downloads a local PDF and does not auto-print. | confirmed by Alex; control observed in Teamship |
| Packing List | Shipping-order document/control that downloads a local PDF and does not auto-print. | confirmed by Alex; control observed in Teamship |
| BOL | Bill of Lading control/document. BOL Print opens another popup; selecting Print there sends to the selected Teamship printer. | confirmed by Alex; editor/control supported by repository evidence |
| Outbound shipping label | Pallet label that prints directly to the selected Teamship printer. Alex confirms the label count should match pallet count. | confirmed by Alex; control observed in Teamship; live print not tested here |
| Pallet row | Shipping step row containing dimensions, quantity, weight, unit, and commodity text. | observed in Teamship; requires CSR confirmation |
| Commodity | Free-text/product description field on pallet/shipping information rows. | observed in Teamship; requires CSR confirmation |
| Warehouse Directory | Teamship screen listing warehouse records and actions. | observed in Teamship |
| Product Details | Teamship screen for product data, transactions, barcodes, labels, stock allocation, and product options. | observed in Teamship |
| User Directory | Admin screen listing Teamship users and account/contact details. | observed in Teamship; requires admin confirmation |
| QAD | Garland's internal system and the source from which Garland Canada EDI orders are pulled. | confirmed by Alex |
| Zeal Concept | Customer name confirmed by Alex and shown in sampled Teamship rows. | confirmed by Alex; observed in Teamship |
