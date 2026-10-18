import type { Address } from 'viem';
import { z } from 'zod';

import {
  ASSISTANT_SCREENS,
  assistantReplySchema,
  readPlainRequest,
  type AssistantReply,
  type AssistantScreen,
} from './assistant-actions';
import { ASSISTANT_NAME, withoutName } from './assistant-persona';
import { askForJson, type ChatMessage, type LanguageModelConfig } from './language-model';

/**
 * Reading what someone said to the assistant.
 *
 * Two readers, tried in this order. The plain grammar (`readPlainRequest`)
 * knows the sentences that can only mean one thing, at once, with no network.
 * Everything else goes to a language model on the server
 * (`apps/web/app/api/assistant/turn`), which holds the key.
 *
 * What the model is given: the words, the name of the screen the person is
 * on, and the last few things said. Nothing about the account: no balance, no
 * names, no history. What it may answer: the fixed vocabulary in
 * `assistant-actions.ts`, checked before anything is done with it. It is a
 * translator from speech to a short list of things the app knows how to do. It
 * has no key, no account and no way to confirm anything.
 */

export const TURN_TEXT_MAX = 300;
export const TURN_HISTORY_MAX = 6;
/** A request signature older than this is refused. A staleness window, not a replay window. */
export const TURN_MAX_AGE_SECONDS = 300;

/** The exact text a turn is signed over: proof the request comes from a signed-in account, so the model is not open to anyone. */
export function buildTurnMessage(input: { account: Address; timestampSeconds: number }): string {
  return ['Entole assistant', `account: ${input.account.toLowerCase()}`, `timestamp: ${input.timestampSeconds}`].join('\n');
}

export const turnHistorySchema = z
  .array(z.object({ from: z.enum(['you', 'assistant']), text: z.string().trim().min(1).max(TURN_TEXT_MAX) }))
  .max(TURN_HISTORY_MAX);

export type TurnHistory = z.infer<typeof turnHistorySchema>;

export type TurnContext = {
  /** Where in the app the person is, when it is one of the screens the assistant knows. */
  screen?: AssistantScreen | undefined;
  history?: TurnHistory | undefined;
};

// ---------------------------------------------------------------------------
// The model, server side.
// ---------------------------------------------------------------------------

/** Words the product never uses with a person. A model that says one has its sentence dropped. */
const NEVER_SAID = /\b(wallet|crypto\w*|blockchain|on-?chain|chain|gas|token|seed phrase|recovery phrase|private key|transaction hash|signature)\b/i;

export const ASSISTANT_SYSTEM_PROMPT = [
  `You are ${ASSISTANT_NAME}, the voice inside Entole, a money app used in Nigeria. People talk to you, mostly out loud, and you work the app for them.`,
  `Your manner: warm, calm and quick, like a capable friend who handles money errands. You are called ${ASSISTANT_NAME}; if they greet you ("hey ${ASSISTANT_NAME}") just answer, and never repeat your name back to them unprompted. You may use a light Nigerian turn of phrase now and then ("no wahala", "okay, let me do that"), never forced, never every time.`,
  'You never see their account and you never answer with figures of your own. You turn what they said into actions the app carries out, plus a few words to say.',
  '',
  'Reply with ONLY a JSON object: {"say": string, "actions": [ ... ]}. At most 3 actions.',
  '"say" is what you will speak aloud: one or two short natural sentences, 30 words at most, the way you would say it, not write it. No lists, no emoji, no symbols. Use "" when the action speaks for itself.',
  'They can talk to you about anything small ("how are you", "what can you do", "thank you"): answer in a sentence or two, warmly, with no actions, and where it fits steer back to what you can do. Do not give advice about investing, tax or law; say you can only help with the app.',
  '',
  'Actions, in exactly these shapes:',
  `{"do":"open","screen":S} where S is one of: ${ASSISTANT_SCREENS.join(', ')}. Use it whenever they want to go somewhere ("take me home", "I want to send money" opens send).`,
  '{"do":"pay","to":WHO,"amount":NUMBER,"note":TEXT} gets a payment ready. WHO is who they named, as they said it: a name, an @username or a phone number. "amount" and "note" are optional.',
  '{"do":"request","amount":NUMBER} when they want to be paid or to show their own link. "amount" is optional.',
  '{"do":"save","amount":NUMBER} puts money into savings. {"do":"take-out","amount":NUMBER} takes it out. "amount" is optional.',
  '{"do":"bill","kind":K,"amount":NUMBER} opens a bill. K is electricity (also "light", NEPA), airtime-data, cable-tv (DSTV, GOtv, Startimes) or internet. "kind" and "amount" are optional.',
  '{"do":"tell","about":A} where A is balance, recent, allowances, savings or username. Use this whenever they ask for a fact about their account ("what is my balance", "did Tunde pay me"); the app takes them to the right screen and says the real figure.',
  '{"do":"pause"} and {"do":"resume"} pause or resume the assistant itself.',
  '',
  'Rules:',
  '- What you hear was written down by a speech recogniser, so names and numbers may be slightly off. Take the most likely meaning; if a name or an amount is really unclear, ask once.',
  '- Amounts are naira, as plain numbers: "5k" is 5000, "two thousand five hundred" is 2500, "1.5m" is 1500000. If no amount was said, leave "amount" out. Never invent one.',
  '- You cannot confirm, approve or send a payment. "pay" only gets it ready; the person confirms it themselves with their own fingerprint or face. Never say money has been sent.',
  '- When you get a payment ready, say so briefly and that they will need to confirm it. Do not describe how.',
  '- One payment at a time. If they ask for several, get the first ready and say you will do the next after it.',
  '- People may speak Nigerian English or Pidgin: "abeg send Tunde 2k", "wetin be my balance". Understand it; answer in plain, easy English.',
  '- If you cannot tell what they want, or the app cannot do it, return no actions and ask one short question or say what you can do: send money, show how to get paid, open a screen, read out a balance.',
  '- Never use these words: wallet, crypto, blockchain, chain, gas, token, signature. Say payment, account, fee, receipt.',
].join('\n');

export type AssistantModelConfig = LanguageModelConfig;

/** Tidies what a model said into something safe to speak, or nothing. */
function cleanSay(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text || NEVER_SAID.test(text)) return undefined;
  return text.slice(0, 300);
}

/**
 * Asks the model what the person meant. `null` on any failure: no answer, an
 * answer that is not JSON, or one outside the vocabulary. An action the model
 * made up is not an action; the whole reply is dropped rather than half done.
 */
export async function readWithModel(
  text: string,
  config: AssistantModelConfig,
  context: TurnContext = {},
): Promise<AssistantReply | null> {
  const said = text.replace(/\s+/g, ' ').trim().slice(0, TURN_TEXT_MAX);
  if (!said) return null;

  const messages: ChatMessage[] = [
    { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
    ...(context.screen ? [{ role: 'system' as const, content: `They are on this screen now: ${context.screen}.` }] : []),
    ...(context.history ?? []).map((turn) => ({
      role: turn.from === 'you' ? ('user' as const) : ('assistant' as const),
      content: turn.text,
    })),
    { role: 'user', content: said },
  ];

  const parsed = assistantReplySchema.safeParse(await askForJson(messages, config));
  if (!parsed.success) return null;
  const say = cleanSay(parsed.data.say);
  return { actions: parsed.data.actions, ...(say ? { say } : {}) };
}

// ---------------------------------------------------------------------------
// The client: grammar first, then the server.
// ---------------------------------------------------------------------------

export type Heard =
  | { kind: 'reply'; reply: AssistantReply; by: 'grammar' | 'model' }
  /** The model was asked and could make nothing of it. */
  | { kind: 'not-understood' }
  /** No model to ask: not configured, or out of reach. Only the plain grammar is working. */
  | { kind: 'grammar-only' };

export type AssistantBrain = {
  read(text: string, context?: TurnContext): Promise<Heard>;
};

/** What to say when only the plain grammar is working and it did not know the sentence. */
export const GRAMMAR_ONLY_HINT =
  'Right now I can only follow simple requests. Try "send 5,000 to Ada", "open receive" or "what\'s my balance".';
export const NOT_UNDERSTOOD = "I didn't get that. Try saying who to pay and how much, or which screen to open.";

export function createAssistantBrain(options: {
  baseUrl: string;
  account: Address;
  sign: (message: string) => Promise<`0x${string}`>;
  fetch?: typeof fetch;
}): AssistantBrain {
  const fetchImpl = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  return {
    async read(heard, context = {}) {
      // "Hey Ayo, ..." is a greeting to the assistant, not part of the request.
      const text = withoutName(heard) || heard;
      const plain = readPlainRequest(text);
      if (plain) return { kind: 'reply', reply: plain, by: 'grammar' };

      const timestampSeconds = Math.floor(Date.now() / 1000);
      let response: Response;
      try {
        const signature = await options.sign(buildTurnMessage({ account: options.account, timestampSeconds }));
        response = await fetchImpl(`${base}/api/assistant/turn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            account: options.account,
            timestampSeconds,
            signature,
            text: text.slice(0, TURN_TEXT_MAX),
            ...(context.screen ? { screen: context.screen } : {}),
            ...(context.history?.length ? { history: context.history.slice(-TURN_HISTORY_MAX) } : {}),
          }),
        });
      } catch {
        return { kind: 'grammar-only' };
      }
      // No model configured, or it has been asked too often for now: either
      // way only the plain grammar is working, and that is what is said.
      if (response.status === 501 || response.status === 429) return { kind: 'grammar-only' };
      if (!response.ok) return { kind: 'not-understood' };
      try {
        const parsed = z.object({ reply: assistantReplySchema }).safeParse(await response.json());
        if (!parsed.success) return { kind: 'not-understood' };
        const { reply } = parsed.data;
        return reply.actions.length === 0 && !reply.say ? { kind: 'not-understood' } : { kind: 'reply', reply, by: 'model' };
      } catch {
        return { kind: 'not-understood' };
      }
    },
  };
}

/** The brain before anyone is signed in: it knows nothing and asks no one. */
export const silentBrain: AssistantBrain = { read: async () => ({ kind: 'grammar-only' }) };
