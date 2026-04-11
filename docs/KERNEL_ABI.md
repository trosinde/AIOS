# AIOS Kernel ABI v0 – Stabilitätsvertrag

> **Status:** Draft (Phase 0)
> **ABI-Version:** 0 (unstable → wird 1 mit Phase 1)
> **Ziel:** Definiert welche Interfaces und Datenstrukturen als **kernel-stable** gelten. Änderungen an kernel-stable Elementen erfordern Major-Version-Bump und Migrations-Guide.

---

## 1. Was bedeutet "kernel-stable"?

Ein Interface ist **kernel-stable**, wenn:
- Es von User-Space-Code (Patterns, Personas, Contexts) direkt referenziert wird
- Änderungen daran bestehende Patterns/Personas brechen würden
- Es als **Mechanism** (nicht Policy) klassifiziert ist

Stabilitätsgarantie:
- **Keine Breaking Changes** ohne Major-Version-Bump (`kernel_abi: 1` → `kernel_abi: 2`)
- **Additive Erweiterungen** sind erlaubt (neue optionale Felder)
- **Deprecation** mindestens eine Minor-Version vor Entfernung

---

## 2. Pattern Frontmatter ABI

### 2.1 Kernel-stable Felder (PFLICHT)

Diese Felder werden vom Pattern-Loader (`core/registry.ts`) validiert. Jedes Pattern MUSS sie setzen.

```yaml
kernel_abi: 1          # Integer. Gibt an gegen welche Kernel-ABI-Version das Pattern gebaut ist.
                       # Loader gibt Warning wenn fehlt, Error wenn inkompatibel.
name: string           # Eindeutig, snake_case. Wird als Key in der Registry verwendet.
input_type: string     # Semantischer Typ des Inputs (z.B. "text", "code", "requirements")
output_type: string    # Semantischer Typ des Outputs
```

### 2.2 Kernel-bekannte Felder (optional, stabil)

Diese Felder werden vom Kernel gelesen und interpretiert, müssen aber nicht gesetzt sein:

```yaml
description: string              # Menschenlesbare Beschreibung
category: string                 # Gruppierung für Katalog (z.B. "analyze", "generate")
tags: string[]                   # Für Router-Matching
type: "llm" | "tool" | "mcp" | "rag" | "image_generation"  # Default: "llm"
can_follow: string[]             # Workflow-Hints: darf nach diesen Patterns folgen
can_precede: string[]            # Workflow-Hints: darf vor diesen Patterns stehen
parallelizable_with: string[]    # Kann parallel zu diesen Patterns laufen
```

### 2.3 User-Space-Felder (nicht kernel-stable)

Diese Felder dürfen sich ändern ohne den Kernel zu brechen. Der Kernel leitet sie durch, interpretiert sie aber nicht:

```yaml
persona: string                  # Zuordnung zu einer Persona (User-Space-Konzept)
domain_tags: string[]            # Für Context-Routing (Phase 4)
compliance_tags: string[]        # Regulatorische Tags (User-Space-Policy)
preferred_provider: string       # Bevorzugter LLM-Provider
```

### 2.4 Tool-Pattern-Felder (kernel-stable für type: "tool")

```yaml
tool: string                     # CLI-Befehl (z.B. "mmdc")
tool_args: string[]              # Args-Template: ["$INPUT", "-o", "$OUTPUT"]
input_format: string             # Erwartetes Format (z.B. "mermaid")
output_format: string[]          # Mögliche Outputs (z.B. ["svg", "png"])
```

### 2.5 MCP-Pattern-Felder (kernel-stable für type: "mcp")

```yaml
mcp_server: string               # Server-Name aus Config
mcp_tool: string                 # Original MCP-Tool-Name
mcp_input_schema: object         # JSON Schema für Tool-Args
```

---

## 3. TypeScript Interfaces (kernel-stable)

### 3.1 ExecutionContext (NEU – einzuführen in Phase 1)

```typescript
// src/types.ts
interface ExecutionContext {
  trace_id: string;      // UUID v4, vom Kernel vergeben bei Workflow-Start
  context_id: string;    // Aktiver User-Space-Kontext (default: "default")
  started_at: number;    // Unix timestamp in Millisekunden
}
```

**Stabilitätsregeln:**
- Felder dürfen NIE entfernt werden
- Neue Felder MÜSSEN optional sein
- `trace_id` wird vom Kernel erzeugt, nie vom User-Space

### 3.2 LLMProvider Interface

```typescript
// src/agents/provider.ts
interface LLMProvider {
  complete(system: string, user: string, ctx: ExecutionContext): Promise<LLMResponse>;
  chat(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>, ctx: ExecutionContext): Promise<LLMResponse>;
}
```

**Aktueller Stand:** `complete()` und `chat()` haben noch keinen `ExecutionContext`-Parameter. Wird in Phase 1 hinzugefügt.

**Migration Phase 1:**
1. `ExecutionContext` als optionalen letzten Parameter hinzufügen
2. Engine erzeugt `ExecutionContext` und gibt ihn an Provider weiter
3. Provider leitet `trace_id` an Logging weiter

### 3.3 LLMResponse

```typescript
// src/types.ts
interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: { input: number; output: number };
  images?: Array<{ mimeType: string; data: string }>;
}
```

### 3.4 PatternMeta

```typescript
// src/types.ts – kernel-stable Teilmenge
interface PatternMeta {
  name: string;              // kernel-stable
  input_type: string;        // kernel-stable
  output_type: string;       // kernel-stable
  description: string;       // kernel-stable
  category: string;          // kernel-stable
  tags: string[];            // kernel-stable
  type?: "llm" | "tool" | "mcp" | "rag" | "image_generation";  // kernel-stable
  // ... weitere Felder siehe types.ts
}
```

### 3.5 ExecutionPlan & ExecutionStep

```typescript
// src/types.ts
interface ExecutionStep {
  id: string;                // kernel-stable
  pattern: string;           // kernel-stable (referenziert Pattern by name)
  depends_on: string[];      // kernel-stable (DAG-Kanten)
  input_from: string[];      // kernel-stable ("$USER_INPUT" oder step-IDs)
  // retry, quality_gate, compensate: kernel-stable Struktur
}

interface ExecutionPlan {
  plan: {
    type: "pipe" | "scatter_gather" | "dag" | "saga";  // kernel-stable
    steps: ExecutionStep[];
  };
  analysis: { /* ... */ };
  reasoning: string;
}
```

### 3.6 StepResult & WorkflowResult

```typescript
interface StepResult {
  stepId: string;            // kernel-stable
  pattern: string;           // kernel-stable
  output: string;            // kernel-stable
  outputType: "text" | "file";  // kernel-stable
  durationMs: number;        // kernel-stable
  filePath?: string;
  filePaths?: string[];
}

interface WorkflowResult {
  plan: ExecutionPlan;
  results: Map<string, StepResult>;
  status: Map<string, StepStatus>;
  totalDurationMs: number;
}
```

---

## 4. Kernel-Komponenten und ihre Stabilität

| Komponente | Datei | Stabilität | Beschreibung |
|---|---|---|---|
| Pattern Registry | `core/registry.ts` | kernel-stable API | `get()`, `list()`, `all()`, `buildCatalog()` |
| Pattern Loader | `core/registry.ts` | kernel-internal | Kann refactored werden, solange API stabil bleibt |
| Router | `core/router.ts` | kernel-stable Output | Muss `ExecutionPlan` produzieren |
| Engine | `core/engine.ts` | kernel-stable Contract | `execute(plan, input)` → `WorkflowResult` |
| Provider Factory | `agents/provider.ts` | kernel-stable Interface | `LLMProvider` + `createProvider()` |
| Knowledge Bus | `core/knowledge-bus.ts` | kernel-stable API (v1.1, async) | `publish/query/search/byTrace/stats/delete` + additive `semanticSearch/checkDuplicate/publishMany/listTaxonomy/kgAdd/kgQuery/diaryWrite/diaryRead` |

### 4.1 Knowledge Bus v1.1 — async API

Phase 4c migrated `KnowledgeBus` from a synchronous `better-sqlite3` backend to an asynchronous LanceDB backend. This is a **minor** ABI bump:

- **Signature change:** `publish`, `query`, `search`, `byTrace`, `stats`, `delete`, `close` now return `Promise<...>`. All call sites must be `await`-ed.
- **Constructor change:** the synchronous `new KnowledgeBus(path)` is replaced by `await KnowledgeBus.create(dir, embeddingProvider?)`. The path argument is now a directory, not a single file.
- **Additive methods (no break):** `semanticSearch`, `checkDuplicate`, `publishMany`, `listTaxonomy`, `kgAdd`, `kgQuery`, `diaryWrite`, `diaryRead`, `ensureVectorIndex`.
- **Additive `KernelMessage` fields:** `wing?: string`, `room?: string`. Existing publishers that don't set them remain valid.
- **Additive `KnowledgeType` values:** `finding`, `pattern`, `lesson`, `diary` (in addition to the four pre-existing `decision`, `fact`, `requirement`, `artifact`).
- **No removal:** every method that existed in the previous version still exists.

Patterns that depended on synchronous behavior need to await the new async methods. There are no known external consumers of the old sync API; internal AIOS consumers (`quality/pipeline.ts`, `cli.ts knowledge` commands) were migrated in the same change.

For the full reference, see [KNOWLEDGE_BUS.md](./KNOWLEDGE_BUS.md).

---

## 5. Versionierung

### ABI-Versionsnummer

```
kernel_abi: <major>
```

- **Major = 0:** Aktuell. Alles ist instabil, Änderungen erlaubt.
- **Major = 1:** Erster stabiler Vertrag (Phase 1 abgeschlossen). Breaking Changes nur mit `kernel_abi: 2`.

### Kompatibilitätsmatrix

| Pattern `kernel_abi` | Kernel unterstützt | Verhalten |
|---|---|---|
| fehlt | 1 | Warning, Pattern wird geladen |
| 1 | 1 | Volle Kompatibilität |
| 1 | 2 | Rückwärtskompatibel, kein Warning |
| 2 | 1 | Error, Pattern wird nicht geladen |

---

## 6. Was NICHT kernel-stable ist

Explizit **nicht** Teil des ABI:
- Interner Aufbau der Engine (Topologischer Sort, Promise-Handling)
- Router-Prompt und -Strategie (wie der Router plant)
- CLI-Flags und -Kommandos (UX, nicht ABI)
- Logging-Format und -Kanäle
- Config-Dateiformat (`aios.config.yaml`)
- Persona-Definitionen und -Trait-Werte (→ siehe PERSONA_TRAITS.md)
- Knowledge-Base-Schema-Internals (→ siehe KNOWLEDGE_BUS.md; die `KernelMessage` *interface* ist stabil, das LanceDB-`messages`-Tabellen-Schema mit Spaltennamen ist es nicht)

---

## 7. Änderungsprozess für kernel-stable Interfaces

1. **Proposal:** Issue mit Label `kernel-abi` erstellen
2. **Impact-Analyse:** Welche Patterns/Personas brechen?
3. **Migration-Guide:** Wie aktualisiert man betroffenen Code?
4. **Implementation:** Code + Tests + Dokumentation
5. **Version-Bump:** `kernel_abi` hochzählen
6. **Deprecation-Period:** Mindestens eine Minor-Version Übergangszeit
