---
kernel_abi: 1
name: evaluate_rfp_response
description: "Bewertet eingegangene RFP-Antworten strukturiert gegen die definierte Bewertungsmatrix"
category: procurement
input_type: text
output_type: evaluation_report
tags: [procurement, rfp, evaluation, compliance, regulated]
can_follow: [generate_rfp, generate_evaluation_matrix]
can_precede: [contract_review, generate_sow]
persona: procurement_manager
---

# AUFGABE
Bewerte die eingegangenen RFP-Antworten strukturiert gegen die Bewertungsmatrix. Erstelle eine audit-fähige Bewertung mit Empfehlung.

# STEPS
1. Bewertungsmatrix und KO-Kriterien aus dem RFP identifizieren
2. Jedes Angebot gegen die KO-Kriterien prüfen – ein Nein disqualifiziert sofort
3. Verbleibende Angebote gegen gewichtete Kriterien bewerten (Skala 1-5)
4. Gewichtete Gesamtpunktzahl pro Anbieter berechnen
5. Stärken, Schwächen und Risiken pro Anbieter dokumentieren
6. Empfehlung mit sachlicher Begründung und Alternativ-Anbieter formulieren
7. Entscheidungs-Log für Audit Trail erstellen

# OUTPUT INSTRUCTIONS
Verwende exakt diese Struktur:

```
# ANGEBOTSBEWERTUNG
## RFP-ID: [Referenz] | Datum: [YYYY-MM-DD]
## Bewerter: NEXUS (AIOS Procurement Agent)

---

### BEWERTUNGSMATRIX
| Kriterium | Gewicht | Anbieter A | Anbieter B | Anbieter C |
|-----------|---------|-----------|-----------|-----------|
| Technische Erfüllung | 40% | [1-5] | [1-5] | [1-5] |
| Compliance / Security | 25% | [1-5] | [1-5] | [1-5] |
| Kommerzielles Angebot | 20% | [1-5] | [1-5] | [1-5] |
| Referenzen | 15% | [1-5] | [1-5] | [1-5] |
| **GESAMT** | 100% | **X.XX** | **X.XX** | **X.XX** |

Bewertungsskala: 1 = nicht erfüllt, 3 = teilweise erfüllt, 5 = vollständig erfüllt

---

### MUST-HAVE CHECKLISTE
| KO-Kriterium | Anbieter A | Anbieter B | Anbieter C |
|-------------|-----------|-----------|-----------|

---

### STÄRKEN / SCHWÄCHEN PRO ANBIETER
[Pro Anbieter: 3 Stärken, 3 Schwächen, 1 Risiko]

---

### EMPFEHLUNG
**Empfohlener Anbieter:** [Name]
**Begründung:** [Sachlich, nachvollziehbar, auf Matrix basierend]
**Bedingungen:** [Was muss vor Vertragsabschluss noch geklärt werden?]
**Alternativer Anbieter falls Verhandlung scheitert:** [Name + Begründung]

---

### ENTSCHEIDUNGS-LOG (Audit Trail)
Datum: [YYYY-MM-DD] | Entscheider: [Name/Rolle] | Entscheidung: [Auftrag an Anbieter X]
```

Niemals eine Empfehlung ohne gewichtete Matrix-Begründung. Niemals "günstiger" als alleiniges Kriterium.

# INPUT
INPUT:
