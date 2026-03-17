// ============================================================
// AIOS Workflow Engine – Parallele & Synchronisierte Workflows
// ============================================================
//
// Drei Stufen, aufeinander aufbauend:
//
//   1. scatterGather()    – Einfach: Fan-out, Fan-in
//   2. runDAG()           – Komplex: Abhängigkeitsgraph
//   3. runSaga()          – Mit Fehlerbehandlung & Retry
//
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const client = new Anthropic();
const PATTERNS_DIR = join(homedir(), ".aios", "patterns");

// ─── Basis: Ein Pattern ausführen (wie zuvor) ─────────────

interface PatternResult {
  pattern: string;
  output: string;
  durationMs: number;
}

async function runPattern(
  patternName: string,
  userInput: string
): Promise<PatternResult> {
  const systemPrompt = readFileSync(
    join(PATTERNS_DIR, patternName, "system.md"),
    "utf-8"
  );

  const start = Date.now();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userInput }],
  });

  const output = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    pattern: patternName,
    output,
    durationMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════
// STUFE 1: Scatter-Gather
// ═══════════════════════════════════════════════════════════
//
// Das einfachste parallele Pattern:
//   - SCATTER: Derselbe Input geht an N Agenten gleichzeitig
//   - GATHER:  Alle Ergebnisse werden zu einem zusammengeführt
//
// Beispiel: Code wird parallel von 3 Perspektiven reviewt,
//           dann werden die Reviews konsolidiert.

async function scatterGather(
  input: string,
  scatterPatterns: string[],
  gatherPattern: string
): Promise<string> {
  console.error("⏳ Scatter: Starte %d parallele Agents...", scatterPatterns.length);

  // ── SCATTER: Alle Patterns GLEICHZEITIG starten ──
  //
  // Promise.all startet alle API-Calls parallel.
  // Es wartet bis ALLE fertig sind.
  //
  // Das ist der ganze Trick: Statt
  //   const r1 = await runPattern("security_review", input);
  //   const r2 = await runPattern("code_review", input);     // wartet auf r1
  //   const r3 = await runPattern("architecture_review", input); // wartet auf r2
  //
  // Machen wir:
  //   const [r1, r2, r3] = await Promise.all([...]);  // alle gleichzeitig!

  const results = await Promise.all(
    scatterPatterns.map(async (pattern) => {
      console.error("  🚀 %s gestartet", pattern);
      const result = await runPattern(pattern, input);
      console.error("  ✅ %s fertig (%dms)", pattern, result.durationMs);
      return result;
    })
  );

  // ── GATHER: Alle Ergebnisse zusammenführen ──
  //
  // Die Ergebnisse aller parallelen Agents werden zu einem
  // einzigen Text zusammengebaut und an den Aggregator geschickt.

  console.error("⏳ Gather: Führe %d Ergebnisse zusammen...", results.length);

  const combinedInput = results
    .map((r) => `## Ergebnis von: ${r.pattern}\n\n${r.output}`)
    .join("\n\n---\n\n");

  const finalResult = await runPattern(gatherPattern, combinedInput);
  console.error("✅ Fertig! Gesamt: %dms", results.reduce((s, r) => s + r.durationMs, 0));

  return finalResult.output;
}

// Nutzung:
//
//   cat code.py | aios workflow scatter-gather \
//     --scatter security_review code_review architecture_review \
//     --gather aggregate_reviews
//
// Was passiert:
//   1. code.py wird gleichzeitig an 3 Reviewer geschickt
//   2. Alle 3 arbeiten parallel (3x schneller!)
//   3. Die 3 Ergebnisse werden zusammengeführt
//   4. Ein Aggregator erstellt den finalen Report

// ═══════════════════════════════════════════════════════════
// STUFE 2: DAG-basierter Workflow
// ═══════════════════════════════════════════════════════════
//
// Für komplexe Workflows mit Abhängigkeiten:
//   - Manche Schritte brauchen Ergebnisse anderer Schritte
//   - Was parallel laufen KANN, läuft parallel
//   - Was warten MUSS, wartet automatisch
//
// Definiert als gerichteter azyklischer Graph (DAG).

interface WorkflowStep {
  id: string;
  pattern: string;
  dependsOn: string[];        // IDs der Schritte die vorher fertig sein müssen
  buildInput: (results: Map<string, string>) => string;
}

type StepStatus = "pending" | "running" | "done" | "failed";

async function runDAG(steps: WorkflowStep[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const status = new Map<string, StepStatus>();

  // Alle Schritte starten als "pending"
  steps.forEach((s) => status.set(s.id, "pending"));

  console.error("═══════════════════════════════════════════");
  console.error(" DAG Workflow: %d Schritte", steps.length);
  console.error("═══════════════════════════════════════════");

  // ── Event Loop: Prüfe wiederholt welche Schritte starten können ──
  //
  // Dies ist das Herzstück der Synchronisation:
  //
  //   1. Finde alle Schritte die "pending" sind
  //   2. Prüfe ob ALLE ihre Dependencies "done" sind
  //   3. Wenn ja → starte sie (parallel!)
  //   4. Warte bis mindestens einer fertig wird
  //   5. Wiederhole bis alle "done" sind

  while ([...status.values()].some((s) => s !== "done" && s !== "failed")) {
    // Finde startbare Schritte:
    // - Status ist "pending"
    // - ALLE Dependencies sind "done"
    const ready = steps.filter((step) => {
      if (status.get(step.id) !== "pending") return false;
      return step.dependsOn.every((dep) => status.get(dep) === "done");
    });

    if (ready.length === 0) {
      // Nichts startbar → warte kurz auf laufende Schritte
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }

    // Starte alle bereiten Schritte PARALLEL
    console.error(
      "\n🚀 Starte parallel: %s",
      ready.map((s) => s.id).join(", ")
    );

    // Markiere als "running"
    ready.forEach((s) => status.set(s.id, "running"));

    // Starte alle gleichzeitig, aber warte nicht auf alle zusammen –
    // jeder Schritt markiert sich selbst als "done" wenn er fertig ist
    const promises = ready.map(async (step) => {
      try {
        // Input aus den Ergebnissen der Dependencies bauen
        const input = step.buildInput(results);

        console.error("  ⏳ %s → Pattern: %s", step.id, step.pattern);
        const result = await runPattern(step.pattern, input);
        console.error("  ✅ %s fertig (%dms)", step.id, result.durationMs);

        results.set(step.id, result.output);
        status.set(step.id, "done");
      } catch (error) {
        console.error("  ❌ %s fehlgeschlagen: %s", step.id, error);
        status.set(step.id, "failed");
      }
    });

    // Warte bis ALLE gerade gestarteten Schritte fertig sind
    // (Im nächsten Loop-Durchlauf werden dann neue Schritte frei)
    await Promise.all(promises);
  }

  // Status-Report
  console.error("\n═══════════════════════════════════════════");
  for (const [id, s] of status) {
    const icon = s === "done" ? "✅" : "❌";
    console.error("  %s %s: %s", icon, id, s);
  }
  console.error("═══════════════════════════════════════════");

  return results;
}

// ── Konkretes Beispiel: Feature-Entwicklung ──

async function featureDevelopmentWorkflow(featureDescription: string) {
  const steps: WorkflowStep[] = [
    {
      id: "requirements",
      pattern: "extract_requirements",
      dependsOn: [],                              // Keine Dependencies → startet sofort
      buildInput: () => featureDescription,
    },
    {
      id: "design",
      pattern: "design_solution",
      dependsOn: ["requirements"],                // Wartet auf Requirements
      buildInput: (results) =>
        `## Anforderungen\n${results.get("requirements")}\n\n` +
        `## Ursprüngliche Beschreibung\n${featureDescription}`,
    },
    {
      // ┐
      id: "generate_code",                        //  │
      pattern: "generate_code",                   //  │ Diese 3 laufen
      dependsOn: ["design"],                      //  │ PARALLEL – alle
      buildInput: (results) =>                    //  │ brauchen nur
        `## Design\n${results.get("design")}`,    //  │ das Design
    },                                            //  │
    {                                             //  │
      id: "generate_tests",                       //  │
      pattern: "generate_tests",                  //  │
      dependsOn: ["design"],                      //  │
      buildInput: (results) =>                    //  │
        `## Anforderungen\n${results.get("requirements")}\n\n` +
        `## Design\n${results.get("design")}`,    //  │
    },                                            //  │
    {                                             //  │
      id: "threat_model",                         //  │
      pattern: "threat_model",                    //  │
      dependsOn: ["design"],                      //  │
      buildInput: (results) =>                    //  │
        `## Design\n${results.get("design")}`,    //  │
    },                                            //  ┘
    {
      id: "run_tests",
      pattern: "validate_tests",
      dependsOn: ["generate_code", "generate_tests"],  // ← SYNCHRONISATION!
      buildInput: (results) =>                         //    Wartet auf Code UND Tests
        `## Code\n${results.get("generate_code")}\n\n` +
        `## Tests\n${results.get("generate_tests")}`,
    },
    {
      id: "security_review",                      //  ┐ Diese 2 laufen
      pattern: "security_review",                 //  │ wieder PARALLEL
      dependsOn: ["generate_code"],               //  │
      buildInput: (results) =>                    //  │
        `## Code\n${results.get("generate_code")}\n\n` +
        `## Threat Model\n${results.get("threat_model")}`,
    },                                            //  │
    {                                             //  │
      id: "code_review",                          //  │
      pattern: "code_review",                     //  │
      dependsOn: ["generate_code"],               //  │
      buildInput: (results) =>                    //  ┘
        `## Code\n${results.get("generate_code")}`,
    },
    {
      id: "final_report",
      pattern: "compliance_report",
      dependsOn: [                                // ← FINALE SYNCHRONISATION
        "requirements",                           //    Wartet auf ALLES
        "generate_code",
        "run_tests",
        "security_review",
        "code_review",
        "threat_model",
      ],
      buildInput: (results) =>
        `## Anforderungen\n${results.get("requirements")}\n\n` +
        `## Code\n${results.get("generate_code")}\n\n` +
        `## Testergebnisse\n${results.get("run_tests")}\n\n` +
        `## Security Review\n${results.get("security_review")}\n\n` +
        `## Code Review\n${results.get("code_review")}\n\n` +
        `## Threat Model\n${results.get("threat_model")}`,
    },
  ];

  return runDAG(steps);
}

// Das ergibt diese Ausführungsreihenfolge:
//
//   t=0s    requirements (allein)
//   t=30s   design (allein, braucht requirements)
//   t=60s   generate_code + generate_tests + threat_model (PARALLEL!)
//   t=90s   run_tests (braucht code+tests) + security_review + code_review (PARALLEL!)
//   t=120s  final_report (braucht alles)
//   t=140s  FERTIG
//
//   Sequentiell wäre das: 8 × 30s = 240s
//   Mit DAG: ~140s (42% schneller)

// ═══════════════════════════════════════════════════════════
// STUFE 3: Saga Pattern (mit Retry & Rollback)
// ═══════════════════════════════════════════════════════════
//
// Wie DAG, aber mit Fehlerbehandlung:
//   - Wenn ein Schritt fehlschlägt → Retry mit Feedback
//   - Wenn Retry auch fehlschlägt → Eskalation (zurück zu früherem Schritt)
//   - Jeder Retry bekommt das FEEDBACK des Fehlers als zusätzlichen Kontext

interface SagaStep extends WorkflowStep {
  maxRetries?: number;
  onFailure?: {
    strategy: "retry_with_feedback" | "escalate";
    feedbackTo?: string;    // ID des Schritts der es nochmal versuchen soll
    escalateTo?: string;    // ID des Schritts zu dem eskaliert wird
  };
  qualityGate?: {
    pattern: string;        // Pattern das die Qualität prüft
    minScore: number;       // Mindest-Score (1-10)
  };
}

async function runSaga(steps: SagaStep[], initialInput: string): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const status = new Map<string, StepStatus>();
  const retryCount = new Map<string, number>();
  const feedback = new Map<string, string>();

  steps.forEach((s) => {
    status.set(s.id, "pending");
    retryCount.set(s.id, 0);
  });

  while ([...status.values()].some((s) => s !== "done" && s !== "failed")) {
    const ready = steps.filter((step) => {
      if (status.get(step.id) !== "pending") return false;
      return step.dependsOn.every((dep) => status.get(dep) === "done");
    });

    if (ready.length === 0) {
      // Prüfe ob wir stuck sind (alle remaining sind blocked by failed)
      const hasRunning = [...status.values()].some((s) => s === "running");
      if (!hasRunning) break; // Deadlock → abbrechen
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }

    ready.forEach((s) => status.set(s.id, "running"));

    await Promise.all(
      ready.map(async (step) => {
        try {
          // Input bauen – inklusive eventuellem Feedback aus vorherigem Retry
          let input = step.buildInput(results);

          if (feedback.has(step.id)) {
            input +=
              "\n\n## ⚠️ FEEDBACK AUS VORHERIGEM VERSUCH\n\n" +
              "Der vorherige Versuch war nicht ausreichend. " +
              "Bitte berücksichtige folgendes Feedback:\n\n" +
              feedback.get(step.id);
          }

          const result = await runPattern(step.pattern, input);

          // ── Quality Gate prüfen (falls definiert) ──
          if (step.qualityGate) {
            const evaluation = await runPattern(
              step.qualityGate.pattern,
              `Bewerte folgendes Ergebnis auf einer Skala von 1-10:\n\n${result.output}`
            );

            // Score extrahieren (vereinfacht)
            const scoreMatch = evaluation.output.match(/(\d+)\s*\/?\s*10/);
            const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;

            if (score < step.qualityGate.minScore) {
              throw new Error(
                `Quality Gate nicht bestanden (${score}/${step.qualityGate.minScore}). ` +
                `Feedback: ${evaluation.output}`
              );
            }
          }

          results.set(step.id, result.output);
          status.set(step.id, "done");
          console.error("  ✅ %s: done", step.id);
        } catch (error) {
          const retries = retryCount.get(step.id) ?? 0;
          const maxRetries = step.maxRetries ?? 0;
          const errorMsg = error instanceof Error ? error.message : String(error);

          if (retries < maxRetries && step.onFailure?.strategy === "retry_with_feedback") {
            // ── RETRY: Nochmal versuchen mit Feedback ──
            console.error(
              "  🔄 %s: Retry %d/%d (Feedback wird weitergegeben)",
              step.id, retries + 1, maxRetries
            );
            feedback.set(step.id, errorMsg);
            retryCount.set(step.id, retries + 1);
            status.set(step.id, "pending"); // → Wird im nächsten Loop neu gestartet

          } else if (step.onFailure?.strategy === "escalate" && step.onFailure.escalateTo) {
            // ── ESKALATION: Früheren Schritt nochmal ausführen ──
            const escalateId = step.onFailure.escalateTo;
            console.error(
              "  ⬆️ %s: Eskalation zu %s",
              step.id, escalateId
            );
            feedback.set(escalateId, 
              `Nachfolgender Schritt "${step.id}" ist fehlgeschlagen:\n${errorMsg}\n` +
              `Bitte überarbeite dein Ergebnis unter Berücksichtigung dieses Problems.`
            );
            status.set(escalateId, "pending");
            status.set(step.id, "pending");
            // Alle Schritte die von escalateId abhängen müssen auch zurückgesetzt werden
            steps.forEach((s) => {
              if (s.dependsOn.includes(escalateId) && s.id !== step.id) {
                status.set(s.id, "pending");
                results.delete(s.id);
              }
            });

          } else {
            // ── ENDGÜLTIG FEHLGESCHLAGEN ──
            console.error("  ❌ %s: failed (keine Retries mehr)", step.id);
            status.set(step.id, "failed");
          }
        }
      })
    );
  }

  return results;
}

// ── Konkretes Saga-Beispiel ──

async function regulatedFeatureWorkflow(description: string) {
  const sagaSteps: SagaStep[] = [
    {
      id: "design",
      pattern: "design_solution",
      dependsOn: [],
      buildInput: () => description,
      qualityGate: {
        pattern: "evaluate_quality",
        minScore: 7,
      },
      maxRetries: 1,
      onFailure: { strategy: "retry_with_feedback" },
    },
    {
      id: "implement",
      pattern: "generate_code",
      dependsOn: ["design"],
      buildInput: (r) => `## Design\n${r.get("design")}`,
      maxRetries: 2,
      onFailure: {
        strategy: "retry_with_feedback",
        feedbackTo: "implement",
      },
    },
    {
      id: "test",
      pattern: "generate_tests",
      dependsOn: ["implement"],
      buildInput: (r) =>
        `## Code\n${r.get("implement")}\n\n## Design\n${r.get("design")}`,
      maxRetries: 1,
      onFailure: {
        strategy: "escalate",
        escalateTo: "implement",  // ← Schickt Developer zurück mit Feedback!
      },
    },
  ];

  return runSaga(sagaSteps, description);
}

// ═══════════════════════════════════════════════════════════
// CLI Entry Point
// ═══════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // stdin lesen
  const input = await new Promise<string>((resolve) => {
    if (process.stdin.isTTY) { resolve(""); return; }
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
  });

  switch (command) {
    case "scatter-gather": {
      // aios scatter-gather --scatter p1 p2 p3 --gather aggregator < input.txt
      const scatterIdx = args.indexOf("--scatter");
      const gatherIdx = args.indexOf("--gather");
      const scatterPatterns = args.slice(scatterIdx + 1, gatherIdx);
      const gatherPattern = args[gatherIdx + 1];

      const result = await scatterGather(input, scatterPatterns, gatherPattern);
      process.stdout.write(result);
      break;
    }

    case "review": {
      // Shortcut: aios review < code.py
      // = scatter-gather mit security_review + code_review + architecture_review
      const result = await scatterGather(
        input,
        ["security_review", "code_review", "architecture_review"],
        "aggregate_reviews"
      );
      process.stdout.write(result);
      break;
    }

    case "develop": {
      // aios develop < feature_spec.md
      const results = await featureDevelopmentWorkflow(input);
      process.stdout.write(results.get("final_report") ?? "Workflow fehlgeschlagen");
      break;
    }

    default:
      console.log("AIOS Parallel Workflows");
      console.log("");
      console.log("  aios scatter-gather --scatter p1 p2 p3 --gather agg");
      console.log("  aios review < code.py");
      console.log("  aios develop < feature_spec.md");
  }
}

main().catch(console.error);
