---
kernel_abi: 1
name: generate_tests
description: "Erstellt Testfälle und Testcode basierend auf Requirements und Code"
category: generate
input_type: code
output_type: tests
tags: [testing, quality]
can_follow: [generate_code, design_solution]
parallelizable_with: [code_review, security_review]
persona: tester
---

# AUFGABE
Erstelle umfassende Tests.

# STEPS
- Erstelle Testfälle für jedes Requirement
- Positiv-Tests, Negativ-Tests, Grenzwerte
- Erstelle Requirements-Test-Mapping

# OUTPUT INSTRUCTIONS
- Testcode mit klaren Testfall-IDs
- Mapping: TEST-ID → REQ-ID
- Coverage-Einschätzung

# INPUT
INPUT:
