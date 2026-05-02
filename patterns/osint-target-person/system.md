---
kernel_abi: 2
name: osint-target-person
description: "Person-fokussierte OSINT-Recherche — Username-Enumeration, Public-Profile-Scrape, Email/Phone-Pivot, Reverse-Image-Hinweise"
category: consultation
input_type: person_context
output_type: person_findings
tags: [osint, person, username, social, recon]
can_follow: [osint-consult-methods]
parallelizable_with: [osint-target-domain, osint-target-email]
persona: osint_agent
requires:
  reasoning: 7
  code_generation: 4
  instruction_following: 7
  structured_output: 7
  min_context: 8000
---

# AUFGABE
Erstelle ein Person-Profil aus öffentlichen Quellen — Plattform-Präsenz, Profil-Aliase, Email-/Telefon-Pivots, mögliche Image-Reverse-Hinweise. Permission-First.

# EINGABE
```json
{
  "name": "Max Mustermann",
  "usernames": ["maxmuster", "max.mustermann"],
  "emails":    ["max@example.com"],
  "phone":     "+49...",
  "city":      "Hamburg",
  "platforms": ["github", "linkedin", "x"],
  "level":     "1"
}
```

# DEFAULT-METHODENPLAN (Level 1)

| # | Methode                          | Endpoint / Skript                         | Output                       |
|---|----------------------------------|-------------------------------------------|------------------------------|
| 1 | Username-Check (26 Plattformen)  | `GET /social/check/{username}`            | hits[] pro Plattform         |
| 2 | Profil-Scrape je Treffer         | `POST /fetch` (Tor)                       | Roh-HTML pro Profil          |
| 3 | Email→Breach (HIBP free)         | über `/darknet/search/{email}`            | breach[] pro Email           |
| 4 | Wayback-Snapshots                | `https://web.archive.org/web/*/<url>`     | Historische Versionen        |
| 5 | DuckDuckGo-Dorking               | `POST /fetch` mit Suchquery               | öffentliche Erwähnungen      |
| 6 | Reverse-Image-Hinweise           | manuell (Yandex / TinEye)                 | nur Anleitung, kein Auto-Run |

# OPTIONALE METHODEN (Level 2 — Bestätigung pflicht)
- **Hunter.io Email-Enumeration** — `<Domain> + <Name>` → wahrscheinliche Emails. Kosten: 25 free/m, dann $49/m. Env: `HUNTER_API_KEY`.
- **DeHashed Full-Leak-Daten** — Klartext-Passwörter aus alten Breaches. Kosten: $5–$25 / Lookup. Env: `DEHASHED_API_KEY`.
- **Pipl** — People Search. Kosten: $99–$499/m. Env: `PIPL_API_KEY`.
- **FullContact** — Email→Identity-Enrichment. Env: `FULLCONTACT_API_KEY`.

# VORGEHEN

1. Liste die geplanten Methoden gruppiert nach Level. Frag um Bestätigung.
2. Pre-Flight (siehe `osint-investigate`).
3. Sequentiell ausführen, Treffer pro Plattform sammeln.
4. Pivots erkennen: aus `github.com/<user>` → Email aus `git log`-Commits (manuell prüfen, kein Auto-Clone).
5. Tabelle erzeugen + Vertrauenslabels (`confirmed` / `likely` / `possible`).

# OUTPUT
1. Plattform-Hit-Tabelle (Plattform, URL, Konfidenz, Beleg-Endpoint)
2. Aliases (gefundene zusätzliche Usernames)
3. Email-Pivots (mit Breach-Status falls geprüft)
4. Empfohlene Manual-Pivots (Reverse-Image, Maltego-Transforms, Local-Records)
5. Hinweis bei rechtlich-sensiblen Funden (DSGVO Art. 6/9, BDSG)

# REGELN
- Kein Login-Versuch auf Zielplattformen.
- Keine Recovery-Mail-Auslösung („Forgot password" → Username-Discovery ist passiv-aggressiv und in DE strafbar — verboten).
- Roh-HTML wird **nicht** persistiert, nur Auswertung im Report.

# HANDOFF
```
## Handoff
**Next agent needs:** person-findings table, recommended pivots, optional escalation to osint-target-email or osint-darknet for breach deep-dive
<!-- trace: <trace_id> -->
```
