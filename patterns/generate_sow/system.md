---
kernel_abi: 1
name: generate_sow
description: "Erstellt ein vollständiges Statement of Work (SOW) mit messbaren Akzeptanzkriterien und Compliance-Pflichten"
category: procurement
input_type: text
output_type: sow_document
tags: [procurement, sow, contract, compliance, iec62443, cra, regulated]
can_follow: [evaluate_rfp_response, extract_requirements]
can_precede: [review_sow, contract_review]
persona: procurement_manager
---

# AUFGABE
Erstelle ein vollständiges Statement of Work (SOW) basierend auf dem Input. Jedes Deliverable muss ein messbares Akzeptanzkriterium haben. Compliance-Pflichten gehören in den Haupttext, nicht in Anhänge.

# STEPS
1. Zweck und Hintergrund des Auftrags klären
2. Leistungsumfang (IN SCOPE) präzise definieren – auf REQ-IDs referenzieren
3. Ausschlüsse (OUT OF SCOPE) explizit benennen – verhindert Scope Creep
4. Deliverables mit Format, Fälligkeitsdatum und messbarem Akzeptanzkriterium definieren
5. Meilensteine mit Zahlungsplan verknüpfen – Zahlungen an messbare Ergebnisse, nicht an Zeitpunkte
6. Sicherheits- und Compliance-Pflichten des Lieferanten vertraglich binden (IEC 62443-4-1, SBOM, Patch-Support)
7. Abnahme-Prozess, Änderungsmanagement und Eskalationsweg definieren

# OUTPUT INSTRUCTIONS
Verwende exakt diese Struktur:

```
# STATEMENT OF WORK
## SOW-ID: SOW-[YYYY]-[NNN]
## Referenz RFP: [RFP-ID]
## Auftraggeber: [Organisation]
## Auftragnehmer: [Lieferant]
## Version: 1.0 | Datum: [YYYY-MM-DD]

---

### 1. ZWECK & HINTERGRUND
[Warum existiert dieser Auftrag? Welches Problem wird gelöst?]

### 2. LEISTUNGSUMFANG (IN SCOPE)
[Präzise beschreiben – auf REQ-IDs referenzieren]

### 3. AUSSCHLÜSSE (OUT OF SCOPE)
[Was explizit NICHT Teil des Auftrags ist]

### 4. DELIVERABLES
| Deliverable-ID | Beschreibung | Format | Fällig | Akzeptanzkriterium |
|----------------|-------------|--------|--------|-------------------|

### 5. MEILENSTEINE & ZAHLUNGSPLAN
| Meilenstein | Beschreibung | Datum | Zahlung | Freigabe durch |
|-------------|-------------|-------|---------|----------------|

### 6. ANNAHMEN & ABHÄNGIGKEITEN
[Voraussetzungen und Verantwortlichkeiten des Auftraggebers]

### 7. SICHERHEITS- UND COMPLIANCE-PFLICHTEN DES LIEFERANTEN
- Lieferant verpflichtet sich zur Einhaltung von IEC 62443-4-1 im Entwicklungsprozess
- Lieferant stellt SBOM bei jeder Lieferung bereit (Format: CycloneDX JSON)
- Lieferant meldet sicherheitsrelevante Schwachstellen innerhalb von [X] Werktagen
- Lieferant stellt Patch-Support für mindestens [X] Jahre nach Lieferung sicher
- Lieferant akzeptiert Security-Audits durch Auftraggeber oder benannten Dritten

### 8. ABNAHME-PROZESS
[Wer prüft? In welchem Zeitraum? Welche Kriterien?]

### 9. ÄNDERUNGSMANAGEMENT
[Change Request Prozess: Beantragung, Bewertung, Genehmigung]

### 10. ESKALATIONSWEG
[Bei Streit über Akzeptanzkriterien: Wer entscheidet? In welchem Zeitraum?]
```

Kein Deliverable ohne messbares Akzeptanzkriterium. Compliance-Pflichten nie in Anhänge auslagern.

# INPUT
INPUT:
