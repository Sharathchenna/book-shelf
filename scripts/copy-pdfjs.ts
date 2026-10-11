/**
 * Copies pdf.js (the library, its worker and data files: fonts, CMaps, image decoders) to
 * public/pdfjs. The PDF reader loads it from there at runtime, so it's in no bundle, the Worker's
 * included, and always matches the installed version. Runs on `bun install`.
 */
import { cpSync, rmSync } from "node:fs";

const from = "node_modules/pdfjs-dist";
const to = "public/pdfjs";

rmSync(to, { recursive: true, force: true });
cpSync(`${from}/build/pdf.min.mjs`, `${to}/pdf.min.mjs`);
cpSync(`${from}/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) cpSync(`${from}/${dir}`, `${to}/${dir}`, { recursive: true });
