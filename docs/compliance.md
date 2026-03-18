# Compliance, Traceability, and Reporting

> **Audience:** Architects + Quality Managers

> **STATUS: ASPIRATIONAL -- Phase 6.**
> This document describes the target vision for Phase 6 of the AIOS roadmap.
> These features are **NOT YET IMPLEMENTED**. See [roadmap.md](roadmap.md) for current status.

---

## Regulatory Context

AIOS targets environments where generated artifacts must satisfy regulatory and quality requirements:

- **IEC 62443** -- Security for Industrial Automation and Control Systems
- **EU Cyber Resilience Act (CRA)** -- Cybersecurity requirements for products with digital elements
- **Internal quality standards** -- Review processes, approval gates, release management

The goal is to produce traceable, auditable artifacts that link every requirement to its design, implementation, test evidence, and review.

## Traceability Model

### Full Chain: Requirement to Design to Code to Test to Review

```
REQ-042 (Requirement)
  |
  +---> DES-012 (Design Decision)
  |       |
  |       +---> auth_middleware.py (Code Artifact)
  |       |       |
  |       |       +---> TEST-042-001 (JWT Validation)        Pass
  |       |       +---> TEST-042-002 (Token Expiry)          Pass
  |       |       +---> TEST-042-003 (Refresh Token)         Pass
  |       |
  |       +---> REV-012 (Code Review)                        Approved
  |
  +---> SEC-042 (Security Assessment)                        Pass
  |
  +---> COMP-042 (Compliance Check)                          Compliant
```

Each node in this chain is an artifact stored in the knowledge base. Links between them are explicit and queryable.

### Traceability Matrix (Auto-Generated)

The system generates a traceability matrix from the artifact graph:

```
| Requirement | Design  | Code         | Tests   | Status    | Review   | Security | Compliant |
|-------------|---------|--------------|---------|-----------|----------|----------|-----------|
| REQ-042     | DES-012 | auth_mw.py   | 3 Tests | 3/3 Pass  | Approved | Pass     | Yes       |
| REQ-043     | DES-013 | data_enc.py  | 5 Tests | 5/5 Pass  | Approved | Pass     | Yes       |
| REQ-044     | DES-014 | -            | -       | Missing   | -        | -        | No        |
| REQ-045     | -       | -            | -       | No Design | -        | -        | No        |
```

Gaps are surfaced automatically. Any requirement without a complete chain is flagged.

### Coverage Metrics

```
Requirements Coverage:
|-- Total Requirements: 67
|-- With Design:        62 (92.5%)
|-- With Code:          58 (86.6%)
|-- With Tests:         55 (82.1%)
|-- All Tests Pass:     52 (77.6%)
|-- Reviewed:           50 (74.6%)
|-- Security Checked:   48 (71.6%)
+-- Fully Traceable:    45 (67.2%)   <-- End-to-End Coverage

Gap Analysis:
|-- Missing Design:      5 Requirements
|-- Missing Code:        4 Requirements
|-- Missing Tests:       7 Requirements
|-- Failed Tests:        3 Requirements
|-- Missing Review:      8 Requirements
+-- Missing Security:   10 Requirements
```

## Automatic Report Generation

### Test Report

Generated from the knowledge base using a dedicated pattern:

```yaml
pattern: test_report
input_sources:
  - knowledge.requirements
  - knowledge.test_results
  - knowledge.traceability

output_sections:
  - title: "Test Summary"
  - title: "Test Results by Requirement"
  - title: "Coverage Analysis"
  - title: "Failed Tests"
  - title: "Recommendations"
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

### CLI Commands (Planned)

```bash
# Generate test report
aios report test --project=my-project --format=markdown

# Coverage report
aios report coverage --project=my-project

# Compliance report for a specific standard
aios report compliance --standard=iec62443 --project=my-project

# Full audit export
aios report audit --project=my-project --format=xlsx --period="2026-Q1"
```

## Audit Trail

Every action in the system is logged with cryptographic integrity:

```yaml
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

Each entry records:
- **What** happened (action, target, result)
- **Who** performed it (actor, model)
- **Integrity** proof (input/output hashes)
- **Traceability** links (requirement references)
- **Cost** data (tokens, duration)

### Querying the Audit Trail (Planned)

```bash
# Recent audit log
aios audit log --project=my-project --last=7d

# Trace a specific requirement through all actions
aios audit trace REQ-042

# Export for external auditors
aios audit export --project=my-project --format=xlsx --period="2026-Q1"
```

## Quality Gates

Configurable gates that block progression until all checks pass:

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

### Gate Check Output (Planned)

```bash
aios gate check "Release Gate" --project=my-project

# Output:
# ===============================================
# Quality Gate: Release Gate
# Status: FAILED (4/5 checks passed)
# ===============================================
#
# [PASS] All requirements covered
# [PASS] All reviews approved
# [PASS] All security checks passed
# [PASS] Compliance report generated
# [FAIL] Traceability complete (3 gaps found)
#    |-- REQ-044: Missing code implementation
#    |-- REQ-051: Missing test cases
#    +-- REQ-058: Missing security review
#
# Action Required: Resolve 3 traceability gaps
```

## Artifact Management

All generated artifacts are versioned and linked in a structured project directory:

```
projects/my-project/artifacts/
|-- requirements/
|   |-- REQ-042.yaml
|   |-- REQ-043.yaml
|   +-- requirements_matrix.md
|-- design/
|   |-- DES-012.md
|   |-- ADR-001.md
|   +-- component_diagram.mermaid
|-- code/
|   |-- auth_middleware.py
|   +-- data_encryption.py
|-- tests/
|   |-- test_auth.py
|   |-- test_encryption.py
|   +-- test_results.json
|-- reviews/
|   |-- REV-012.md
|   +-- SEC-042.md
+-- reports/
    |-- test_report_2026-03-17.md
    |-- coverage_report_2026-03-17.md
    |-- compliance_report_iec62443.md
    +-- audit_trail_2026-Q1.xlsx
```

Each artifact carries metadata linking it to related artifacts in the traceability chain. The knowledge base indexes all artifacts for search and cross-referencing.
