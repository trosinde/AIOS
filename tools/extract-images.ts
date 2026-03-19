#!/usr/bin/env tsx
/**
 * extract-images.ts – Extrahiert Bilder aus PDF, PPTX und DOCX Dokumenten.
 *
 * Usage: tsx tools/extract-images.ts <input-file> <output-dir>
 *
 * Gibt JSON auf stdout aus: {"images": ["path1.png", "path2.jpg", ...]}
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, extname, basename } from "path";
import AdmZip from "adm-zip";

const MEDIA_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp", ".emf", ".wmf", ".svg"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"]);

// ─── PPTX / DOCX (ZIP-based) ─────────────────────────────────

function extractFromZip(filePath: string, mediaDir: string, outputDir: string): string[] {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const images: string[] = [];
  let index = 1;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const entryName = entry.entryName.toLowerCase();

    // Only extract from known media directories
    if (!entryName.startsWith(mediaDir)) continue;

    const ext = extname(entry.entryName).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;

    const outName = `image-${String(index).padStart(3, "0")}${ext}`;
    const outPath = join(outputDir, outName);
    writeFileSync(outPath, entry.getData());
    images.push(outPath);
    index++;
  }

  return images;
}

function extractFromPptx(filePath: string, outputDir: string): string[] {
  return extractFromZip(filePath, "ppt/media/", outputDir);
}

function extractFromDocx(filePath: string, outputDir: string): string[] {
  return extractFromZip(filePath, "word/media/", outputDir);
}

// ─── PDF ──────────────────────────────────────────────────────

async function extractFromPdf(filePath: string, outputDir: string): Promise<string[]> {
  // Dynamic import for pdfjs-dist (ESM)
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const images: string[] = [];
  let index = 1;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const ops = await page.getOperatorList();

    for (let i = 0; i < ops.fnArray.length; i++) {
      // OPS.paintImageXObject = 85, OPS.paintJpegXObject = 82
      if (ops.fnArray[i] !== 85 && ops.fnArray[i] !== 82) continue;

      const imgName = ops.argsArray[i][0];
      try {
        const img = await page.objs.get(imgName);
        if (!img || !img.data) continue;

        const { width, height, data: imgData } = img;
        if (!width || !height || !imgData) continue;

        // Convert raw pixel data to PNG using minimal encoder
        const pngBuffer = encodeRawToPng(imgData, width, height);
        const outName = `image-${String(index).padStart(3, "0")}.png`;
        const outPath = join(outputDir, outName);
        writeFileSync(outPath, pngBuffer);
        images.push(outPath);
        index++;
      } catch {
        // Skip images that can't be extracted
      }
    }
  }

  return images;
}

/**
 * Minimal PNG encoder for raw RGBA pixel data.
 * Avoids external dependency (canvas/sharp) for simple image writing.
 */
function encodeRawToPng(data: Uint8ClampedArray | Uint8Array, width: number, height: number): Buffer {
  // Determine bytes per pixel from data length
  const totalPixels = width * height;
  const bpp = Math.round(data.length / totalPixels);

  // Convert to RGBA if needed
  let rgba: Uint8Array;
  if (bpp === 4) {
    rgba = new Uint8Array(data);
  } else if (bpp === 3) {
    rgba = new Uint8Array(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      rgba[i * 4] = data[i * 3];
      rgba[i * 4 + 1] = data[i * 3 + 1];
      rgba[i * 4 + 2] = data[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else if (bpp === 1) {
    rgba = new Uint8Array(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      rgba[i * 4] = data[i];
      rgba[i * 4 + 1] = data[i];
      rgba[i * 4 + 2] = data[i];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    throw new Error(`Unsupported bytes per pixel: ${bpp}`);
  }

  // Build raw PNG (uncompressed, using zlib store)
  const { deflateSync } = await_import_zlib();

  // Filter: None (0) prepended to each row
  const rawRows = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawRows[y * (1 + width * 4)] = 0; // filter byte
    rawRows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  const compressed = deflateSync(Buffer.from(rawRows));

  // PNG structure
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", compressed);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function await_import_zlib() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("zlib") as typeof import("zlib");
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeB, data]);
  const crc = crc32(crcData);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  const [, , inputFile, outputDir] = process.argv;

  if (!inputFile || !outputDir) {
    console.error("Usage: tsx tools/extract-images.ts <input-file> <output-dir>");
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`Datei nicht gefunden: ${inputFile}`);
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });

  const ext = extname(inputFile).toLowerCase();
  let images: string[];

  switch (ext) {
    case ".pptx":
      images = extractFromPptx(inputFile, outputDir);
      break;
    case ".docx":
      images = extractFromDocx(inputFile, outputDir);
      break;
    case ".pdf":
      images = await extractFromPdf(inputFile, outputDir);
      break;
    default:
      console.error(`Nicht unterstütztes Format: ${ext}. Unterstützt: .pdf, .pptx, .docx`);
      process.exit(1);
  }

  if (images.length === 0) {
    console.error("Keine Bilder gefunden.");
  } else {
    console.error(`${images.length} Bild(er) extrahiert nach ${outputDir}`);
  }

  // JSON output on stdout for engine consumption
  console.log(JSON.stringify({ images }));
}

main().catch((err) => {
  console.error(`Fehler: ${err.message}`);
  process.exit(1);
});
