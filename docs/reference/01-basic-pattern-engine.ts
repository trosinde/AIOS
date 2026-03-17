// ============================================================
// AIOS Pattern Engine - Das Fabric-Prinzip in TypeScript
// ============================================================
// Dies ist das Kernkonzept: Markdown-Dateien als System-Prompts,
// stdin/stdout als Interface, LLM-API als Engine.
//
// Zum Verstehen, nicht als fertiges Produkt.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ─── SCHRITT 1: Pattern laden ────────────────────────────────
//
// Ein Pattern ist nur ein Verzeichnis mit einer system.md Datei.
// Genau wie bei Fabric. Keine Magie.
//
// ~/.aios/patterns/
// ├── summarize/
// │   └── system.md        ← "Du bist ein Experte für..."
// ├── extract_requirements/
// │   └── system.md
// └── code_review/
//     └── system.md

const PATTERNS_DIR = join(homedir(), ".aios", "patterns");

interface Pattern {
  name: string;
  systemPrompt: string;
}

function loadPattern(name: string): Pattern {
  const systemPath = join(PATTERNS_DIR, name, "system.md");

  if (!existsSync(systemPath)) {
    throw new Error(
      `Pattern "${name}" nicht gefunden.\n` +
        `Erwartet: ${systemPath}\n\n` +
        `Verfügbare Patterns:\n` +
        listPatterns()
          .map((p) => `  - ${p}`)
          .join("\n")
    );
  }

  return {
    name,
    systemPrompt: readFileSync(systemPath, "utf-8"),
  };
}

function listPatterns(): string[] {
  if (!existsSync(PATTERNS_DIR)) return [];
  return readdirSync(PATTERNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(join(PATTERNS_DIR, d.name, "system.md")))
    .map((d) => d.name);
}

// ─── SCHRITT 2: LLM aufrufen ────────────────────────────────
//
// Das ist der gesamte "Motor". System-Prompt aus der Markdown-
// Datei, User-Input aus stdin. Fertig.
//
// Fabric macht genau dasselbe – nur in Go statt TypeScript.

async function runPattern(pattern: Pattern, userInput: string): Promise<string> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: pattern.systemPrompt, // ← Die system.md Datei
    messages: [
      {
        role: "user",
        content: userInput, // ← stdin
      },
    ],
  });

  // Nur den Text extrahieren
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// ─── SCHRITT 3: stdin lesen ──────────────────────────────────
//
// Liest alles von stdin. Wenn Daten gepiped werden (z.B.
// cat file.txt | aios run summarize), kommt der Text hier an.
// Wenn nichts gepiped wird, liest es interaktiv.

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    // Prüfe ob stdin ein Pipe/File ist (nicht interaktiv)
    if (process.stdin.isTTY) {
      resolve(""); // Kein Pipe-Input
      return;
    }

    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

// ─── SCHRITT 4: CLI zusammenbauen ───────────────────────────
//
// Minimales CLI. In der echten Version würde hier Typer/Commander
// stehen, aber das Prinzip bleibt gleich.
//
// Nutzung:
//   echo "Langer Text..." | npx tsx aios.ts run summarize
//   cat code.py | npx tsx aios.ts run code_review
//   npx tsx aios.ts list
//   npx tsx aios.ts run extract_requirements < spec.md

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    // ── aios list ──
    // Zeigt alle verfügbaren Patterns
    case "list": {
      const patterns = listPatterns();
      if (patterns.length === 0) {
        console.log(`Keine Patterns gefunden in ${PATTERNS_DIR}`);
        console.log(`\nErstelle dein erstes Pattern:`);
        console.log(`  mkdir -p ${PATTERNS_DIR}/summarize`);
        console.log(
          `  echo "Du bist ein Experte für Zusammenfassungen..." > ${PATTERNS_DIR}/summarize/system.md`
        );
      } else {
        console.log("Verfügbare Patterns:\n");
        patterns.forEach((p) => console.log(`  ${p}`));
      }
      break;
    }

    // ── aios run <pattern> ──
    // Das Herzstück: Pattern laden, stdin lesen, LLM aufrufen, stdout schreiben
    case "run": {
      const patternName = args[1];
      if (!patternName) {
        console.error("Usage: aios run <pattern_name>");
        process.exit(1);
      }

      // 1. Pattern laden (= system.md lesen)
      const pattern = loadPattern(patternName);

      // 2. User-Input holen (stdin oder Argument)
      let userInput = args.slice(2).join(" ");
      if (!userInput) {
        userInput = await readStdin();
      }
      if (!userInput) {
        console.error("Kein Input. Nutze stdin oder übergib Text als Argument.");
        console.error("  echo 'dein text' | aios run " + patternName);
        process.exit(1);
      }

      // 3. LLM aufrufen
      const result = await runPattern(pattern, userInput);

      // 4. Ergebnis nach stdout schreiben
      //    → Das ermöglicht Pipe-Verkettung!
      process.stdout.write(result);
      break;
    }

    // ── aios show <pattern> ──
    // Zeigt den System-Prompt eines Patterns (zum Debuggen/Lernen)
    case "show": {
      const name = args[1];
      if (!name) {
        console.error("Usage: aios show <pattern_name>");
        process.exit(1);
      }
      const p = loadPattern(name);
      console.log(p.systemPrompt);
      break;
    }

    default:
      console.log("AIOS - AI Orchestration System\n");
      console.log("Commands:");
      console.log("  aios list              Alle Patterns anzeigen");
      console.log("  aios run <pattern>     Pattern ausführen (stdin → LLM → stdout)");
      console.log("  aios show <pattern>    System-Prompt anzeigen");
      console.log("\nBeispiele:");
      console.log('  echo "Langer Text" | aios run summarize');
      console.log("  cat code.py | aios run code_review");
      console.log("  cat spec.md | aios run extract_requirements | aios run prioritize");
  }
}

main().catch((err) => {
  console.error("Fehler:", err.message);
  process.exit(1);
});

// ============================================================
// DAS IST ALLES.
//
// Die gesamte "Magie" von Fabric ist:
//   1. Markdown-Datei lesen (system.md)
//   2. stdin lesen
//   3. Beides als system + user an LLM schicken
//   4. Antwort nach stdout schreiben
//
// Die Kraft kommt aus:
//   - Der Qualität der Prompts in den system.md Dateien
//   - Der Unix-Pipe-Komposition (stdout → stdin)
//   - Der Einfachheit (jeder kann Patterns schreiben)
//
// Für AIOS wird DIESES Fundament erweitert um:
//   - Personas (= Patterns mit Rolle + Gedächtnis)
//   - Workflows (= Orchestrierte Pattern-Ketten)
//   - Knowledge Base (= Kontext der automatisch injiziert wird)
//   - Message Bus (= Agenten kommunizieren asynchron)
//
// Aber der Kern bleibt: Markdown rein → LLM → Text raus.
// ============================================================
