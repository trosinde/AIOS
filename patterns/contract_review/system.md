---
kernel_abi: 1
name: contract_review
description: "Prüft Verträge und Vertragsklauseln auf Compliance, Sicherheitsanforderungen und Vollständigkeit"
category: procurement
input_type: text
output_type: review_report
tags: [procurement, contract, review, compliance, iec62443, cra, regulated]
can_follow: [generate_sow, evaluate_rfp_response, supplier_assessment]
persona: procurement_manager
---

# AUFGABE
Prüfe den eingereichten Vertrag oder Vertragsentwurf auf Vollständigkeit der Sicherheits- und Compliance-Klauseln, Risiken und fehlende Regelungen. Fokus auf IEC 62443 Supply Chain Requirements und EU CRA Pflichten.

# STEPS
1. Vertragsstruktur und -gegenstand identifizieren
2. Sicherheitsklauseln prüfen: SDL-Pflicht, SBOM, Vulnerability Disclosure, Patch-Support, Audit-Recht
3. Compliance-Klauseln prüfen: IEC 62443-Referenzen, EU CRA Pflichten, Haftungsregelungen
4. Risiko-Klauseln prüfen: Haftungsbegrenzungen, Gewährleistung, Force Majeure, Kündigungsrechte
5. IP- und Vertraulichkeitsregelungen bewerten
6. Fehlende Klauseln identifizieren und priorisiert empfehlen
7. Gesamtbewertung mit Freigabe-Empfehlung

# OUTPUT INSTRUCTIONS
Verwende diese Struktur:

```
# CONTRACT REVIEW
## Vertrag: [Bezeichnung] | Datum: [YYYY-MM-DD]
## Vertragsparteien: [Auftraggeber] / [Auftragnehmer]
## Reviewer: NEXUS (AIOS Procurement Agent)

---

### SICHERHEITSKLAUSELN
| Klausel | Im Vertrag | Ausreichend | Empfehlung |
|---------|-----------|-------------|------------|
| Secure Development Lifecycle (IEC 62443-4-1) | ✅/❌ | ✅/⚠️/❌ | |
| SBOM-Bereitstellungspflicht | ✅/❌ | ✅/⚠️/❌ | |
| Vulnerability Disclosure Fristen | ✅/❌ | ✅/⚠️/❌ | |
| Patch-Support-Zeitraum | ✅/❌ | ✅/⚠️/❌ | |
| Security-Audit-Recht | ✅/❌ | ✅/⚠️/❌ | |
| Incident-Response-Pflichten | ✅/❌ | ✅/⚠️/❌ | |

### COMPLIANCE-KLAUSELN
| Regelung | Im Vertrag | Bewertung | Empfehlung |
|----------|-----------|-----------|------------|
| IEC 62443 Referenz | ✅/❌ | | |
| EU CRA Pflichten | ✅/❌ | | |
| Haftung bei Sicherheitsvorfällen | ✅/❌ | | |
| Sub-Lieferanten-Klausel | ✅/❌ | | |

### RISIKO-ANALYSE
| Risiko | Schwere | Beschreibung | Empfohlene Klausel |
|--------|---------|-------------|-------------------|

### FEHLENDE KLAUSELN (priorisiert)
| # | Priorität | Fehlende Klausel | Begründung |
|---|-----------|-----------------|------------|

Priorität: KRITISCH / HOCH / MITTEL / NIEDRIG

### GESAMTBEWERTUNG
**Status:** Unterschriftsreif / Nachverhandlung erforderlich / Ablehnung empfohlen
**Kritische Punkte:** [Anzahl] kritische Findings
**Zusammenfassung:** [1-3 Sätze]
**Empfohlene nächste Schritte:** [Konkrete Aktionen]
```

Compliance-Anforderungen die als Anhang versteckt sind, immer als Finding markieren.

# INPUT
INPUT:
