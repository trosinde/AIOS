---
kernel_abi: 2
name: osint-investigate
description: "Vollautonome OSINT-Recherche zu einem Target — startet Stack, prüft Kill-Switch, fragt Methodenfreigabe ab, erzeugt Roh-JSON + Markdown-Report"
category: orchestration
input_type: target_context
output_type: osint_package
tags: [osint, tor, autonomous, orchestration, recon]
can_follow: []
parallelizable_with: []
persona: osint_agent
requires:
  reasoning: 7
  code_generation: 5
  instruction_following: 7
  structured_output: 6
  min_context: 12000
output_extraction:
  artifact_pattern: "(?<kind>report_json|report_md|next_steps|summary)\\s*[→:\\s]\\s*(?<content>.+)"
  artifact_type: file
  summary_strategy: first_paragraph
---

# AUFGABE
Führe eine vollautonome OSINT-Recherche zu einem Target durch: Stack starten, Kill-Switch verifizieren, Methodenliste vom User freigeben lassen, Recherche durchführen, Report erzeugen, Stack stoppen.

# EINGABE
JSON-Objekt mit dem Target und dem gewünschten Recherche-Profil:

```json
{
  "target": "Max Mustermann",
  "type":   "person",
  "context": {
    "usernames": ["maxmuster", "max.mustermann"],
    "emails":    ["max@example.com"],
    "domain":    "example.com"
  },
  "level":  "1",
  "skip":   ["darknet"]
}
```

Felder:
- `target` (Pflicht) — Hauptbezeichner (Name, Domain, IP, Username, Email, Telefon)
- `type` (Pflicht) — `person` | `domain` | `ip` | `username` | `email` | `phone`
- `context` (optional) — bekannte Pivots
- `level` — `"1"` (default, gratis) oder `"1+2"` (paid mit Bestätigung)
- `skip` — Methoden, die ausgelassen werden sollen (z. B. `["darknet"]`)

# ⛔ HARTE REGEL — NICHT VERHANDELBAR
**Kein Run ohne verifizierten Kill-Switch.** Wenn `verify-no-leak.sh` fehlschlägt: stoppe sofort, melde an den User. Kein Fallback auf direkten HTTP-Verkehr.

# VORGEHEN

1. **Pre-Flight.**
   ```bash
   cd /home/thorsten/dev/osint
   sudo docker compose ps
   # falls nicht running:
   sudo docker compose up --build -d
   bash scripts/verify-no-leak.sh
   curl -s http://localhost:8080/health | jq '.tor_connected'
   ```

2. **Methoden-Plan zeigen.** Liste die geplanten Endpoints, gruppiert nach Level. Bei `level: "1+2"` zusätzlich Kosten-/Quota-Hinweis pro Level-2-Methode. Frag um Bestätigung — außer der Aufrufer hat `auto_confirm: true` gesetzt.

3. **Recherche.** Default-Profil je nach `type`:
   - `person`: `osint_report.py --name "<target>" [--usernames ...]`
   - `domain`: `osint_report.py --domain <target>`
   - `ip`:     `osint_report.py --ip <target>`
   - `username`: `osint_report.py --username <target>`
   - `email`: kein direktes Profil — fallback auf `osint-target-email`-Pattern
   - `phone`: `osint_report.py --phone "<target>"`

   Aufruf:
   ```bash
   python3 /home/thorsten/dev/osint/scripts/osint_report.py \
     --name "<target>" \
     --usernames "<csv>" \
     --no-shutdown \
     [--skip-darknet]
   ```
   `--no-shutdown` setzen, weil dieses Pattern den Stack selbst kontrolliert.

4. **Report einsammeln.** Die Reports liegen in `/home/thorsten/dev/osint/reports/<Target>_<TS>.{json,md}`. Pfade an den Aufrufer durchreichen.

5. **Stack stoppen** (außer der Aufrufer hat `keep_stack_running: true` gesetzt):
   ```bash
   sudo docker compose -f /home/thorsten/dev/osint/docker-compose.yml down
   ```

# OUTPUT (an den Aufrufer)
1. Pfad zu `<Target>_<TS>.json` und `<Target>_<TS>.md`
2. Top-5-Findings (Plattform/Domain + Beleg-URL/Endpoint, Konfidenz)
3. 3 wichtigste Next-Steps (manuelle Pivots, die der Agent nicht autonom macht)
4. Hinweis auf Stack-Status (running / stopped) und ggf. übrig gebliebene Reports

# REGELN
- Niemals direkter HTTP-Traffic — alles über `osint-api`.
- Niemals Level-2 ohne explizite Bestätigung.
- Niemals einen Report committen oder in den Knowledge-Bus persistieren ohne PII-Filter (`scripts/osint_report.py` macht das bereits).
- Bei niedriger Konfidenz: prefix `⚠️ LOW_CONFIDENCE: <Grund>`.

# HANDOFF
```
## Handoff
**Next agent needs:** report paths, top findings, optionally trigger osint-target-* for deep-dive on a specific pivot
<!-- trace: <trace_id> -->
```
