"use client";

export function ThemeToggle() {
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const root = document.documentElement;
    const apply = () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch {
        // Private mode: the toggle still works for this visit.
      }
    };
    // While the theme changes, nothing animates on its own (see globals.css): otherwise every
    // button and chip fades between the themes on its own clock, and the page flickers.
    root.dataset.switching = "";
    const settle = () => delete root.dataset.switching;

    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      apply();
      // Two frames: the new colours are painted before transitions come back.
      requestAnimationFrame(() => requestAnimationFrame(settle));
      return;
    }
    // The new theme grows as a circle from the middle of this button (see globals.css).
    const r = e.currentTarget.getBoundingClientRect();
    root.style.setProperty("--vt-x", `${r.left + r.width / 2}px`);
    root.style.setProperty("--vt-y", `${r.top + r.height / 2}px`);
    document.startViewTransition(apply).finished.finally(settle);
  };

  // Both icons render; CSS shows the right one, so server and client markup always match.
  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="grid size-10 place-items-center rounded-full bg-chip transition-colors hover:bg-line"
    >
      <svg viewBox="0 0 24 24" className="size-[18px] dark:hidden" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 24 24" className="hidden size-[18px] dark:block" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="4" />
        <path
          d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
