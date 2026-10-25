import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// `next dev` gets the Worker's bindings (the D1 database, as a local copy under .wrangler/).
if (process.env.NODE_ENV === "development") void initOpenNextCloudflareForDev();

/**
 * The reader renders EPUB content in iframes that must allow scripts (see
 * app/components/reader/foliate.ts), so its pages get a strict policy: scripts only from this
 * site, never from blob: URLs (where book documents live) or anywhere else.
 * 'unsafe-inline' is needed for Next's own inline bootstrap; book documents are sanitized of
 * inline scripts and handlers before they render.
 */
const readerCsp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets pdf.js compile its WebAssembly image decoders; it allows no JS eval.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' blob: data: https://*.r2.cloudflarestorage.com https://covers.openlibrary.org",
  "font-src 'self' blob: data:",
  // Narrated chapters stream straight from R2; an article's videos and audio play from their own sites.
  "media-src 'self' blob: https:",
  // The narrator's voice model (Kokoro) downloads from Hugging Face once, then stays in the browser's cache.
  "connect-src 'self' blob: https://*.r2.cloudflarestorage.com https://huggingface.co https://*.huggingface.co https://*.hf.co",
  // An article's players, where the page had them (web-article.ts player()); foliate.ts lets only these through.
  "frame-src 'self' blob: https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://open.spotify.com https://embed.podcasts.apple.com https://w.soundcloud.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // The books had a page of their own before they joined the library on the home page.
  async redirects() {
    return [{ source: "/books", destination: "/", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/reader/:path*",
        headers: [
          { key: "Content-Security-Policy", value: readerCsp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
    ];
  },
  experimental: {
    agentFeedback: true,
    // Lets the OG image import its fonts as bytes, so they're bundled rather than read from disk
    // (Cloudflare Workers have no project files at runtime).
    turbopackImportTypeBytes: true,
  },
  // No cacheComponents / partial prerendering: OpenNext on Workers serves a partially prerendered
  // page's static shell but never resumes the dynamic part, and the shelf is read from D1 per
  // request. Pages that read data render per request (they call connection()); the rest stay static.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
