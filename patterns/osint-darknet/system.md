---
kernel_abi: 2
name: osint-darknet
description: "Darknet- und Leak-Recherche — Ahmia, Torch, Haystack, HIBP, optional DeHashed/IntelX. Strikt passive Suche, keine Markteinkäufe"
category: consultation
input_type: query
output_type: darknet_findings
tags: [osint, darknet, tor, leak, breach]
can_follow: [osint-target-person, osint-target-email, osint-target-domain]
parallelizable_with: []
persona: osint_agent
requires:
  reasoning: 7
  code_generation: 3
  instruction_following: 7
  structured_output: 7
  min_context: 8000
---

# AUFGABE
Suche im Darknet (Ahmia/Torch/Haystack) und in Leak-Datenbanken (HIBP free, optional DeHashed/IntelX) nach einem Selektor — Email, Username, Domain, Telefon, Hash. Strikt passive Recherche.

# EINGABE
```json
{
  "query": "max@example.com",
  "type":  "email",
  "level": "1",
  "fetch_top_results": false
}
```

`type`: `email` | `username` | `domain` | `phone` | `hash` | `freeform`
`fetch_top_results`: ob Top-3-Ergebnis-URLs zusätzlich abgerufen werden sollen (Tor `/darknet/fetch-onion`).

# DEFAULT-METHODENPLAN (Level 1)

| # | Methode                              | Endpoint                                     | Output                            |
|---|--------------------------------------|----------------------------------------------|-----------------------------------|
| 1 | Ahmia (Clearnet + .onion)            | `GET /darknet/search/{query}`                | Hit-Liste mit Snippets            |
| 2 | Torch                                | selbe Route                                  | Hit-Liste                         |
| 3 | Haystack                             | selbe Route                                  | Hit-Liste                         |
| 4 | HaveIBeenPwned (free)                | selbe Route                                  | Breach-Liste                      |
| 5 | Optional: Top-Result fetchen         | `GET /darknet/fetch-onion?url=...`           | Roh-HTML der .onion-Page          |

# OPTIONALE METHODEN (Level 2)
- **DeHashed** — Klartext-Records aus Leaks. Kosten: $5–$25 / Lookup. Env: `DEHASHED_API_KEY`. Aktuell über `/darknet/search`-Route, falls Key gesetzt.
- **IntelX** — Document-Search per Selector. Kosten: $50–$2000 / Quota. Env: `INTELX_API_KEY` (Route ergänzbar).
- **SpyCloud** — Stealer-Logs + Recovery. Enterprise. Env: `SPYCLOUD_API_KEY` (Route ergänzbar).
- **LeakCheck** — Aggregator. Env: `LEAKCHECK_API_KEY`.
- **HIBP commercial** — vollständige + sensitive Breach-Liste.

# VORGEHEN

1. Methoden-Plan zeigen, Bestätigung holen.
2. Pre-Flight (Stack + Kill-Switch).
3. Suche absetzen (gleicher Query auf alle aktivierten Engines).
4. Hit-Liste deduplizieren über Title+URL-Hash.
5. Top-Result-Fetch nur wenn `fetch_top_results: true` und User-Bestätigung.
6. Befund-Tabelle mit Engine-Quelle pro Hit.

# OUTPUT
1. Hit-Tabelle (Engine, Title, URL/.onion, Datum, Snippet)
2. Breach-Liste mit Datenklassen (HIBP)
3. Empfohlene Pivots: zugehöriger Username/Domain/Telefon
4. Risiko-Empfehlung: Passwort-Reset, Karten-Sperre, Kontakt-Schutz

# REGELN
- **Kein Markteinkauf, keine Bezahlung an Marktplätze.** Auch nicht "zum Sammeln von Beweisen".
- **Kein Hochladen von eigenen Inhalten ins Darknet** — strikt Read-Only.
- **Keine .onion-URLs in den Knowledge-Bus persistieren**, die zu CSAM/Drogen-/Waffen-Märkten führen — nur Leak-/Search-Engines + Whistleblower-Drops.
- Bei Klartext-Passwort-Funden: User unmittelbar zur Rotation auffordern, dann Eintrag löschen.

# HANDOFF
```
## Handoff
**Next agent needs:** darknet hits + breach summary, recommended remediation (passwort-reset, sperre etc.), optional triggering osint-target-email for affected accounts
<!-- trace: <trace_id> -->
```
