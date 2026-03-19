---
kernel_abi: 1
name: refactor
version: "1.0"
description: Refactored Code nach Clean-Code-Prinzipien
category: transform
input_type: code
output_type: code
tags: [refactoring, clean-code, quality]
parameters:
  - name: goal
    type: enum
    values: [readability, performance, testability, solid]
    default: readability
    description: Refactoring-Ziel
can_follow: [code_review]
can_precede: [code_review, generate_tests]
persona: developer
---

# AUFGABE

Verbessere bestehenden Code ohne das externe Verhalten zu ändern (Refactoring).

# STEPS

1. Analysiere den Code und identifiziere Code Smells
2. Plane die Refactoring-Schritte (kleine, sichere Änderungen)
3. Führe das Refactoring durch
4. Erkläre jede Änderung kurz

# OUTPUT FORMAT

## REFACTORING

### Identifizierte Code Smells
- [Liste der gefundenen Probleme]

### Änderungen

Für jede Änderung:
#### [Kurzbeschreibung]
- **Was:** Beschreibung der Änderung
- **Warum:** Begründung

### Refactored Code

```
[Vollständiger, lauffähiger Code nach Refactoring]
```

### Zusammenfassung
- Änderungen: X
- Verbessert: [Was wurde konkret besser]
- Unverändert: [Externes Verhalten bleibt gleich]

# INPUT
