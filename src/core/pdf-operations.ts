/**
 * Internal PDF operations – replaces the external tools/pdf-tools.ts script.
 * Called directly by the Engine for type: "internal" patterns, no subprocess.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join, basename, resolve, normalize, extname } from "path";
import { PDFDocument } from "pdf-lib";

const MAX_FILE_SIZE = 200 * 1024 * 1024;

let _allowedRoots: string[] | undefined;

export function setAllowedRoots(roots: string[] | undefined): void {
  _allowedRoots = roots;
}

function validateFilePath(filePath: string): string {
  const resolved = resolve(normalize(filePath));
  if (_allowedRoots && _allowedRoots.length > 0) {
    const isAllowed = _allowedRoots.some(root => resolved.startsWith(resolve(root)));
    if (!isAllowed) {
      throw new Error(`Pfad außerhalb erlaubter Verzeichnisse: ${basename(filePath)}`);
    }
  }
  if (!existsSync(resolved)) {
    throw new Error(`Datei nicht gefunden: ${basename(filePath)}`);
  }
  const size = statSync(resolved).size;
  if (size > MAX_FILE_SIZE) {
    throw new Error(`Datei zu groß: ${basename(filePath)} (${Math.round(size / 1024 / 1024)}MB, max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  }
  return resolved;
}

function safeReadFile(filePath: string): Buffer {
  const resolved = validateFilePath(filePath);
  return readFileSync(resolved);
}

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

export async function pdfMerge(inputFile: string, outputPath: string): Promise<{ content: string; kind: "text" | "file" }> {
  const lines = readFileSync(inputFile, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    throw new Error("Keine PDF-Dateien angegeben. Input: eine Datei pro Zeile.");
  }

  const merged = await PDFDocument.create();

  for (const pdfPath of lines) {
    const bytes = safeReadFile(pdfPath);
    const doc = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }

  writeFileSync(outputPath, await merged.save());
  return { content: `Datei erzeugt: ${outputPath}`, kind: "file" };
}

export async function pdfSplit(inputFile: string, outputPath: string): Promise<{ content: string; kind: "text" | "file"; filePaths?: string[] }> {
  const lines = readFileSync(inputFile, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 1) {
    throw new Error("Input: Zeile 1 = PDF-Pfad, Zeile 2 = Seitenangabe (z.B. '1-3,5')");
  }

  const bytes = safeReadFile(lines[0]);
  const srcDoc = await PDFDocument.load(bytes);
  const totalPages = srcDoc.getPageCount();

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
    return {
      content: `Dateien extrahiert: ${files.join(", ")}`,
      kind: "file",
      filePaths: files,
    };
  }

  const pageSpec = lines[1];
  const pageNumbers = parsePageSpec(pageSpec, totalPages);
  if (pageNumbers.length === 0) {
    throw new Error(`Keine gültigen Seiten in "${pageSpec}" (PDF hat ${totalPages} Seiten)`);
  }

  const newDoc = await PDFDocument.create();
  const indices = pageNumbers.map(p => p - 1);
  const pages = await newDoc.copyPages(srcDoc, indices);
  for (const page of pages) {
    newDoc.addPage(page);
  }

  writeFileSync(outputPath, await newDoc.save());
  return { content: `Datei erzeugt: ${outputPath}`, kind: "file" };
}

export async function pdfExtractText(inputFile: string, outputPath: string): Promise<{ content: string; kind: "text" | "file" }> {
  const pdfPath = readFileSync(inputFile, "utf-8").trim().split("\n")[0].trim();
  const actualPath = existsSync(resolve(normalize(pdfPath))) ? pdfPath : inputFile;
  const fileBytes = safeReadFile(actualPath);

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fileData = new Uint8Array(fileBytes);
  const doc = await pdfjsLib.getDocument({ data: fileData }).promise;

  const textParts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item: Record<string, unknown>) => "str" in item && typeof item.str === "string")
      .map((item: Record<string, unknown>) => String(item.str))
      .join(" ");
    if (pageText.trim()) textParts.push(pageText);
  }

  const fullText = textParts.join("\n\n");
  writeFileSync(outputPath, fullText, "utf-8");
  return { content: fullText, kind: "text" };
}

export async function pdfImgToPdf(inputFile: string, outputPath: string): Promise<{ content: string; kind: "text" | "file" }> {
  const lines = readFileSync(inputFile, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    throw new Error("Keine Bilder angegeben. Input: ein Bildpfad pro Zeile.");
  }

  const doc = await PDFDocument.create();

  for (const imgPath of lines) {
    const imgBytes = safeReadFile(imgPath);
    const isPng = imgBytes[0] === 0x89 && imgBytes[1] === 0x50 && imgBytes[2] === 0x4e && imgBytes[3] === 0x47;
    const isJpg = imgBytes[0] === 0xff && imgBytes[1] === 0xd8 && imgBytes[2] === 0xff;

    let image;
    if (isPng) {
      image = await doc.embedPng(imgBytes);
    } else if (isJpg) {
      image = await doc.embedJpg(imgBytes);
    } else {
      console.error(`  ⚠ Überspringe ${basename(imgPath)} (kein gültiges PNG/JPG)`);
      continue;
    }

    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  if (doc.getPageCount() === 0) {
    throw new Error("Keine unterstützten Bilder gefunden (PNG/JPG).");
  }

  writeFileSync(outputPath, await doc.save());
  return { content: `Datei erzeugt: ${outputPath}`, kind: "file" };
}

export type InternalOpFn = (inputFile: string, outputPath: string) => Promise<{ content: string; kind: "text" | "file"; filePaths?: string[] }>;

export const INTERNAL_OPS: Record<string, InternalOpFn> = {
  pdf_merge: pdfMerge,
  pdf_split: pdfSplit,
  pdf_extract_text: pdfExtractText,
  pdf_img_to_pdf: pdfImgToPdf,
};
