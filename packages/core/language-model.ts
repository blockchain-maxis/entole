/**
 * The language model both readers ask: the assistant's (`assistant-brain.ts`)
 * and Telegram's (`telegram-intake.ts`). It is Kimi, from Moonshot AI, through
 * its OpenAI-compatible `chat/completions` endpoint. Server side only: the key
 * is read in the routes that call this and never reaches a client bundle.
 *
 * Reading a sentence into a fixed vocabulary needs no long reasoning, so the
 * default model is asked with thinking off, which is what makes it quick
 * enough to answer someone who is talking. Any other OpenAI-compatible
 * endpoint and model can be put in its place with `apiUrl` and `model`.
 */

export const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';
export const KIMI_MODEL = 'kimi-k2.6';

export type LanguageModelConfig = {
  apiKey: string;
  model?: string | undefined;
  /** An OpenAI-compatible `chat/completions` endpoint. Defaults to Moonshot's. */
  apiUrl?: string | undefined;
  fetch?: typeof fetch;
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Kimi K2.6 can be asked with thinking off; K3 always thinks, and other providers do not know the field. */
function canTurnThinkingOff(model: string): boolean {
  return /^kimi-k2\.6/.test(model);
}

/** Pulls the JSON object out of a model's answer, which sometimes arrives wrapped in a code fence. */
export function jsonIn(content: string): unknown {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Asks for one JSON object. `null` on any failure: the endpoint refused,
 * answered something other than a chat reply, or answered no JSON at all.
 * Whatever comes back is still unchecked; each caller parses it with its own
 * schema before using it.
 */
export async function askForJson(
  messages: ChatMessage[],
  config: LanguageModelConfig,
  maxTokens = 300,
): Promise<unknown> {
  const model = config.model ?? KIMI_MODEL;
  try {
    const response = await (config.fetch ?? fetch)(config.apiUrl ?? KIMI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
        ...(canTurnThinkingOff(model) ? { thinking: { type: 'disabled' } } : {}),
        messages,
      }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    return jsonIn(content);
  } catch {
    return null;
  }
}
