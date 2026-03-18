> **Audience:** Developers + Operators

# LLM Providers

## Overview

AIOS abstracts LLM access behind a unified `LLMProvider` interface, allowing the engine to call any supported model without knowing provider-specific details. Four provider types are supported: Anthropic (Claude), Ollama, Google Gemini, and OpenAI.

The interface defines two methods:

```typescript
interface LLMProvider {
  complete(system: string, user: string, images?: string[]): Promise<LLMResponse>;
  chat(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>, images?: string[]): Promise<LLMResponse>;
}
```

Both methods accept an optional `images` parameter -- an array of base64-encoded PNG strings. The provider translates these into its native image format before sending the request.

## Provider Table

| Provider | Type | Auth | Vision Format | Source |
|---|---|---|---|---|
| Anthropic (Claude) | `anthropic` | `ANTHROPIC_API_KEY` env var | Multimodal content blocks (`type: "image"`) | `src/agents/provider.ts` |
| Ollama | `ollama` | Optional Bearer token (`apiKey` field) | Native `images` array on the message object | `src/agents/provider.ts` |
| Google Gemini | `gemini` | API key as query parameter | `inlineData` parts with mimeType + data | `src/agents/gemini-provider.ts` |
| OpenAI | `openai` | Bearer token in Authorization header | `image_url` with `data:image/png;base64,...` data URI | `src/agents/openai-provider.ts` |

## Configuration

Providers are configured in `aios.yaml` under the `providers` key. Each entry specifies the type, model, and optional fields for auth, capabilities, and cost.

```yaml
providers:
  claude-sonnet:
    type: anthropic
    model: claude-sonnet-4-20250514
    capabilities: [vision, code]
    cost_per_mtok: 3.0

  ollama-local:
    type: ollama
    model: llama3.2
    endpoint: http://localhost:11434

  gemini-flash:
    type: gemini
    model: gemini-2.0-flash
    apiKey: ${GEMINI_API_KEY}
    capabilities: [vision]
    cost_per_mtok: 0.075

  gpt4o-mini:
    type: openai
    model: gpt-4o-mini
    apiKey: ${OPENAI_API_KEY}
    capabilities: [vision, code]
    cost_per_mtok: 0.15

defaults:
  provider: claude-sonnet
```

Field reference:

- **type** -- One of `anthropic`, `ollama`, `gemini`, `openai`. Determines which class the factory instantiates.
- **model** -- Model identifier passed to the API (e.g. `claude-sonnet-4-20250514`, `gemini-2.0-flash`).
- **endpoint** -- Base URL override. Required for remote Ollama; optional for OpenAI-compatible endpoints.
- **apiKey** -- API key or Bearer token. Required for Gemini and OpenAI. Optional for Ollama. Anthropic reads `ANTHROPIC_API_KEY` from the environment instead.
- **capabilities** -- String array declaring what this provider can do (e.g. `["vision", "code"]`). Used by `ProviderSelector` to match providers to tasks.
- **cost_per_mtok** -- Cost in USD per million input tokens. `0` means free/local. Used by `ProviderSelector` to rank providers.

## Cost-Based Provider Selection

The `ProviderSelector` class (`src/agents/provider-selector.ts`) picks the cheapest available provider for a given capability. The selection algorithm:

1. **Filter** -- Keep only providers whose `capabilities` array includes the requested capability.
2. **Filter** -- Skip providers without a configured `apiKey`, except Ollama (which may run without auth).
3. **Sort** -- Order remaining candidates by `cost_per_mtok` ascending.
4. **Return** -- The first (cheapest) candidate, or `undefined` if none qualify.

For a typical setup with all four providers configured, the vision chain looks like:

```
Ollama (0) --> Gemini Flash (0.075) --> GPT-4o-mini (0.15) --> Claude Sonnet (3.0)
```

Providers whose API key is not set in the config are silently skipped. This means you can list all providers in `aios.yaml` and only activate the ones you have keys for.

## Vision Support

Images flow through the system in a specific pipeline:

1. **MCP tool step** -- An upstream step (e.g. a PDF-to-image tool) produces file paths as output.
2. **Engine collectImages()** -- The DAG engine's `collectImages()` method reads those file paths from upstream `StepResult` outputs, loads each file from disk, and encodes it as a base64 PNG string.
3. **Provider selection** -- If images are present, the engine uses `ProviderSelector.select("vision")` to find the cheapest vision-capable provider, overriding the default provider for that step.
4. **Native format** -- The selected provider converts the base64 strings into its API-specific format:
   - **Anthropic**: `{ type: "image", source: { type: "base64", media_type: "image/png", data } }`
   - **Ollama**: Plain base64 strings in an `images` array on the message
   - **Gemini**: `{ inlineData: { mimeType: "image/png", data } }`
   - **OpenAI**: `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }`

Images are always attached to the first user message in both `complete()` and `chat()` calls.

## Adding a New Provider

To add a provider (e.g. Mistral, Cohere):

1. **Implement `LLMProvider`** -- Create a new file in `src/agents/` (e.g. `mistral-provider.ts`). Implement the `complete()` and `chat()` methods with the vendor's API format.

2. **Register in the factory** -- In `src/agents/provider.ts`, import your class and add a case to the `createProvider()` switch:
   ```typescript
   case "mistral":
     return new MistralProvider(config.model, config.apiKey!);
   ```

3. **Update the type union** -- In `src/types.ts`, add the new type string to `ProviderConfig.type`:
   ```typescript
   type: "anthropic" | "ollama" | "gemini" | "openai" | "mistral";
   ```

4. **Configure in aios.yaml** -- Add an entry with the appropriate capabilities and cost.

## Ollama Setup

### Local install

Run Ollama on the same machine. No auth required.

```yaml
providers:
  ollama-local:
    type: ollama
    model: llama3.2
    # endpoint defaults to http://localhost:11434
```

Start Ollama and pull the model:

```bash
ollama serve &
ollama pull llama3.2
```

### Remote with Bearer auth

For a shared GPU server behind an auth proxy, set the `endpoint` and `apiKey` fields:

```yaml
providers:
  ollama-gpu:
    type: ollama
    model: llama3.2:70b
    endpoint: https://gpu-server.internal:11434
    apiKey: ${OLLAMA_BEARER_TOKEN}
    capabilities: [vision]
    cost_per_mtok: 0
```

The `apiKey` value is sent as a `Bearer` token in the `Authorization` header on every request. If the field is omitted, no auth header is sent.

### Vision models on Ollama

Ollama supports multimodal models like `llava` or `llama3.2-vision`. Add `vision` to the capabilities list to make the model eligible for vision tasks via `ProviderSelector`:

```yaml
providers:
  ollama-vision:
    type: ollama
    model: llava:13b
    capabilities: [vision]
    cost_per_mtok: 0
```

Since Ollama's cost is 0, it will always be preferred over cloud providers for vision tasks when available.
