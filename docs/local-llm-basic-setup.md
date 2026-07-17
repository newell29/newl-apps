# Basic Local LLM Setup

This first-stage integration connects the Company Assistant directly to an OpenAI-compatible model endpoint. It does not add the outbound job worker yet.

## Local development

Run Ollama on the same machine as Newl Apps and confirm the endpoint:

```bash
curl -sS http://127.0.0.1:11434/v1/models
```

After this PR is merged, update the Mac mini checkout from `main`:

```bash
git switch main
npm run sync:main
```

For normal local startup, use this command so the checkout is updated before the app starts:

```bash
npm run dev:fresh
```

The sync command only updates a clean `main` checkout. If you are on a feature branch or have uncommitted changes, it stops and tells you what to fix instead of changing your work in place.

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

## Basic Mac mini relay with ngrok

Run the relay on the Mac mini. It binds to `127.0.0.1` and requires a bearer token before forwarding the limited OpenAI-compatible routes to Ollama:

```bash
cd ~/Developer/newl-apps
export LOCAL_LLM_RELAY_TOKEN="$(openssl rand -hex 32)"
echo "$LOCAL_LLM_RELAY_TOKEN"
npm run relay:local-llm
```

In a second terminal, expose the relay over HTTPS with ngrok:

```bash
brew install ngrok
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
ngrok http 41134
```

Use the ngrok `https://...ngrok.app` forwarding URL as the Vercel endpoint, with `/v1` appended. For example:

```bash
https://your-ngrok-host.ngrok.app/v1
```

In Vercel, add the host without protocol or path:

```bash
ASSISTANT_LOCAL_LLM_ALLOWED_HOSTS=your-ngrok-host.ngrok.app
```

Redeploy Vercel after saving the environment variable.

In deployed Newl Apps Settings > Assistant AI, save:

- Provider: `Local LLM`
- Endpoint: `https://your-ngrok-host.ngrok.app/v1`
- Default model: `qwen3:30b`
- Fallback model: `gpt-oss:20b`
- Reasoning effort: `None / fastest`
- Temperature: `0.2`
- Max tokens: `1200`
- Bearer token: the `LOCAL_LLM_RELAY_TOKEN` value printed by the Mac mini
- Live assistant replies: enabled

Select **Test local model**. If the test passes, the deployed app can reach the Mac mini through the authenticated tunnel.

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
