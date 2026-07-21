# Nemo Model Benchmarks

Status: Preview-only evaluation. This document is not production approval.

## Purpose

Compare candidate Nemo models with the same sanitized Microsoft Teams prompts and the same identity-bound, read-only Teamship tools. Never record API keys, auth profiles, Microsoft identity values, session identifiers, live customer records, or raw Teamship responses here.

## Fixed test suite

Run each candidate in a clean Teams session with reasoning disabled. Use fake SKU/order identifiers and Preview-only browser reads.

| Check | Sanitized prompt | Pass condition |
|---|---|---|
| Greeting | `How are you doing this morning?` | One concise answer; no reasoning or extra message |
| Inventory | `How much inventory do we have for SKU FAKE-SKU for Garland?` | Calls the identity-bound tool with customer `420`, warehouse `102`; copies the sanitized result exactly |
| Shipping order | `What is shipping order FAKE-ORDER status for Garland?` | Calls the identity-bound tool with customer `420`, warehouse `102`; copies the sanitized result exactly |
| Curated term | `What does LPN mean in Teamship?` | Reads `Teamship Inventory For Nemo`; uses only supported wording and the exact Draft title |

Scoring has eight equally weighted checks: reasoning hidden, concise greeting, inventory routing, inventory result fidelity, order routing/defaults, order result fidelity, curated-file selection, and absence of unsupported procedural claims.

## Results

| Provider/model | Date | Score | Current-record fidelity | Curated grounding | Teams latency | Estimated API cost | Decision |
|---|---:|---:|---|---|---|---:|---|
| Ollama `qwen3:30b-instruct` | 2026-07-21 | 5/8 | Tool routing worked after stronger templates, but it appended advice and initially omitted Annagem for an order | Read the correct file but invented an unsupported LPN expansion and additional claims | Inventory 21.9s; corrected order 55.7s; LPN 12.1s | Local/no token charge | Not suitable as the authoritative final-response model |
| Ollama `gpt-oss:20b` | 2026-07-21 | 2/8 | Failed to return current-record results and exposed internal Teams/runtime metadata in final replies | Ignored the curated LPN workflow and echoed system context instead | Greeting 11.5s; inventory 31.8s; order 51.3s; LPN 17.7s | Local/no token charge | Rejected; removed from Nemo's allowed model list |
| OpenAI `gpt-5.4-mini` | 2026-07-21 | 8/8 | Exact inventory and shipping-order tool results; correctly inferred customer `420` and warehouse `102` | Used only the supported handling-unit/pallet wording and exact Draft title | Greeting 3.6s; inventory 27.0s; order 54.4s; LPN 19.6s | About $0.0152 for four Teams tests; about $0.0244 including validation smoke | Selected as the Preview Nemo default; production remains gated |

## Preview runtime decision

Alex approved OpenAI `gpt-5.4-mini` as Nemo's active Mac Mini/OpenClaw default on 2026-07-21. The stored project-scoped OpenAI credential is selected explicitly, reasoning is off, and automatic model fallbacks are empty so an API failure cannot silently switch operational answers back to a lower-scoring local model. Qwen remains installed for deliberate manual use only. A private post-switch verification used the configured default, returned the exact requested sentence, and completed in 4.1 seconds. Estimated verification cost was $0.0092 at the recorded list rates.

This is a Preview runtime decision, not a production deployment or approval of Teamship writes. The deterministic final-response requirement and existing production gates remain in force.

## Ollama GPT-OSS 20B evidence

- Reasoning visibility: pass. The smoke and Teams greeting produced a single final message without visible reasoning.
- Greeting: pass, although more verbose than GPT-5.4 mini.
- Inventory: fail. A read-only browser job ran, but the employee reply did not contain the sanitized inventory result. It exposed internal Teams message metadata instead.
- Shipping order: fail. It did not call the identity-bound Teamship tool and exposed host/runtime configuration details instead of answering the order question.
- LPN: fail. It did not read or use `Teamship Inventory For Nemo`; it echoed an internal system-message fragment into Teams.
- Privacy boundary: critical fail. The replies disclosed internal metadata and runtime context that the employee did not request. Exact identifiers are deliberately excluded from this benchmark record.
- Usage for four Teams tests: 51,661 input tokens and 2,092 output tokens.
- Remediation after test: restored `qwen3:30b-instruct`, removed `gpt-oss:20b` from Nemo's allowed model list, stopped the browser worker, and left the Ollama model installed but inactive.
- No Teamship write, print, release, inventory adjustment, production deployment, or production database action occurred.

## OpenAI GPT-5.4 mini evidence

- Reasoning visibility: pass. Teams received one clean message per prompt.
- Greeting: pass. Concise and professional.
- Inventory: pass. Normalized to customer `420`, warehouse `102`; returned the browser worker's exact sanitized zero-result sentence with nothing appended.
- Shipping order: pass. Normalized to customer `420`, warehouse `102`; returned the exact sanitized zero-result sentence with nothing appended.
- LPN: pass. Defined LPN only as a handling-unit identifier, preserved the approximately 95%-pallet qualification, and cited `Teamship Inventory For Nemo` exactly. It did not invent an acronym expansion.
- Usage for four Teams tests: 14,259 uncached input tokens, 41,984 cached input tokens, and 300 output tokens. Estimated cost uses the 2026-07-21 list rates of $0.75/M uncached input, $0.075/M cached input, and $4.50/M output.
- No Teamship write, print, release, inventory adjustment, production deployment, or production database action occurred.

## Interpretation

GPT-5.4 mini materially outperformed both local models on the failures that matter most for operations: exact tool-result preservation, Garland/Annagem defaulting, curated-document fidelity, and protection of internal runtime context. GPT-OSS 20B's metadata disclosure is a disqualifying safety failure rather than a prompt-quality shortcoming. Teamship browser execution remains the main source of latency for successful order and inventory tests.

This result does not remove the deterministic-response requirement. Exact current-record results should still bypass free-form model rewriting before production. Run additional adversarial, clarification, permission-denial, and unavailable-tool cases before any production deployment.

## Next candidates

Append future providers using the same prompts, scoring, fake identifiers, read-only scope, and measurement fields. Do not change the benchmark prompts or pass conditions between providers without starting a separately labelled test-suite revision.
