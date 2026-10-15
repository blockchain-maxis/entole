import { z } from 'zod';

import { entryToMinor } from './amount-entry';
import { askForJson, type LanguageModelConfig } from './language-model';
import { naira, type Naira } from './money';
import type { Contact } from './schemas';

/**
 * Turns a Telegram message into the same shape the app's own proposal
 * builder produces — see docs/SCOPE.md's "Telegram as a second intake
 * surface." Whatever comes out of this still runs the same undo window
 * before anything settles; nothing here gets a shortcut past it.
 *
 * `parseTelegramMessage` below is a deterministic fallback grammar — it
 * handles the well-formed case ("Pay 5000 to Mom") without ever calling out
 * anywhere. `parseTelegramMessageWithAssistant` layers Kimi (the same model
 * the in-app assistant asks, `language-model.ts`) on top for the messages the
 * grammar can't parse, e.g. "send mom five thousand for the light bill." It
 * is additive, never a replacement: the
 * heuristic runs first, the model only sees what the heuristic already gave
 * up on, and every model response is Zod-validated before it can become a
 * proposal — same rule as every other external response in this codebase.
 */

export type ParsedIntent =
  | { ok: true; contactId: string; amountMinor: Naira; note: string }
  | { ok: false; reason: string };

const PAY_VERB = /^(pay|send)\b/i;
const AMOUNT = /(?:₦|ngn)?\s*([\d,]+(?:\.\d{1,2})?)/i;
// Whatever follows "to", up to "for", "note:" or the end. A name is not only
// letters: Mary-Jane, O'Brien, José and "Mum 2" are all people someone saved,
// and a pattern of a-z alone answered "say who it goes to" for every one.
const TO_CLAUSE = /\bto\s+(\S.*?)(?=\s+(?:for\b|note:)|$)/i;
const NOTE_CLAUSE = /\b(?:for|note:)\s+(.+)$/i;

export function parseTelegramMessage(
  text: string,
  contacts: Contact[],
  /** Used when the message gives no reason of its own. */
  defaultNote = 'Sent from Telegram',
): ParsedIntent {
  const trimmed = text.trim();
  if (!PAY_VERB.test(trimmed)) {
    return { ok: false, reason: 'Start with "pay" or "send" — e.g. "Pay 5000 to Mom for rent".' };
  }

  const amountMatch = trimmed.match(AMOUNT);
  if (!amountMatch?.[1]) return { ok: false, reason: 'Could not find an amount.' };
  const amountMinor = entryToMinor({ raw: amountMatch[1].replace(/,/g, '') });
  if (amountMinor <= 0) return { ok: false, reason: 'Amount must be greater than zero.' };

  const toMatch = trimmed.match(TO_CLAUSE);
  if (!toMatch?.[1]) return { ok: false, reason: 'Say who it goes to — e.g. "to Mom".' };
  const name = toMatch[1].trim().toLowerCase();

  const contact = contacts.find((c) => {
    const full = c.name.toLowerCase();
    return full === name || full.split(' ')[0] === name || full.startsWith(name);
  });
  if (!contact) return { ok: false, reason: `No contact matches "${toMatch[1].trim()}".` };

  const noteMatch = trimmed.match(NOTE_CLAUSE);
  const note = noteMatch?.[1]?.trim() || defaultNote;

  return { ok: true, contactId: contact.id, amountMinor, note };
}

/** The model's key and, optionally, another model or endpoint. Server-side
 * only — never read on a client bundle, same rule as `TELEGRAM_BOT_TOKEN` in
 * the webhook route that calls this. */
export type AssistantParserConfig = LanguageModelConfig;

/** What the model is allowed to hand back. Never trusted until it parses. */
const llmIntentSchema = z.object({
  understood: z.boolean(),
  /** Whole naira, not minor units — the model does language, not kobo
   * arithmetic; `naira()` does the only multiplication that matters. */
  amountWholeNaira: z.number().positive().optional(),
  recipientName: z.string().min(1).optional(),
  note: z.string().optional(),
});

const SYSTEM_PROMPT =
  'You read one Telegram message that may be a request to pay someone. ' +
  'Reply with ONLY a JSON object, no prose: ' +
  '{"understood": boolean, "amountWholeNaira": number, "recipientName": string, "note": string}. ' +
  'amountWholeNaira is the naira amount as a plain number (not kobo, not a string). ' +
  'Set "understood" to false if the message is not a payment instruction or is missing an amount or a recipient.';

/** Returns `null` on any failure — network, non-JSON, or a shape Zod
 * rejects — so the caller always has a clean "the model didn't help"
 * signal to fall back on, never a thrown error mid-parse. */
async function askModel(text: string, config: AssistantParserConfig): Promise<z.infer<typeof llmIntentSchema> | null> {
  const answer = await askForJson(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
    config,
    200,
  );
  const result = llmIntentSchema.safeParse(answer);
  return result.success ? result.data : null;
}

/**
 * The heuristic first, the model only for what it couldn't parse, `config`
 * omitted or its `apiKey` unset means "stay on the heuristic alone" — the
 * same gated-off-until-a-key-exists pattern as `GrowthVault`'s address or
 * the indexer's URL. Never throws; an unhelpful or unreachable model just
 * means the caller sees the heuristic's own rejection reason.
 */
export async function parseTelegramMessageWithAssistant(
  text: string,
  contacts: Contact[],
  config?: AssistantParserConfig,
): Promise<ParsedIntent> {
  const heuristic = parseTelegramMessage(text, contacts);
  if (heuristic.ok || !config?.apiKey) return heuristic;

  const understood = await askModel(text, config);
  if (!understood?.understood || !understood.amountWholeNaira || !understood.recipientName) return heuristic;

  const amountMinor = naira(Math.round(understood.amountWholeNaira));
  if (amountMinor <= 0) return heuristic;

  const name = understood.recipientName.trim().toLowerCase();
  const contact = contacts.find((c) => {
    const full = c.name.toLowerCase();
    return full === name || full.split(' ')[0] === name || full.startsWith(name);
  });
  if (!contact) return heuristic;

  return { ok: true, contactId: contact.id, amountMinor, note: understood.note?.trim() || 'Sent from Telegram' };
}
