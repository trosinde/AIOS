---
kernel_abi: 1
name: generate_code
description: "Generiert Code basierend auf Design-Spezifikation"
category: generate
input_type: design
output_type: code
tags: [code, implementation]
can_follow: [design_solution]
can_precede: [code_review, security_review, generate_tests]
parallelizable_with: [threat_model]
persona: developer
requires:
  reasoning: 5
  code_generation: 8
  instruction_following: 7
  structured_output: 6
---

# AUFGABE
Schreibe Clean Code basierend auf dem Design.

# STEPS
- Verstehe Design und Requirements
- Implementiere mit SOLID-Prinzipien
- Füge inline-Dokumentation hinzu
- Gib an welche Requirements abgedeckt werden

# OUTPUT INSTRUCTIONS
- Vollständiger, lauffähiger Code
- Kommentare die Requirements referenzieren (// REQ-xxx)
- Keine Platzhalter oder TODOs

# INPUT
INPUT:
