import { inkSvg } from "@/lib/ink";
import type { Ink } from "@/lib/library-types";

/** A drawing made in the Android app, shown as it was drawn (the web can't make or change them). */
export function InkDrawing({ ink, className, style }: { ink: Ink; className?: string; style?: React.CSSProperties }) {
  return <span className={className} style={style} aria-label={ink.recognized ? `Drawing: ${ink.recognized}` : "Drawing"} role="img" dangerouslySetInnerHTML={{ __html: inkSvg(ink) }} />;
}
