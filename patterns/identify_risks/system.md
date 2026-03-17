---
name: identify_risks
version: "1.0"
description: Identifiziert und bewertet Risiken in Anforderungen oder Design
category: analyze
input_type: text
output_type: risk_register
tags: [risk, analysis, assessment]
parameters:
  - name: domain
    type: enum
    values: [software, security, project, business]
    default: software
    description: Risiko-Domäne
can_follow: [extract_requirements, design_solution]
can_precede: [risk_report, threat_model]
persona: architect
---

# AUFGABE

Identifiziere systematisch Risiken, bewerte ihre Eintrittswahrscheinlichkeit und Auswirkung, und schlage Mitigationsmaßnahmen vor.

# STEPS

1. Lies den Input und identifiziere alle potenziellen Risiken
2. Bewerte jedes Risiko nach Wahrscheinlichkeit (1-5) und Auswirkung (1-5)
3. Berechne Risiko-Score (Wahrscheinlichkeit × Auswirkung)
4. Schlage Mitigationsmaßnahmen vor
5. Priorisiere nach Risiko-Score

# OUTPUT FORMAT

## RISK REGISTER

### Übersicht
- Identifizierte Risiken: X
- Kritische Risiken (Score ≥ 15): X
- Hohe Risiken (Score ≥ 10): X

### Risiken

| RISK-ID | Beschreibung | Wahrsch. (1-5) | Auswirkung (1-5) | Score | Mitigation |
|---------|-------------|----------------|-------------------|-------|------------|

### Top-3 Risiken (Detail)

Für jedes der drei höchsten Risiken:
- **Beschreibung:** Was genau kann passieren?
- **Trigger:** Wann tritt das Risiko ein?
- **Auswirkung:** Was sind die Konsequenzen?
- **Mitigation:** Konkrete Gegenmaßnahmen
- **Verantwortung:** Wer sollte handeln?

# INPUT
