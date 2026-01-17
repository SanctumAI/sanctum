# Maple API (Maple Proxy) — OpenAI-Compatible Encrypted LLMs

## Index

- [Overview](#overview)
- [Setup](#setup)
  - [Desktop app (fast local dev)](#desktop-app-fast-local-dev)
  - [Docker (server or CI)](#docker-server-or-ci)
- [Beginner usage](#beginner-usage)
  - [List models](#list-models)
  - [Chat completions (streaming)](#chat-completions-streaming)
- [Pro usage](#pro-usage)
  - [Production Docker Compose](#production-docker-compose)
  - [LangChain or LlamaIndex](#langchain-or-llamaindex)
  - [Goose integration](#goose-integration)
  - [Health and monitoring](#health-and-monitoring)
  - [API surface](#api-surface)
- [Cost savings guide](#cost-savings-guide)
- [Privacy guide](#privacy-guide)
- [Security guide](#security-guide)
- [Troubleshooting](#troubleshooting)
- [Quick reference](#quick-reference)
- [Sources](#sources)

## Overview

Maple Proxy is Maple AI’s **OpenAI-compatible** gateway to its **end-to-end encrypted** LLMs. Swap the OpenAI base URL for Maple’s proxy and keep the rest of your client code unchanged. Inference runs inside hardware TEEs with attestation and no clear-text logs. ([Maple AI Blog][1])

**Best when you need**

- Minimal code changes from an existing OpenAI client or SDK. ([Maple AI Blog][1])
- Hardware-isolated inference for sensitive prompts/outputs (code, PHI/PII, internal docs). ([Maple AI Blog][1])
- Compatibility with OpenAI-style tools (LangChain, LlamaIndex, Goose, Open Interpreter, Jan, etc.) via a custom `base_url`. ([Maple AI Blog][2])
- Streaming responses; the proxy currently supports streaming-only chat completions. ([GitHub][3])

---

## Setup

### Desktop app (fast local dev)

- Install the Maple desktop app from `trymaple.ai/downloads` and sign in. ([Maple AI Blog][2])
- Upgrade to **Pro / Team / Max** and add at least **$10** in API credits. ([Maple AI Blog][1])
- In **API Management → Local Proxy**, click **Start Proxy**. The app starts `http://localhost:8080/v1`, manages attestation, and injects your API key. Point your OpenAI client at that URL. ([Maple AI Blog][2])
- When using the desktop Local Proxy, authentication and attestation are handled by the Maple app, so you do not need to embed your Maple API key directly in scripts or notebooks.

### Docker (server or CI)

```bash
docker pull ghcr.io/opensecretcloud/maple-proxy:latest

docker run -p 8080:8080 \
  -e MAPLE_BACKEND_URL=https://enclave.trymaple.ai \
  -e MAPLE_API_KEY=YOUR_MAPLE_API_KEY \
  ghcr.io/opensecretcloud/maple-proxy:latest
```

- Exposes an OpenAI-compatible endpoint at `http://localhost:8080/v1`. ([Maple AI Blog][1])
- Do **not** bake a shared `MAPLE_API_KEY` into multi-tenant deployments; require per-user keys. ([Maple AI Blog][1])
- Key server-side env vars: `MAPLE_HOST` (default `127.0.0.1`), `MAPLE_PORT` (default `8080`), `MAPLE_BACKEND_URL` (prod: `https://enclave.trymaple.ai`), `MAPLE_ENABLE_CORS` (`true` to allow browser apps), `RUST_LOG` / `MAPLE_DEBUG` (logging). ([GitHub][3])

---

## Beginner usage

### List models

```bash
curl http://localhost:8080/v1/models \
  -H "Authorization: Bearer YOUR_MAPLE_API_KEY"
```

Returns the current Maple catalog (examples at launch: `llama-3.3-70b`, `gpt-oss-120b`, `deepseek-r1-0528`, `mistral-small-3-1-24b`, `qwen2-5-72b`, `qwen3-coder-480b`, plus an image model). These examples may change over time—always check `/v1/models` for the live list. ([Maple AI Blog][2])

### Chat completions (streaming)

Maple Proxy streams responses only—set `stream: true` (or the SDK equivalent) and read chunks. ([GitHub][3])

**cURL**

```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer YOUR_MAPLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.3-70b",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Write a haiku about privacy."}
    ],
    "stream": true
  }'
```

**Python (openai SDK)**

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="YOUR_MAPLE_API_KEY"  # desktop app may inject automatically
)

resp = client.chat.completions.create(
    model="qwen3-coder-480b",
    messages=[{"role": "user", "content": "Write a Python function to title-case strings."}],
    stream=True,
)
for chunk in resp:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="")
```

**Node/TypeScript**

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8080/v1",
  apiKey: process.env.MAPLE_API_KEY,
});

const stream = await client.chat.completions.create({
  model: "deepseek-r1-0528",
  messages: [{ role: "user", content: "Solve step-by-step: 25 * 4 + 10" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

---

## Pro usage

### Production Docker Compose

```yaml
version: "3.8"
services:
  maple-proxy:
    image: ghcr.io/opensecretcloud/maple-proxy:latest
    container_name: maple-proxy
    ports:
      - "8080:8080"
    environment:
      - MAPLE_BACKEND_URL=https://enclave.trymaple.ai
      - MAPLE_ENABLE_CORS=true
      - RUST_LOG=info
      # Do not set MAPLE_API_KEY in multi-tenant deployments.
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 3s
      retries: 3
```

### LangChain or LlamaIndex

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="llama-3.3-70b",
    base_url="http://localhost:8080/v1",
    api_key="YOUR_MAPLE_API_KEY",
    streaming=True,
)
```

Any OpenAI-compatible library works the same way: set `base_url` (or `api_base`) to the Maple proxy. ([Maple AI Blog][2])

### Goose integration

- In the UI: `goose configure` → **Configure Providers** → **OpenAI** → Host `http://localhost:8080`, Base Path `/v1`. ([Block][4])
- Env vars: newer Goose builds also accept provider host/key env vars (e.g., `GOOSE_PROVIDER__HOST`, `GOOSE_PROVIDER__API_KEY`). Older docs mention `OPENAI_HOST`; prefer the provider UI when available. ([Block][5])

### Health and monitoring

- `GET /health` for liveness.
- Enable `RUST_LOG=info` or `MAPLE_DEBUG=true` for request/stream diagnostics. ([GitHub][3])

### API surface

- Implemented endpoints: `GET /v1/models`, `POST /v1/chat/completions` (SSE streaming).
- Works with most OpenAI-compatible clients that allow a custom `base_url`. ([GitHub][3])
- Some advanced models can include structured reasoning segments inside their responses; treat these as normal message content and post-process or filter them according to your application’s needs.

---

## Cost savings guide

- Typical launch pricing (per Maple’s original announcement): **$4 / million tokens in** and **$4 / million tokens out** for most models; listed vision model at **$10 / million**. Credits are pay-as-you-go starting at **$10**; API access requires a paid plan from **$20/mo**. Treat these as historical figures and check Maple’s current pricing page plus `/v1/models` for up-to-date options. ([Maple AI Blog][1])
- Start with general models (`llama-3.3-70b`, `mistral-small-3-1-24b`) and reserve heavy models (`deepseek-r1-0528`, coder SKUs) for complex tasks. ([Maple AI Blog][1])
- Set `max_tokens`, keep prompts concise, and stream so you can stop early. ([GitHub][3])
- Reuse system prompts/context; batch lower-priority work on cheaper models; route up only on failures.
- Different models support different context window sizes; consult Maple’s model guide or `/v1/models` metadata and choose smaller-context models for short tasks to save tokens.
- Requests are billed against your Maple account’s credits and are subject to per-account rate limits; use your dashboard to monitor usage and adjust traffic patterns.

---

## Privacy guide

- Prompts and outputs are processed inside hardware TEEs with encrypted transport and no clear-text logs, plus attestation of the secure hardware. ([Maple AI Blog][1])
- Avoid sending unnecessary PII/PHI; redact logs; disable verbose payload logging in production clients.
- The desktop proxy handles attestation and local key injection to reduce credential exposure in scripts. ([Maple AI Blog][2])
- Maple states that API prompts and outputs are not used to train models and are not shared with model providers; they are only used to serve your requests.
- Even with end-to-end encryption and TEEs, Maple still records basic usage metadata (like request counts) for billing and reliability, but message content remains encrypted.

---

## Security guide

- Treat `MAPLE_API_KEY` like a password; rotate via the Maple dashboard; never commit to VCS. Use per-user keys in multi-tenant apps. ([Maple AI Blog][2])
- Run behind your ingress/WAF; restrict egress; terminate TLS at your edge.
- Enable `MAPLE_ENABLE_CORS=true` only when browser clients need direct access. ([Maple AI Blog][2])
- Use `/health` for liveness and `RUST_LOG`/`MAPLE_DEBUG` for auditable request logs. ([GitHub][3])
- Maple’s proxy and backend components are open source with reproducible builds, allowing security teams to verify that the code running inside TEEs matches the published source before trusting attestation.

---

## Troubleshooting

- **Client hangs / no output:** ensure `stream: true` and, for cURL, include `-N`; Maple currently streams only. ([GitHub][3])
- **Browser requests blocked:** set `MAPLE_ENABLE_CORS=true` on the proxy or route through your backend. ([Maple AI Blog][2])
- **Model not found:** call `/v1/models` and pick a listed model name. ([Maple AI Blog][2])
- **Proxy health:** hit `GET /health` and check logs with `RUST_LOG=info`. ([GitHub][3])

---

## Quick reference

- Base URL: `http://localhost:8080/v1` (default local proxy). ([Maple AI Blog][2])
- Endpoints: `GET /v1/models`, `POST /v1/chat/completions` (SSE). ([GitHub][3])
- Docker image: `ghcr.io/opensecretcloud/maple-proxy:latest`. ([Maple AI Blog][1])
- Desktop app: auto-starts local proxy and injects API key for local dev. ([Maple AI Blog][2])
- Goose: Host `http://localhost:8080`, Base Path `/v1` via `goose configure` or provider env vars. ([Block][4])

---

## Sources

- [Introducing Maple Proxy][1]
- [Maple Proxy Documentation][2]
- [Maple Proxy GitHub][3]
- [Goose provider config][4]
- [Goose environment variables][5]

[1]: https://blog.trymaple.ai/introducing-maple-proxy-the-maple-ai-api-that-brings-encrypted-llms-to-your-openai-apps/ "Introducing Maple Proxy – the Maple AI API that brings encrypted LLMs to your OpenAI apps"
[2]: https://blog.trymaple.ai/maple-proxy-documentation/ "Maple Proxy Documentation"
[3]: https://github.com/opensecretcloud/maple-proxy "GitHub - OpenSecretCloud/maple-proxy"
[4]: https://block.github.io/goose/docs/getting-started/providers/ "Configure LLM Provider | goose - GitHub Pages"
[5]: https://block.github.io/goose/docs/guides/environment-variables/ "Environment Variables | goose - GitHub Pages"