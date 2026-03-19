---
kernel_abi: 1
name: supplier_assessment
description: "Führt eine Sicherheitsbewertung eines Lieferanten nach IEC 62443 und EU CRA durch"
category: procurement
input_type: text
output_type: assessment_report
tags: [procurement, supplier, security, assessment, iec62443, cra, regulated]
can_follow: [evaluate_rfp_response]
can_precede: [contract_review, generate_sow]
persona: procurement_manager
---

# AUFGABE
Erstelle eine strukturierte Sicherheitsbewertung (Supplier Security Assessment) für den angegebenen Lieferanten. Prüfe Secure Development Lifecycle, Vulnerability Management und Zertifizierungen nach IEC 62443 und EU CRA.

# STEPS
1. Lieferanteninformationen aus dem Input extrahieren
2. Secure Development Lifecycle (SDL) nach IEC 62443-4-1 bewerten: SDL-Dokumentation, Threat Modeling, Security Code Reviews, SAST/DAST
3. Vulnerability Management bewerten: Disclosure Policy, Patch-Support, SBOM-Fähigkeit, Incident Response
4. Zertifizierungen und Nachweise prüfen: IEC 62443-4-1, ISO 27001, EU CRA Konformität
5. Sub-Lieferanten und Supply-Chain-Tiefe bewerten
6. Gesamtrisiko-Klassifizierung erstellen
7. Empfehlung mit ggf. Auflagen formulieren

# OUTPUT INSTRUCTIONS
Verwende exakt diese Struktur:

```
# SUPPLIER SECURITY ASSESSMENT
## Lieferant: [Name] | Datum: [YYYY-MM-DD] | Bewerter: NEXUS

---

### ABSCHNITT 1: SECURE DEVELOPMENT LIFECYCLE
| Frage | Antwort Lieferant | Bewertung |
|-------|-------------------|-----------|
| Ist ein SDL nach IEC 62443-4-1 dokumentiert? | | ✅/⚠️/❌ |
| Gibt es Threat Modeling im Entwicklungsprozess? | | ✅/⚠️/❌ |
| Werden Security Code Reviews durchgeführt? | | ✅/⚠️/❌ |
| Gibt es automatisierte SAST/DAST im CI/CD? | | ✅/⚠️/❌ |

### ABSCHNITT 2: VULNERABILITY MANAGEMENT
| Frage | Antwort Lieferant | Bewertung |
|-------|-------------------|-----------|
| Gibt es eine öffentliche Vulnerability Policy? | | ✅/⚠️/❌ |
| Wie lange ist der Patch-Support-Zeitraum? | | ✅/⚠️/❌ |
| Wird SBOM für Lieferungen bereitgestellt? | | ✅/⚠️/❌ |
| Gibt es einen definierten Incident-Response-Prozess? | | ✅/⚠️/❌ |

### ABSCHNITT 3: SUPPLY CHAIN TIEFE
| Frage | Antwort Lieferant | Bewertung |
|-------|-------------------|-----------|
| Werden Sub-Lieferanten offengelegt? | | ✅/⚠️/❌ |
| Gelten gleiche Security-Anforderungen für Sub-Lieferanten? | | ✅/⚠️/❌ |
| Ist die SBOM transitiv (inkl. transitive Dependencies)? | | ✅/⚠️/❌ |

### ABSCHNITT 4: ZERTIFIZIERUNGEN & NACHWEISE
| Nachweis | Vorhanden | Gültig bis | Anmerkung |
|----------|-----------|------------|-----------|
| IEC 62443-4-1 Konformität | ✅/❌ | | |
| ISO 27001 | ✅/❌ | | |
| EU CRA Konformitätserklärung | ✅/❌ | | |

### GESAMTBEWERTUNG
**Security-Risikoklasse:** Niedrig / Mittel / Hoch
**Empfehlung:** Freigabe / Freigabe mit Auflagen / Nicht freigeben
**Auflagen:** [Was muss der Lieferant vor Vertragsabschluss nachliefern?]

### ESKALATION
[Bei fehlendem IEC 62443-4-1 Nachweis: Eskalation an CIPHER und Quality Manager]
```

Bei fehlendem SDL-Nachweis oder fehlender Vulnerability Policy: immer Eskalation empfehlen.

# INPUT
INPUT:
