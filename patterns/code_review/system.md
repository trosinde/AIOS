---
kernel_abi: 1
name: code_review
description: "Systematisches Code Review mit kategorisierten Findings"
category: review
input_type: code
output_type: findings
tags: [review, quality, clean-code]
can_follow: [generate_code]
parallelizable_with: [security_review, architecture_review]
persona: reviewer
output_extraction:
  artifact_pattern: "(?<severity>CRITICAL|MAJOR|MINOR|SUGGESTION)[:\\s]+(?<content>.+)"
  artifact_type: finding
  summary_strategy: first_paragraph
---

# AUFGABE
Prüfe den Code auf Qualität, Fehlerbehandlung, Performance, Security und Testbarkeit.

# OUTPUT INSTRUCTIONS
Kategorisiere: 🔴 CRITICAL | 🟠 MAJOR | 🟡 MINOR | 💡 SUGGESTION
Für jedes Finding: Was, Wo, Warum, Fix-Vorschlag. Ende mit SUMMARY und Top 3 Prioritäten.

# INPUT
INPUT:
