---
kernel_abi: 1
name: requirements_review
version: "1.0"
description: Prüft Requirements auf Qualität, Vollständigkeit und Testbarkeit
category: review
input_type: requirements
output_type: findings
tags: [requirements, review, quality]
can_follow: [extract_requirements]
can_precede: [design_solution]
parallelizable_with: [identify_risks]
persona: re
---

# AUFGABE

Prüfe Requirements auf Qualität nach INCOSE-Kriterien: korrekt, vollständig, eindeutig, konsistent, prüfbar, verfolgbar, realisierbar.

# STEPS

1. Prüfe jedes Requirement einzeln gegen die Qualitätskriterien
2. Prüfe die Requirements-Menge auf Konsistenz und Vollständigkeit
3. Identifiziere fehlende Requirements (implizite Anforderungen)
4. Bewerte die Testbarkeit jedes Requirements
5. Schlage konkrete Verbesserungen vor

# OUTPUT FORMAT

## REQUIREMENTS REVIEW

### Zusammenfassung
- Geprüfte Requirements: X
- Findings: X (Critical: X, Major: X, Minor: X)
- Qualitätsscore: X/10

### Findings

| REQ-ID | Kriterium | Schwere | Finding | Verbesserungsvorschlag |
|--------|-----------|---------|---------|----------------------|

### Fehlende Requirements
- [Implizite Anforderungen die nicht explizit formuliert wurden]

### Konsistenzprobleme
- [Widersprüche zwischen Requirements]

### Verbesserungsvorschläge (Top 5)
1. [Konkrete, umsetzbare Verbesserungen]

# INPUT
