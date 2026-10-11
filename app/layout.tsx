import type { Metadata, Viewport } from "next";
import { Fraunces, Geist } from "next/font/google";
import { shelfConfig } from "@/shelf.config";
import { PointerEffects } from "./components/pointer-effects";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  // SOFT rounds the serifs (set in globals.css); opsz tightens the letterforms at display sizes.
  axes: ["SOFT", "opsz"],
});

const title = `${shelfConfig.owner}'s Shelf`;

export const metadata: Metadata = {
  metadataBase: shelfConfig.siteUrl ? new URL(shelfConfig.siteUrl) : undefined,
  title,
  description: shelfConfig.bio,
  openGraph: { title, description: shelfConfig.bio, type: "website" },
  twitter: { card: "summary_large_image", title, description: shelfConfig.bio },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f2ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0d100e" },
  ],
};

// Runs before first paint: applies the saved (or system) theme so there is no flash, and marks
// Chromium, the only engine that can refract the backdrop through an SVG filter.
const bootScript = `(function(){var d=document.documentElement;try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t}catch(e){}var b=navigator.userAgentData&&navigator.userAgentData.brands;if(b&&b.some(function(x){return /Chromium/.test(x.brand)}))d.dataset.refract=""})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${geist.variable} ${fraunces.variable} antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        {/* Refraction for `.liquid` glass: low-frequency noise displaces the backdrop slightly. */}
        <svg width="0" height="0" className="absolute" aria-hidden>
          <filter id="liquid" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.01 0.015" numOctaves={2} seed={4} result="noise" />
            <feGaussianBlur in="noise" stdDeviation={2.5} result="soft" />
            <feDisplacementMap in="SourceGraphic" in2="soft" scale={26} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
        <div className="aurora" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <PointerEffects />
        {children}
      </body>
    </html>
  );
}
