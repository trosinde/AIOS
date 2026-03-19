---
kernel_abi: 1
name: review_sow
description: "Prüft ein Statement of Work auf Vollständigkeit, messbare Akzeptanzkriterien und Compliance-Anforderungen"
category: procurement
input_type: text
output_type: review_report
tags: [procurement, sow, review, compliance, quality, regulated]
can_follow: [generate_sow]
can_precede: [contract_review]
persona: procurement_manager
---

# AUFGABE
Prüfe das eingereichte Statement of Work auf Vollständigkeit, Präzision und Compliance. Identifiziere fehlende Akzeptanzkriterien, vage Formulierungen, Compliance-Lücken und Scope-Risiken.

# STEPS
1. Struktur-Check: Sind alle erforderlichen Abschnitte vorhanden? (Scope, Out of Scope, Deliverables, Meilensteine, Compliance, Abnahme, Änderungsmanagement, Eskalation)
2. Akzeptanzkriterien prüfen: Hat jedes Deliverable ein messbares Kriterium? Ist es eindeutig testbar?
3. Scope-Analyse: Ist die Abgrenzung IN/OUT OF SCOPE klar? Gibt es Grauzonen die zu Scope Creep führen?
4. Compliance-Check: Sind IEC 62443-4-1, SBOM-Pflicht, Vulnerability Disclosure, Patch-Support und Audit-Recht adressiert?
5. Zahlungsplan prüfen: Sind Zahlungen an messbare Meilensteine gebunden (nicht nur an Zeitpunkte)?
6. Risiko-Identifikation: Fehlende Eskalationswege, unklare Verantwortlichkeiten, fehlende Change-Request-Prozesse
7. Gesamtbewertung und priorisierte Empfehlungen

# OUTPUT INSTRUCTIONS
Verwende diese Struktur:

```
# SOW REVIEW
## SOW-ID: [Referenz] | Datum: [YYYY-MM-DD]
## Reviewer: NEXUS (AIOS Procurement Agent)

---

### STRUKTUR-CHECK
| Abschnitt | Vorhanden | Vollständig | Anmerkung |
|-----------|-----------|-------------|-----------|

### AKZEPTANZKRITERIEN-PRÜFUNG
| Deliverable-ID | Kriterium vorhanden | Messbar | Problem |
|----------------|--------------------|---------|---------|

### COMPLIANCE-CHECK
| Anforderung | Adressiert | Bewertung | Empfehlung |
|-------------|-----------|-----------|------------|
| IEC 62443-4-1 SDL | ✅/❌ | | |
| SBOM-Pflicht | ✅/❌ | | |
| Vulnerability Disclosure | ✅/❌ | | |
| Patch-Support-Zeitraum | ✅/❌ | | |
| Audit-Recht | ✅/❌ | | |

### SCOPE-RISIKEN
[Grauzonen, potentieller Scope Creep, fehlende Abgrenzungen]

### FINDINGS (priorisiert)
| # | Schwere | Finding | Empfehlung |
|---|---------|---------|------------|

Schwere: KRITISCH (blockiert Freigabe) / HOCH / MITTEL / NIEDRIG

### GESAMTBEWERTUNG
**Status:** Freigabe / Freigabe mit Auflagen / Überarbeitung erforderlich
**Zusammenfassung:** [1-3 Sätze]
```

# INPUT
INPUT:
