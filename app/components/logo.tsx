/** An open book on an emerald tile; app/icon.svg is the same mark for the favicon. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-[30%] bg-[linear-gradient(140deg,#3aa57c,#1e7a58_50%,#174a5c)] shadow-[inset_0_1px_0_rgb(255_255_255/0.3)] ${className}`}
    >
      <svg viewBox="0 0 32 32" className="size-[70%]" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round">
        <path d="M16 9.5c-2.6-1.8-6-2.4-10-2v15c4-.4 7.4.2 10 2 2.6-1.8 6-2.4 10-2v-15c-4-.4-7.4.2-10 2z" />
        <path d="M16 9.5v15" />
      </svg>
    </span>
  );
}
