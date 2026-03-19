# Secret Management

> **Audience:** Users + Operators

AIOS bietet verschlüsselte Secret-Speicherung mit KeePass-kompatiblen `.kdbx`-Dateien. Secrets werden pro Context isoliert und sind über die CLI oder automatisch beim Provider-Start verfügbar.

## Warum verschlüsselte Secrets?

Standardmäßig speichert AIOS API-Keys in `~/.aios/.env` (Klartext, chmod 600). Das reicht für lokale Entwicklung, ist aber für Teams und regulierte Umgebungen unzureichend:

- **Klartext auf Disk** — Tools wie `grep`, Backups oder Malware können Keys lesen
- **Kein Audit-Trail** — Unklar wer wann auf welchen Key zugegriffen hat
- **Keine Context-Isolation** — Alle Projekte teilen die gleichen Keys

Das Secret-Management löst diese Probleme mit:

- **AES-256 + Argon2** Verschlüsselung (KeePass-Standard)
- **Pro-Context-Isolation** — Jeder Context kann eigene Keys haben
- **Audit-Logging** — Jeder Zugriff wird protokolliert
- **KeePassXC-Kompatibilität** — `.kdbx` in KeePassXC öffnen/bearbeiten

## Backends

| Backend | Verschlüsselung | Setup | Empfehlung |
|---------|-----------------|-------|------------|
| `keepassxc` | AES-256 + Argon2d | Master-Passwort nötig | Für Teams & Produktion |
| `env` | Keine (chmod 600) | Zero-Setup | Für lokale Entwicklung |

## Setup

### KeePass-Backend aktivieren

In `~/.aios/config.yaml` oder `aios.yaml`:

```yaml
secrets:
  backend: keepassxc
  keepassxc:
    database: ~/.aios/secrets.kdbx
    group: AIOS                        # Optional, Default "AIOS"
```

Oder pro Context in `.aios/context.yaml`:

```yaml
name: my-project
version: 1
secrets:
  backend: keepassxc
  keepassxc:
    database: ~/.aios/secrets.kdbx
```

Beim ersten Zugriff wird das Master-Passwort abgefragt und für die Session gecached.

### Migration von .env

```bash
# Bestehende .env-Secrets in KeePass importieren
aios secret import
```

## CLI-Referenz

```bash
aios secret set <key>              # Secret speichern (Hidden Input)
aios secret set <key> --global     # Global statt context-scoped
aios secret get <key>              # Secret abrufen (stdout)
aios secret list                   # Key-Namen auflisten (keine Werte)
aios secret delete <key>           # Secret löschen
aios secret import                 # .env → KeePass migrieren
aios secret backend                # Aktives Backend anzeigen
```

### Beispiele

```bash
# API-Key verschlüsselt speichern
aios secret set ANTHROPIC_API_KEY
Wert für "ANTHROPIC_API_KEY": ****

# Key für einen bestimmten Context
aios context switch work
aios secret set ANTHROPIC_API_KEY     # wird in Context "work" gespeichert

# Keys auflisten
aios secret list
  ANTHROPIC_API_KEY
  GEMINI_API_KEY

# Backend prüfen
aios secret backend
Secret Backend: keepassxc
Datenbank: ~/.aios/secrets.kdbx
Context: work (global)
```

## Context-Isolation

Secrets werden per Context isoliert über KeePass-Gruppen:

```
AIOS/                          # KeePass-Gruppe (konfigurierbar)
├── _global/                   # Globale Secrets
│   ├── ANTHROPIC_API_KEY
│   └── GEMINI_API_KEY
├── work/                      # Context "work"
│   └── ANTHROPIC_API_KEY      # Überschreibt global
└── personal/                  # Context "personal"
    └── OPENAI_API_KEY
```

Die Auflösungsreihenfolge:
1. Context-scoped Secret (z.B. `AIOS/work/KEY`)
2. Globales Secret (z.B. `AIOS/_global/KEY`)
3. Environment Variable (`process.env.KEY`)

## KeePassXC-Interop

Die `.kdbx`-Datei ist vollständig kompatibel mit KeePassXC Desktop:

1. Öffne `~/.aios/secrets.kdbx` in KeePassXC
2. Navigiere zu `AIOS/_global/` oder `AIOS/<context>/`
3. Einträge können in KeePassXC bearbeitet werden
4. AIOS liest die Änderungen beim nächsten Zugriff

**Wichtig:** AIOS und KeePassXC sollten nicht gleichzeitig schreiben. Öffne die DB in KeePassXC nur wenn kein AIOS-Prozess läuft.

## Provider-Integration

AIOS löst Secrets automatisch beim Start auf und setzt die entsprechenden Umgebungsvariablen bevor Provider erstellt werden:

```
loadConfig() → loadEnv()            # Bestehendes Verhalten
             → SecretResolver       # Prüft KeePass → Env Fallback
             → populateEnv()        # Setzt process.env
             → createProvider()     # Provider nutzt Keys aus env
```

Unterstützte Provider-Keys:
- `ANTHROPIC_API_KEY` — Anthropic/Claude
- `GEMINI_API_KEY` — Google Gemini
- `OPENAI_API_KEY` — OpenAI
- `OLLAMA_BEARER_TOKEN` — Ollama (remote)

## Audit-Trail

Jeder Secret-Zugriff wird im Security-Audit-Log protokolliert:

```jsonl
{"event_type":"secret_access","message":"Secret \"ANTHROPIC_API_KEY\" resolved via keepassxc","metadata":{"backend":"keepassxc","key":"ANTHROPIC_API_KEY"}}
{"event_type":"secret_write","message":"Secret \"GEMINI_API_KEY\" stored via keepassxc","metadata":{"backend":"keepassxc","key":"GEMINI_API_KEY"}}
```

**Werte werden nie geloggt** — nur Key-Name, Backend und Context-ID.

## Security-Architektur

```
┌────────────────────────────────────────┐
│  CLI: aios secret set / Provider Init  │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│       SecretResolver (Kernel)          │
│  Provider-Chain · Cache · Audit-Log    │
└──────────────┬─────────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌─────────────┐ ┌─────────────┐
│  KeePassXC  │ │  Env (.env) │
│  AES-256    │ │  chmod 600  │
│  Argon2d    │ │  Fallback   │
│  .kdbx      │ │             │
└─────────────┘ └─────────────┘
```

- **KeePass-Verschlüsselung:** AES-256 mit Argon2d Key Derivation
- **Master-Passwort:** Wird nur im Memory gehalten, nie auf Disk geschrieben
- **Dateiberechtigungen:** `.kdbx` und `.env` werden mit `chmod 600` erstellt
- **Kein Shell-Zugriff:** Pure-JS-Library (`kdbxweb`), kein `execFile`/`spawn`
