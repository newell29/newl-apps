# Customer-To-Warehouse Scope Extraction

Status: Draft evidence. Alex reviewed and approved the filtered technical scope candidate on 2026-07-20. This does not enable production Teamship access.

## Purpose

Create the smallest reviewable customer-to-warehouse scope candidate for the read-only Teamship tools. The Teamship customer API supplied profile candidates but did not include warehouse assignments, so each profile's visible `Assigned Warehouse(s)` section was read through a focused browser session.

## Evidence Classification

- Customer ID, name, company, customer type, deactivation state, and exact assigned warehouse labels: focused read-only Teamship observation on 2026-07-20.
- Warehouse IDs for Kestrel, Monte Vista, Watline, New Toronto 4, New Toronto 3, New Toronto 2, Sandy Porter, JP, and Annagem: earlier focused Playwright observation recorded in this Draft documentation.
- Whether an active Teamship profile should be authorized for Nemo: proposed configuration requiring Alex review.
- Mapping an unresolved label to any known warehouse: not inferred and not approved.

## Results

| Check | Result |
| --- | ---: |
| Profiles reviewed | 280 |
| Active profiles | 61 |
| Deactivated profiles excluded from the proposal | 219 |
| Active customer-to-warehouse assignment rows | 90 |
| Active profiles assigned to one warehouse | 42 |
| Active profiles assigned to multiple warehouses | 19 |
| Active profiles assigned to no warehouse | 0 |
| Duplicate customer IDs | 0 |
| Extraction errors | 0 |

## Active Assignment Distribution

| Exact Teamship warehouse label | Confirmed Teamship ID | Active profiles assigned |
| --- | ---: | ---: |
| Kestrel | 1 | 34 |
| Monte Vista | 6 | 18 |
| Sandy Porter | 18 | 17 |
| Annagem | 102 | 12 |
| New Toronto 3 | 15 | 2 |
| Watline | 13 | 1 |
| New Toronto 4 | 14 | 1 |
| New Toronto 2 | 17 | 1 |
| JP | 19 | 1 |
| New Toronto Street | Excluded | 1 |
| 49th | Excluded | 1 |
| New Huntington Road | Excluded | 1 |

## Owner Decision

`New Toronto Street`, `49th`, and `New Huntington Road` appear as exact assignments on active profiles. Alex confirmed on 2026-07-20 that these warehouses are not in use and directed Newl Apps to ignore them. They remain in the original extraction audit as observed evidence but are excluded from the approved 87-entry configuration candidate.

The full active-customer CSV, readable review report, all-profile audit JSON, filtered approval CSV, approval note, and application-shaped scope JSON are stored outside Git under `/Users/alexnewell/Desktop/OpenClaw recordings/Teamship Overview 07-20-26 artifacts/`. They contain operational customer-directory data. The filtered candidate must be tested in a disabled or non-production configuration before production use.

## Safety Outcome

- No Teamship profile or setting was changed.
- No Save, Deactivate, billing, administrative, inventory, receiving, shipping, or print action was used.
- `readOnlySearchEnabled` remains false.
- `readOnlyScopes` remains empty.
- The customer directory was not added to repository documentation or Nemo retrieval.
