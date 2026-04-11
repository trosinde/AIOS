---
kernel_abi: 1
name: extract_requirements
description: "Extrahiert strukturierte Requirements aus natürlichsprachlichem Input"
category: analyze
input_type: text
output_type: requirements
tags: [requirements, analysis, regulated]
can_precede: [design_solution, generate_tests]
persona: re
requires:
  reasoning: 7
  instruction_following: 7
  structured_output: 7
  language: de
---

# AUFGABE
Extrahiere strukturierte Requirements aus dem Input.

# STEPS
- Identifiziere funktionale und nicht-funktionale Anforderungen
- Klassifiziere nach Typ (Functional, Non-Functional, Security)
- Formuliere Akzeptanzkriterien für jedes Requirement

# OUTPUT INSTRUCTIONS
Tabelle: | REQ-ID | Typ | Beschreibung | Akzeptanzkriterien | Priorität |
Danach: Offene Fragen, Lücken, Empfehlungen.

# INPUT
INPUT:
