---
kernel_abi: 1
name: generate_rfp
description: "Erstellt ein vollständiges Request for Proposal (RFP) mit technischen, kommerziellen und Compliance-Anforderungen"
category: procurement
input_type: text
output_type: rfp_document
tags: [procurement, rfp, compliance, iec62443, cra, regulated]
can_follow: [extract_requirements, gap_analysis, threat_model]
can_precede: [evaluate_rfp_response, generate_evaluation_matrix]
persona: procurement_manager
---

# AUFGABE
Erstelle ein vollständiges Request for Proposal (RFP) basierend auf dem Input. Das RFP muss technische Anforderungen, Compliance-Pflichten (IEC 62443, EU CRA) und Bewertungskriterien enthalten.

# STEPS
1. Kontext und Beschaffungsgegenstand aus dem Input extrahieren
2. Technische Anforderungen mit REQ-IDs strukturieren und priorisieren (Must/Should/Could)
3. Compliance- und Sicherheitsanforderungen nach IEC 62443 und EU CRA einbetten
4. Lieferumfang mit messbaren Meilensteinen und Akzeptanzkriterien definieren
5. Bewertungskriterien gewichtet und transparent festlegen – VOR dem Versand
6. Vertragsrahmenbedingungen inkl. Sicherheitsklauseln formulieren
7. Prozess und Timeline mit klaren Fristen definieren

# OUTPUT INSTRUCTIONS
Verwende exakt diese Struktur:

```
# REQUEST FOR PROPOSAL
## RFP-ID: RFP-[YYYY]-[NNN]
## Titel: [Beschaffungsgegenstand]
## Ausgabedatum: [YYYY-MM-DD]
## Einreichungsfrist: [YYYY-MM-DD HH:MM]
## Kontakt: [Name / E-Mail]

---

### 1. HINTERGRUND & KONTEXT
[Auftraggeber, Projekt, regulatorischer Kontext – IEC 62443 / EU CRA explizit benennen]

### 2. BESCHAFFUNGSGEGENSTAND
[Was wird gesucht – IN SCOPE und OUT OF SCOPE klar abgrenzen]

### 3. TECHNISCHE ANFORDERUNGEN
| REQ-ID | Anforderung | Priorität | Nachweisform |
|--------|-------------|-----------|--------------|

### 4. COMPLIANCE & SICHERHEITSANFORDERUNGEN
- [ ] Lieferant hat dokumentierten Secure Development Lifecycle (IEC 62443-4-1)
- [ ] Vulnerability Disclosure Policy vorhanden und öffentlich
- [ ] SBOM für alle gelieferten Komponenten bereitstellbar (CycloneDX / SPDX)
- [ ] Patch-Support-Zeitraum definiert und vertraglich zugesichert
- [ ] Incident Response Prozess dokumentiert

### 5. LIEFERUMFANG & MEILENSTEINE
| Meilenstein | Beschreibung | Fälligkeitsdatum | Akzeptanzkriterium |
|-------------|-------------|-----------------|---------------------|

### 6. VERTRAGSRAHMENBEDINGUNGEN
[Laufzeit, Zahlungsmodell, IP-Regelung, Haftung, Sicherheitsklauseln]

### 7. BEWERBUNGSANFORDERUNGEN
[Was muss der Anbieter einreichen?]

### 8. BEWERTUNGSKRITERIEN
| Kriterium | Gewichtung | Bewertungsmaßstab |
|-----------|------------|-------------------|

### 9. PROZESS & TIMELINE
[Fragen-Deadline, Bietergespräche, Entscheidungsdatum]
```

Keine Bewertungskriterien auslassen. Jede Anforderung muss eine Nachweisform haben.

# INPUT
INPUT:
