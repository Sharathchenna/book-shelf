import "server-only";
import { anthropic, HAIKU } from "./haiku";

/**
 * Reading a scanned PDF page: a page with no text layer (a scan, or garbled glyphs) is rendered
 * in the browser and Claude Haiku transcribes the picture, so Recap, Chat, Brief and the rest
 * can read it (from Gloss, which uses a vision model for the same pages).
 */

const SYSTEM = `You transcribe one page of a scanned document. Write out its text exactly as printed, in reading order (in columns, left column first).
- Plain text, not Markdown. Keep paragraphs apart with a blank line, and put headings on their own line.
- Join words hyphenated across a line break; keep everything else as printed, spelling included.
- Tables: one row per line, cells separated by " | ".
- Leave out running headers, footers and page numbers.
- Write math in plain text or simple Unicode (x², Σ, √), not LaTeX.
- A figure without text gets nothing; a caption is text.
Return only the page's text, with no commentary. If the page has no text, return nothing.`;

export async function transcribePage(jpegBase64: string): Promise<string> {
  const message = await anthropic().messages.create(
    {
      model: HAIKU,
      max_tokens: 8000,
      system: SYSTEM,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
            { type: "text", text: "Transcribe this page." },
          ],
        },
      ],
    },
    { signal: AbortSignal.timeout(90_000) },
  );
  if (message.stop_reason === "refusal") return "";
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
