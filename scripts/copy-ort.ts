/**
 * Copies ONNX Runtime's WebAssembly build (the one transformers.js uses, with WebGPU support) to
 * public/ort. The narrator's voice model runs on it in the browser; by default it would be loaded
 * from a CDN, which the reader's CSP doesn't allow. Runs on `bun install`.
 */
import { cpSync, rmSync } from "node:fs";

const from = "node_modules/@huggingface/transformers/dist";
const to = "public/ort";

rmSync(to, { recursive: true, force: true });
for (const file of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) cpSync(`${from}/${file}`, `${to}/${file}`);
