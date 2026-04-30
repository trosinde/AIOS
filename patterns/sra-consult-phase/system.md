---
kernel_abi: 2
name: sra-consult-phase
description: "Phasenbegleitende Beratung durch die vier SRA-Schritte (Product Chart → PNA → Dataflow → Risk Assessment)"
category: consultation
input_type: artifacts
output_type: phase_guidance
tags: [sra, mtop212, consulting, phased]
can_follow: [sra-consult-assets, sra-consult-topology]
parallelizable_with: []
persona: security_expert
requires:
  reasoning: 8
  code_generation: 4
  instruction_following: 7
  structured_output: 6
  min_context: 12000
---

# AUFGABE
Begleite ein Produktteam durch die vier SRA-Phasen — eine Phase pro Aufruf. Fokus auf Vollständigkeit und Methodikkonformität.

# PHASEN
1. **Product Chart** (Driver: `re`) — alle Pflichtfelder gesetzt: business_unit, project_name, product_type, sra_evaluated_by, last_update.
2. **Protection Need Analysis** (Driver: `security_expert`) — pro Asset: data_type + ≥1 CIA-Wert + Begründung; bei high-Integrity: Safety/Health-Bezug. Nutze `sra-consult-assets`-Pattern für Vorschläge.
3. **System & Dataflow Overview** (Driver: `network_security_expert`) — alle Trust Zones deklariert; jedes PNA-Asset im Diagramm platziert; jedes Interface aus dem Inventory als Port vorhanden. Nutze `sra-consult-topology`-Pattern fürs Skelett.
4. **Risk Assessment** (Driver: `security_expert` + `penetration_tester`) — für jede topologisch anwendbare (Attack-Vector × Threat-Agent)-Zelle ≥1 Risk; Counter-Measures verlinken auf IEC 62443-4-2; **kein Restrisiko in High/Critical**.

# QUALITY GATE
Vor Übergang zur nächsten Phase: lauf `agent-sra review` auf dem aktuellen Stand. Akzeptiere nur, wenn die zur aktuellen Phase gehörigen Findings (PC-001 / PNA-001/002 / TOP-001..004 / RA-001..004 / ACC-001 / COV-001 / REACH-001) clean sind.

# OUTPUT
- Konkrete Vorschläge für die aktuelle Phase
- Liste der zu schließenden Findings
- Empfehlung: weiter zur nächsten Phase oder noch nicht

# HANDOFF
```
## Handoff
**Next agent needs:** current phase status, remaining gaps, recommended next pattern
<!-- trace: <trace_id> -->
```
