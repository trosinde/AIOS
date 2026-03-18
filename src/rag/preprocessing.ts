import type { PreprocessingConfig } from "./types.js";

// ─── Cleaner Registry ───────────────────────────────────

type CleanerFn = (text: string) => string;

const cleaners = new Map<string, CleanerFn>();

export function registerCleaner(name: string, fn: CleanerFn): void {
  cleaners.set(name, fn);
}

export function applyCleaners(text: string, names: string[]): string {
  let result = text;
  for (const name of names) {
    const fn = cleaners.get(name);
    if (!fn) throw new Error(`Cleaner "${name}" nicht registriert`);
    result = fn(result);
  }
  return result;
}

// ─── Built-in Cleaners ─────────────────────────────────

registerCleaner("stripHtml", (text) =>
  text.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " "),
);

registerCleaner("normalizeWhitespace", (text) =>
  text.replace(/\s+/g, " ").trim(),
);

registerCleaner("truncate", (text) =>
  // truncate cleaner is a no-op; actual truncation happens in chunkText
  text,
);

// ─── Chunking ───────────────────────────────────────────

export function chunkText(text: string, config: PreprocessingConfig): string[] {
  const maxLen = config.maxChunkLength;
  if (text.length <= maxLen) return [text];

  switch (config.chunkStrategy) {
    case "truncate":
      return [text.slice(0, maxLen)];

    case "sliding_window": {
      const overlap = config.chunkOverlap ?? 0;
      const step = maxLen - overlap;
      if (step <= 0) return [text.slice(0, maxLen)];
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += step) {
        chunks.push(text.slice(i, i + maxLen));
        if (i + maxLen >= text.length) break;
      }
      return chunks;
    }

    case "sentence": {
      // Split on sentence boundaries, then group into chunks
      const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [text];
      const chunks: string[] = [];
      let current = "";
      for (const sentence of sentences) {
        if (current.length + sentence.length > maxLen && current.length > 0) {
          chunks.push(current.trim());
          current = "";
        }
        current += sentence;
      }
      if (current.trim()) chunks.push(current.trim());
      return chunks;
    }

    default:
      return [text.slice(0, maxLen)];
  }
}

// ─── Field Concatenation ────────────────────────────────

export function concatFields(
  item: Record<string, unknown>,
  fields: string[],
  separator: string = " | ",
): string {
  return fields
    .map((f) => {
      const val = item[f];
      if (val == null) return "";
      return typeof val === "string" ? val : String(val);
    })
    .filter(Boolean)
    .join(separator);
}
