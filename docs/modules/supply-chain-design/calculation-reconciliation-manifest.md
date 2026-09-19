# Phase 2 calculation and orchestration reconciliation

Source: preserved tracked patch based on `855e490d`; Phase 1 working tree is retained.

## Exact calculation hunk allowlist

| File | Preserved old-line hunk starts |
| --- | --- |
| `src/modules/supply-chain-design/actions.ts` | 130, 141, 1183, 1197, 1208, 1350, 1412, 1496, 1506, 1514, 1537, 1556, 1596, 1671, 1693, 1703, 1720, 1768, 1805, 1821, 1841, 1918, 1949, 1959, 2646, 2660, 2671, 2714, 2774, 2783, 2798, 2837, 2857, 2872, 3409, 3417, 3432, 3439, 3471, 3542, 3555, 3606, 3630, 3651, 3724 |
| `src/modules/supply-chain-design/candidate-ltl-rate-preparation.ts` | 3, 37, 62, 78, 106, 123, 153, 167, 196, 213, 229, 257, 268, 382, 408, 441, 461, 512, 537, 546, 609, 660, 680, 710 |
| `src/modules/supply-chain-design/ltl-rate-batches.ts` | 5, 20, 38, 50, 58, 83, 157, 203, 212, 228, 259, 301, 308, 360, 392, 413, 421, 493, 608, 800, 844, 978, 1007, 1024, 1130, 1146, 1164, 1186, 1325, 1349, 1361, 1409, 1434, 1476, 1490, 1583, 1623, 1659, 1692, 1736, 1752, 1792 |
| `src/modules/supply-chain-design/mapping-definitions.ts` | Manually extracted amount-currency labels and optional fields only; see exact field list below. |
| `src/modules/supply-chain-design/model-01-proof.ts` | 1, 10, 142, 163, 175, 192, 296, 322, 365, 388, 427, 498, 549, 668, 680, 712, 723, 736, 777, 788, 800, 823, 1115 |
| `src/modules/supply-chain-design/model-02-proof.ts` | 121, 179, 188, 610 |
| `src/modules/supply-chain-design/network-scenario-combined-cost.ts` | 88, 154, 212, 421 |
| `src/modules/supply-chain-design/network-scenario-comparison-orchestration.ts` | 54, 169, 195, 232, 360, 407, 437, 453, 555, 568, 592, 626 |
| `src/modules/supply-chain-design/network-scenario-comparison-persistence.ts` | 77, 579 |
| `src/modules/supply-chain-design/network-scenario-evaluation.ts` | 5, 24, 45, 85, 103, 216, 231, 295, 309, 335, 343, 355 |
| `src/modules/supply-chain-design/queries.ts` | 9, 1037, 1519, 2110 |
| `src/modules/supply-chain-design/types.ts` | 364 |
| `src/modules/supply-chain-design/warehouse-cost-comparison.ts` | 15, 90, 103, 147, 193, 207, 252 |
| `src/modules/supply-chain-design/warehouse-cost-engine.ts` | 11 |
| `src/modules/supply-chain-design/warehouse-location-strategy.ts` | 14, 43, 60, 279, 460, 1088 |

The listed hunk ranges identify source candidates, not wholesale replacements. The following manual resolutions supersede incompatible historical hunks.

## Reconciliation constraints

- Manual conflict resolution preserves Phase 1 project settings, physical guards and discriminator keys.
- Retain existing record-type DTOs, positional reporting rows, shipment-count defaults, form FX inputs, deletion actions and CSV escaping.
- Currency-aware runs use project settings; legacy direct calculation callers retain their prior no-conversion behavior until they pass a currency context.
- New additive mappings cover only amounts consumed by the reconciled paths. Unused provider/benchmark currency mappings are excluded.
- Retain optional baseline count mappings and individual-row defaults; retain record-type DTOs and CSV columns. Whole-pallet aggregate rating requires whole represented counts and enough whole pallets, and remains subject to business review.
- Whole-pallet distribution and fixed USD interpretation of provider rates are preserved hypotheses requiring business review before production use.
- No page/form restructuring, template/sample rewrite, output artifacts, duplicate pages, reset/replacement, unrelated work, schema change or migration execution.

## Test and follow-up allowlist

- `tests/supply-chain-design.test.ts`: dependent calculation fixtures and preserved calculation/orchestration regression hunks; preserve current-main and Phase 1 safeguards.
- `tests/supply-chain-design-foundations.test.ts`: retain Phase 1 tests.
- `tests/supply-chain-design-phase2.test.ts`: focused compatibility/FX/evidence regressions if needed.
- `docs/modules/supply-chain-design/overview.md`: record the actual Phase 2 boundary.
- `docs/modules/supply-chain-design/calculation-reconciliation-manifest.md`: this manifest and verification results.

Phase 3 retains customer-facing currency/unit display, removal of duplicate per-run FX UI after review, updated templates/samples, richer reporting layouts and broader product documentation.


## Exact additive mapping fields

Labels and optional definitions only: `annual_fixed_cost_currency`, `annual_facility_warehouse_cost_currency`, `inbound_fee_per_pallet_currency`, `outbound_fee_per_pallet_currency`, `storage_fee_per_pallet_per_month_currency`, `current_inventory_value_currency`, `transportation_cost_currency`, `inventory_value_total_currency`, `unit_cost_currency`, `annual_cost_currency`. Existing fields, header recognition, requirements and templates remain intact.

## Manual compatibility and safety resolutions

- Baseline actions pass project currency settings when monetary currency mappings exist. Legacy files with no monetary currency mapping remain unconverted and carry no FX snapshot. Direct baseline/preparation callers without currency context retain raw historical monetary amounts. This exception needs product confirmation before template changes.
- Weight evidence with valid source units is normalized to pounds; persisted `normalizedWeightUnit` prevents normalized weights being displayed as kilograms. Old untagged baseline results retain legacy source-unit display.
- Project FX settings take precedence; current per-run FX form inputs remain a fallback when no project rate exists. Resume uses the comparison run's saved currency/FX evidence.
- Preparation version is V5; physical request keys retain the Phase 1 discriminator. Batch freshness requires source hashes, mapping timestamps, and matching project FX snapshot. Batch compatibility includes cost amounts/currencies, project FX evidence, fresh-rate intent, physical profiles and warehouse quantities/dwell.
- Exact lane reuse requires tenant and project scope. Force-fresh mode bypasses completed comparison cache, ordinary active comparison/batch reuse and ordinary exact-rate reuse while accepted batches completed for that comparison can reconcile as `LIVE_RATE`. Comparison/transportation calculation versions are bumped; older Location Strategy V9 results remain readable after the V10 bump.
- Preserve source quantities and original currencies; normalize rates/fees before scenario winner selection. Unsupported or missing monetary currencies cannot be relabelled into an analysis currency by FX conversion. Explicit fee currencies work without a redundant FX rate when all currencies match.
- Warehouse source rows survive profile consolidation. Supplemental source rows, including excluded Parcel rows, contribute to candidate warehouse economics once per source ID. Storage-month math remains `max(1, ceil(dwellDays / 30))`.
- Currency-aware warehouse comparisons fail closed on partial or missing warehouse evidence. Legacy unversioned batch calculations retain their prior interpretation; they are not eligible for compatible current preparation reuse.
- Direct comparison CSV reporting normalizes historical and provider amounts to the same analysis currency and appends candidate-summary currency; raw provider rate exports retain their USD evidence. Formula escaping remains intact. Richer positional reporting stays deferred.
- Preserve existing deletion action bodies, evidence deletion checks, module access implementation, CSV escaping, navigation and unrelated modules. No Phase 2 schema/migration changes.

## Files changed in Phase 2

The 15 source files listed above, `tests/supply-chain-design.test.ts`, `docs/modules/supply-chain-design/overview.md`, and this new manifest. Phase 1 remains uncommitted and intact. No generated packages, ZIPs, duplicate pages, reset/replacement workflows, or unrelated preserved files are included.

## Remaining business review

Whole-pallet allocation assumes historical aggregate weight can be allocated proportionally to pallets and whole pallets distributed across represented shipments. Provider rate totals are interpreted as USD; confirm this for each supported account. Confirm the legacy untagged-baseline exception and the transition from per-run FX inputs to project settings. These assumptions are not approved for production by this reconciliation.

## Phase 3 boundary

Update customer-facing currency/unit labels, clearer FX provenance and force-fresh controls; review spreadsheet/template header changes and count/record-type language; reconcile richer positional scenario reporting with the current page; update samples, fixtures and broader product documentation; perform preview/browser validation only after deployment authorization.

## Completion and validation (2026-09-18)

The controlled final pass added the backend-supported force-fresh controls to Network Design and Network Scenario Comparison, clarified Location Strategy distance/cost wording, and updated the current-facility and candidate-warehouse templates and samples with amount-specific currency columns. Official-template recognition accepts both these new headers and the legacy generic `Currency` layouts. The historical-shipment template and sample retain current-main record type, customer grouping, counts and generic-currency fallback because the preserved replacement changed business meaning. The duplicate-file guard, per-run FX fallback and current positional reporting contracts remain unchanged. The new project currency form was converted losslessly from UTF-16 to UTF-8 after the production build identified the preserved encoding.

Validation results:

- Focused Vitest: 474 passed across `tests/supply-chain-design.test.ts` and `tests/supply-chain-design-foundations.test.ts`.
- Prisma schema validation: passed with synthetic localhost `DATABASE_URL`.
- Prisma Client generation: passed with the same synthetic URL after the sandbox initially blocked the engine subprocess with `spawn EPERM`.
- Full TypeScript typecheck: passed.
- Full repository ESLint: passed with zero warnings.
- Production build: passed with the synthetic URL after the sandbox initially blocked compiler subprocesses; no deployment or database connection occurred.
- Full Vitest suite: 2,678 passed, 126 failed, 2 skipped across 267 files. SCDS passed. The failures are outside SCDS and arise from unavailable Windows-host executables (`python3`, `/usr/bin/python3`, `/bin/bash`, `/bin/zsh`), POSIX permission/symlink assumptions, and dependent local-worker setup.
- `git diff --check`: passed. Changed-file UTF-8 scan passed. Protected access, CSV export, scenario reporting and app-shell files remain byte-equivalent to this branch's HEAD.
- Migration review: one additive migration adds non-null `analysisCurrency` with `USD` default and nullable `cadToUsdRate DECIMAL(12,6)`; it matches Prisma and contains no destructive SQL. It was not applied.

During validation, `origin/main` first moved five commits ahead for Website Inbound correspondence. The final preparation fetch found two additional conversation-grouping commits. The task branch was fast-forwarded to `18e3d38d`; all seven commits are now the baseline. Their Website Inbound schema additions are retained, and the working schema diff contains only the two additive SCDS project currency fields.