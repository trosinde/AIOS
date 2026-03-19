# AIOS Setup & Konfiguration

## Schnellinstallation

```bash
curl -fsSL https://raw.githubusercontent.com/trosinde/AIOS/main/install.sh | bash
```

Der Installer:
- Prüft Voraussetzungen (Node.js >= 20, npm, git)
- Klont das Repository nach ~/.aios/repo
- Installiert Dependencies und kompiliert TypeScript
- Kopiert Patterns und Personas nach ~/.aios/
- Erstellt den `aios` CLI-Wrapper in ~/.local/bin/
- Startet den Konfigurations-Wizard

## Voraussetzungen

- Node.js >= 20.0.0
- npm
- git
- Optional: Ollama (für lokale Modelle)

## Konfiguration

### Interaktiver Wizard

```bash
aios configure
```

Führt durch:
1. Anthropic API Key einrichten
2. Claude-Modell wählen
3. Ollama-Server konfigurieren (optional)
4. Default Provider wählen

### Dateien

| Datei | Zweck |
|-------|-------|
| ~/.aios/config.yaml | Provider, Modelle, Pfade |
| ~/.aios/.env | API Keys (chmod 600) |
| ~/.aios/patterns/ | Pattern-Bibliothek |
| ~/.aios/personas/ | Persona-Definitionen |
| ~/.aios/secrets.kdbx | Verschlüsselte Secrets (optional) |
| ~/.aios/repo/ | Geklontes Repository |

### Config-Hierarchie

AIOS sucht Konfiguration in dieser Reihenfolge:
1. `./aios.yaml` im aktuellen Verzeichnis (Projekt-Override)
2. `~/.aios/config.yaml` (globale Config, vom Wizard geschrieben)
3. Eingebaute Defaults

### API Keys

API Keys werden standardmäßig in `~/.aios/.env` gespeichert (nicht in der config.yaml). Unterstützte Variablen:
- `ANTHROPIC_API_KEY` — Anthropic API Key
- `GEMINI_API_KEY` — Google Gemini API Key
- `OPENAI_API_KEY` — OpenAI API Key

Die .env wird automatisch beim Start geladen. Alternativ kann der Key
auch als Umgebungsvariable gesetzt werden — eine bereits gesetzte
Umgebungsvariable hat Vorrang vor dem Wert in .env.

### Sichere Secret-Speicherung (empfohlen)

Für verschlüsselte Speicherung mit KeePass-kompatiblen `.kdbx`-Dateien:

```bash
# 1. Backend in config.yaml aktivieren
cat >> ~/.aios/config.yaml << 'EOF'
secrets:
  backend: keepassxc
  keepassxc:
    database: ~/.aios/secrets.kdbx
EOF

# 2. Bestehende .env-Secrets importieren
aios secret import

# 3. Oder einzeln setzen
aios secret set ANTHROPIC_API_KEY
```

Secrets werden per Context isoliert und mit AES-256 + Argon2 verschlüsselt.
Siehe [docs/secrets.md](secrets.md) für Details.

### Manuell konfigurieren

Statt den Wizard zu nutzen, können die Dateien direkt editiert werden:

```bash
# Config editieren
vim ~/.aios/config.yaml

# API Key setzen
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.aios/.env
chmod 600 ~/.aios/.env
```

### Config-Format (config.yaml)

```yaml
providers:
  claude:
    type: anthropic
    model: claude-sonnet-4-20250514
  ollama-fast:
    type: ollama
    model: qwen3:235b
    endpoint: http://localhost:11434

defaults:
  provider: claude

paths:
  patterns: ~/.aios/patterns
  personas: ~/.aios/personas
```

## Deinstallation

```bash
rm -rf ~/.aios
rm ~/.local/bin/aios
# Optional: AIOS-Zeilen aus .zshrc/.bashrc entfernen
```
