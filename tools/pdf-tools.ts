#!/usr/bin/env tsx
/**
 * pdf-tools.ts – Native PDF operations: merge, split, extract-text, convert.
 *
 * Usage: tsx tools/pdf-tools.ts <operation> <input-file> <output-path>
 *
 * Operations:
 *   merge          Input = text file with one PDF path per line → merged PDF
 *   split          Input = text file: first line = PDF path, second line = page spec (e.g. "1-3,5,7-9")
 *   extract-text   Input = PDF path → extracted text on stdout
 *   img-to-pdf     Input = text file with one image path per line → PDF with images
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, extname, basename } from "path";
import { PDFDocument } from "pdf-lib";

// ─── Merge ──────────────────────────────────────────────────

async function merge(inputFile: string, outputPath: string): Promise<void> {
  const lines = readFileSync(inputFile, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error("Keine PDF-Dateien angegeben. Input: eine Datei pro Zeile.");
  }

  const merged = await PDFDocument.create();

  for (const pdfPath of lines) {
    if (!existsSync(pdfPath)) {
      throw new Error(`Datei nicht gefunden: ${pdfPath}`);
    }
    const bytes = readFileSync(pdfPath);
    const doc = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }

  const result = await merged.save();
  writeFileSync(outputPath, result);
  console.error(`${lines.length} PDFs zusammengeführt → ${outputPath}`);
}

// ─── Split ──────────────────────────────────────────────────

function parsePageSpec(spec: string, maxPages: number): number[] {
  const pages: number[] = [];
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Math.max(1, parseInt(range[1], 10));
      const end = Math.min(maxPages, parseInt(range[2], 10));
      for (let i = start; i <= end; i++) pages.push(i);
    } else {
      const p = parseInt(trimmed, 10);
      if (p >= 1 && p <= maxPages) pages.push(p);
    }
  }
  return pages;
}

async function split(inputFile: string, outputPath: string): Promise<void> {
  const lines = readFileSync(inputFile, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 1) {
    throw new Error("Input: Zeile 1 = PDF-Pfad, Zeile 2 = Seitenangabe (z.B. '1-3,5')");
  }

  const pdfPath = lines[0];
  if (!existsSync(pdfPath)) {
    throw new Error(`Datei nicht gefunden: ${pdfPath}`);
  }

  const bytes = readFileSync(pdfPath);
  const srcDoc = await PDFDocument.load(bytes);
  const totalPages = srcDoc.getPageCount();

  // If no page spec given, split into individual pages
  if (lines.length < 2 || !lines[1]) {
    mkdirSync(outputPath, { recursive: true });
    const files: string[] = [];
    for (let i = 0; i < totalPages; i++) {
      const singleDoc = await PDFDocument.create();
      const [page] = await singleDoc.copyPages(srcDoc, [i]);
      singleDoc.addPage(page);
      const outFile = join(outputPath, `page-${String(i + 1).padStart(3, "0")}.pdf`);
      writeFileSync(outFile, await singleDoc.save());
      files.push(outFile);
    }
    console.error(`${totalPages} Seiten extrahiert nach ${outputPath}`);
    console.log(JSON.stringify({ files }));
    return;
  }

  const pageSpec = lines[1];
  const pageNumbers = parsePageSpec(pageSpec, totalPages);
  if (pageNumbers.length === 0) {
    throw new Error(`Keine gültigen Seiten in "${pageSpec}" (PDF hat ${totalPages} Seiten)`);
  }

  const newDoc = await PDFDocument.create();
  // Convert 1-based page numbers to 0-based indices
  const indices = pageNumbers.map((p) => p - 1);
  const pages = await newDoc.copyPages(srcDoc, indices);
  for (const page of pages) {
    newDoc.addPage(page);
  }

  writeFileSync(outputPath, await newDoc.save());
  console.error(`Seiten ${pageSpec} extrahiert → ${outputPath} (${pageNumbers.length} Seiten)`);
}

// ─── Extract Text ───────────────────────────────────────────

async function extractText(inputFile: string, outputPath: string): Promise<void> {
  const pdfPath = readFileSync(inputFile, "utf-8").trim().split("\n")[0].trim();
  const actualPath = existsSync(pdfPath) ? pdfPath : inputFile;

  if (!existsSync(actualPath)) {
    throw new Error(`Datei nicht gefunden: ${actualPath}`);
  }

  // Use pdfjs-dist for text extraction
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fileData = new Uint8Array(readFileSync(actualPath));
  const doc = await pdfjsLib.getDocument({ data: fileData }).promise;

  const textParts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item: Record<string, unknown>) => "str" in item)
      .map((item: Record<string, unknown>) => item.str as string)
      .join(" ");
    if (pageText.trim()) textParts.push(pageText);
  }

  const fullText = textParts.join("\n\n");
  writeFileSync(outputPath, fullText, "utf-8");
  console.error(`Text extrahiert: ${doc.numPages} Seiten, ${fullText.length} Zeichen → ${outputPath}`);
}

// ─── Image to PDF ───────────────────────────────────────────

async function imgToPdf(inputFile: string, outputPath: string): Promise<void> {
  const lines = readFileSync(inputFile, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error("Keine Bilder angegeben. Input: ein Bildpfad pro Zeile.");
  }

  const doc = await PDFDocument.create();

  for (const imgPath of lines) {
    if (!existsSync(imgPath)) {
      throw new Error(`Bild nicht gefunden: ${imgPath}`);
    }

    const imgBytes = readFileSync(imgPath);
    const ext = extname(imgPath).toLowerCase();

    let image;
    if (ext === ".png") {
      image = await doc.embedPng(imgBytes);
    } else if (ext === ".jpg" || ext === ".jpeg") {
      image = await doc.embedJpg(imgBytes);
    } else {
      console.error(`  ⚠ Überspringe ${basename(imgPath)} (nur PNG/JPG unterstützt)`);
      continue;
    }

    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  if (doc.getPageCount() === 0) {
    throw new Error("Keine unterstützten Bilder gefunden (PNG/JPG).");
  }

  writeFileSync(outputPath, await doc.save());
  console.error(`${doc.getPageCount()} Bilder → PDF: ${outputPath}`);
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const [, , operation, inputFile, outputPath] = process.argv;

  if (!operation || !inputFile || !outputPath) {
    console.error("Usage: tsx tools/pdf-tools.ts <merge|split|extract-text|img-to-pdf> <input> <output>");
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`Input-Datei nicht gefunden: ${inputFile}`);
    process.exit(1);
  }

  switch (operation) {
    case "merge":
      await merge(inputFile, outputPath);
      break;
    case "split":
      await split(inputFile, outputPath);
      break;
    case "extract-text":
      await extractText(inputFile, outputPath);
      break;
    case "img-to-pdf":
      await imgToPdf(inputFile, outputPath);
      break;
    default:
      console.error(`Unbekannte Operation: ${operation}. Verfügbar: merge, split, extract-text, img-to-pdf`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fehler: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
