# AIOS Base Trait Protocol

> **Status:** Draft (Phase 0)
> **Ziel:** Definiert welche Traits jede Persona im AIOS-System implementieren MUSS, damit Agenten-Interoperabilität gewährleistet ist.

---

## 1. Motivation

Personas in AIOS sind User-Space-Konzepte – sie enthalten Domain-Wissen und -Logik. Aber der Kernel muss garantieren können, dass:

- Outputs maschinenlesbare Handoff-Informationen enthalten
- Unsicherheit explizit kommuniziert wird
- Jeder Output rückverfolgbar ist (Tracing)

Das **Base Trait Protocol** definiert das Minimum, das jede Persona liefern muss – unabhängig von Domain, Kontext oder Aufgabe.

---

## 2. Trait-Hierarchie

```
Kernel Base Traits (PFLICHT – dieses Dokument)
    │
    ├── Context Traits (optional – definiert pro Context)
    │   z.B. compliance_output, regulatory_references
    │
    └── Instance Traits (optional – definiert pro Persona)
        z.B. code_style, review_depth
```

**Composition-Reihenfolge (Phase 2):**
```
kernel/base_traits.yaml → context/<name>/traits.yaml → personas/<name>/traits.yaml
```

Spätere Layer überschreiben frühere. Kernel-Traits können NICHT überschrieben werden (enforced).

---

## 3. Kernel Base Traits (PFLICHT)

Jede Persona MUSS diese Traits in ihrem Output liefern.

### 3.1 Handoff-Block

```markdown
## Handoff
**Next agent needs:** <Zusammenfassung was der nächste Agent/Step wissen muss>
```

**Regeln:**
- MUSS am Ende des Outputs stehen (vor optionalen Trace-Kommentaren)
- MUSS in natürlicher Sprache formuliert sein
- MUSS die wesentlichen Ergebnisse und offenen Punkte enthalten
- DARF keine technischen IDs oder internen Referenzen enthalten (die kommen über ExecutionContext)

**Beispiel:**
```markdown
## Handoff
**Next agent needs:** 12 funktionale Requirements extrahiert, davon 3 mit fehlenden Akzeptanzkriterien (REQ-004, REQ-007, REQ-011). Priorisierung steht aus. Input enthielt Widersprüche bei Authentifizierung (Abschnitt 3.2 vs 4.1).
```

### 3.2 Confidence-Signal

```markdown
⚠️ LOW_CONFIDENCE: <Erklärung warum die Konfidenz niedrig ist>
```

**Regeln:**
- OPTIONAL – nur wenn die Persona unsicher ist
- MUSS vor dem Handoff-Block stehen
- Schwellenwert für "niedrig" wird nicht vom Kernel definiert (User-Space-Policy)
- Mehrere Confidence-Warnings sind erlaubt

**Beispiel:**
```markdown
⚠️ LOW_CONFIDENCE: Der Input enthielt keine klaren NFRs. Die extrahierten Performance-Requirements sind Annahmen basierend auf dem Domänenkontext, nicht explizite Anforderungen.
```

### 3.3 Trace-Marker

```html
<!-- trace: <trace_id> -->
```

**Regeln:**
- MUSS als letztes Element im Output stehen
- MUSS als HTML-Kommentar formatiert sein (unsichtbar in gerendertem Markdown)
- `trace_id` kommt aus dem `ExecutionContext` (vom Kernel vergeben)
- Bis Phase 1 implementiert ist: Platzhalter `<!-- trace: pending -->` verwenden

**Beispiel:**
```html
<!-- trace: 550e8400-e29b-41d4-a716-446655440000 -->
```

---

## 4. Vollständiges Output-Beispiel

```markdown
# Requirements-Analyse: Benutzerauthentifizierung

| REQ-ID | Typ | Beschreibung | Akzeptanzkriterien | Priorität |
|--------|-----|-------------|-------------------|-----------|
| REQ-001 | Functional | Login mit E-Mail/Passwort | Erfolgreicher Login mit validen Credentials | Must |
| REQ-002 | Security | Passwort-Hashing | bcrypt mit Cost-Factor ≥12 | Must |
| REQ-003 | Non-Functional | Login-Response-Zeit | < 500ms p95 | Should |

⚠️ LOW_CONFIDENCE: Keine expliziten Anforderungen zu Session-Management gefunden. REQ-003 basiert auf branchenüblichen Werten.

## Handoff
**Next agent needs:** 3 Requirements extrahiert. Session-Management fehlt im Input – nächster Step sollte Rückfrage an Stakeholder empfehlen. Passwort-Policy wurde angenommen (kein expliziter Input).

<!-- trace: 550e8400-e29b-41d4-a716-446655440000 -->
```

---

## 5. Validierung (Phase 2)

### 5.1 Validator-Logik

Der Kernel validiert nach jedem Persona-Aufruf:

```
1. Output enthält "## Handoff" Header?          → Ja/Nein
2. Handoff enthält "**Next agent needs:**"?      → Ja/Nein
3. Output endet mit "<!-- trace: ... -->"?       → Ja/Nein
4. trace_id matcht ExecutionContext.trace_id?     → Ja/Nein
```

### 5.2 Fehlerbehandlung

| Validierung fehlgeschlagen | Verhalten |
|---|---|
| Handoff fehlt | Warning + synthetischen Handoff generieren aus letztem Absatz |
| Trace fehlt | Warning + Trace automatisch anhängen |
| Trace-ID falsch | Error loggen, korrekten Trace anhängen |
| Alles fehlt | Warning, Output trotzdem verwenden (graceful degradation) |

**Prinzip:** Der Validator soll Probleme melden, aber den Workflow nie blockieren. Strikte Validierung erst ab `kernel_abi: 2`.

---

## 6. Context Traits (User-Space, Phase 2+)

Contexts können zusätzliche Traits verlangen. Beispiele:

```yaml
# contexts/dvoi-engineering/traits.yaml
required_traits:
  - compliance_references    # Jeder Output muss Compliance-Referenzen enthalten
  - regulatory_classification # Output muss regulatorische Klassifizierung haben

trait_definitions:
  compliance_references:
    format: "## Compliance\n**References:** <Liste>"
    position: before_handoff
  regulatory_classification:
    format: "**Classification:** <CRA|NIS2|ISO27001|none>"
    position: after_first_heading
```

---

## 7. Persona-Definition (aktueller Stand vs. Ziel)

### Aktuell (`src/types.ts`)

```typescript
interface Persona {
  id: string;
  name: string;
  role: string;
  description: string;
  system_prompt: string;
  expertise: string[];
  preferred_patterns: string[];
  preferred_provider?: string;
  communicates_with: string[];
  output_format?: string;
}
```

### Ziel (Phase 2)

```typescript
interface Persona {
  // ... bestehende Felder ...
  traits: {
    kernel: string[];      // Referenz auf Kernel-Traits (automatisch gesetzt)
    context: string[];     // Traits aus dem aktiven Context
    instance: string[];    // Persona-spezifische Traits
  };
}
```

---

## 8. CLI-Integration (Phase 2)

```bash
# Persona gegen Trait-Protocol validieren
aios persona validate <name>

# Ausgabe:
# ✓ Handoff trait: implemented
# ✓ Trace trait: implemented
# ⚠ Confidence trait: not testable (runtime only)
# ✓ Context traits (dvoi-engineering): 2/2 implemented
```

---

## 9. Abgrenzung

**Dieses Dokument definiert:**
- Welche Traits im Output vorkommen müssen (Format, Position)
- Wie der Kernel Trait-Compliance validiert
- Wie Trait-Composition funktioniert (Kernel → Context → Instance)

**Dieses Dokument definiert NICHT:**
- Welche Personas existieren (→ User-Space)
- Was Personas inhaltlich tun (→ Pattern system prompts)
- Wie Personas miteinander kommunizieren (→ IPC_PROTOCOL.md)
