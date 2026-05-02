---
kernel_abi: 2
name: osint-scam
description: "Scam- und Phishing-Triage über die scam_investigation.py-Pipeline — URL/Email/Image, Origin-IP-Probing, IOK-Match, Beweissicherung"
category: orchestration
input_type: scam_context
output_type: scam_report
tags: [osint, scam, phishing, triage, evidence]
can_follow: []
parallelizable_with: []
persona: osint_agent
requires:
  reasoning: 7
  code_generation: 5
  instruction_following: 7
  structured_output: 7
  min_context: 12000
output_extraction:
  artifact_pattern: "(?<kind>scam_json|scam_md|evidence|summary)\\s*[→:\\s]\\s*(?<content>.+)"
  artifact_type: file
  summary_strategy: first_paragraph
---

# AUFGABE
Triage einen verdächtigen URL/Email/Screenshot mit der Standard-Pipeline `scripts/scam_investigation.py`. Sammle Beweise (Wayback/archive.ph), prüfe IOK-/PhishTank-/OpenPhish-Treffer, bestimme Origin-IP hinter CDN, erzeuge JSON + Markdown-Report.

# EINGABE
```json
{
  "url":   "https://klelnanzeigen-deutch.gorzlz.online/receive/order/nhA8jTUh_C",
  "email": "rilezede509@gmail.com",
  "image": "/path/to/fake_screenshot.png",
  "level": "1",
  "keep_stack_running": false
}
```

Mindestens `url` ODER `email` ODER `image` — alle drei sind optional, aber mindestens eines muss gesetzt sein.

# DEFAULT-METHODENPLAN (Level 1, eingebaut in `scam_investigation.py`)

| # | Schritt                                    | Quelle                                         |
|---|--------------------------------------------|------------------------------------------------|
| 1 | URL parsen + Parent-Domain ermitteln       | `_parent_domain`                               |
| 2 | DNS A/AAAA/MX/TXT/NS/CNAME via Tor-DNS     | `_resolve` (port 5353)                         |
| 3 | WHOIS via Tor                              | `_whois_via_tor`                               |
| 4 | Cert-Transparency (crt.sh)                 | `_crtsh_lookup`                                |
| 5 | urlscan.io public Lookup                   | `_urlscan_lookup`                              |
| 6 | Subdomain-Bruteforce (DoH)                 | `_bruteforce_subdomains`                       |
| 7 | Origin-DNS-Records (DoH-bypass des CDN)    | `_origin_dns_records`                          |
| 8 | PhishTank + OpenPhish Match                | `_phishtank_check`, `_openphish_check`         |
| 9 | PhishReport IOK Match                      | `_phishreport_iok`                             |
|10 | Origin-Probe (HTTPS HEAD, kein Login)      | `_origin_probe`                                |
|11 | abuse@-Kontakt-Discovery                   | `_abuse_contact`                               |
|12 | Beweissicherung Wayback + archive.ph       | `_wayback_save`, `_archive_ph`                 |
|13 | Optional: Screenshot-EXIF-Dump             | lokal (exiftool)                               |
|14 | Email-Header-Parser (falls Raw-Header)     | `/scam/headers`-Endpoint                       |

# OPTIONALE METHODEN (Level 2)
- **Shodan Host-Lookup pro Origin-IP** — `GET /shodan/host/{ip}`. Kosten: 1 query credit / IP. Env: `SHODAN_API_KEY`.
- **VirusTotal URL Reputation** — nicht eingebaut, ergänzbar. Free-Tier mit Quota. Env: `VT_API_KEY`.
- **DomainTools Iris** — Registrant-Hash-Pivots zu Schwester-Domains. Env: `DOMAINTOOLS_API_KEY`.

# VORGEHEN

1. Pre-Flight: Stack starten + `verify-no-leak.sh` laufen lassen.
2. Methoden-Plan zeigen, Bestätigung holen.
3. Aufruf:
   ```bash
   python3 /home/thorsten/dev/osint/scripts/scam_investigation.py \
     --url   "<url>" \
     [--email "<email>"] \
     [--image "<path>"] \
     --no-shutdown
   ```
4. Output (`reports/scam_<TS>.json` und `.md`) parsen.
5. Verdikt zusammenfassen:
   - **CONFIRMED PHISHING** — wenn IOK-/PhishTank-/OpenPhish-Hit
   - **HIGH SUSPICION** — wenn Origin-Probing Inhalt zeigt + Domain neu (<30d)
   - **LIKELY PHISHING** — Heuristik-Treffer, aber kein direkter IOK-Match
   - **INCONCLUSIVE** — keine eindeutigen Indikatoren
6. Stack stoppen (außer `keep_stack_running: true`).

# OUTPUT
1. Pfade zu `scam_<TS>.{json,md}`
2. Verdikt + Begründung (Top-3-Indikatoren)
3. Origin-IP-Kandidaten (mit Probe-Beleg)
4. abuse@-Kontakt für Takedown-Request
5. Beweis-URLs (Wayback, archive.ph)
6. Empfohlene Next-Steps: Takedown-Mail-Template, Behörden-Meldung (BSI/Hostingprovider), User-Warnung

# REGELN
- Kein Login, keine Form-Submits, kein POST mit Credentials — strikt HEAD/GET.
- Wayback-/archive.ph-Snapshots sind erlaubt (öffentliche Archive).
- Screenshots dürfen lokal gespeichert werden, aber nicht im Knowledge-Bus persistiert (PII-Risiko).
- Wenn der User selbst geschädigt ist: Hinweis auf Anzeige bei der Polizei + Verbraucherzentrale + Hosting-abuse@.

# HANDOFF
```
## Handoff
**Next agent needs:** scam report paths, verdict, abuse@-contact, recommended takedown actions
<!-- trace: <trace_id> -->
```
