# Chat system

> Evidence status: Confirmed from code unless otherwise marked.


AI support is implemented through the Company Assistant module in `src/modules/assistant` with persistent chat, runs, retrieved sources, knowledge documents/chunks, memory, mailbox sync state, and automations in `prisma/schema.prisma`. External model execution is centralized in `src/server/integrations/assistant-provider.ts`; OpenAI and local LLM are supported provider kinds.

## Chat flow

```mermaid
flowchart LR
  User[User message] --> Page[`src/app/(authenticated)/assistant/page.tsx`]
  Page --> Action[`src/modules/assistant/actions.ts`]
  Action --> Runtime[`runAssistantPrompt`]
  Runtime --> Tools[Rate, shipment documents, Apollo deterministic tools]
  Runtime --> Knowledge[`searchAssistantKnowledge`]
  Runtime --> Provider[`generateAssistantReply`]
  Provider --> Persist[AssistantChatMessage / AssistantRun / sources]
```

Available tool-like workflows are rate tools (`rate-tools.ts`, `rate-workflow.ts`), Apollo activity (`apollo-workflow.ts`), shipment documents (`shipment-documents-workflow.ts`), knowledge sync (`knowledge-sync.ts`), Microsoft Graph sync (`microsoft-graph-sync.ts`), and automations (`automations.ts`). Provider settings default to OpenAI `gpt-5-mini` with fallback `gpt-5-nano` but live responses are disabled unless integration settings and runtime env are ready.

## Tests and gaps

Tests named `tests/assistant-*.test.ts`, `tests/openai-integration.test.ts`, and `tests/assistant-provider.test.ts` cover deterministic runtime, provider parsing, automations, knowledge, Microsoft sync, and module workflows. Missing coverage requiring confirmation includes employee-facing factuality evaluations, cost budgets, latency SLOs, and approved tool allowlists per tenant.
