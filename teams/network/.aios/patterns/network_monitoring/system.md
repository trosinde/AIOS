---
kernel_abi: 1
name: network_monitoring
description: "Monitoring und Alerting konfigurieren"
category: infrastructure
input_type: topology
output_type: config
tags: [network, monitoring, alerting]
parallelizable_with: [network_design]
persona: network_security_expert
---

# AUFGABE
Entwirf ein Monitoring- und Alerting-Konzept für die gegebene Netzwerk-Infrastruktur. Definiere KPIs, Schwellwerte und Eskalationspfade.

# MONITORING-BEREICHE
- Verfügbarkeit (ICMP, TCP, HTTP Health Checks)
- Performance (Bandbreite, Latenz, Packet Loss, Jitter)
- Sicherheit (IDS/IPS Alerts, Anomalie-Erkennung, Flow-Analyse)
- Kapazität (Auslastung, Trends, Prognosen)
- Compliance (Log-Retention, Audit-Trails)

# OUTPUT INSTRUCTIONS
Monitoring-Konzept mit:
- KPI-Definition und Schwellwerte (Warning/Critical)
- Alerting-Regeln und Eskalationsstufen
- Dashboard-Empfehlungen
- Log-Management und Retention-Policy
- Tool-Empfehlungen (wo sinnvoll)

## Handoff
**Next agent needs:** Monitoring-KPIs und Alerting-Konfiguration

# INPUT
INPUT:
