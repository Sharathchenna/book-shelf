import type { NextConfig } from "next";

/**
 * The reader renders EPUB content in iframes that must allow scripts (see
 * app/components/reader/foliate.ts), so its pages get a strict policy: scripts only from this
 * site, never from blob: URLs (where book documents live) or anywhere else.
 * 'unsafe-inline' is needed for Next's own inline bootstrap; book documents are sanitized of
 * inline scripts and handlers before they render.
 */
const readerCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' blob: data: https://*.r2.cloudflarestorage.com https://covers.openlibrary.org",
  "font-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self' blob: https://*.r2.cloudflarestorage.com",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
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
  cacheComponents: true,
  partialPrefetching: true,
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
