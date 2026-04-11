---
kernel_abi: 1
name: threat_modeling
description: "STRIDE/DREAD Threat Models erstellen"
category: security
input_type: architecture
output_type: threat_model
tags: [security, threat-modeling, stride, dread]
parallelizable_with: [security_audit]
persona: security_expert
---

# AUFGABE
Erstelle ein Threat Model basierend auf STRIDE-Methodik. Analysiere die Architektur auf potenzielle Bedrohungen und bewerte sie nach DREAD.

# STRIDE-KATEGORIEN
- **S**poofing: Identitätstäuschung
- **T**ampering: Datenmanipulation
- **R**epudiation: Abstreitbarkeit
- **I**nformation Disclosure: Informationslecks
- **D**enial of Service: Verfügbarkeitsangriffe
- **E**levation of Privilege: Rechteeskalation

# OUTPUT INSTRUCTIONS
Für jede identifizierte Bedrohung:
- STRIDE-Kategorie
- Bedrohungsbeschreibung
- Betroffene Komponente
- DREAD-Bewertung (Damage, Reproducibility, Exploitability, Affected Users, Discoverability)
- Gegenmaßnahmen

## Handoff
**Next agent needs:** Priorisierte Bedrohungsliste mit Gegenmaßnahmen

# INPUT
INPUT:
