# REQ-001: AIOS in GitHub Copilot CLI nutzbar machen

| Feld        | Wert                                                |
|-------------|-----------------------------------------------------|
| ID          | REQ-001                                              |
| Titel       | AIOS als MCP-Server in GitHub Copilot CLI verfügbar |
| Status      | Umgesetzt                                            |
| Priorität   | Hoch                                                 |
| Typ         | Integration / Developer Experience                  |

## Kontext

GitHub Copilot CLI (das `copilot`-Kommandozeilen-Tool) unterstützt das
[Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Lokale
MCP-Server werden in `~/.copilot/mcp-config.json` (überschreibbar via
`COPILOT_HOME`) registriert. AIOS bringt bereits einen vollwertigen
MCP-Server mit (`aios mcp-server`, stdio-Transport, siehe `src/mcp/server.ts`),
der die nativen Tools `aios_run`, `aios_orchestrate`, `aios_patterns` und
`aios_plan` exponiert.

Es fehlt der letzte Schritt: ein reibungsloser, dokumentierter Weg, AIOS in
GitHub Copilot CLI zu registrieren, ohne dass Nutzer das JSON-Format von Hand
zusammenbauen müssen.

## User Story

> Als AIOS-Nutzer möchte ich AIOS-Patterns und -Orchestrierung direkt aus
> GitHub Copilot CLI heraus aufrufen können, damit ich Code Review, Security
> Review, Requirements-Extraktion und dynamische Workflows ohne Tool-Wechsel
> in meinem gewohnten CLI-Agenten nutzen kann.

## Funktionale Anforderungen

- **FR-1**: Ein neuer Befehl `aios copilot install` schreibt einen
  AIOS-Eintrag in die Copilot-CLI-MCP-Konfiguration
  (`~/.copilot/mcp-config.json`, `COPILOT_HOME` respektiert).
- **FR-2**: Der Merge ist **idempotent** und **nicht-destruktiv**: bereits
  vorhandene MCP-Server in der Datei bleiben erhalten; nur der `aios`-Eintrag
  wird hinzugefügt bzw. aktualisiert.
- **FR-3**: `aios copilot install --print` (Dry-Run) gibt das resultierende
  JSON auf stdout aus und schreibt **nichts** auf die Platte.
- **FR-4**: `aios copilot uninstall` entfernt ausschließlich den
  `aios`-Eintrag und lässt andere Server unangetastet.
- **FR-5**: Das zu registrierende Kommando ist überschreibbar:
  - Default: `aios mcp-server` (wenn `aios` auf dem `PATH` liegt),
  - Fallback: `node <abs>/dist/cli.js mcp-server` (lokale Installation),
  - manuell via `--command` / `--args`.
- **FR-6**: Der Eintrag exponiert per Default alle Tools (`tools: ["*"]`).

## Nicht-funktionale Anforderungen

- **NFR-1 (Sicherheit)**: Es werden keine Secrets/PATs in die Config
  geschrieben. Environment-Variablen werden über das normale AIOS-`.env`
  geladen (siehe `docs/MCP.md`).
- **NFR-2 (Robustheit)**: Korrupte/leere `mcp-config.json` führt zu einer
  klaren Fehlermeldung, nicht zu Datenverlust.
- **NFR-3 (Konvention)**: Logging auf stderr, Ergebnis-JSON auf stdout
  (Unix-Konvention, CLAUDE.md).
- **NFR-4 (Testbarkeit)**: Die Merge-/Build-Logik ist als reine Funktion
  ohne I/O testbar.

## Akzeptanzkriterien

1. `aios copilot install` legt einen funktionsfähigen `aios`-Server-Eintrag
   an; ein anschließender `copilot`-Start zeigt die `aios_*`-Tools.
2. Wiederholtes `aios copilot install` verändert die Datei nicht (idempotent),
   außer bei geänderten Optionen.
3. Bereits vorhandene Fremd-Server (z.B. `github`) bleiben nach
   `install`/`uninstall` erhalten.
4. `--print` schreibt nichts und gibt valides JSON aus.
5. Unit-Tests decken Merge, Idempotenz, Uninstall und Korrupt-Datei ab.

## Out of Scope

- Remote-MCP-Server-Registrierung (nur `type: local`).
- Automatische Installation der GitHub Copilot CLI selbst.
