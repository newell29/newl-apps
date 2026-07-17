# Basic Local LLM Setup

This first-stage integration connects the Company Assistant directly to an OpenAI-compatible model endpoint. It does not add the outbound job worker yet.

## Local development

Run Ollama on the same machine as Newl Apps and confirm the endpoint:

```bash
curl -sS http://127.0.0.1:11434/v1/models
```

In tenant Settings > Assistant AI, save:

- Provider: `Local LLM`
- Endpoint: `http://127.0.0.1:11434/v1`
- Default model: `qwen3:30b`
- Fallback model: `gpt-oss:20b`
- Reasoning effort: `None / fastest`
- Temperature: `0.2`
- Max tokens: `1200`
- Bearer token: blank for loopback Ollama

Select **Test local model** after saving. A successful test discovers the configured model and runs a short grounded completion.

## Deployed Newl Apps

A deployed Newl Apps server cannot call the Mac mini through `127.0.0.1`. Before enabling live replies in production, put the model behind an authenticated HTTPS relay or tunnel.

Production safeguards require:

1. An HTTPS endpoint ending in `/v1`.
2. Bearer-token authentication at the relay.
3. The relay hostname in the deployment environment:

```bash
ASSISTANT_LOCAL_LLM_ALLOWED_HOSTS=your-authenticated-llm-host.example.com
```

4. The bearer token saved in tenant Settings. Newl Apps encrypts it into `IntegrationCredential.secretRef`; it is not stored in public configuration.

Do not port-forward Ollama or expose port `11434` directly to the internet.

## Expected behavior

- Model discovery uses `GET /v1/models`.
- Assistant replies use `POST /v1/chat/completions`.
- Requests time out after 90 seconds.
- Empty responses caused by an exhausted token budget produce a clear error.
- Provider errors use the existing deterministic assistant fallback.
- Each tenant resolves its own provider record, endpoint, and encrypted bearer token.

The later outbound-worker design remains an option if Newl needs private-network-only inference, durable queues, or higher availability.
