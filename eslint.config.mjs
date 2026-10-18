import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cloudflare Workers build output (OpenNext) and wrangler state.
    ".open-next/**",
    ".wrangler/**",
    "cloudflare-env.d.ts",
    // pdf.js assets copied from node_modules (scripts/copy-pdfjs.ts).
    "public/pdfjs/**",
    // ONNX Runtime for the narrator's voice (scripts/copy-ort.ts).
    "public/ort/**",
    // Gloss, another reading app kept beside this one for reference; it isn't part of the site.
    "gloss/**",
    // The Android app (Kotlin), and its Gradle build output.
    "android/**",
  ]),
]);

export default eslintConfig;
