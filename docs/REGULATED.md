# 07 – Compliance, Traceability & Reporting

## Regulatorischer Kontext

Das System muss Artefakte produzieren, die in regulierten Umgebungen bestehen können:
- **IEC 62443** – Security for Industrial Automation
- **EU Cyber Resilience Act (CRA)** – Cybersecurity Requirements
- **Interne Qualitätsstandards** – Review-Prozesse, Freigaben

## Traceability-Modell

### Vollständige Kette: Requirement → Design → Code → Test → Review

```
REQ-042 (Requirement)
  │
  ├──→ DES-012 (Design Decision)
  │      │
  │      ├──→ auth_middleware.py (Code Artifact)
  │      │      │
  │      │      ├──→ TEST-042-001 (Test: JWT Validation)     ✅ Pass
  │      │      ├──→ TEST-042-002 (Test: Token Expiry)       ✅ Pass
  │      │      └──→ TEST-042-003 (Test: Refresh Token)      ✅ Pass
  │      │
  │      └──→ REV-012 (Code Review)                          ✅ Approved
  │
  ├──→ SEC-042 (Security Assessment)                         ✅ Pass
  │
  └──→ COMP-042 (Compliance Check)                           ✅ Compliant
```

### Traceability-Matrix (automatisch generiert)

```
| Requirement | Design | Code | Tests | Test Status | Review | Security | Compliance |
|-------------|--------|------|-------|-------------|--------|----------|------------|
| REQ-042     | DES-012| auth_mw.py | 3 Tests | ✅ 3/3 Pass | ✅ Approved | ✅ Pass | ✅ |
| REQ-043     | DES-013| data_enc.py| 5 Tests | ✅ 5/5 Pass | ✅ Approved | ✅ Pass | ✅ |
| REQ-044     | DES-014| -          | -       | ❌ Missing   | -          | -        | ❌ |
| REQ-045     | -      | -          | -       | ❌ No Design | -          | -        | ❌ |
```

### Coverage-Metriken

```
Requirements Coverage:
├── Total Requirements: 67
├── With Design:        62 (92.5%)
├── With Code:          58 (86.6%)
├── With Tests:         55 (82.1%)
├── All Tests Pass:     52 (77.6%)
├── Reviewed:           50 (74.6%)
├── Security Checked:   48 (71.6%)
└── Fully Traceable:    45 (67.2%)  ← End-to-End Coverage

Gap Analysis:
├── Missing Design:      5 Requirements
├── Missing Code:        4 Requirements
├── Missing Tests:       7 Requirements
├── Failed Tests:        3 Requirements
├── Missing Review:      8 Requirements
└── Missing Security:   10 Requirements
```

## Automatische Report-Generierung

### Test Report

```yaml
# Wird automatisch aus Knowledge Base generiert
pattern: test_report
input_sources:
  - knowledge.requirements
  - knowledge.test_results
  - knowledge.traceability

output_sections:
  - title: "Test Summary"
    content: Gesamtübersicht aller Tests
  - title: "Test Results by Requirement"
    content: Tabelle Requirement → Tests → Ergebnis
  - title: "Coverage Analysis"
    content: Abdeckungsmetriken und Lücken
  - title: "Failed Tests"
    content: Details zu fehlgeschlagenen Tests
  - title: "Recommendations"
    content: Empfehlungen zur Verbesserung
```

```bash
# Report generieren
aios report test --project=project-alpha --format=markdown
aios report test --project=project-alpha --format=docx

# Coverage Report
aios report coverage --project=project-alpha

# Compliance Report
aios report compliance --standard=iec62443 --project=project-alpha

# Vollständiger Audit-Report
aios report audit --project=project-alpha
```

### Compliance Report (IEC 62443)

```yaml
pattern: compliance_report
params:
  standard: iec62443

sections:
  - "1. Scope and Applicability"
  - "2. Security Requirements Mapping"
  - "3. Threat Model Summary"
  - "4. Security Controls Implementation"
  - "5. Test Evidence"
  - "6. Residual Risk Assessment"
  - "7. SBOM Reference"
  - "8. Secure Update Mechanism"
  - "9. Vulnerability Disclosure Process"
  - "10. Traceability Matrix"
```

### CRA Technical Documentation

```yaml
pattern: cra_technical_documentation
params:
  standard: eu_cra

sections:
  - "Product Description and Intended Use"
  - "Risk Assessment"
  - "Security Requirements"
  - "Architecture and Design"
  - "Vulnerability Handling Process"
  - "Software Bill of Materials (SBOM)"
  - "Secure Update Mechanism"
  - "Conformity Assessment Evidence"
```

## Audit Trail

Jede Aktion im System wird protokolliert:

```yaml
# Automatisches Audit-Log
audit_entry:
  timestamp: "2026-03-17T14:32:15Z"
  action: "code_review"
  actor: "reviewer (Claude Sonnet)"
  target: "auth_middleware.py v1.2"
  input_hash: "sha256:abc123..."
  output_hash: "sha256:def456..."
  result: "approved"
  findings:
    critical: 0
    major: 1
    minor: 3
    suggestions: 5
  requirement_refs: ["REQ-042"]
  model_used: "claude-sonnet-4-20250514"
  tokens_used: 3421
  duration_seconds: 12
```

```bash
# Audit Trail abfragen
aios audit log --project=project-alpha --last=7d

# Audit für spezifisches Requirement
aios audit trace REQ-042

# Export für Auditor
aios audit export --project=project-alpha --format=xlsx --period="2026-Q1"
```

## Quality Gates

Definierbare Qualitätstore, die automatisch geprüft werden:

```yaml
# quality_gates.yaml
gates:
  - name: "Design Gate"
    trigger: before_implementation
    checks:
      - all_requirements_have_design: true
      - architecture_review_passed: true
      - security_review_passed: true
    on_failure: block

  - name: "Code Gate"
    trigger: before_review
    checks:
      - all_tests_pass: true
      - test_coverage_minimum: 80
      - no_critical_findings: true
    on_failure: block_with_notification

  - name: "Release Gate"
    trigger: before_release
    checks:
      - all_requirements_covered: true
      - all_reviews_approved: true
      - all_security_checks_passed: true
      - compliance_report_generated: true
      - traceability_complete: true
    on_failure: block_and_escalate
```

```bash
# Quality Gate manuell prüfen
aios gate check "Release Gate" --project=project-alpha

# Output:
# ═══════════════════════════════════════════════
# Quality Gate: Release Gate
# Status: ❌ FAILED (4/5 checks passed)
# ═══════════════════════════════════════════════
#
# ✅ All requirements covered
# ✅ All reviews approved
# ✅ All security checks passed
# ✅ Compliance report generated
# ❌ Traceability complete (3 gaps found)
#    ├── REQ-044: Missing code implementation
#    ├── REQ-051: Missing test cases
#    └── REQ-058: Missing security review
#
# Action Required: Resolve 3 traceability gaps
```

## Artefakt-Management

Alle generierten Artefakte werden versioniert und verknüpft:

```
projects/project-alpha/artifacts/
├── requirements/
│   ├── REQ-042.yaml
│   ├── REQ-043.yaml
│   └── requirements_matrix.md
├── design/
│   ├── DES-012.md
│   ├── ADR-001.md
│   └── component_diagram.mermaid
├── code/
│   ├── auth_middleware.py
│   └── data_encryption.py
├── tests/
│   ├── test_auth.py
│   ├── test_encryption.py
│   └── test_results.json
├── reviews/
│   ├── REV-012.md
│   └── SEC-042.md
└── reports/
    ├── test_report_2026-03-17.md
    ├── coverage_report_2026-03-17.md
    ├── compliance_report_iec62443.md
    └── audit_trail_2026-Q1.xlsx
```
