# AIOS Context-Isolation-Modell

> **Status:** Draft (Phase 0)
> **Ziel:** Definiert was ein "Kontext" in AIOS ist, wie Isolation funktioniert, und wie die Verzeichnisstruktur aussieht.

---

## 1. Was ist ein Kontext?

Ein **Kontext** ist eine isolierte Arbeitsumgebung mit eigenen Personas, Patterns, Knowledge und Konfiguration. Kontexte sind das User-Space-Äquivalent von Prozessen in einem Betriebssystem.

**Beispiele:**
- `dvoi-engineering` – CRA-Compliance, Requirements Engineering, regulatorisches Wissen
- `embedded-devices` – Firmware-Patterns, Hardware-Abstraktion
- `personal-projects` – Persönliche Workflows, eigene Patterns

**Kernel-Analogie:**

| OS-Konzept | AIOS-Äquivalent |
|---|---|
| Prozess | Context |
| User Space | Context-lokale Patterns, Personas, Knowledge |
| Kernel Space | AIOS Core (Engine, Registry, Provider) |
| Filesystem | Knowledge Base (isoliert per context_id) |
| IPC | Knowledge Bus (cross-context Kommunikation) |

---

## 2. Isolation-Garantien

### 2.1 Was ist isoliert?

| Ressource | Isolation | Beschreibung |
|---|---|---|
| Patterns | Vollständig | Context-Patterns sind nur im eigenen Context sichtbar |
| Personas | Vollständig | Persona-Definitionen sind context-lokal |
| Knowledge | Vollständig | Knowledge Items haben `context_id`, Queries filtern darauf |
| Workflows | Vollständig | Workflow-Definitionen sind context-lokal |
| Provider-Config | Geteilt | Provider sind global (Kernel-Ressource) |
| Kernel-Patterns | Geteilt | Patterns in `~/.aios/kernel/patterns/` sind überall verfügbar |

### 2.2 Isolation-Durchsetzung

```
Context A kann NICHT:
  ✗ Patterns aus Context B laden
  ✗ Knowledge aus Context B lesen (ohne explizites IPC)
  ✗ Personas aus Context B verwenden

Context A KANN:
  ✓ Kernel-Patterns verwenden (global)
  ✓ Nachrichten an Context B senden (über Knowledge Bus / IPC)
  ✓ Globale Provider-Konfiguration nutzen
```

---

## 3. Verzeichnisstruktur

### 3.1 Globale Kernel-Ressourcen

```
~/.aios/
├── kernel/
│   ├── patterns/              # Kernel-Patterns (überall verfügbar)
│   │   ├── _router/
│   │   └── evaluate_quality/
│   ├── personas/
│   │   └── base_traits.yaml   # Kernel Base Trait Protocol
│   └── config.yaml            # Globale Kernel-Konfiguration
├── contexts/
│   ├── dvoi-engineering/      # Context-spezifische Ressourcen
│   │   ├── context.yaml       # Context-Metadaten
│   │   ├── patterns/
│   │   ├── personas/
│   │   ├── workflows/
│   │   └── knowledge/
│   └── personal-projects/
│       ├── context.yaml
│       └── ...
└── knowledge/
    └── kernel.db              # Globale Knowledge Base (SQLite)
```

### 3.2 Projekt-lokale Ressourcen

```
mein-projekt/
├── .aios/
│   ├── context.yaml           # Projekt-Context (überschreibt globalen)
│   ├── patterns/              # Projekt-spezifische Patterns
│   ├── personas/              # Projekt-spezifische Personas
│   └── knowledge/             # Projekt-lokales Wissen
├── src/
└── ...
```

### 3.3 Auflösungsreihenfolge (Pattern-Lookup)

```
1. .aios/patterns/             (Projekt-lokal, höchste Priorität)
2. ~/.aios/contexts/<active>/patterns/  (Context-spezifisch)
3. patterns/                   (Repository-Patterns, aktueller Stand)
4. ~/.aios/kernel/patterns/    (Kernel-Patterns, niedrigste Priorität)
```

Bei Namenskollision gewinnt die spezifischere Ebene. Der Kernel loggt eine Warning bei Shadowing.

---

## 4. context.yaml Format

```yaml
# Unified ContextConfig Format (schema_version 1.0)
# EIN Format für alle context.yaml Dateien

# ─── Pflichtfelder ────────────────────────────────
schema_version: "1.0"
name: dvoi-engineering           # Eindeutig, kebab-case
description: "CRA-Compliance und Requirements Engineering für DVOI"
type: project                    # project | team | library

# ─── Federation ───────────────────────────────────
capabilities: []                 # Was dieser Kontext kann
exports: []                      # Was er anderen zur Verfügung stellt
accepts: []                      # Was er als Input akzeptiert
links: []                        # Verknüpfungen zu anderen Kontexten

# ─── Verzeichnisse & Provider ─────────────────────
config:
  default_provider: claude
  patterns_dir: ./patterns
  personas_dir: ./personas
  knowledge_dir: ./knowledge

# ─── Projekt-Details (optional) ───────────────────
project:
  domain: regulated-software
  language: typescript
  repo: https://github.com/org/dvoi

# ─── Trait-Requirements (optional) ────────────────
required_traits:
  - compliance_references
  - regulatory_classification

# ─── Provider-Routing (optional) ──────────────────
providers:
  routing:
    complex: anthropic
    quick: ollama

# ─── Knowledge (optional) ─────────────────────────
knowledge:
  backend: sqlite                # sqlite
  isolation: strict              # strict = kein cross-context Zugriff
  retention_days: 90             # Auto-Cleanup nach N Tagen (0 = nie)

# ─── Berechtigungen (optional) ────────────────────
permissions:
  allow_ipc: true                # Darf Nachrichten über Knowledge Bus senden
  allow_tool_execution: true     # Darf CLI-Tools ausführen
  allowed_tools:                 # Allowlist (leer = alle erlaubt)
    - mmdc
    - pandoc
```

---

## 5. Context-Lifecycle

### 5.1 Initialisierung

```bash
# Neuen Context erstellen
aios context init dvoi-engineering

# Erzeugt:
# ~/.aios/contexts/dvoi-engineering/
# ├── context.yaml    (Template)
# ├── patterns/       (leer)
# ├── personas/       (leer)
# └── knowledge/      (leer)
```

### 5.2 Aktivierung

```bash
# Context wechseln
aios context switch dvoi-engineering

# Aktiver Context wird in ~/.aios/active_context gespeichert
# Alle nachfolgenden Befehle nutzen diesen Context
```

### 5.3 Projekt-Binding

```bash
# Im Projektverzeichnis:
aios context init --local

# Erzeugt .aios/ im aktuellen Verzeichnis
# Wird automatisch aktiviert wenn man sich im Verzeichnis befindet
```

### 5.4 Umbenennung

```bash
# Aktiven Context umbenennen
aios context rename new-name

# Aktualisiert automatisch:
# - context.yaml (name-Feld)
# - Verzeichnisname (bei globalen Contexts)
# - ~/.aios/active_context (falls betroffen)
# - Links in anderen Contexts die auf den alten Namen zeigen
# - Federation-Registry
```

### 5.5 Auflösung des aktiven Kontexts

```
1. .aios/context.yaml im CWD?           → Verwende Projekt-Context
2. Sonst: ~/.aios/active_context lesen   → Verwende globalen Context
3. Sonst: "default" Context              → Minimal-Context ohne Extras
```

---

## 6. ExecutionContext-Integration

Der aktive Context fließt in den `ExecutionContext` (siehe KERNEL_ABI.md):

```typescript
interface ExecutionContext {
  trace_id: string;      // UUID, vom Kernel
  context_id: string;    // ← Aktiver Context-Name (z.B. "dvoi-engineering")
  started_at: number;    // Unix timestamp ms
}
```

Die Engine setzt `context_id` automatisch basierend auf dem aktiven Context. Knowledge-Queries filtern auf diese `context_id`.

---

## 7. Sicherheitsmodell

### 7.1 Isolation ist NICHT Security

Context-Isolation schützt vor versehentlichem Zugriff, nicht vor bösartigen Akteuren. Es ist ein **Convenience-Feature**, keine Sicherheitsgrenze.

### 7.2 Regeln

- Patterns können nur auf Knowledge mit gleicher `context_id` zugreifen
- Cross-Context-Zugriff nur über explizites IPC (→ IPC_PROTOCOL.md)
- Kernel-Patterns haben keine `context_id`-Restriktion
- Tool-Execution respektiert die `allowed_tools`-Liste aus `context.yaml`
- Filesystem-Zugriff wird NICHT eingeschränkt (kein Sandboxing)

---

## 8. Migration bestehender Patterns

Die 36 bestehenden Patterns in `patterns/` werden in Phase 1 mit `kernel_abi: 1` versehen. In Phase 4:

1. Universelle Patterns (z.B. `summarize`, `code_review`) → `~/.aios/kernel/patterns/`
2. Domain-spezifische Patterns (z.B. `compliance_report`) → bleiben in `patterns/` oder werden in einen Context verschoben
3. Interne Patterns (z.B. `_router`) → `~/.aios/kernel/patterns/` (immer Kernel)

---

## 9. Abgrenzung

**Dieses Dokument definiert:**
- Was ein Context ist und welche Isolation er bietet
- Verzeichnisstruktur und Auflösungsreihenfolge
- `context.yaml` Format
- Context-Lifecycle (init, switch, list)

**Dieses Dokument definiert NICHT:**
- Wie Contexts miteinander kommunizieren (→ IPC_PROTOCOL.md)
- Welche Traits ein Context verlangen kann (→ PERSONA_TRAITS.md)
- Wie Context-Packaging funktioniert (→ Phase 6, noch nicht spezifiziert)
