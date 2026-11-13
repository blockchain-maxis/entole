import type { Address } from 'viem';
import { z } from 'zod';

import {
  ASSISTANT_SCREENS,
  assistantReplySchema,
  readPlainRequest,
  TELL_ABOUT,
  type AssistantReply,
  type AssistantScreen,
} from './assistant-actions';
import { ASSISTANT_NAME, withoutName } from './assistant-persona';
import { EXPLAIN_TOPICS } from './ayo-knowledge';
import { REPLY_STYLES, type ReplyStyle } from './ayo-memory';
import { NEVER_SAID, plainWords } from './ayo-voice';
import { askModel, type ChatMessage, type LanguageModelConfig, type ModelFailure } from './language-model';

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
/** The longest the app waits for the model. Past it the plain grammar is all there is, and it says so: better than thinking for ever. */
export const TURN_TIMEOUT_MS = 12_000;
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
  /** How they asked to be answered. A preference, not a fact about their money. */
  style?: ReplyStyle | undefined;
  /** Today, YYYY-MM-DD, so "by March" can be read as a date. Defaults to today in Lagos. */
  today?: string | undefined;
};

export const replyStyleSchema = z.enum(REPLY_STYLES);

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Friday, 2026-11-13": the one thing about the world the model is told, so it can turn "by March" into a date. */
function todayLine(today: string): string {
  return `Today is ${WEEKDAY_NAMES[new Date(`${today}T00:00:00Z`).getUTCDay()]}, ${today}.`;
}

const STYLE_LINES: Record<ReplyStyle, string> = {
  english: 'They asked for plain English.',
  pidgin: 'They asked you to talk Pidgin with them.',
  short: 'They asked for short answers: a few words in "say".',
};

/**
 * What the assistant said, made safe to send back to the model as history:
 * every figure the device spoke ("You have ₦12,500") is taken out, so a
 * balance never reaches the model by way of the conversation.
 */
export function withoutFigures(text: string): string {
  return text
    .replace(/[₦$€£]\s?\d[\d,]*(?:\.\d+)?/g, 'that amount')
    .replace(/\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent|naira|kobo|dollars?|euros?|pounds?|k\b|m\b|months?|days?)/gi, 'some')
    .replace(/\b\d{3,}\b/g, 'some');
}

// ---------------------------------------------------------------------------
// The model, server side.
// ---------------------------------------------------------------------------

export const ASSISTANT_SYSTEM_PROMPT = [
  `You are ${ASSISTANT_NAME}, the voice inside Entole, a money app used in Nigeria. People talk to you, mostly out loud, and you work the app for them.`,
  'Who you are: a warm, calm, quick friend who is good with money errands. You talk like a person, not a bank: short spoken sentences, plain words, a little warmth. Money worries people; when someone sounds anxious or ashamed about money, be kind and steady in a few words, never preachy, never a lecture. Vary how you say things; do not open every reply the same way.',
  `You are called ${ASSISTANT_NAME}; if they greet you ("hey ${ASSISTANT_NAME}") just answer, and never repeat your name back unprompted.`,
  'If they speak Pidgin, answer in light, natural Pidgin ("no wahala", "I don set am", "e dey ready"), never forced and never mocking. If they speak plain English, answer in plain English.',
  'You never see their account and you never say figures about it. You turn what they said into actions the app carries out, plus a few words to say. The app works out and speaks every figure itself.',
  '',
  'Reply with ONLY a JSON object: {"say": string, "actions": [ ... ]}. At most 3 actions.',
  '"say" is what you will speak aloud: one or two short sentences, 25 words at most, the way you would say it, not write it. No lists, no emoji, no symbols. Use "" when an action already speaks for itself (tell, afford, checkin, explain, goal, prefer, remind and forget always do).',
  'Small talk ("how are you", "thank you", "I am tired of being broke") gets a sentence or two of warmth and no actions, and where it fits a gentle steer to something you can do.',
  '',
  'Actions, in exactly these shapes:',
  `{"do":"open","screen":S} where S is one of: ${ASSISTANT_SCREENS.join(', ')}. Use it whenever they want to go somewhere ("take me home"; "I want to send money" opens send). When they want you to pay someone regularly on your own ("let you pay my sister 2k every week", "pay my rent for me every month"), open new-allowance: that is an allowance they write themselves.`,
  '{"do":"pay","to":WHO,"amount":NUMBER,"note":TEXT} gets a payment ready. WHO is who they named, as they said it: a name, an @username or a phone number. "amount" and "note" are optional: "help me send money to Emeka" is {"do":"pay","to":"Emeka"} on its own.',
  '{"do":"request","amount":NUMBER} when they want to be paid or to show their own link: "how will people pay me", "how dem go pay me", "show my link". "amount" is optional.',
  '{"do":"save","amount":NUMBER} puts money into savings. {"do":"take-out","amount":NUMBER} takes it out. "amount" is optional.',
  '{"do":"bill","kind":K,"amount":NUMBER} opens a bill. K is electricity (also "light", NEPA), airtime-data, cable-tv (DSTV, GOtv, Startimes) or internet. "kind" and "amount" are optional.',
  `{"do":"tell","about":A} where A is one of: ${TELL_ABOUT.join(', ')}. Use this whenever they ask about their own money: "what is my balance" or "how much money I get" (balance), "did Tunde pay me" (recent), "how much can I spend today" (safe-to-spend), "where is my money going" or "small things I keep buying" (leaks), "what am I subscribed to" (subscriptions), "how am I doing" or "how long will my money last" (picture), "how much tax should I set aside" (tax), "how many dollars do I have" (pockets), "how are my goals" (goals), "what did I ask you to remind me" (reminders), "how much can you still spend for me" or "what can you pay on your own" (allowances), "anything I should know", "what's new" or "how far with my money today" (whats-new).`,
  '{"do":"afford","amount":NUMBER} when they ask whether they can afford something ("can I afford a 200k laptop", "should I buy this 50k thing"). The app answers from their own numbers.',
  '{"do":"checkin"} for a monthly check-in or review ("how did I do this month", "give me my monthly check-in", "how my month take go").',
  `{"do":"explain","topic":T} where T is one of: ${EXPLAIN_TOPICS.join(', ')}. Use it when they ask how something works or what it means: tax bands or "how does tax work now" (tax), rent relief (rent-relief), what safe to spend means (safe-to-spend), small leaks (small-leaks), pockets or changing currency (pockets), how the bank statement reading stays private (statement), allowances, pause, savings.`,
  '{"do":"goal","name":TEXT,"amount":NUMBER,"by":WHEN} saves something they are saving towards ("I want to save 400k for a laptop by March"). "name" is two or three words ("Laptop", "Rent", "Wedding"). "by" is optional.',
  '{"do":"prefer","key":K,"value":TEXT} remembers a preference, only when they say one about themselves. K is payday (value is the day of the month, "25"), savings-share (a percentage, "15"), or reply-style (english, pidgin or short).',
  '{"do":"remind","what":TEXT,"when":WHEN} remembers a reminder ("remind me to pay rent on Friday"). "what" is a few words in their own terms.',
  '{"do":"forget","what":TEXT} lets go of a goal, reminder or preference they name.',
  'WHEN is a date written YYYY-MM-DD, or one of: today, tomorrow, next tomorrow, a weekday (friday), next week, end of the month, a month (march), or a day of the month (the 25th).',
  '{"do":"swap","from":P,"to":P,"amount":NUMBER} changes money between currency pockets. P is usd, eur or gbp (dollars, euros, pounds). "amount" is in the "from" currency and optional. Naira is not a pocket.',
  '{"do":"add-to-pocket","pocket":P} when they want to add dollars, euros or pounds to a pocket. "pocket" is optional.',
  '{"do":"pause"} and {"do":"resume"} pause or resume the assistant itself.',
  '',
  'Rules:',
  '- What you hear was written down by a speech recogniser, so names and numbers may be slightly off. Take the most likely meaning; if a name or an amount is really unclear, ask once.',
  '- Amounts are plain numbers as said: "5k" is 5000, "two thousand five hundred" is 2500, "1.5m" is 1500000. Naira unless they name dollars, euros or pounds for a swap. If no amount was said, leave "amount" out. Never invent one.',
  '- You cannot confirm, approve or send a payment, a saving, a bill or a currency change. You only get it ready; the person confirms it themselves with their own fingerprint or face. Never say money has moved, been sent, saved or paid.',
  '- When you get something ready, say so in a few words and that they will confirm it. Do not describe how.',
  '- One payment at a time. If they ask for several, get the first ready and say you will do the next after it.',
  '- pay, request, save, take-out, bill, swap and add-to-pocket each open their own screen: never put an open action beside them.',
  '- Never give personal investment, tax-avoidance or legal advice, never pick a stock, a share or a currency for them, and never guess at their numbers. When they ask what to buy, invest in or hold, or how to avoid tax, return NO actions: say kindly that the choice is theirs (or that you cannot help with avoiding tax), and offer to show their own numbers or explain how something works if they want. For their own money use tell, afford and checkin; for how things work, when they ask, use explain.',
  '- If you cannot tell what they want, or the app cannot do it, return no actions and ask one short question, or say what you can do.',
  '- Never use these words: wallet, crypto, blockchain, chain, gas, token, signature. Say payment, account, fee, receipt.',
].join('\n');

export type AssistantModelConfig = LanguageModelConfig;

/** Tidies what a model said into something safe to speak, or nothing. */
function cleanSay(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text || NEVER_SAID.test(text)) return undefined;
  return plainWords(text, 300) ?? undefined;
}

/**
 * What the model made of it. "busy" is the model's own state (rate limited,
 * too slow, down, key refused) and says nothing about the sentence, so the
 * app falls back to its plain grammar rather than telling the person it did
 * not understand them. "not_understood" is an answer that was empty, not
 * JSON, or outside the vocabulary.
 */
export type ModelRead =
  /** `model` is the one that answered: the first, or the backup. */
  | { ok: true; reply: AssistantReply; model: string }
  | { ok: false; why: 'busy'; failure: Exclude<ModelFailure, 'no_json'> }
  | { ok: false; why: 'not_understood' };

/**
 * Asks the model what the person meant. An action the model made up is not
 * an action; the whole reply is dropped rather than half done.
 */
export async function readWithModel(
  text: string,
  config: AssistantModelConfig,
  context: TurnContext = {},
): Promise<ModelRead> {
  const said = text.replace(/\s+/g, ' ').trim().slice(0, TURN_TEXT_MAX);
  if (!said) return { ok: false, why: 'not_understood' };

  const today = context.today ?? new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const messages: ChatMessage[] = [
    { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
    { role: 'system', content: todayLine(today) },
    ...(context.style ? [{ role: 'system' as const, content: STYLE_LINES[context.style] }] : []),
    ...(context.screen ? [{ role: 'system' as const, content: `They are on this screen now: ${context.screen}.` }] : []),
    ...(context.history ?? []).map((turn) => ({
      role: turn.from === 'you' ? ('user' as const) : ('assistant' as const),
      // Figures the device spoke never go back to the model, whichever side sent them.
      content: turn.from === 'assistant' ? withoutFigures(turn.text) : turn.text,
    })),
    { role: 'user', content: said },
  ];

  const answer = await askModel(messages, config);
  if (!answer.ok) {
    return answer.failure === 'no_json' ? { ok: false, why: 'not_understood' } : { ok: false, why: 'busy', failure: answer.failure };
  }
  const parsed = assistantReplySchema.safeParse(answer.json);
  if (!parsed.success) return { ok: false, why: 'not_understood' };
  const say = cleanSay(parsed.data.say);
  return { ok: true, model: answer.model, reply: { actions: parsed.data.actions, ...(say ? { say } : {}) } };
}

// ---------------------------------------------------------------------------
// The client: grammar first, then the server.
// ---------------------------------------------------------------------------

export type Heard =
  /** `sealed`: the model that read it runs in sealed hardware (the route says so only when that is true). */
  | { kind: 'reply'; reply: AssistantReply; by: 'grammar' | 'model'; sealed?: boolean }
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
      try {
        const signature = await options.sign(buildTurnMessage({ account: options.account, timestampSeconds }));
        response = await fetchImpl(`${base}/api/assistant/turn`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            account: options.account,
            timestampSeconds,
            signature,
            text: text.slice(0, TURN_TEXT_MAX),
            ...(context.screen ? { screen: context.screen } : {}),
            ...(context.style ? { style: context.style } : {}),
            ...(context.history?.length
              ? {
                  history: context.history
                    .slice(-TURN_HISTORY_MAX)
                    .map((turn) => (turn.from === 'assistant' ? { ...turn, text: withoutFigures(turn.text) } : turn)),
                }
              : {}),
          }),
        });
      } catch {
        return { kind: 'grammar-only' };
      } finally {
        clearTimeout(timer);
      }
      // No model configured (501), asked too often (429), or the model itself
      // busy or down (503): only the plain grammar is working, and that is
      // what is said. None of them is a sentence it could not follow.
      if (response.status === 501 || response.status === 429 || response.status === 503) return { kind: 'grammar-only' };
      if (!response.ok) return { kind: 'not-understood' };
      try {
        const parsed = z.object({ reply: assistantReplySchema, sealed: z.boolean().optional() }).safeParse(await response.json());
        if (!parsed.success) return { kind: 'not-understood' };
        const { reply, sealed } = parsed.data;
        return reply.actions.length === 0 && !reply.say
          ? { kind: 'not-understood' }
          : { kind: 'reply', reply, by: 'model', ...(sealed ? { sealed: true } : {}) };
      } catch {
        return { kind: 'not-understood' };
      }
    },
  };
}

/** The brain before anyone is signed in: it knows nothing and asks no one. */
export const silentBrain: AssistantBrain = { read: async () => ({ kind: 'grammar-only' }) };
