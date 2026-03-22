# AIOS CLI Command Reference

Vollständige Referenz aller `aios` Command-Line-Befehle.

> **Aufruf:** `aios <command> [subcommand] [optionen]`

---

## Übersicht

| Befehl | Beschreibung |
|--------|-------------|
| `aios <task>` | Natürlichsprachliche Aufgabe orchestrieren |
| `aios run` | Einzelnes Pattern ausführen |
| `aios plan` | Workflow planen ohne Ausführung |
| `aios chat` | Interaktive REPL-Session |
| `aios init` | Projekt-Context initialisieren |
| `aios configure` | Setup-Wizard für Provider/API-Keys |
| `aios update` | AIOS aktualisieren |
| `aios mcp-server` | MCP-Server starten |
| `aios context` | Context-Management |
| `aios persona` | Persona-Management |
| `aios knowledge` | Knowledge Bus |
| `aios patterns` | Pattern-Management |

---

## Top-Level-Befehle

### `aios <task...>` — Dynamische Orchestrierung

Zerlegt eine natürlichsprachliche Aufgabe in einen Workflow (DAG) und führt ihn aus. Der Router (Meta-Agent) wählt automatisch passende Patterns und plant die Ausführungsreihenfolge.

```bash
aios "Analysiere die Sicherheit von app.js und erstelle einen Report"
aios "Fasse alle Markdown-Dateien im Projekt zusammen" --dry-run
aios "Deploy-Checkliste erstellen" --provider ollama
aios "Teste alle Module" --cross
aios "Erstelle Requirements" --context dvoi-engineering
```

| Option | Beschreibung |
|--------|-------------|
| `--dry-run` | Nur planen, nicht ausführen. Zeigt den Execution Plan als JSON |
| `--provider <name>` | LLM-Provider überschreiben (`anthropic`, `ollama`, `gemini`, `openai`, `opencode`) |
| `--cross` | Cross-Context-Modus: orchestriert über mehrere Contexts hinweg |
| `--context <name>` | Aufgabe an einen bestimmten Context delegieren |

---

### `aios run <pattern>` — Einzelnes Pattern ausführen

Führt ein einzelnes Pattern im Fabric-Style aus: stdin → LLM → stdout. Ideal für Pipes und Skripte.

> **Hinweis:** Input via stdin ist **Pflicht**. Ohne stdin-Input bricht der Befehl mit Fehler ab.

```bash
echo "Mein Code" | aios run analyze_code
cat report.md | aios run summarize
aios run extract_requirements --type=functional < spec.md
aios run improve_writing --provider ollama < draft.txt
```

Spezielle Pattern-Typen werden automatisch erkannt und unterschiedlich verarbeitet:
- **`rag`** — Nutzt das RAG-Backend für semantische Suche
- **`mcp`** — Delegiert an einen MCP-Server
- **`tool`** — Führt ein CLI-Tool aus statt LLM-Aufruf
- **`image_generation`** — Generiert Bilder
- **Vision-Patterns** (`input_type: image`) — Verarbeiten Bilder als Input

| Argument | Beschreibung |
|----------|-------------|
| `<pattern>` | Name des auszuführenden Patterns (Pflicht) |

| Option | Beschreibung |
|--------|-------------|
| `--provider <name>` | LLM-Provider überschreiben |
| `--key=value` / `--key value` | Pattern-Parameter als Key-Value-Paare übergeben |

---

### `aios plan <task...>` — Workflow planen

Plant einen Workflow ohne ihn auszuführen. Gibt den Execution Plan als JSON aus. Nützlich zum Debuggen und Überprüfen, welche Patterns der Router wählen würde.

```bash
aios plan "Erstelle eine Security-Analyse für das Backend"
aios plan "Refactore die Datenbankschicht" --provider claude
```

| Option | Beschreibung |
|--------|-------------|
| `--provider <name>` | LLM-Provider überschreiben |

---

### `aios chat` — Interaktive REPL

Startet eine interaktive Chat-Session mit Slash-Commands. Unterstützt Konversationshistorie und Pattern-Ausführung im Dialog.

```bash
aios chat
aios chat --provider ollama
```

| Option | Beschreibung |
|--------|-------------|
| `--provider <name>` | LLM-Provider überschreiben |

---

### `aios init` — Projekt-Context initialisieren

Initialisiert ein `.aios/`-Verzeichnis im aktuellen Projekt. Erstellt `context.yaml`, erkennt Technologien und generiert passende Agent-Instructions.

**Re-Init-Verhalten:** Wenn `.aios/` bereits existiert, zeigt `aios init` ein interaktives Menü mit drei Optionen:
1. **Refresh** — `agent-instructions.md` neu generieren aus bestehender `context.yaml`
2. **Reconfigure** — Konfiguration neu durchlaufen
3. **Abort** — Abbrechen

Mit `--quick` wird bei bestehendem `.aios/` automatisch ein Refresh durchgeführt (keine Rückfrage).

```bash
aios init                    # Interaktiver Wizard (oder Re-Init-Menü)
aios init --quick            # Auto-Detect, keine Fragen (bei Re-Init: silent Refresh)
aios init --yes              # Zeigt Plan, bestätigt automatisch
aios init --refresh          # agent-instructions.md explizit neu generieren
```

| Option | Beschreibung |
|--------|-------------|
| `--quick` | Automatische Erkennung ohne Rückfragen. Bei bestehendem `.aios/`: stiller Refresh |
| `--yes` | Plan anzeigen und automatisch bestätigen |
| `--refresh` | `agent-instructions.md` aus bestehender `context.yaml` neu generieren |
| `--aios-path <path>` | AIOS-Installationspfad vorgeben |

---

### `aios configure` — Setup-Wizard

Alias: `aios config`

Interaktiver Setup-Wizard zur Konfiguration von LLM-Providern und API-Keys. Unterstützt Anthropic (Claude), Google (Gemini) und Ollama.

```bash
aios configure
aios config          # Kurzform
```

---

### `aios update` — AIOS aktualisieren

Aktualisiert AIOS auf die neueste Version (git pull, npm install, build).

```bash
aios update          # Update durchführen
aios update --check  # Nur prüfen, ob Updates verfügbar
```

| Option | Beschreibung |
|--------|-------------|
| `--check` | Nur prüfen ob Updates verfügbar sind, nicht installieren |

---

### `aios mcp-server` — MCP-Server starten

Startet AIOS als Model Context Protocol (MCP) Server über stdio-Transport. Ermöglicht die Integration in MCP-fähige Clients (z.B. Claude Desktop).

```bash
aios mcp-server
```

---

## Command-Gruppe: `aios context`

Verwaltet Contexts — isolierte Arbeitsbereiche mit eigenen Patterns, Personas und Knowledge.

### `aios context switch <name>`

Wechselt den aktiven Context.

```bash
aios context switch dvoi-engineering
aios context switch personal-projects
```

### `aios context list`

Listet alle bekannten Contexts auf.

```bash
aios context list
```

### `aios context show`

Zeigt Details zum aktiven Context (Name, Pfad, Konfiguration).

```bash
aios context show
```

### `aios context info [name]`

Zeigt Details eines Contexts inkl. Federation-Manifest. Ohne Argument wird der aktive Context angezeigt.

```bash
aios context info
aios context info dvoi-engineering
```

### `aios context rename <new-name>`

Benennt den aktiven Context um. Aktualisiert context.yaml, Verzeichnisname (global), active_context und Links in anderen Contexts.

```bash
aios context rename new-project-name
```

### `aios context link <target>`

Erstellt eine Verknüpfung zu einem anderen Context für Federation.

```bash
aios context link compliance-context
aios context link audit-context --relationship audits
```

| Option | Beschreibung |
|--------|-------------|
| `--relationship <rel>` | Beziehungstyp: `audits`, `consults`, `feeds`, `depends_on` (default: `consults`) |

### `aios context unlink <target>`

Entfernt eine Context-Verknüpfung.

```bash
aios context unlink compliance-context
```

### `aios context catalog`

Zeigt den Federation-Katalog aller registrierten Contexts.

```bash
aios context catalog
```

### `aios context scan [paths...]`

Durchsucht das Dateisystem nach Contexts und aktualisiert die Registry.

```bash
aios context scan
aios context scan ~/projects ~/work --depth 5
```

| Option | Beschreibung |
|--------|-------------|
| `--depth <n>` | Maximale Suchtiefe (default: `3`) |

---

## Command-Gruppe: `aios persona`

Verwaltet und validiert Personas gegen das Base Trait Protocol.

### `aios persona list`

Listet alle verfügbaren Personas auf.

```bash
aios persona list
```

### `aios persona validate [name]`

Validiert eine Persona gegen das Base Trait Protocol (Handoff, Confidence, Trace). Ohne Argument werden alle Personas validiert.

```bash
aios persona validate
aios persona validate requirements-engineer
```

---

## Command-Gruppe: `aios knowledge`

Verwaltet den Knowledge Bus — das IPC-System für Wissensaustausch zwischen Agenten.

### `aios knowledge publish`

Publiziert ein Knowledge-Item via stdin in den Knowledge Bus.

```bash
echo "REST API bevorzugt gegenüber GraphQL" | aios knowledge publish --type decision --tags "api,architektur"
cat finding.md | aios knowledge publish --type artifact --pattern security_audit
```

| Option | Beschreibung | Pflicht |
|--------|-------------|---------|
| `--type <type>` | Typ: `decision`, `fact`, `requirement`, `artifact` | Ja |
| `--tags <tags>` | Komma-getrennte Tags | Nein |
| `--pattern <name>` | Quell-Pattern (default: `manual`) | Nein |
| `--context <id>` | Context-ID (default: `default`) | Nein |

### `aios knowledge query`

Filtert Knowledge-Items nach Typ, Tags, Pattern oder Context.

```bash
aios knowledge query --type decision
aios knowledge query --tags "security" --limit 5
aios knowledge query --cross-context --type requirement
```

| Option | Beschreibung |
|--------|-------------|
| `--type <type>` | Nach Typ filtern |
| `--tags <tags>` | Nach Tags filtern (komma-getrennt) |
| `--pattern <name>` | Nach Quell-Pattern filtern |
| `--context <id>` | Context-ID (default: `default`) |
| `--cross-context` | Cross-Context-Items einbeziehen |
| `--limit <n>` | Max. Ergebnisse (default: `20`) |

### `aios knowledge search <query...>`

Volltextsuche im Knowledge Bus.

```bash
aios knowledge search "API Design Entscheidung"
aios knowledge search "Sicherheitsanforderung" --limit 10
```

| Option | Beschreibung |
|--------|-------------|
| `--context <id>` | Context-ID (default: `default`) |
| `--limit <n>` | Max. Ergebnisse (default: `20`) |

---

## Command-Gruppe: `aios patterns`

Verwaltet und durchsucht das Pattern-Registry.

### `aios patterns list`

Listet alle verfügbaren Patterns, gruppiert nach Kategorie.

```bash
aios patterns list
aios patterns list --category security
```

| Option | Beschreibung |
|--------|-------------|
| `--category <cat>` | Nach Kategorie filtern |

### `aios patterns search <query...>`

Durchsucht Patterns nach Name, Beschreibung und Tags.

```bash
aios patterns search "security audit"
aios patterns search "code review"
```

### `aios patterns show <name>`

Zeigt Details eines Patterns: System-Prompt, Metadaten, Parameter.

```bash
aios patterns show analyze_code
aios patterns show extract_requirements
```

### `aios patterns create <name>`

Erstellt ein neues Pattern aus einem Template.

> **Hinweis:** Das generierte Template enthält noch kein `kernel_abi: 1` im Frontmatter. Dieses Feld sollte manuell ergänzt werden, damit der Pattern-Loader keine Warnung ausgibt.

```bash
aios patterns create my_custom_pattern
aios patterns create compliance_check --category security --description "Prüft Compliance-Anforderungen"
```

| Option | Beschreibung |
|--------|-------------|
| `--category <cat>` | Kategorie (default: `custom`) |
| `--description <desc>` | Beschreibung des Patterns |

---

## Globale Konventionen

- **Logging:** stderr (Statusmeldungen, Fehler) — **Output:** stdout (Ergebnisse, JSON)
- **Stdin:** Viele Befehle lesen Input von stdin (Unix-Pipe-kompatibel)
- **Provider:** Alle LLM-Befehle unterstützen `--provider` zur Provider-Auswahl (`anthropic`, `ollama`, `gemini`, `openai`, `opencode`)
- **Exit-Codes:** `0` = Erfolg, `1` = Fehler
