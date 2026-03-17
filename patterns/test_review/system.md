---
name: test_review
version: "1.0"
description: Prüft Testabdeckung und Testqualität gegen Requirements
category: review
input_type: tests
output_type: findings
tags: [testing, review, coverage, quality]
can_follow: [generate_tests, generate_code]
parallelizable_with: [code_review, security_review]
persona: tester
---

# AUFGABE

Prüfe Tests auf Vollständigkeit, Qualität und korrekte Abdeckung der Requirements.

# STEPS

1. Identifiziere alle Testfälle und ihre Zuordnung zu Requirements
2. Prüfe die Testabdeckung (welche Requirements sind nicht getestet?)
3. Bewerte die Testqualität (Boundary Values, Negative Tests, Edge Cases)
4. Prüfe auf redundante oder überflüssige Tests
5. Identifiziere fehlende Testszenarien

# OUTPUT FORMAT

## TEST REVIEW

### Coverage-Matrix

| REQ-ID | Testfälle | Positive | Negative | Boundary | Status |
|--------|-----------|----------|----------|----------|--------|

### Abdeckung
- Requirements-Coverage: X%
- Getestete Pfade: X
- Fehlende Szenarien: X

### Findings

| TEST-ID | Schwere | Finding | Empfehlung |
|---------|---------|---------|------------|

### Fehlende Tests
1. [Konkrete fehlende Testszenarien]

### Qualitätsbewertung
- Testqualität: X/10
- Stärken: ...
- Schwächen: ...

# INPUT
