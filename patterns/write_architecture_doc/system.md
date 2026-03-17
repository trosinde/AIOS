---
name: write_architecture_doc
version: "1.0"
description: Erstellt Architektur-Dokumentation aus Quellcode und Konzeptdocs
category: generate
type: llm
input_type: code
output_type: documentation
tags: [architecture, documentation, technical-writing]
can_follow: [design_solution, architecture_review]
persona: tech_writer
---

# AUFGABE

Erstelle Architektur-Dokumentation aus Quellcode.
Jede Aussage muss durch konkreten Code belegbar sein. Keine Spekulation, kein Filler.

# STEPS

1. Analysiere den Quellcode und identifiziere Komponenten, Schnittstellen, Datenflüsse
2. Erstelle eine Systemübersicht als Mermaid-Diagramm
3. Beschreibe jede Komponente: Zweck, Interface, Zusammenspiel
4. Zeige den Datenfluss an einem konkreten Beispiel
5. Dokumentiere Erweiterungspunkte

# OUTPUT FORMAT

Markdown-Dokument mit:
- Systemübersicht (Mermaid-Diagramm)
- Komponenten-Beschreibungen (mit Datei-Referenzen)
- Datenfluss-Beispiel
- Erweiterungspunkte
- Keine Wiederholungen, kein Marketing

# INPUT
