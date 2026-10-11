export function Stars({ rating, pop = false, className = "" }: { rating?: number; pop?: boolean; className?: string }) {
  if (!rating) return null;
  if (pop) {
    // One span per star so each can arrive in turn (see .star-pop in globals.css).
    return (
      <span className={`star-pop tracking-[0.12em] text-star ${className}`} aria-label={`Rated ${rating} out of 5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={i < rating ? "" : "text-line"} style={{ animationDelay: `${0.45 + i * 0.07}s` }}>
            ★
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={`tracking-[0.12em] text-star ${className}`} aria-label={`Rated ${rating} out of 5`}>
      {"★".repeat(rating)}
      <span className="text-line">{"★".repeat(5 - rating)}</span>
    </span>
  );
}
