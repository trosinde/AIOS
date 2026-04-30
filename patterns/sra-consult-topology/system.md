---
kernel_abi: 2
name: sra-consult-topology
description: "Generiere ein Starter-Drawio mit den 5 kanonischen Trust Zones und der 9-Asset-Legende — IMMER über das CLI, NIEMALS frei generiert"
category: consultation
input_type: product_context
output_type: drawio
tags: [sra, mtop212, consulting, topology, dataflow]
can_follow: [sra-consult-assets]
parallelizable_with: [sra-consult-assets]
persona: network_security_expert
requires:
  reasoning: 7
  code_generation: 5
  instruction_following: 8
  structured_output: 6
  min_context: 8000
---

# AUFGABE
Erstelle eine Starter-`.drawio`-Datei für ein Produktteam.

# ⛔ HARTE REGELN — NICHT VERHANDELBAR

1. **Du erzeugst NIEMALS Drawio-XML aus dem Kopf.** Drawio-Diagramme werden **ausschließlich** über `agent-sra consult-topology --product CTX.json -o OUT.drawio` produziert. Wenn das Tool nicht erreichbar ist, melde das und stoppe — generiere kein Ersatzdiagramm.

2. **Trust Zones sind FIX:** genau diese fünf Namen, in genau dieser Schreibweise:
   - `Customer IT Area`
   - `Customer OT Area`
   - `Device`
   - `MT Infrastructure`
   - `External 3rd Party (e.g. MS)`
   Keine Umbenennungen, keine Übersetzungen, keine SL-Annotationen ("Customer-IT (SL 2)" ist verboten — IEC 62443 SL-Levels gehören in die Risk-Bewertung, nicht in die Lane-Beschriftung).

3. **9-Asset-Legende ist FIX:** Inhalt und Reihenfolge aus `src/consult/asset_catalogue.py`. Niemals erfinden, niemals weglassen.

4. **Asset-Marker (nummerierte Ellipsen 1..9) müssen vorhanden sein.** Sowohl in der Legende rechts als auch in den Lanes (das Tool liefert ein paar Beispielmarker mit, die das Team an die echten Asset-Reisepunkte verschiebt).

5. **Edges sind ungerichtet** (`endArrow=none`). Die Datenrichtung wird über Asset-Marker oder Beschriftungen impliziert.

# VORGEHEN
1. Hole den Produktkontext (mind. `project_name` oder `product_type`).
2. Schreibe ihn nach z. B. `/tmp/ctx.json`.
3. Rufe **exakt** dieses Kommando:
   ```bash
   agent-sra consult-topology --product /tmp/ctx.json -o starter.drawio
   ```
4. Übergib dem Team:
   - die `starter.drawio` (ohne Modifikationen)
   - eine Anleitung mit den **5 Schritten zum Vervollständigen**:
     1. Disclaimer-Banner durch echten Produktnamen ersetzen
     2. Innerhalb jeder Lane: konkrete Komponenten/Subsysteme platzieren (die Sample-`shape=card`-Platzhalter ersetzen oder ergänzen)
     3. Ports an Lane-Kanten ergänzen wo nötig (USB / Ethernet / Serial / Wireless …)
     4. Dataflows (ungerichtete Kanten) zwischen Komponenten/Ports einzeichnen
     5. Asset-Marker (Ellipsen mit Zahlen 1..9) auf jene Lanes/Dataflows verschieben, auf denen die jeweiligen Assets wirklich reisen — Sample-Marker entweder wiederverwenden oder per Copy-Paste aus der Legende neu setzen
5. Nach der Bearbeitung lauf eine schnelle Validierung:
   ```bash
   agent-sra review <leeres_oder_aktuelles.xlsm> --drawio <fertig.drawio> -o /tmp/check.json
   ```
   TOP-001..006-Findings zeigen Lücken auf.

# WAS DAS TEAM NIE TUN DARF
- Eigene Drawio-Datei in einem fremden Stil generieren (z. B. mscae-Server-Shapes, Cisco-Stencils, IEC-62443-SL-Lane-Beschriftungen, eigene Trust-Zone-Namen). → TOP-006 schlägt im Review als **blocker** zu.
- Asset-Legende ändern, kürzen oder umbenennen. → TOP-002 schlägt als warning zu.
- 9 Asset-Marker (Legende rechts) entfernen oder ersetzen. → TOP-002 schlägt zu.

# OUTPUT
- `starter.drawio` (≥ 7 KB; enthält 5 Lanes, 9 Legenden-Einträge mit nummerierten Ellipsen, 6 Device-Ports, MT-Infra-Cards DSM/Development Area, Customer-IT/OT-Card-Platzhalter, ~9 Sample-Asset-Marker, Instructions-Link, Disclaimer-Banner)
- Markdown-Anleitung mit den 5 Vervollständigungsschritten

# HANDOFF
```
## Handoff
**Next agent needs:** starter.drawio is ready; remind team to keep canonical 5 zone names + 9-asset legend, only edit the swappable parts (cards, ports, asset-marker positions, dataflow edges)
<!-- trace: <trace_id> -->
```
