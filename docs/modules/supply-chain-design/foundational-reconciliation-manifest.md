# Foundational SCDS reconciliation

Source: Desktop `newl-apps-f4-preservation-2026-09-18`, tracked patch based on
`855e490d`; target baseline `6ea5b11d` on `codex/scds-reconcile`.
The committed backbone is already in the target ancestry; no commits are replayed.

## Exact file and hunk allowlist

| File | Allowed change |
| --- | --- |
| `prisma/schema.prisma` | Only `SupplyChainDesignProject.analysisCurrency` and `cadToUsdRate`; preserved patch hunk `-912,6 +912,8`. |
| `prisma/migrations/20260812120000_add_scds_project_currency_settings/migration.sql` | Preserved additive two-column SQL source only; never execute during this phase. |
| `src/modules/supply-chain-design/currency.ts` | Preserved new helper, including USD/CAD parsing, fixed-direction conversion, snapshots and formatting. |
| `src/modules/supply-chain-design/weight-units.ts` | Preserved new alias and kg-to-lb helper. |
| `src/modules/supply-chain-design/ltl-physical-normalization.ts` | Preserved new pounds/inches, per-piece weight and class helper; additionally reject invalid physical quantities before division. |
| `src/modules/supply-chain-design/types.ts` | Only project-summary currency/rate fields (`-29,6 +29,8`); no result DTO expansion. |
| `src/modules/supply-chain-design/queries.ts` | Only project list/detail currency/rate projection (`-124,6 +125,8`, `-221,6 +224,8`), with null-safe legacy fixture fallback. |
| `src/modules/supply-chain-design/actions.ts` | Currency-helper import and only `updateSupplyChainDesignProjectCurrencySettingsAction` from hunk `-356,6 +561,60`; reconcile update plus audit transactionally. Existing actions stay intact. |
| `src/modules/supply-chain-design/components/project-currency-settings-form.tsx` | Dedicated settings form with visible success/error and pending state; avoids importing the mixed preserved page hunk. |
| `src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx` | Only import/render the settings form in Project Data; no reporting or layout replacement. |
| `src/modules/supply-chain-design/candidate-ltl-rate-preparation.ts` | Only physical-helper imports, shared unit alias resolution, normalized pounds/inches pieces with per-piece weight and US UOM, freight-class delegation, preparation version invalidation, and a physical-version discriminator in the request key. Preserve source amounts, represented-shipment logic, hazmat gates and request lineage. This manually extracts the physical behavior from mixed hunks beginning `-268,104 +316,120`, `-546,59 +633,87`, `-609,8 +724,8`, `-660,16 +775,15`. |
| `tests/supply-chain-design.test.ts` | Currency-action transactional mock and authorization/validation/tenant/audit tests; physical integration regressions only affected request assertions, and the compatible batch fixture plus legacy-physical rejection test. No wholesale preserved test patch. |
| `tests/supply-chain-design-foundations.test.ts` | Focused helper conversion, aliases, missing/unsupported evidence and invalid-quantity regression coverage. |
| `docs/modules/supply-chain-design/overview.md` | Describe the implemented foundation and the monetary-workflow integration boundary. |
| `docs/modules/supply-chain-design/foundational-reconciliation-manifest.md` | This manifest and verification boundary. |

## Explicit exclusions and compatibility

No new mapping fields are needed for settings or physical normalization: existing
weight/dimension mappings already provide their inputs. New amount-specific currency
mappings, actual monetary-workflow FX integration, result snapshots, baseline weight
conversion, warehouse economics, batch reuse/freshness, orchestration, reporting,
sample/template changes and UI restructuring remain later phases. Saving project
settings does not yet change the existing monetary calculations or saved results.

Exclude file replacement/reset/invalidation, the obsolete duplicate `project-page.tsx`,
generated output ZIPs, packaging, unrelated migrations, TMS Bridge, TradeMining,
invoice work, proof scripts, screenshots, `data/` and `Skills/` content.

Retain current-main tenant filtering, module/role/mutation guards, transactional
deletion audits, referenced-evidence protection, CSV escaping, navigation and all
unrelated modules. Schema changes are additive; no shared file is replaced.

## Verification boundary

Use hermetic mocked SCDS tests, Prisma validation/generation with a synthetic
localhost URL, and TypeScript checking. No database connections, migration execution,
live rating, commit, push, merge or deployment. Preview validation is deferred.

## Completed phase validation (2026-09-18)

- `npm ci --ignore-scripts --no-audit --no-fund`: installed locked local dependencies; dependency manifests unchanged.
- `node node_modules/prisma/build/index.js validate`: passed with a synthetic localhost DATABASE_URL.
- `node node_modules/prisma/build/index.js generate`: passed with the same synthetic URL after sandbox subprocess EPERM required an approved rerun.
- `npx vitest run tests/supply-chain-design.test.ts tests/supply-chain-design-foundations.test.ts --maxWorkers=1 --minWorkers=1`: final run passed, 442 tests (409 existing/extended SCDS, 33 new helper tests). Sandbox esbuild EPERM required approved subprocess access.
- `node node_modules/typescript/lib/tsc.js --noEmit --incremental false`: passed.
- Changed-file ESLint via `node node_modules/eslint/bin/eslint.js <11 changed TS/TSX paths> --max-warnings=0`: passed.
- `git diff --check`: passed. Static schema/SQL agreement and preserved-byte checks passed.
- Allowlist audit: 15 files, 8 modified and 7 new. Navigation, seed, dependency manifests, access helper and CSV consumers are unchanged. Existing project/file/mapping deletion action bodies match HEAD.

Initial test failures were introduced fixture issues: compatible batch fixtures
still used total-weight pieces, a new project fixture lacked included collections,
and an unused queued mock response leaked into a later test. These were fixed;
the final run has no failures. No pristine-baseline or full repository suite was
run, so this phase makes no claim about broader pre-existing failures.

Full build, full repository suite and Vercel Preview validation remain later-phase
work. No Preview URL exists. No migration was applied or database contacted.
