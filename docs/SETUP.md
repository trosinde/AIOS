# AIOS Setup & Konfiguration

Vom Nullpunkt zum ersten Ergebnis in unter 5 Minuten.

---

## Schnellinstallation

Ein Befehl -- alles automatisch:

```bash
curl -fsSL https://raw.githubusercontent.com/trosinde/AIOS/main/install.sh | bash
```

Das passiert dabei:

1. **Preflight-Check** -- Node.js >= 20, npm und git werden geprüft
2. **Repository klonen** -- nach `~/.aios/repo`
3. **Build** -- `npm install` und TypeScript-Kompilierung
4. **Patterns & Personas** -- 35+ Patterns und 8 Personas werden nach `~/.aios/` kopiert
5. **CLI-Wrapper** -- `aios` wird in `~/.local/bin/` erstellt und im PATH registriert
6. **Wizard starten** -- der interaktive Konfigurations-Wizard startet automatisch

> **Schon AIOS installiert?** Der Installer ist idempotent -- bei erneutem Aufruf wird nur aktualisiert (`git pull`), nichts überschrieben.

---

## Voraussetzungen

| Was | Minimum | Prüfen mit |
|-----|---------|------------|
| Node.js | >= 20.0.0 | `node -v` |
| npm | (kommt mit Node) | `npm -v` |
| git | beliebig | `git --version` |
| Ollama | *optional* | `ollama --version` |

**Node.js installieren** (falls fehlend): [nodejs.org](https://nodejs.org/) -- die LTS-Version wählen.

**Ollama installieren** (für kostenlose lokale Modelle): [ollama.com](https://ollama.com/)

---

## Manuelle Installation

Falls du den Installer nicht nutzen möchtest:

```bash
# 1. Repository klonen
git clone https://github.com/trosinde/AIOS.git && cd AIOS

# 2. Dependencies installieren
npm install

# 3. Konfigurieren
npx tsx src/cli.ts configure

# 4. Testen
echo "Hello World" | npx tsx src/cli.ts run summarize
```

---

## Konfiguration mit `aios configure`

Der interaktive Wizard führt Schritt für Schritt durch die Einrichtung. Jederzeit erneut aufrufbar um Einstellungen zu ändern:

```bash
aios configure
```

### Was der Wizard macht

Der Wizard fragt die wichtigsten Einstellungen ab und speichert alles an den richtigen Stellen. So sieht eine typische Session aus:

```
═══════════════════════════════════════
  AIOS Configuration
═══════════════════════════════════════

▸ Anthropic (Claude)
  API Key einrichten? [Y/n]: y
  API Key (sk-ant-...): sk-ant-api03-xxxxx
  Modell wählen:
    1) claude-sonnet-4-20250514  (empfohlen)
    2) claude-opus-4-20250514    (stärkstes Modell)
    3) claude-haiku-4-5-20251001 (schnellstes)
  Wahl [1]: 1
  ✓ Anthropic konfiguriert

▸ Ollama (lokale Modelle)
  Ollama-Server einrichten? [y/N]: n

▸ Konfiguration gespeichert: ~/.aios/config.yaml
▸ API Keys gespeichert: ~/.aios/.env

  Fertig! Teste mit:
    echo "Hello World" | aios run summarize
```

### Schritt 1: Anthropic (Claude) einrichten

Der Wizard fragt nach deinem Anthropic API Key. Diesen bekommst du unter [console.anthropic.com](https://console.anthropic.com/) -> API Keys.

Drei Modelle stehen zur Wahl:

| Modell | Stärke | Wann nutzen |
|--------|--------|-------------|
| **Sonnet 4** (empfohlen) | Bestes Preis-Leistungs-Verhältnis | Alltag -- Reviews, Analysen, Code |
| **Opus 4** | Stärkstes Reasoning | Komplexe Architektur, tiefe Analysen |
| **Haiku 4.5** | Schnellstes | Einfache Tasks, schnelle Antworten |

> **Kein Anthropic-Account?** Kein Problem -- überspringe diesen Schritt mit `n` und nutze stattdessen Ollama mit lokalen Modellen (kostenlos).

### Schritt 2: Ollama (optional)

Wenn du einen Ollama-Server hast (lokal oder im Netzwerk), kann AIOS diesen als kostenlosen Provider nutzen.

Der Wizard:
1. Fragt nach dem Endpoint (Standard: `http://localhost:11434`)
2. Testet die Verbindung automatisch
3. Zeigt alle verfügbaren Modelle an
4. Lässt ein Hauptmodell und optional ein separates Code-Modell wählen

```
▸ Ollama (lokale Modelle)
  Ollama-Server einrichten? [y/N]: y
  Endpoint [http://localhost:11434]: http://jarvis:11434
  ⠋ Teste Verbindung...
  ✓ Ollama erreichbar
  Verfügbare Modelle:
    1) qwen3:235b
    2) qwen2.5-coder:32b
    3) llama3:70b
  Modell für schnelle Tasks [qwen3:235b]: 1
  Separates Code-Modell? [y/N]: y
  Code-Modell [qwen2.5-coder:32b]: 2
  ✓ Ollama konfiguriert
```

### Schritt 3: Default Provider

Wenn mehrere Provider konfiguriert sind, wird der Standard-Provider abgefragt. Dieser wird genutzt, wenn kein `--provider` explizit angegeben wird.

---

## Erste Schritte nach der Installation

Teste ob alles funktioniert:

```bash
# Einfachster Test -- Text zusammenfassen
echo "AIOS ist ein CLI-basiertes AI-Orchestrierungssystem" | aios run summarize

# Alle verfügbaren Patterns anzeigen
aios patterns list

# Code reviewen
cat src/utils/config.ts | aios run code_review

# Interaktive Chat-Session starten
aios chat
```

---

## Wo liegt was?

Nach der Installation sieht die Verzeichnisstruktur so aus:

```
~/.aios/
├── config.yaml          # Provider, Modelle, Pfade (vom Wizard geschrieben)
├── .env                 # API Keys (chmod 600 -- nur du kannst lesen)
├── patterns/            # 35+ Pattern-Bibliothek (Prompts als Markdown)
├── personas/            # 8 Persona-Definitionen (YAML)
└── repo/                # Geklontes Git-Repository (Code + Build)

~/.local/bin/
└── aios                 # CLI-Wrapper (ruft node ~/.aios/repo/dist/cli.js auf)
```

### Config-Hierarchie

AIOS sucht Konfiguration in dieser Reihenfolge (erste Treffer gewinnt):

| Priorität | Datei | Wann nutzen |
|-----------|-------|-------------|
| 1 (höchste) | `./aios.yaml` | Projekt-spezifische Overrides |
| 2 | `~/.aios/config.yaml` | Globale Config (vom Wizard) |
| 3 (niedrigste) | Eingebaute Defaults | Fallback |

So kannst du z.B. in einem Projekt einen anderen Default-Provider verwenden, ohne die globale Config zu ändern.

### API Keys -- Sicherheit

API Keys werden **nie** in `config.yaml` gespeichert. Sie liegen in `~/.aios/.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

- Die Datei hat `chmod 600` -- nur dein User kann sie lesen
- AIOS lädt die `.env` automatisch beim Start
- Bereits gesetzte Umgebungsvariablen haben Vorrang (gut für CI/CD)

---

## Konfiguration manuell anpassen

Statt den Wizard zu nutzen, kannst du die Dateien direkt editieren:

```bash
# Config öffnen
vim ~/.aios/config.yaml

# API Key setzen
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.aios/.env
chmod 600 ~/.aios/.env
```

### Beispiel: config.yaml mit Cloud + lokalem Provider

```yaml
providers:
  claude:
    type: anthropic
    model: claude-sonnet-4-20250514

  ollama-fast:
    type: ollama
    model: qwen3:235b
    endpoint: http://localhost:11434

  ollama-code:
    type: ollama
    model: qwen2.5-coder:32b
    endpoint: http://localhost:11434

defaults:
  provider: claude

paths:
  patterns: ~/.aios/patterns
  personas: ~/.aios/personas
```

### Beispiel: Nur Ollama (komplett kostenlos)

```yaml
providers:
  ollama:
    type: ollama
    model: llama3:70b
    endpoint: http://localhost:11434

defaults:
  provider: ollama

paths:
  patterns: ~/.aios/patterns
  personas: ~/.aios/personas
```

### Unterstützte Provider

| Provider | Typ | Kosten | Config-Key |
|----------|-----|--------|------------|
| **Anthropic** (Claude) | Cloud API | ab $3/Mtok | `type: anthropic` |
| **Ollama** | Lokal/Netzwerk | Kostenlos | `type: ollama` |
| **Google Gemini** | Cloud API | ab $0.075/Mtok | `type: gemini` |
| **OpenAI** | Cloud API | ab $0.15/Mtok | `type: openai` |

---

## Troubleshooting

### `aios: command not found`

`~/.local/bin` ist nicht im PATH. Lösung:

```bash
# Für die aktuelle Session
export PATH="$HOME/.local/bin:$PATH"

# Permanent (je nach Shell)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc   # bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc    # zsh
```

### `Error: Could not resolve authentication method`

Kein API Key gesetzt. Lösung:

```bash
# Option 1: Wizard erneut starten
aios configure

# Option 2: Manuell setzen
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.aios/.env
chmod 600 ~/.aios/.env

# Option 3: Direkt als Umgebungsvariable
export ANTHROPIC_API_KEY=sk-ant-...
```

### Ollama: `Verbindung fehlgeschlagen`

```bash
# Läuft Ollama?
ollama list

# Ollama starten
ollama serve

# Standard-Endpoint testen
curl http://localhost:11434/api/tags
```

### Installer schlägt bei `npm install` fehl

```bash
# Node-Version prüfen (muss >= 20 sein)
node -v

# Cache leeren und neu versuchen
cd ~/.aios/repo
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Konfiguration zurücksetzen

```bash
# Alles auf Anfang
rm ~/.aios/config.yaml ~/.aios/.env
aios configure
```

---

## Update

```bash
# Bei Installer-Installation
cd ~/.aios/repo && git pull && npm install && npm run build

# Oder einfach den Installer nochmal ausführen
curl -fsSL https://raw.githubusercontent.com/trosinde/AIOS/main/install.sh | bash
```

---

## Deinstallation

```bash
# Alles entfernen
rm -rf ~/.aios
rm ~/.local/bin/aios

# Optional: AIOS-Zeilen aus Shell-Config entfernen
# In ~/.bashrc oder ~/.zshrc die Zeilen mit ".aios" und ".local/bin" löschen
```
