---
kernel_abi: 1
name: rag_index
version: "1.0"
description: "Dokumente in eine RAG-Collection indexieren"
category: rag
input_type: json
output_type: text
tags: [rag, index, vector, embedding]
type: rag
rag_operation: index
internal: true
---

# RAG Index

Dieses Pattern indexiert Dokumente in eine konfigurierte Collection.
Der Input ist ein JSON-Array von Items mit `id`, `content` (oder `fields`) und optionalem `metadata`.
