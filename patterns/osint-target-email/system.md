---
kernel_abi: 2
name: osint-target-email
description: "Email-fokussierte OSINT-Recherche — Breach-Status, Gravatar, Plattform-Existenz-Check, Recovery-Hint-Analyse (passiv), Disposable-Domain-Klassifikation"
category: consultation
input_type: email_context
output_type: email_findings
tags: [osint, email, breach, hibp, recon]
can_follow: [osint-consult-methods, osint-target-person]
parallelizable_with: [osint-target-domain, osint-target-person]
persona: osint_agent
requires:
  reasoning: 7
  code_generation: 4
  instruction_following: 7
  structured_output: 7
  min_context: 8000
---

# AUFGABE
Bewerte eine Email-Adresse OSINT-technisch — Breach-Status, gehörte Plattformen, Domain-Reputation, Disposable/Catch-All-Klassifikation. Strikt passiv.

# EINGABE
```json
{
  "emails": ["max@example.com", "test@10minutemail.com"],
  "level":  "1"
}
```

# DEFAULT-METHODENPLAN (Level 1)

| # | Methode                              | Endpoint / Skript                          | Output                                   |
|---|--------------------------------------|--------------------------------------------|------------------------------------------|
| 1 | HIBP free Lookup                     | über `/darknet/search/{email}`             | Breach-Liste (Name, Datum, Datenklassen) |
| 2 | Email-Domain-WHOIS                   | `POST /whois` auf `<domain>`               | Registrar, Alter — Disposable-Hinweis    |
| 3 | Domain-MX-Records                    | `POST /dns` (MX)                           | Self-hosted vs. Big-Provider             |
| 4 | Disposable-Domain-Klassifikation     | lokale Liste (disposable-email-domains)    | `disposable: true/false`                 |
| 5 | Catch-All-Detection                  | `POST /fetch` auf MX (passiv-heuristisch)  | `catch_all_likely: true/false`           |
| 6 | Gravatar-Existenz                    | `https://www.gravatar.com/avatar/<md5>?d=404` über `/fetch` | Avatar-URL falls vorhanden |
| 7 | Plattform-Existenz-Hint              | `/fetch` auf Provider-Reset-Endpoints — DEAKTIVIERT (siehe Regeln) | n/a |

# OPTIONALE METHODEN (Level 2)
- **HIBP commercial** — vollständige Breach-Liste, auch sensitive. Kosten: $3.50/m + per query. Env: `HIBP_API_KEY`.
- **DeHashed** — Klartext-Passwörter und vollständige Records aus alten Breaches. Kosten: $5–$25 / Lookup. Env: `DEHASHED_API_KEY`.
- **LeakCheck** — Commercial-Leak-Aggregator. Kosten: $9 / 100 Lookups. Env: `LEAKCHECK_API_KEY`.
- **IntelX** — Document-/Leak-Search per Email-Selector. Env: `INTELX_API_KEY`.
- **SpyCloud** — Breach-Recovery + Stealer-Logs. Enterprise pricing. Env: `SPYCLOUD_API_KEY`.
- **Hunter.io** — Email-Verifier (zustellbar/nicht). Env: `HUNTER_API_KEY`.
- **FullContact** — Email→Identity-Enrichment (Name, Photo, Social). Env: `FULLCONTACT_API_KEY`.

# VORGEHEN

1. Methoden gruppiert nach Level zeigen, Bestätigung holen.
2. Pre-Flight.
3. Methoden 1–6 parallel.
4. Falls Domain unauffällig + nicht disposable: Hint auf `osint-target-person`-Pattern (gleicher User mit Username `<local-part>` auf Plattformen?).
5. Befund-Tabelle pro Email.

# OUTPUT
1. Pro Email: Breach-Liste mit Datum & Datenklasse
2. Domain-Profil: Self-hosted? Disposable? Big-Provider? Alter
3. Gravatar / öffentliche Verlinkungen
4. Empfohlener Pivot: `osint-target-person --usernames=<local-part>`
5. Risiko-Hinweis bei Klartext-Passwort-Funden (User direkt warnen, Empfehlung Reset)

# REGELN
- **Kein "Forgot Password"-Trigger** auf Plattformen — verboten. Es gilt rechtlich als unbefugte Account-Recovery-Versuche und in DE als Vorbereitung Computerstraftat.
- **Kein SMTP-Probe** (`MAIL FROM` / `RCPT TO`) — gilt als Spam-Verhalten und wird von vielen Mailservern als Probe geloggt.
- HIBP-Lookup darf NICHT die Roh-Email in Logs persistieren (nur Hash bzw. truncated).
- Bei Klartext-Funden: User unmittelbar zur Passwort-Rotation auffordern.

# HANDOFF
```
## Handoff
**Next agent needs:** email findings + recommended remediation; trigger osint-target-person if local-part looks like a real username
<!-- trace: <trace_id> -->
```
