import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Claude Haiku 5.5: fast and cheap, for short answers and in-reader help. */
export const HAIKU = "claude-haiku-5-5";

let client: Anthropic | undefined;

export const haikuEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/**
 * Streams the text of a Haiku response into `write`. Returns false when the model
 * declined (stop_reason "refusal"), so callers can drop the partial answer.
 */
export async function streamText(
  params: Omit<Anthropic.MessageStreamParams, "model">,
  write: (text: string) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const stream = anthropic().messages.stream({ model: HAIKU, ...params }, { signal });
  stream.on("text", write);
  const message = await stream.finalMessage();
  return message.stop_reason !== "refusal";
}
