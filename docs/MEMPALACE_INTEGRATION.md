# MemPalace Integration

[MemPalace](https://github.com/milla-jovovich/mempalace) liefert AIOS persistentes, sitzungsübergreifendes Gedächtnis. Entscheidungen, Findings und Patterns werden in einer lokalen Wissensbasis (ChromaDB + SQLite) abgelegt und stehen bei zukünftigen Aufgaben als Kontext zur Verfügung.

Die Integration nutzt ausschließlich den bestehenden MCP-Client (`src/core/mcp.ts`) – kein Kernel-Code wurde geändert. Sie besteht aus drei Teilen: MCP-Server-Konfiguration, zwei LLM-Patterns und einem Router-Hinweis.

## Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│ User Task                                                       │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                  ┌───────▼───────┐
                  │    Router     │  plant symmetrische Read- und Write-Chains
                  └───────┬───────┘
                          │
         ┌────────────────┼────────────────────┐
         │                │                    │
         ▼                ▼                    ▼
┌────────────────┐  ┌──────────────┐  ┌────────────────────┐
│ memory_recall  │  │ Haupt-Steps  │  │ memory_store (LLM) │
│ (LLM)          │─►│ (code_review,│─►│ → memory_items[]   │
│ → queries[]    │  │  design, …)  │  └──────┬─────────────┘
└──────┬─────────┘  └──────────────┘         │
       │                   ▲                 ▼
       ▼                   │        ┌──────────────────────┐
┌────────────────────┐     │        │ memory_store_persist │
│ memory_recall_fetch│     │        │ (type: tool, text)   │
│ (type: tool, text) │     │        │ tools/mempalace-     │
│ tools/mempalace-   │─────┘        │   persist.ts         │
│   recall.ts        │              └──────┬───────────────┘
└──────┬─────────────┘                     │
       │  Engine inlined $OUTPUT-Content   │
       │  → nächster Step sieht Kontext    │
       │                                   │
       │ MCP stdio (kurzlebig)             │ MCP stdio (kurzlebig)
       ▼                                   ▼
┌─────────────────────────────────────────────────┐
│            MemPalace MCP Server                 │
│      (python -m mempalace.mcp_server)           │
│      → ChromaDB + SQLite (local)                │
└─────────────────────────────────────────────────┘
       ▲
       │ tools/call (MCP stdio, langlebig)
       │
┌──────┴──────────────────┐
│ McpManager              │
│ (src/core/mcp.ts)       │
│ spawnt mempalace lazy   │
└─────────────────────────┘
```

**Drei parallele MemPalace-Zugriffspfade**, alle via MCP:

1. **Router-Read-Path** – Der langlebige `McpManager` im AIOS-Hauptprozess hält eine persistente MCP-Verbindung. Wird für direkte `mempalace/*` Tool-Calls und Router-Catalog-Discovery genutzt.
2. **Recall-Fetch** (`memory_recall_fetch`) – Tool-Script spawnt kurz einen MemPalace-Prozess, führt die Searches aus, schreibt Markdown nach `$OUTPUT`, terminiert. Die Engine inlined den Datei-Inhalt als Message-Content für nachfolgende Steps.
3. **Store-Persist** (`memory_store_persist`) – Analog: Tool-Script spawnt kurz einen MemPalace-Prozess, schreibt Drawers, terminiert.

Die Tool-Scripts brauchen einen eigenen MCP-Spawn weil Subprozesse keinen Zugriff auf den laufenden `McpManager` im Parent haben. SQLite WAL + lokale ChromaDB vertragen den kurzen parallelen Zugriff; die Persistenz-Latenz ist niedriger als die Dauer eines Haupt-LLM-Calls.

## Setup

### 1. MemPalace installieren

```bash
pip install mempalace
# oder aus Source:
# git clone https://github.com/milla-jovovich/mempalace && cd mempalace && pip install -e .
```

### 2. MemPalace initialisieren

```bash
mempalace init
```

Dies legt den lokalen Speicher an (ChromaDB + SQLite). Standardpfad ist systemabhängig – siehe `mempalace --help`.

### 3. AIOS konfigurieren

`aios.yaml` enthält bereits den MemPalace-Eintrag:

```yaml
mcp:
  servers:
    mempalace:
      command: python
      args: ["-m", "mempalace.mcp_server"]
      category: knowledge
      prefix: mempalace
      description: "MemPalace – Persistentes AI-Gedächtnis (lokal, ChromaDB + SQLite)"
```

Kein API-Key nötig – MemPalace läuft komplett lokal.

### 4. Verifizieren

Nach dem Start von AIOS werden die MemPalace-Tools automatisch entdeckt und als virtuelle Patterns registriert:

```bash
aios patterns list --category knowledge
# Erwartet:
#   memory_recall             (LLM)
#   memory_recall_fetch       (TOOL)
#   memory_store              (LLM)
#   memory_store_persist      (TOOL)
#   mempalace/mempalace_search
#   mempalace/mempalace_add_drawer
#   mempalace/mempalace_check_duplicate
#   mempalace/mempalace_list_wings
#   …
```

Smoke-Tests:

```bash
# Router-Read-Path via McpManager
echo '{"query": "OAuth2", "wing": "wing_aios"}' | aios run mempalace/mempalace_search

# Recall-Fetch via Tool-Script (manuell)
echo '{"search_queries":[{"query":"kernel abi"},{"query":"mcp policy","wing":"wing_aios_decisions"}]}' \
  | aios run memory_recall_fetch

# Store-Persist via Tool-Script (manuell)
echo '{"memory_items":[{"wing":"wing_aios_decisions","room":"mcp","type":"decision","content":"Test"}]}' \
  | aios run memory_store_persist
```

## Patterns

### `memory_recall` + `memory_recall_fetch` (Chain)

Symmetrisch zur Write-Chain (siehe unten) erfolgt der Read-Pfad als **zweistufige Kette**:

1. **`memory_recall`** (LLM-Pattern, `selection_strategy: cheapest`) – leitet aus der Aufgabenbeschreibung 2–4 komplementäre semantische Suchanfragen ab (kurz, domänen-relevant, unterschiedliche Perspektiven). Optional mit Wing/Room-Filter. Output ist JSON mit `search_queries[]`.

2. **`memory_recall_fetch`** (Tool-Pattern, `tsx tools/mempalace-recall.ts`) – führt die Queries über MCP gegen MemPalace aus (max. 4 Queries, max. 5 Treffer pro Query, max. 20 Treffer gesamt), gruppiert die Drawers nach `metadata.type` in vier Sektionen (Entscheidungen / Fakten / Findings / Patterns & Lessons), dedupliziert nach Content und schreibt einen fertigen Markdown-Kontext-Block nach `$OUTPUT`.

Weil `memory_recall_fetch` **`output_type: text`** deklariert, inlined die Engine den Datei-Inhalt als Message-Content (siehe Kernel-Mechanismus in `src/core/engine.ts:executeTool`). Nachfolgende LLM-Steps sehen den Markdown-Kontext-Block DIREKT in ihrem `input_from`-Payload – keine weitere Extraktion, kein JSON-Parsing im Haupt-LLM.

Der Tool-Script ist fire-and-forget: bei fehlender MemPalace, malformed Input oder MCP-Fehlern wird ein Kontext-Block mit `_Kein Kontext verfügbar: …_` geschrieben. Der Workflow läuft ungestört weiter.

### `memory_store` + `memory_store_persist` (Chain)

Die eigentliche Persistenz erfolgt als **zweistufige Kette**, die der Router automatisch hinter den Haupt-Schritten einplant:

1. **`memory_store`** (LLM-Pattern, `selection_strategy: cheapest`) – extrahiert aus dem Workflow-Output langlebiges Wissen (decisions, facts, findings, patterns, lessons), klassifiziert nach Wing/Room und gibt JSON `memory_items[]` aus. Selbst-Test-Kriterium: Jedes Item muss ohne Original-Kontext verständlich sein.

2. **`memory_store_persist`** (Tool-Pattern, `tsx tools/mempalace-persist.ts`) – nimmt den JSON-Output von `memory_store` entgegen, extrahiert das erste balancierte JSON-Objekt (robust gegen ContextBuilder-Markdown-Wrapping und Code-Fences), spawnt kurz einen MemPalace MCP-Client, ruft für jedes Item `mempalace_check_duplicate` + `mempalace_add_drawer`, und schreibt eine Markdown-Summary (`stored / duplicates / failed / skipped`) auf `$OUTPUT`.

Der Tool-Script ist **fire-and-forget**: Exit-Code ist IMMER 0, auch bei
- nicht-installierter MemPalace,
- fehlerhaftem Input (kein JSON, falsches Schema, unvollständige Items),
- MCP-Verbindungsfehlern,
- teilweise fehlgeschlagenen Item-Writes.

Fehler landen in der Summary mit Status `Skipped: …` oder als Einträge unter `## Errors`. Der umgebende AIOS-Workflow wird nicht gebrochen.

Input: Workflow-Output (Text, wird an `memory_store` gereicht)
Output (von `memory_store_persist`): Markdown-Summary

## Konfigurations-Single-Source

`tools/mempalace-persist.ts` liest beim Start `./aios.yaml` und verwendet dieselbe `mcp.servers.mempalace.{command,args,env}` Konfiguration wie der laufende `McpManager`. Änderst du den MemPalace-Command in `aios.yaml`, greift er sowohl für Read- als auch für Write-Pfad. Falls `aios.yaml` fehlt oder keinen `mempalace`-Block hat, fällt der Script auf Defaults (`python -m mempalace.mcp_server`) zurück.

Sensitive Env-Vars (`ANTHROPIC_API_KEY`, `GH_TOKEN`, …) werden beim Spawn gestrippt – dieselbe Defense-in-Depth-Liste wie in `src/core/mcp.ts`.

## Wing-Mapping Konvention

MemPalace organisiert Wissen in Wings (Großbereichen) und Rooms (Unterthemen). Die LLM-Patterns (`memory_store`, `memory_recall`) emittieren **semantische Kategorien**, nicht konkrete Wing-Namen. Die Tool-Scripts (`memory_store_persist`, `memory_recall_fetch`) übersetzen diese Kategorien in Wing-Namen – entweder per Default-Map oder per Override in der aktiven `.aios/context.yaml`.

### Kategorien → Wings (Defaults)

| Kategorie     | Default-Wing              | Zweck                                   |
|---------------|---------------------------|-----------------------------------------|
| `decisions`   | `wing_aios_decisions`     | Architektur-Entscheidungen (ADRs)       |
| `facts`       | `wing_aios`               | Harte Fakten, Constraints, Konfigs      |
| `findings`    | `wing_aios_findings`      | Review-Findings aller Personas          |
| `patterns`    | `wing_aios_patterns`      | Gelernte Patterns und Best Practices    |
| `lessons`     | `wing_aios_patterns`      | Lessons Learned (alias von patterns)    |
| `compliance`  | `wing_aios_compliance`    | Compliance-Artefakte (IEC 62443, CRA)   |
| `default`     | `wing_aios`               | Fallback für unbekannte Kategorien      |

### Per-Context-Override via `.aios/context.yaml`

Jeder Kontext kann seine Kategorien auf beliebige Wing-Namen mappen. Das Tool-Script sucht `.aios/context.yaml` im CWD und bis zu 6 Parent-Levels aufwärts (damit Aufrufe aus Unterordnern noch den Projekt-Kontext finden).

```yaml
# .aios/context.yaml
schema_version: "1.0"
name: myproject
description: "My Project"
type: project
# … andere Felder …

memory:
  wings:
    decisions: wing_myproject_adrs
    findings: wing_myproject_issues
    patterns: wing_myproject_patterns
    compliance: wing_myproject_iec62443
    default: wing_myproject
```

Nicht im Mapping enthaltene Kategorien fallen zurück auf `DEFAULT_WINGS`. Fehlender `memory.wings`-Block oder fehlendes `context.yaml` → vollständige Default-Map wird verwendet.

### Escape Hatch: Explizite Wing-Namen

Beide Patterns akzeptieren statt `category` auch einen expliziten `wing: "wing_*"` String. Das wird durchgereicht ohne Resolution und ist als Escape-Hatch gedacht für Migration von Legacy-Daten mit fest vergebenen Wing-Namen. Im Normalfall: immer `category`.

### Wing-Source-Trace

Jede `memory_store_persist` Summary enthält eine `Wing mapping:` Zeile, die zeigt woher das Mapping kam:

```
- Wing mapping: context.yaml (/projects/myproject/.aios/context.yaml)
```

oder

```
- Wing mapping: built-in defaults
```

So ist immer nachvollziehbar, welche Konvention gerade greift.

### Rooms

Rooms innerhalb eines Wings sind freier – snake_case, thematisch (`authentication`, `mcp_integration`, `kernel_abi`, `threat_model`, …). Rooms werden NICHT per Config gemappt; der LLM wählt sie direkt.

## Referenz: Wichtige MemPalace-Tools

| Tool                        | Zweck                                          |
|-----------------------------|------------------------------------------------|
| `mempalace_status`          | Palace-Statistiken                             |
| `mempalace_search`          | Semantische Suche (optional Wing/Room-Filter)  |
| `mempalace_add_drawer`      | Wissen speichern (Wing + Room + Content)       |
| `mempalace_delete_drawer`   | Eintrag löschen                                |
| `mempalace_check_duplicate` | Duplikat-Prüfung vor Speicherung               |
| `mempalace_list_wings`      | Alle Wings auflisten                           |
| `mempalace_list_rooms`      | Rooms in einem Wing                            |
| `mempalace_get_taxonomy`    | Wing → Room → Count Baum                       |
| `mempalace_kg_add`          | Knowledge Graph: Fakt hinzufügen               |
| `mempalace_kg_query`        | Knowledge Graph: Fakten abfragen               |
| `mempalace_diary_write`     | Tagebuch-Eintrag                               |

Die vollständige Tool-Liste mit Schemas sieht der Router im Pattern-Katalog – kein Code-Update nötig, wenn MemPalace neue Tools hinzufügt.

## Kernel-vs-User-Space

Die Integration lebt fast komplett im User Space. Die **einzige** Kernel-Änderung ist ein kleiner, domänen-freier Mechanismus-Fix in `src/core/engine.ts:executeTool`:

> Wenn ein Tool-Pattern `output_type: "text"` deklariert, liest die Engine die erzeugte Ausgabedatei zurück und setzt deren Inhalt als Message-Content, statt nur den Dateipfad als String weiterzureichen.

Dieser Fix ist **keine MemPalace-Policy**, sondern ein generischer Mechanismus: er macht jede Tool→LLM-Kette (`pdf_extract_text → summarize`, `render_diagram → review_visual`, alle zukünftigen Text-Tool-Patterns) endlich funktional. Vorher wurde die Datei nur erzeugt und der nachfolgende LLM-Step sah statt des Inhalts den wörtlichen String `"Datei erzeugt: /path"`. Der Mechanismus folgt explizit der goldenen Regel aus CLAUDE.md (mechanism, not policy): ein Perl-Entwickler, ein Java-Entwickler und ein CRA-Compliance-Beauftragter profitieren gleichermaßen.

User-Space-Bestandteile:

- **Patterns:** `patterns/memory_recall/`, `patterns/memory_recall_fetch/`, `patterns/memory_store/`, `patterns/memory_store_persist/`
- **Tool-Scripts:** `tools/mempalace-recall.ts`, `tools/mempalace-persist.ts` – gemeinsame Helpers (`findFirstJsonObject`, `loadMempalaceConfig`, `MempalaceCmd`) werden zwischen beiden geteilt
- **Config:** `aios.yaml` (`mcp.servers.mempalace`) – Single Source of Truth für alle drei Zugriffspfade
- Nutzt existierende `McpServerConfig` und `@modelcontextprotocol/sdk`

Kein neues Kernel-Interface, keine Erweiterung der kernel-stablen Typen. Die MemPalace-spezifische Konkretion (welche Wings, welche Klassifizierung, welche Sektionen) bleibt im User Space, weil sie Domain-Konvention ist.

## Troubleshooting

**MemPalace-Tools erscheinen nicht in `aios patterns list`:**

- Läuft der MCP-Server? Teste manuell: `python -m mempalace.mcp_server`
- Fehler beim Start? `aios` gibt auf stderr eine Warnung aus wenn ein MCP-Server nicht erreichbar ist
- Ist `mempalace` im Python-Path? `python -c "import mempalace"` muss klappen

**`memory_store` speichert zu viel Rauschen:**

- Passe den Prompt in `patterns/memory_store/system.md` an (Qualitätskriterien / Skip-Regeln)
- Reduziere den Input-Scope: Nur finale Ergebnisse weitergeben, nicht Zwischen-Outputs

**Duplikate trotz `check_duplicate`:**

- `mempalace_check_duplicate` nutzt semantische Ähnlichkeit – passe Schwellwert in MemPalace-Config an
