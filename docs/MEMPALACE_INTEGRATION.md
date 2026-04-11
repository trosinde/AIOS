# MemPalace Integration

[MemPalace](https://github.com/milla-jovovich/mempalace) liefert AIOS persistentes, sitzungsübergreifendes Gedächtnis. Entscheidungen, Findings und Patterns werden in einer lokalen Wissensbasis (ChromaDB + SQLite) abgelegt und stehen bei zukünftigen Aufgaben als Kontext zur Verfügung.

Die Integration nutzt ausschließlich den bestehenden MCP-Client (`src/core/mcp.ts`) – kein Kernel-Code wurde geändert. Sie besteht aus drei Teilen: MCP-Server-Konfiguration, zwei LLM-Patterns und einem Router-Hinweis.

## Architektur

```
┌──────────────────────────────┐
│ User Task                    │
└────────────┬─────────────────┘
             │
       ┌─────▼──────┐
       │  Router    │  plant Chain: memory_recall → main → memory_store → memory_store_persist
       └─────┬──────┘
             │
   ┌─────────┼──────────────────────────┐
   │         │                          │
┌──▼────────┐│  ┌──────────────┐  ┌─────▼──────────────┐
│memory_    ││  │ Haupt-Steps  │  │ memory_store (LLM) │
│recall(LLM)││  │ mit Kontext  │  │ → memory_items[]   │
└──┬────────┘│  └────┬─────────┘  └─────┬──────────────┘
   │         │       │                  │
   │         │       │                  ▼
   │         │       │          ┌───────────────────────┐
   │         │       │          │ memory_store_persist  │
   │         │       │          │ (type: tool)          │
   │         │       │          │ tools/mempalace-      │
   │         │       │          │  persist.ts           │
   │         │       │          └─────┬─────────────────┘
   │         │       │                │ MCP stdio (kurzlebig)
   │         │       │                ▼
   │         │       │         ┌────────────────────┐
   │         │       │         │ MemPalace MCP      │
   │         │       │         │ (ChromaDB+SQLite)  │
   │         │       │         └────────────────────┘
   │         │       │                ▲
   │         │       │                │ tools/call (MCP stdio, langlebig)
   │         ▼       ▼                │
   │  ┌─────────────────────────┐     │
   └─►│ McpManager              ├─────┘
      │ (src/core/mcp.ts)       │
      │ spawnt mempalace lazy   │
      └─────────────────────────┘
```

**Zwei MemPalace-Zugriffswege**, beide via MCP:

1. **Read-Path** (`memory_recall`, manuelle `mempalace/*` Calls): Der langlebige `McpManager` im AIOS-Hauptprozess hält eine persistente MCP-Verbindung.
2. **Write-Path** (`memory_store_persist`): Der Tool-Script spawnt kurz einen **zweiten** MemPalace-Prozess, schreibt seine Items und terminiert. Das ist nötig weil Tool-Pattern-Subprozesse keinen Zugriff auf den laufenden `McpManager` haben (würde Kernel-Änderungen erfordern). SQLite WAL + lokale ChromaDB vertragen den kurzen parallelen Schreibzugriff.

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
# Read-Path via McpManager
echo '{"query": "OAuth2", "wing": "wing_aios"}' | aios run mempalace/mempalace_search

# Write-Path via Tool-Script (manuell)
echo '{"memory_items":[{"wing":"wing_aios_decisions","room":"mcp","type":"decision","content":"Test"}]}' \
  | aios run memory_store_persist
```

## Patterns

### `memory_recall`

Leitet aus einer Aufgabe semantische Suchanfragen ab und bereitet einen `context_block` vor, der in nachfolgende Agenten injiziert wird. Der Router plant diesen Step **vor** Haupt-Schritten ein, wenn die Aufgabe auf vorhandenes Wissen angewiesen sein könnte.

Input: Aufgabenbeschreibung (Text)
Output: JSON mit `search_queries[]` und `context_block` (Markdown)

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

MemPalace organisiert Wissen in Wings (Großbereichen) und Rooms (Unterthemen). Konvention für AIOS:

| Wing                      | Zweck                                         |
|---------------------------|-----------------------------------------------|
| `wing_aios_decisions`     | Architektur-Entscheidungen (ADRs)             |
| `wing_aios_compliance`    | Compliance-Artefakte (IEC 62443, CRA)         |
| `wing_aios_findings`      | Review-Findings aller Personas                |
| `wing_aios_patterns`      | Gelernte Patterns und Best Practices          |
| `wing_<projektname>`      | Projekt-spezifisches Wissen                   |

Rooms innerhalb eines Wings sind freier – snake_case, thematisch (`authentication`, `mcp_integration`, `kernel_abi`, `threat_model`, …).

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

Die Integration ist vollständig User Space:

- **Kein Code in `src/core/` (Kernel)** – die Persist-Logik lebt als Tool-Script in `tools/mempalace-persist.ts` und wird über den existierenden `type: tool` Mechanismus aufgerufen (derselbe Weg wie `patterns/pdf_merge/` → `tools/pdf-tools.ts`)
- Patterns liegen in `patterns/memory_store/`, `patterns/memory_recall/`, `patterns/memory_store_persist/`
- Config in `aios.yaml` (`mcp.servers.mempalace`) – Single Source of Truth für beide Zugriffspfade
- Nutzt existierende `McpServerConfig` und `@modelcontextprotocol/sdk`
- Keine Änderung an kernel-stable Interfaces

Ein Perl-Entwickler, ein Java-Entwickler und ein CRA-Compliance-Beauftragter profitieren gleichermaßen von persistentem Gedächtnis – trotzdem bleibt die Konkretion (welche Wings, welche Klassifizierung, welche Persistenz-Semantik) im User Space, weil sie Domain-Konvention ist.

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
