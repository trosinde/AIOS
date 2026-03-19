---
kernel_abi: 1
name: generate_evaluation_matrix
description: "Erstellt eine gewichtete Bewertungsmatrix für Lieferanten- oder Angebotsvergleiche"
category: procurement
input_type: text
output_type: evaluation_matrix
tags: [procurement, evaluation, matrix, comparison, regulated]
can_follow: [generate_rfp, extract_requirements]
can_precede: [evaluate_rfp_response]
persona: procurement_manager
---

# AUFGABE
Erstelle eine gewichtete Bewertungsmatrix basierend auf den Anforderungen im Input. Die Matrix muss VOR dem Versand eines RFP definiert werden und alle technischen, kommerziellen und Compliance-Dimensionen abdecken.

# STEPS
1. Anforderungen aus dem Input extrahieren und kategorisieren (technisch, kommerziell, compliance, organisatorisch)
2. KO-Kriterien (Must-Haves) definieren – binär, nicht gewichtet
3. Bewertungskriterien ableiten und in Kategorien gruppieren
4. Gewichtung pro Kategorie und Kriterium festlegen (Summe = 100%)
5. Bewertungsmaßstab pro Kriterium definieren (was bedeutet 1, 3, 5?)
6. Compliance-Kriterien aus IEC 62443 und EU CRA sicherstellen
7. Vollständige Matrix mit Anwendungshinweisen ausgeben

# OUTPUT INSTRUCTIONS
Verwende diese Struktur:

```
# BEWERTUNGSMATRIX
## Kontext: [Beschaffungsgegenstand]
## Erstellt: [YYYY-MM-DD] | Ersteller: NEXUS
## Referenz RFP: [RFP-ID falls vorhanden]

---

### KO-KRITERIEN (Must-Have – binär, disqualifizierend)
| # | KO-Kriterium | Prüfmethode |
|---|-------------|-------------|

Ein "Nein" bei einem KO-Kriterium disqualifiziert den Anbieter sofort.

---

### GEWICHTETE BEWERTUNGSKRITERIEN

#### Kategorie: Technische Erfüllung (Gewicht: XX%)
| Kriterium | Gewicht | 1 (nicht erfüllt) | 3 (teilweise) | 5 (vollständig) |
|-----------|---------|-------------------|---------------|-----------------|

#### Kategorie: Compliance & Security (Gewicht: XX%)
| Kriterium | Gewicht | 1 (nicht erfüllt) | 3 (teilweise) | 5 (vollständig) |
|-----------|---------|-------------------|---------------|-----------------|

#### Kategorie: Kommerzielles Angebot (Gewicht: XX%)
| Kriterium | Gewicht | 1 (nicht erfüllt) | 3 (teilweise) | 5 (vollständig) |
|-----------|---------|-------------------|---------------|-----------------|

#### Kategorie: Referenzen & Track Record (Gewicht: XX%)
| Kriterium | Gewicht | 1 (nicht erfüllt) | 3 (teilweise) | 5 (vollständig) |
|-----------|---------|-------------------|---------------|-----------------|

---

### BEWERTUNGSBOGEN (leer, zur Anwendung)
| Kriterium | Gewicht | Anbieter A | Anbieter B | Anbieter C |
|-----------|---------|-----------|-----------|-----------|
| ... | | [1-5] | [1-5] | [1-5] |
| **GESAMT** | 100% | **X.XX** | **X.XX** | **X.XX** |

Berechnungsformel: Gewichtete Summe = Σ (Einzelgewicht × Bewertung)

---

### ANWENDUNGSHINWEISE
- Bewertung immer durch mindestens zwei unabhängige Bewerter
- Matrix VOR Sichtung der Angebote finalisieren
- Abweichungen von der Matrix nur mit dokumentierter Begründung
- Bei Gleichstand: Compliance/Security-Kategorie als Tiebreaker
```

Gewichtung muss immer 100% ergeben. Compliance-Kriterien nie unter 20% gewichten im regulierten Umfeld.

# INPUT
INPUT:
