# Getting Started

Du willst AI sinnvoll in deinen Projekten nutzen — ohne jedes Mal von vorne anzufangen. AIOS gibt dir 62+ fertige Patterns (Zusammenfassen, Code-Review, Requirements extrahieren, ...) und orchestriert sie automatisch. Ein Befehl, den Rest plant AIOS.

---

## Voraussetzungen

- **Node.js 20+** und **npm** — [nodejs.org](https://nodejs.org/)
- **git**
- Einen **LLM-Provider**: [Anthropic API Key](https://console.anthropic.com/) oder ein lokales [Ollama](https://ollama.com)

## Installation

Ein Befehl. Der Installer prüft die Voraussetzungen, installiert alles und führt dich durch die Konfiguration.

```bash
curl -fsSL https://raw.githubusercontent.com/trosinde/AIOS/main/install.sh | bash
```

**Was passiert dabei?**
- Prüft ob Node.js, npm und git vorhanden sind
- Installiert AIOS nach `~/.aios/`
- Legt den `aios`-Befehl an
- Startet den Setup-Wizard — dort gibst du deinen API Key ein und wählst deinen Provider

Nach der Installation ein neues Terminal öffnen, fertig.

---

## Projekt einrichten

Wechsel in dein Projekt und initialisiere einen AIOS-Kontext:

```bash
cd mein-projekt
aios init --quick
```

Das erstellt einen `.aios/`-Ordner in deinem Projekt. Darin liegen Personas, Patterns und Wissen die nur für dieses Projekt gelten — komplett isoliert von deinen anderen Projekten.

---

## Erste Schritte

### Ein Pattern ausführen

Das einfachste: Text rein, Ergebnis raus.

```bash
cat README.md | aios run summarize
```

Oder direkt mit echo:

```bash
echo "Kubernetes uses etcd as distributed key-value store for cluster state" | aios run summarize
```

### Patterns verketten

Wie Unix-Pipes — die Ausgabe des einen wird zur Eingabe des nächsten:

```bash
cat spec.md | aios run extract_requirements | aios run generate_tests
```

Erst Requirements extrahieren, dann passende Tests generieren. Alles über Pipes.

### AIOS den Workflow planen lassen

Beschreib einfach was du willst. AIOS wählt die Patterns und plant die Ausführung:

```bash
aios "Analysiere den Code in src/ auf Sicherheitslücken und erstelle einen Bericht"
```

AIOS zerlegt das automatisch in Schritte, führt parallelisierbare Teile gleichzeitig aus und liefert das Ergebnis.

Willst du erst sehen was passieren würde, ohne es auszuführen?

```bash
aios "Analysiere den Code auf Sicherheitslücken" --dry-run
```

### Chat-Modus

Für interaktives Arbeiten:

```bash
aios chat
```

Im Chat kannst du natürliche Sprache nutzen oder Patterns direkt aufrufen:

```
aios> /summarize Das ist ein langer Text den ich zusammenfassen möchte...
aios> Welche Patterns gibt es für Code-Review?
aios> /security_review < main.ts
aios> /exit
```

---

## Was gibt es alles?

### Patterns anzeigen

```bash
aios patterns list
```

Zeigt alle 62+ Patterns, gruppiert nach Kategorie (analysis, generation, review, ...).

Nach Kategorie filtern:

```bash
aios patterns list --category analysis
```

Oder suchen:

```bash
aios patterns search security
```

### Lokale LLMs nutzen

Wenn du Ollama installiert hast, kannst du lokale Modelle verwenden:

```bash
aios "Fasse diesen Text zusammen" --provider ollama < dokument.md
```

Provider werden über `aios configure` oder in der `~/.aios/config.yaml` eingerichtet.

---

## Alltagsbeispiele

**Code reviewen:**
```bash
cat src/auth.ts | aios run code_review
```

**Requirements aus einer Spec extrahieren:**
```bash
cat pflichtenheft.md | aios run extract_requirements
```

**Komplette Analyse per natürlicher Sprache:**
```bash
aios "Review den Code in src/ auf Security und Code-Qualität, dann erstelle einen zusammenfassenden Bericht"
```

**Text übersetzen:**
```bash
echo "Technical documentation for the API" | aios run translate_technical --language=de
```

---

## Updates

AIOS aktualisiert sich selbst:

```bash
aios update
```

Oder nur prüfen ob ein Update verfügbar ist:

```bash
aios update --check
```

---

## Konfiguration ändern

Den Setup-Wizard erneut starten:

```bash
aios configure
```

Oder die Dateien direkt bearbeiten:

| Datei | Inhalt |
|-------|--------|
| `~/.aios/config.yaml` | Provider, Modelle, Pfade |
| `~/.aios/.env` | API Keys |
| `./aios.yaml` | Projekt-spezifische Overrides |

Details: [Setup & Konfiguration](SETUP.md)

---

## Weiter geht's

- [User Guide](user-guide.md) — Alle Befehle und Features im Detail
- [Patterns](PATTERNS.md) — Wie Patterns funktionieren und wie du eigene erstellst
- [Providers](providers.md) — Anthropic, Ollama, Gemini, OpenAI konfigurieren
- [CLI Commands](CLI_COMMANDS.md) — Komplette Befehlsreferenz
