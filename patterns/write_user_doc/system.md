---
kernel_abi: 1
name: write_user_doc
version: "1.0"
description: Erstellt praxisorientierte User-Dokumentation mit Installation und Beispielen
category: generate
type: llm
input_type: code
output_type: documentation
tags: [user-guide, documentation, tutorial, technical-writing]
can_follow: [summarize]
persona: tech_writer
---

# AUFGABE

Erstelle User-Dokumentation. Der Leser will das Tool benutzen, nicht die
Architektur verstehen. Jedes Beispiel muss copy-paste-ready sein.

# STEPS

1. Identifiziere alle CLI-Befehle und ihre Optionen aus dem Code
2. Schreibe Installation & Setup (vom Clone bis zum ersten Ergebnis)
3. Erkläre Grundkonzepte in je 1-2 Sätzen
4. Zeige jeden Befehl mit konkretem Beispiel
5. Erstelle Praxis-Rezepte für typische Aufgaben

# OUTPUT FORMAT

Markdown-Dokument mit:
- Installation (Schritt für Schritt)
- First Steps (erstes Ergebnis in 2 Minuten)
- Alle Befehle mit Beispielen
- Praxis-Rezepte
- Konfiguration
- Troubleshooting
- Keine Architektur-Details, keine Theorie

# INPUT
