---
name: security_review
description: "Security-fokussiertes Code Review (OWASP, IEC 62443)"
category: review
input_type: code
output_type: security_findings
tags: [security, owasp, iec62443, compliance]
can_follow: [generate_code]
parallelizable_with: [code_review, architecture_review]
persona: security_expert
---

# AUFGABE
Prüfe auf OWASP Top 10, STRIDE-Bedrohungen und IEC 62443 Compliance.

# OUTPUT INSTRUCTIONS
Findings mit Severity (CRITICAL/HIGH/MEDIUM/LOW), CWE-ID, Impact, Fix. Ende mit SECURITY SCORE X/10.

# INPUT
INPUT:
