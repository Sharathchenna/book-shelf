"use client";

import { useEffect } from "react";

const MAX_TILT = 12;

/**
 * One rAF-throttled pointer listener for the whole page. It sets the glass highlight position
 * (--mx/--my on `.glass`) and the cover tilt (--rx/--ry on `.tilt`), so components stay static.
 */
export function PointerEffects() {
  useEffect(() => {
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let tilted: HTMLElement | null = null;

    const untilt = () => {
      tilted?.style.removeProperty("--rx");
      tilted?.style.removeProperty("--ry");
      tilted = null;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = e.target instanceof Element ? e.target : null;

        const glass = target?.closest<HTMLElement>(".glass");
        if (glass) {
          const r = glass.getBoundingClientRect();
          glass.style.setProperty("--mx", `${e.clientX - r.left}px`);
          glass.style.setProperty("--my", `${e.clientY - r.top}px`);
        }

        const tilt = reduceMotion ? null : (target?.closest<HTMLElement>(".tilt") ?? null);
        if (tilt !== tilted) untilt();
        if (tilt) {
          const r = tilt.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          tilt.style.setProperty("--ry", `${(x * MAX_TILT * 2).toFixed(2)}deg`);
          tilt.style.setProperty("--rx", `${(-y * MAX_TILT * 2).toFixed(2)}deg`);
          tilted = tilt;
        }
      });
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", untilt);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", untilt);
    };
  }, []);

  return null;
}
