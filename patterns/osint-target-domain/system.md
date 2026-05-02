---
kernel_abi: 2
name: osint-target-domain
description: "Domain- / Infrastructure-fokussierte OSINT-Recherche — DNS, WHOIS, Subdomains, Cert-Transparency, HTTP-Banner, Origin-IP-Probing"
category: consultation
input_type: domain_context
output_type: domain_findings
tags: [osint, domain, dns, whois, subdomain, infrastructure]
can_follow: [osint-consult-methods]
parallelizable_with: [osint-target-person, osint-target-email]
persona: osint_agent
requires:
  reasoning: 7
  code_generation: 4
  instruction_following: 7
  structured_output: 7
  min_context: 8000
---

# AUFGABE
Erstelle ein Infrastructure-Profil zu einer Domain — Registrierungsdaten, DNS-Records, Subdomains, TLS-Cert-History, Tech-Stack-Hinweise, Origin-IP hinter CDNs. Permission-First.

# EINGABE
```json
{
  "domain": "example.com",
  "include_subdomain_bruteforce": true,
  "include_origin_probe": true,
  "level": "1"
}
```

# DEFAULT-METHODENPLAN (Level 1)

| # | Methode                                  | Endpoint / Skript                          | Output                            |
|---|------------------------------------------|--------------------------------------------|-----------------------------------|
| 1 | WHOIS                                    | `POST /whois`                              | Registrar, Dates, Contact-Hashes  |
| 2 | DNS A/AAAA/MX/TXT/NS/CNAME               | `POST /dns`                                | DNS-Records                       |
| 3 | Cert-Transparency (crt.sh)               | `app/routers/scam.py:_crtsh_lookup`        | historische Subdomains            |
| 4 | Amass passive Subdomain-Enum             | `POST /amass/enum`                         | Subdomain-Liste                   |
| 5 | Subdomain-Bruteforce (DoH)               | eingebaut in `/scam/probe`                 | aktive Subdomains aus Wordlist    |
| 6 | HTTP-Banner / robots.txt / security.txt  | `POST /fetch`                              | Server-Banner, Disclosure-Policy  |
| 7 | Wayback-Snapshots                        | `https://web.archive.org/web/*/<url>`      | historische Inhalte               |
| 8 | urlscan.io public                        | eingebaut in `/scam/*`                     | letzte Scans, Screenshots         |
| 9 | SpiderFoot (Module-Set free)             | `POST /spiderfoot/scan`                    | breites Pivot-Set                 |
|10 | Recon-ng (free modules)                  | `POST /recon-ng/run`                       | strukturierte Pivots              |
|11 | Origin-IP-Probing (hinter Cloudflare)    | `POST /scam/probe`                         | nicht-CF-IPs aus Cert + DNS       |

# OPTIONALE METHODEN (Level 2)
- **Shodan Host-Lookup** je gefundener IP — `GET /shodan/host/{ip}`. Kosten: 1 query credit / IP. Env: `SHODAN_API_KEY`.
- **Shodan Search** (`hostname:<domain>`) — `POST /shodan/search`. Env: `SHODAN_API_KEY`.
- **Censys Search** — Cert + Service Discovery. Kosten: 250 free/m, dann $99/m. Env: `CENSYS_API_KEY`.
- **SecurityTrails Historical DNS** — DNS-History, alte A-Records. Env: `SECURITYTRAILS_API_KEY`.
- **WhoisXMLAPI Historic WHOIS** — WHOIS-History trotz Privacy-Schutz. Env: `WHOISXMLAPI_KEY`.
- **DomainTools Iris** — Zusammenhang zwischen Domains (Pivot via Registrant-Hash). Env: `DOMAINTOOLS_API_KEY`.
- **BuiltWith** — Tech-Stack-Detail (Trackers, Frameworks, Versions). Env: `BUILTWITH_API_KEY`.

# VORGEHEN

1. Liste die geplanten Methoden gruppiert nach Level. Frag um Bestätigung.
2. Pre-Flight (Stack + Kill-Switch).
3. Methoden 1–4 parallel (WHOIS / DNS / crt.sh / Amass).
4. Methoden 5–11 sequentiell, jeweils mit dem Output der vorigen verkettet.
5. Subdomain-Liste deduplizieren (crt.sh ∪ Amass ∪ Bruteforce).
6. Origin-IP-Probing nur wenn CDN erkannt (CF/Akamai/Fastly).
7. Tabellen erzeugen, Konfidenz markieren.

# OUTPUT
1. Registrierungs-Block (Registrar, Created, Expires, NS, abuse@-Kontakt)
2. DNS-Tabelle
3. Subdomain-Liste mit Quelle (crt.sh / Amass / brute / scan)
4. Tech-Stack-Hinweise (Server-Banner, robots.txt, security.txt, urlscan-tags)
5. Mögliche Origin-IPs hinter CDN, mit Begründung
6. Historische Snapshots (Wayback / urlscan)
7. Empfohlene Pivots (Cert-Linked-Domains, Subdomain-Takeover-Hinweise)

# REGELN
- Kein aktives Port-Scanning, kein DNS-Brute-Force über UDP (Tor blockt UDP — passiv only).
- Origin-IP-Probing macht nur HTTPS-HEAD-Requests, kein Login.
- Keine `dirbuster`-/`gobuster`-artigen Path-Bruteforce-Aktionen.

# HANDOFF
```
## Handoff
**Next agent needs:** domain-findings, top pivots, optional Shodan deep-dive (level 2) or osint-scam triage if domain looks malicious
<!-- trace: <trace_id> -->
```
