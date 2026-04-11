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
       │  Router    │  plant memory_recall VOR / memory_store NACH
       └─────┬──────┘   Haupt-Schritten (wenn relevant)
             │
   ┌─────────┴─────────┐
   │                   │
┌──▼───────────┐  ┌────▼──────────┐
│ memory_recall│  │ Haupt-Steps   │  (code_review, design_solution, …)
│ (LLM)        │  │ mit Kontext   │
└──┬───────────┘  └────┬──────────┘
   │                   │
   │                   ▼
   │            ┌──────────────┐
   │            │ memory_store │
   │            │ (LLM)        │
   │            └──┬───────────┘
   │               │
   └───┬───────────┘
       │ MCP tools/call
       ▼
┌─────────────────────────────┐
│ McpManager (src/core/mcp.ts)│
└────────────┬────────────────┘
             │ stdio
┌────────────▼────────────────┐
│ MemPalace MCP Server        │
│ (python -m mempalace...)    │
│ → ChromaDB + SQLite (local) │
└─────────────────────────────┘
```

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
# Erwartet u.a.:
#   memory_recall
#   memory_store
#   mempalace/mempalace_search
#   mempalace/mempalace_add_drawer
#   mempalace/mempalace_check_duplicate
#   mempalace/mempalace_list_wings
#   …
```

Smoke-Test:

```bash
echo '{"query": "OAuth2", "wing": "wing_aios"}' | aios run mempalace/mempalace_search
```

## Patterns

### `memory_recall`

Leitet aus einer Aufgabe semantische Suchanfragen ab und bereitet einen `context_block` vor, der in nachfolgende Agenten injiziert wird. Der Router plant diesen Step **vor** Haupt-Schritten ein, wenn die Aufgabe auf vorhandenes Wissen angewiesen sein könnte.

Input: Aufgabenbeschreibung (Text)
Output: JSON mit `search_queries[]` und `context_block` (Markdown)

### `memory_store`

Extrahiert aus Workflow-Outputs langlebiges Wissen (decisions, facts, findings, patterns, lessons) und formatiert es für MemPalace. Der Router plant diesen Step **nach** Haupt-Schritten ein, wenn neue Entscheidungen/Findings produziert wurden. Fire-and-forget: Fehler dürfen den Workflow nicht brechen.

Input: Workflow-Output (Text)
Output: JSON mit `memory_items[]` (jedes Item hat `wing`, `room`, `type`, `content`, `relevance`)

Jedes Item trägt `action: check_duplicate` – vor dem tatsächlichen `mempalace_add_drawer` Aufruf muss `mempalace_check_duplicate` geprüft werden.

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

- Kein Code in `src/core/` (Kernel)
- Patterns liegen in `patterns/memory_store/` und `patterns/memory_recall/`
- Config in `aios.yaml` (`mcp.servers.mempalace`)
- Nutzt existierendes `McpServerConfig` Interface
- Keine Änderung an kernel-stable Interfaces

Ein Perl-Entwickler, ein Java-Entwickler und ein CRA-Compliance-Beauftragter profitieren gleichermaßen von persistentem Gedächtnis – trotzdem bleibt die Konkretion (welche Wings, welche Klassifizierung) im User Space, weil sie Domain-Konvention ist.

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
