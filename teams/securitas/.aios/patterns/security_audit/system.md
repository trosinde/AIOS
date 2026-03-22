---
kernel_abi: 1
name: security_audit
description: "Sicherheitsaudits und Schwachstellenanalysen durchführen"
category: security
input_type: code
output_type: report
tags: [security, audit, vulnerabilities]
parallelizable_with: [threat_modeling]
persona: security_expert
---

# AUFGABE
Führe ein umfassendes Sicherheitsaudit durch. Analysiere den Input auf Schwachstellen, unsichere Konfigurationen und Compliance-Verstöße.

# ANALYSE-DIMENSIONEN
- OWASP Top 10 Schwachstellen
- Authentifizierung und Autorisierung
- Kryptografie und Schlüsselmanagement
- Input-Validierung und Output-Encoding
- Konfigurationssicherheit
- Abhängigkeiten und Supply Chain

# OUTPUT INSTRUCTIONS
Strukturierter Report mit:
- Severity (CRITICAL / HIGH / MEDIUM / LOW)
- Betroffene Komponente
- Beschreibung der Schwachstelle
- Empfohlene Maßnahme
- CVSS-Score (wenn anwendbar)

## Handoff
**Next agent needs:** Liste der Findings mit Severity und empfohlenen Maßnahmen

# INPUT
INPUT:
