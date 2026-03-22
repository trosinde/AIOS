import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { PDFDocument } from "pdf-lib";
import { execFileSync } from "child_process";

// Helper: run pdf-tools.ts via tsx
function runPdfTool(operation: string, inputFile: string, outputPath: string): string {
  return execFileSync("npx", ["tsx", "tools/pdf-tools.ts", operation, inputFile, outputPath], {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf-8",
    timeout: 30_000,
  });
}

// Helper: create a minimal valid PDF
async function createTestPdf(pages: number = 1, text?: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200, 200]);
    if (text) {
      page.drawText(`${text} - Page ${i + 1}`, { x: 10, y: 100, size: 12 });
    }
  }
  return Buffer.from(await doc.save());
}

describe("pdf-tools", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aios-pdf-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("merge", () => {
    it("merges two PDFs into one", async () => {
      const pdf1Path = join(testDir, "a.pdf");
      const pdf2Path = join(testDir, "b.pdf");
      writeFileSync(pdf1Path, await createTestPdf(2));
      writeFileSync(pdf2Path, await createTestPdf(3));

      const inputFile = join(testDir, "input.txt");
      writeFileSync(inputFile, `${pdf1Path}\n${pdf2Path}`);

      const outputFile = join(testDir, "merged.pdf");
      runPdfTool("merge", inputFile, outputFile);

      expect(existsSync(outputFile)).toBe(true);
      const merged = await PDFDocument.load(readFileSync(outputFile));
      expect(merged.getPageCount()).toBe(5);
    });

    it("fails with empty input", () => {
      const inputFile = join(testDir, "empty.txt");
      writeFileSync(inputFile, "");

      expect(() => runPdfTool("merge", inputFile, join(testDir, "out.pdf"))).toThrow();
    });

    it("fails with non-existent PDF", () => {
      const inputFile = join(testDir, "input.txt");
      writeFileSync(inputFile, "/nonexistent/file.pdf");

      expect(() => runPdfTool("merge", inputFile, join(testDir, "out.pdf"))).toThrow();
    });
  });

  describe("split", () => {
    it("splits PDF into individual pages", async () => {
      const pdfPath = join(testDir, "source.pdf");
      writeFileSync(pdfPath, await createTestPdf(3));

      const inputFile = join(testDir, "input.txt");
      writeFileSync(inputFile, pdfPath);

      const outputDir = join(testDir, "pages");
      const stdout = runPdfTool("split", inputFile, outputDir);

      expect(existsSync(join(outputDir, "page-001.pdf"))).toBe(true);
      expect(existsSync(join(outputDir, "page-002.pdf"))).toBe(true);
      expect(existsSync(join(outputDir, "page-003.pdf"))).toBe(true);

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.files).toHaveLength(3);
    });

    it("extracts specific page range", async () => {
      const pdfPath = join(testDir, "source.pdf");
      writeFileSync(pdfPath, await createTestPdf(5));

      const inputFile = join(testDir, "input.txt");
      writeFileSync(inputFile, `${pdfPath}\n2-4`);

      const outputFile = join(testDir, "subset.pdf");
      runPdfTool("split", inputFile, outputFile);

      expect(existsSync(outputFile)).toBe(true);
      const result = await PDFDocument.load(readFileSync(outputFile));
      expect(result.getPageCount()).toBe(3);
    });

    it("handles comma-separated page spec", async () => {
      const pdfPath = join(testDir, "source.pdf");
      writeFileSync(pdfPath, await createTestPdf(5));

      const inputFile = join(testDir, "input.txt");
      writeFileSync(inputFile, `${pdfPath}\n1,3,5`);

      const outputFile = join(testDir, "picked.pdf");
      runPdfTool("split", inputFile, outputFile);

      const result = await PDFDocument.load(readFileSync(outputFile));
      expect(result.getPageCount()).toBe(3);
    });
  });

  describe("extract-text", () => {
    it("extracts text from a PDF with text content", async () => {
      const pdfPath = join(testDir, "text.pdf");
      writeFileSync(pdfPath, await createTestPdf(1, "Hello World"));

      const inputFile = join(testDir, "input.txt");
      writeFileSync(inputFile, pdfPath);

      const outputFile = join(testDir, "extracted.txt");
      runPdfTool("extract-text", inputFile, outputFile);

      expect(existsSync(outputFile)).toBe(true);
      const text = readFileSync(outputFile, "utf-8");
      expect(text).toContain("Hello World");
    });

    it("handles PDF without text", async () => {
      const pdfPath = join(testDir, "empty.pdf");
      writeFileSync(pdfPath, await createTestPdf(1));

      const inputFile = join(testDir, "input.txt");
      writeFileSync(inputFile, pdfPath);

      const outputFile = join(testDir, "extracted.txt");
      runPdfTool("extract-text", inputFile, outputFile);

      expect(existsSync(outputFile)).toBe(true);
    });
  });

  describe("img-to-pdf", () => {
    it("converts a PNG image to PDF", async () => {
      // Create a minimal 1x1 PNG
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
        0x00, 0x00, 0x00, 0x0d, // IHDR length
        0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0x00, 0x01, // width: 1
        0x00, 0x00, 0x00, 0x01, // height: 1
        0x08, 0x02, // 8bit RGB
        0x00, 0x00, 0x00, // compression, filter, interlace
        0x90, 0x77, 0x53, 0xde, // CRC
        0x00, 0x00, 0x00, 0x0c, // IDAT length
        0x49, 0x44, 0x41, 0x54, // IDAT
        0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // compressed data
        0xe2, 0x21, 0xbc, 0x33, // CRC
        0x00, 0x00, 0x00, 0x00, // IEND length
        0x49, 0x45, 0x4e, 0x44, // IEND
        0xae, 0x42, 0x60, 0x82, // CRC
      ]);

      const imgPath = join(testDir, "test.png");
      writeFileSync(imgPath, pngHeader);

      const inputFile = join(testDir, "input.txt");
      writeFileSync(inputFile, imgPath);

      const outputFile = join(testDir, "output.pdf");
      runPdfTool("img-to-pdf", inputFile, outputFile);

      expect(existsSync(outputFile)).toBe(true);
      const result = await PDFDocument.load(readFileSync(outputFile));
      expect(result.getPageCount()).toBe(1);
    });

    it("fails with empty input", () => {
      const inputFile = join(testDir, "empty.txt");
      writeFileSync(inputFile, "");

      expect(() => runPdfTool("img-to-pdf", inputFile, join(testDir, "out.pdf"))).toThrow();
    });
  });

  describe("error handling", () => {
    it("rejects unknown operation", () => {
      const inputFile = join(testDir, "input.txt");
      writeFileSync(inputFile, "test");

      expect(() => runPdfTool("unknown-op", inputFile, join(testDir, "out.pdf"))).toThrow();
    });

    it("rejects non-existent input file", () => {
      expect(() => runPdfTool("merge", "/nonexistent/input.txt", join(testDir, "out.pdf"))).toThrow();
    });
  });
});
