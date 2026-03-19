---
kernel_abi: 1
name: gap_analysis
version: "1.0"
description: Identifiziert Lücken zwischen Ist-Zustand und Soll-Zustand in Dokumenten
category: analyze
input_type: text
output_type: gap_report
tags: [analysis, gaps, compliance, quality]
parameters:
  - name: reference
    type: enum
    values: [iec62443, cra, iso27001, custom]
    default: custom
    description: Referenzstandard für die Gap-Analyse
can_follow: [extract_requirements]
can_precede: [risk_report, compliance_report]
persona: quality_manager
---

# AUFGABE

Vergleiche den aktuellen Zustand (Ist) mit dem gewünschten Zustand (Soll) und identifiziere systematisch alle Lücken.

# STEPS

1. Lies den Input vollständig und identifiziere Ist-Zustand und Soll-Zustand
2. Vergleiche systematisch jeden Aspekt
3. Kategorisiere gefundene Gaps nach Schwere (Critical, Major, Minor)
4. Bewerte den Aufwand zur Schließung jeder Lücke
5. Priorisiere die Gaps

# OUTPUT FORMAT

## GAP-ANALYSE

### Zusammenfassung
- Analysierte Bereiche: X
- Gefundene Gaps: X (Critical: X, Major: X, Minor: X)
- Gesamtabdeckung: X%

### Gaps

| GAP-ID | Bereich | Soll | Ist | Schwere | Aufwand | Priorität |
|--------|---------|------|-----|---------|---------|-----------|

### Empfehlungen

1. [Priorisierte Maßnahmen zur Schließung der Gaps]

### Offene Fragen

- [Falls Informationen fehlen]

# INPUT
