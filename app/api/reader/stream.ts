import Anthropic from "@anthropic-ai/sdk";

/**
 * Streams model text to the client as plain text. If the model declines or the call fails,
 * the stream ends with a marker line the reader UI recognises and shows as an error.
 */
export const AI_ERROR_MARKER = "\n[[ai-error]]";

export function aiResponse(
  signal: AbortSignal,
  run: (write: (text: string) => void) => Promise<boolean>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const ok = await run((text) => controller.enqueue(encoder.encode(text)));
        if (!ok) controller.enqueue(encoder.encode(AI_ERROR_MARKER));
      } catch (error) {
        if (!(error instanceof Anthropic.APIUserAbortError) && !signal.aborted) {
          console.error("Reader AI failed", error);
          controller.enqueue(encoder.encode(AI_ERROR_MARKER));
        }
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
