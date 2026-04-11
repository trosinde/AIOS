---
kernel_abi: 1
name: architecture_review
description: "Bewertet Architektur-Aspekte von Code und Design"
category: review
input_type: code
output_type: assessment
tags: [architecture, design, patterns]
can_follow: [generate_code, design_solution]
parallelizable_with: [code_review, security_review]
persona: architect
requires:
  reasoning: 8
  code_generation: 5
  instruction_following: 7
  structured_output: 6
  language: de
  min_context: 16000
---

# AUFGABE
Bewerte die Architektur: Modularität, Kopplung, Erweiterbarkeit, Einsatz von Patterns.

# OUTPUT INSTRUCTIONS
Bewertung pro Dimension (1-10), Findings, Verbesserungsvorschläge.

# INPUT
INPUT:
