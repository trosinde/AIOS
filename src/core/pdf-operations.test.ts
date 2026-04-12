import { describe, it, expect } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { PDFDocument } from "pdf-lib";
import { pdfMerge, pdfSplit, pdfExtractText, pdfImgToPdf, INTERNAL_OPS, setAllowedRoots } from "./pdf-operations.js";

const TMP = join("/tmp", `aios-pdf-ops-${Date.now()}`);

async function createTestPdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  page.drawText(text, { x: 50, y: 500 });
  return Buffer.from(await doc.save());
}

describe("PDF Operations – Internal Module", () => {
  it("INTERNAL_OPS registry contains all 4 operations", () => {
    expect(Object.keys(INTERNAL_OPS)).toEqual(
      expect.arrayContaining(["pdf_merge", "pdf_split", "pdf_extract_text", "pdf_img_to_pdf"]),
    );
  });

  it("pdfMerge merges two PDFs", async () => {
    const dir = join(TMP, "merge");
    mkdirSync(dir, { recursive: true });

    const pdf1 = join(dir, "a.pdf");
    const pdf2 = join(dir, "b.pdf");
    writeFileSync(pdf1, await createTestPdf("Page A"));
    writeFileSync(pdf2, await createTestPdf("Page B"));

    const inputFile = join(dir, "input.txt");
    writeFileSync(inputFile, `${pdf1}\n${pdf2}\n`);

    const outputFile = join(dir, "merged.pdf");
    const result = await pdfMerge(inputFile, outputFile);

    expect(result.kind).toBe("file");
    expect(existsSync(outputFile)).toBe(true);

    const merged = await PDFDocument.load(readFileSync(outputFile));
    expect(merged.getPageCount()).toBe(2);

    rmSync(dir, { recursive: true, force: true });
  });

  it("pdfMerge throws on empty input", async () => {
    const dir = join(TMP, "merge-empty");
    mkdirSync(dir, { recursive: true });
    const inputFile = join(dir, "input.txt");
    writeFileSync(inputFile, "\n");

    await expect(pdfMerge(inputFile, join(dir, "out.pdf"))).rejects.toThrow("Keine PDF-Dateien");
    rmSync(dir, { recursive: true, force: true });
  });

  it("pdfSplit extracts specific pages", async () => {
    const dir = join(TMP, "split");
    mkdirSync(dir, { recursive: true });

    const doc = await PDFDocument.create();
    doc.addPage().drawText("P1", { x: 50, y: 500 });
    doc.addPage().drawText("P2", { x: 50, y: 500 });
    doc.addPage().drawText("P3", { x: 50, y: 500 });
    const pdfPath = join(dir, "source.pdf");
    writeFileSync(pdfPath, await doc.save());

    const inputFile = join(dir, "input.txt");
    writeFileSync(inputFile, `${pdfPath}\n1,3\n`);

    const outputFile = join(dir, "split.pdf");
    const result = await pdfSplit(inputFile, outputFile);

    expect(result.kind).toBe("file");
    const split = await PDFDocument.load(readFileSync(outputFile));
    expect(split.getPageCount()).toBe(2);

    rmSync(dir, { recursive: true, force: true });
  });

  it("pdfSplit without page spec splits into individual files", async () => {
    const dir = join(TMP, "split-all");
    mkdirSync(dir, { recursive: true });

    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    const pdfPath = join(dir, "source.pdf");
    writeFileSync(pdfPath, await doc.save());

    const inputFile = join(dir, "input.txt");
    writeFileSync(inputFile, pdfPath);

    const outDir = join(dir, "pages");
    const result = await pdfSplit(inputFile, outDir);

    expect(result.kind).toBe("file");
    expect(result.filePaths).toHaveLength(2);
    expect(existsSync(join(outDir, "page-001.pdf"))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("pdfExtractText extracts text from PDF", async () => {
    const dir = join(TMP, "extract");
    mkdirSync(dir, { recursive: true });

    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.drawText("Hello World", { x: 50, y: 500 });
    const pdfPath = join(dir, "source.pdf");
    writeFileSync(pdfPath, await doc.save());

    const inputFile = join(dir, "input.txt");
    writeFileSync(inputFile, pdfPath);

    const outputFile = join(dir, "output.txt");
    const result = await pdfExtractText(inputFile, outputFile);

    expect(result.kind).toBe("text");
    expect(existsSync(outputFile)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("pdfImgToPdf converts PNG to PDF", async () => {
    const dir = join(TMP, "img2pdf");
    mkdirSync(dir, { recursive: true });

    // Minimal valid 1x1 PNG
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, // 8-bit RGB
      0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
      0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82, // IEND
    ]);
    const imgPath = join(dir, "test.png");
    writeFileSync(imgPath, pngHeader);

    const inputFile = join(dir, "input.txt");
    writeFileSync(inputFile, imgPath);

    const outputFile = join(dir, "output.pdf");
    const result = await pdfImgToPdf(inputFile, outputFile);

    expect(result.kind).toBe("file");
    expect(existsSync(outputFile)).toBe(true);

    const pdf = await PDFDocument.load(readFileSync(outputFile));
    expect(pdf.getPageCount()).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("setAllowedRoots blockt Pfade außerhalb erlaubter Verzeichnisse", async () => {
    const dir = join(TMP, "sandbox");
    const allowed = join(TMP, "allowed");
    mkdirSync(dir, { recursive: true });
    mkdirSync(allowed, { recursive: true });

    const pdf = join(dir, "outside.pdf");
    const doc = await PDFDocument.create();
    doc.addPage();
    writeFileSync(pdf, await doc.save());

    const inputFile = join(dir, "input.txt");
    writeFileSync(inputFile, pdf);

    setAllowedRoots([allowed]);
    await expect(pdfMerge(inputFile, join(allowed, "out.pdf"))).rejects.toThrow("außerhalb erlaubter");
    setAllowedRoots(undefined);

    rmSync(dir, { recursive: true, force: true });
    rmSync(allowed, { recursive: true, force: true });
  });

  it("pdfImgToPdf throws on no valid images", async () => {
    const dir = join(TMP, "img2pdf-bad");
    mkdirSync(dir, { recursive: true });

    const fakePath = join(dir, "fake.bmp");
    writeFileSync(fakePath, Buffer.from([0x42, 0x4d, 0x00, 0x00]));

    const inputFile = join(dir, "input.txt");
    writeFileSync(inputFile, fakePath);

    await expect(pdfImgToPdf(inputFile, join(dir, "out.pdf"))).rejects.toThrow("Keine unterstützten Bilder");
    rmSync(dir, { recursive: true, force: true });
  });
});
