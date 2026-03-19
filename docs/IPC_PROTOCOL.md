# AIOS IPC Protocol – Agent-zu-Agent-Kommunikation

> **Status:** Draft (Phase 0)
> **Ziel:** Definiert das Message-Format und die API für Kommunikation zwischen Agenten (Personas/Steps) innerhalb und zwischen Kontexten.

---

## 1. Motivation

In einem Multi-Agent-System müssen Agenten Informationen austauschen:

- **Intra-Workflow:** Step A gibt Ergebnisse an Step B weiter (schon implementiert via `input_from`)
- **Intra-Context:** Persona A veröffentlicht Knowledge, Persona B findet es
- **Cross-Context:** Context A sendet eine Nachricht an Context B (z.B. Compliance-Findings → Engineering)

Das IPC Protocol definiert ein einheitliches Message-Format für alle drei Ebenen.

---

## 2. Kommunikationsebenen

```
┌─────────────────────────────────────────────────────┐
│ Ebene 3: Cross-Context IPC                          │
│ Context A ←──Knowledge Bus──→ Context B             │
├─────────────────────────────────────────────────────┤
│ Ebene 2: Intra-Context Knowledge                    │
│ Persona X ──publish──→ Knowledge Base ──query──→ Y  │
├─────────────────────────────────────────────────────┤
│ Ebene 1: Intra-Workflow (bereits implementiert)     │
│ Step A ──input_from──→ Step B                       │
└─────────────────────────────────────────────────────┘
```

### Ebene 1: Intra-Workflow (existiert)

Bereits implementiert über `input_from` in `ExecutionStep`:
```typescript
interface ExecutionStep {
  input_from: string[];  // "$USER_INPUT" oder step-IDs
}
```

Die Engine sammelt Outputs der referenzierten Steps und konkateniert sie als Input. **Keine Änderung nötig.**

### Ebene 2: Intra-Context Knowledge (Phase 3)

Agenten publizieren strukturiertes Wissen in die Knowledge Base. Andere Agenten im selben Context können es abfragen.

### Ebene 3: Cross-Context IPC (Phase 4+)

Nachrichten werden über den Knowledge Bus zwischen Kontexten ausgetauscht, unter Einhaltung der Isolation-Regeln.

---

## 3. Message-Format (kernel-stable)

```typescript
// src/types.ts – einzuführen in Phase 3
interface KernelMessage {
  // Header (kernel-verwaltet)
  id: string;                    // UUID v4
  trace_id: string;              // Aus ExecutionContext
  source_context: string;        // Context-ID des Senders
  target_context: string;        // Context-ID des Empfängers ("*" = broadcast)
  created_at: number;            // Unix timestamp ms

  // Routing
  type: KnowledgeType;           // "decision" | "fact" | "requirement" | "artifact"
  tags: string[];                // Für semantisches Matching
  source_pattern: string;        // Welches Pattern hat die Nachricht erzeugt?
  source_step?: string;          // Optionale Step-ID

  // Payload
  content: string;               // Die eigentliche Nachricht
  format: "text" | "json" | "markdown";  // Content-Format
  metadata?: Record<string, unknown>;     // Erweiterbar
}
```

**Stabilitätsregeln:**
- Header-Felder sind kernel-stable (dürfen nicht entfernt werden)
- `metadata` ist der Erweiterungspunkt für User-Space-Daten
- `type` verwendet den bestehenden `KnowledgeType` aus `types.ts`

---

## 4. Knowledge Bus API (kernel-stable)

```typescript
// src/knowledge/bus.ts – einzuführen in Phase 3
interface KnowledgeBase {
  /**
   * Knowledge-Item veröffentlichen.
   * Wird automatisch mit context_id aus ExecutionContext versehen.
   */
  publish(message: Omit<KernelMessage, "id" | "created_at" | "trace_id" | "source_context">,
          ctx: ExecutionContext): Promise<string>;  // Returns message ID

  /**
   * Knowledge abfragen.
   * Respektiert Context-Isolation: nur Items aus eigenem Context + explizite Cross-Context-Items.
   */
  query(filter: KnowledgeQuery, ctx: ExecutionContext): Promise<KernelMessage[]>;

  /**
   * Semantische Suche (wenn ChromaDB verfügbar).
   * Fallback auf Tag-basierte Suche.
   */
  search(text: string, options: SearchOptions, ctx: ExecutionContext): Promise<KernelMessage[]>;
}

interface KnowledgeQuery {
  type?: KnowledgeType;
  tags?: string[];               // Mindestens ein Tag muss matchen
  source_pattern?: string;
  since?: number;                // Unix timestamp – nur neuere Items
  limit?: number;                // Max Ergebnisse (default: 50)
  include_cross_context?: boolean;  // Cross-Context-Items einschließen (default: false)
}

interface SearchOptions {
  topK?: number;                 // Max Ergebnisse für semantische Suche
  minRelevance?: number;         // Minimaler Relevanz-Score (0-1)
  type?: KnowledgeType;          // Optional: nur bestimmten Typ suchen
}
```

---

## 5. Backends

### 5.1 SQLite (Default, Phase 3)

```sql
CREATE TABLE knowledge (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  source_context TEXT NOT NULL,
  target_context TEXT NOT NULL DEFAULT '*',
  created_at INTEGER NOT NULL,
  type TEXT NOT NULL,
  tags TEXT NOT NULL,              -- JSON array
  source_pattern TEXT NOT NULL,
  source_step TEXT,
  content TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'text',
  metadata TEXT                    -- JSON object
);

-- Context-Isolation-Index
CREATE INDEX idx_knowledge_context ON knowledge(source_context, type);
CREATE INDEX idx_knowledge_tags ON knowledge(tags);
CREATE INDEX idx_knowledge_created ON knowledge(created_at DESC);
```

### 5.2 ChromaDB (Optional, Phase 3)

Für semantische Suche. Wird nur verwendet wenn in `context.yaml` konfiguriert:

```yaml
knowledge:
  backend: chromadb
  chromadb:
    host: localhost
    port: 8000
```

ChromaDB Collections folgen dem Naming-Schema: `aios_{context_id}_{type}`

Beispiel: `aios_dvoi-engineering_requirement`

---

## 6. Cross-Context IPC Regeln

### 6.1 Berechtigungen

```yaml
# In context.yaml
permissions:
  allow_ipc: true                # Grundsätzlich erlaubt
  ipc_targets:                   # Ziel-Contexts (leer = alle)
    - dvoi-engineering
  ipc_sources:                   # Akzeptierte Quellen (leer = alle)
    - personal-projects
```

### 6.2 Nachrichtenfluss

```
Context A                    Knowledge Bus                Context B
    │                             │                           │
    ├── publish(msg, ctx) ──────→ │                           │
    │                             ├── validate permissions    │
    │                             ├── store in DB             │
    │                             │                           │
    │                             │ ←── query(filter, ctx) ───┤
    │                             ├── check isolation rules   │
    │                             ├── return matching msgs ──→│
    │                             │                           │
```

### 6.3 Isolation-Regeln für Queries

```
1. Eigener Context?      → Immer sichtbar
2. target_context = "*"? → Sichtbar (Broadcast)
3. target_context = mein Context? → Sichtbar
4. Sonst                 → Nicht sichtbar
```

---

## 7. Integration mit bestehendem Code

### 7.1 Bestehender KnowledgeItem-Typ

```typescript
// Aktuell in src/types.ts
interface KnowledgeItem {
  id: string;
  type: KnowledgeType;
  content: string;
  source: string;
  tags: string[];
  created_at: string;
  project?: string;
}
```

**Migration (Phase 3):**
- `KnowledgeItem` wird zu `KernelMessage` erweitert (additive Änderung)
- `source` → `source_pattern` (mit Alias für Rückwärtskompatibilität)
- `project` → `source_context` (mit Alias)
- `created_at` bleibt string für Serialisierung, intern number

### 7.2 Integration in Engine

```typescript
// Pseudocode – Phase 3 Implementation
class Engine {
  async executeStep(step: ExecutionStep, ctx: ExecutionContext): Promise<StepResult> {
    const result = await this.provider.complete(system, userInput, ctx);

    // Knowledge automatisch extrahieren und publizieren
    if (this.knowledgeBus) {
      await this.knowledgeBus.publish({
        type: "artifact",
        tags: pattern.meta.tags,
        source_pattern: step.pattern,
        source_step: step.id,
        target_context: ctx.context_id,
        content: result.content,
        format: "markdown",
      }, ctx);
    }

    return result;
  }
}
```

---

## 8. CLI-Integration (Phase 3)

```bash
# Knowledge veröffentlichen (manuell)
aios knowledge publish --type fact --tags "architecture,decision" < input.md

# Knowledge abfragen
aios knowledge query --type requirement --tags "security"

# Semantische Suche
aios knowledge search "Authentifizierung und Session-Management"

# Cross-Context Query
aios knowledge query --type decision --include-cross-context
```

---

## 9. Abgrenzung

**Dieses Dokument definiert:**
- Message-Format für Agent-zu-Agent-Kommunikation
- Knowledge Bus API (publish, query, search)
- Backend-Schema (SQLite, ChromaDB)
- Cross-Context IPC Regeln und Berechtigungen

**Dieses Dokument definiert NICHT:**
- Was für Knowledge gespeichert wird (→ User-Space-Entscheidung)
- Wie Personas Knowledge interpretieren (→ PERSONA_TRAITS.md)
- Wie Context-Isolation funktioniert (→ CONTEXT_MODEL.md)
- Welche Interfaces kernel-stable sind (→ KERNEL_ABI.md)
