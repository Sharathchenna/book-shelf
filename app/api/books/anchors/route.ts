import { quoteInText } from "@/lib/anchor";
import { requireOwner } from "@/lib/auth/session";
import { allNotes, getNotes, keys, listFiles, putNotes } from "@/lib/library";
import { getJson } from "@/lib/storage";

/**
 * Once, for highlights made before the readers recorded a quote and progression: fills them in from
 * each section's text, so the Android app can find every EPUB highlight. Safe to run again: only
 * highlights without a quote are touched. Answers with how many were filled and how many weren't found.
 */
export async function POST() {
  const denied = await requireOwner();
  if (denied) return denied;
  const [notes, files] = await Promise.all([allNotes(), listFiles()]);
  let filled = 0;
  let missing = 0;
  for (const file of files) {
    if ((file.format ?? "epub") !== "epub") continue;
    if (!notes.get(file.id)?.some((n) => !n.quote && !n.ink)) continue;
    const sections = await getJson<string[]>(keys.text(file.id));
    if (!sections) continue;
    // Read again with the removed ones, so their markers are kept.
    const all = await getNotes(file.id, { removed: true });
    let changed = false;
    const next = all.map((n) => {
      if (n.quote || n.ink || n.deleted) return n;
      const found = quoteInText(sections[n.sectionIndex] ?? "", n.text);
      if (!found) {
        missing++;
        return n;
      }
      filled++;
      changed = true;
      // Not a change the owner made: updatedAt stays, so it never wins over a device's edit.
      return { ...n, ...found };
    });
    if (changed) await putNotes(file.id, next);
  }
  return Response.json({ filled, missing });
}
