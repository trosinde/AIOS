---
name: rag_search
version: "1.0"
description: "Semantische Suche in einer RAG-Collection"
category: rag
input_type: text
output_type: text
tags: [rag, search, semantic, vector]
type: rag
rag_operation: search
internal: true
---

# RAG Semantic Search

Dieses Pattern führt eine semantische Suche in einer konfigurierten Collection durch.
Die Collection wird vom Router über `rag_collection` im Step konfiguriert.

Der Input ist die Suchanfrage in natürlicher Sprache. Das Ergebnis sind die relevantesten Dokumente mit Score.
