import { usePathname, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';

import {
  answerOffer,
  asksPicture,
  nudgesFrom,
  planReply,
  readAnswer,
  type AssistantFacts,
  type AssistantScreen,
  type AssistantStep,
  type PendingOffer,
} from '@entole/core/assistant-actions';
import { GRAMMAR_ONLY_HINT, NOT_UNDERSTOOD, type TurnHistory } from '@entole/core/assistant-brain';
import { readNudgeFacts } from '@entole/core/ayo-hook';
import { readMemory } from '@entole/core/ayo-memory';
import { openingLine } from '@entole/core/ayo-nudges';
import { useBackend } from '@entole/core/backend';
import { readMoneyView } from '@entole/core/money-picture-hook';
import { useStore } from '@entole/core/store';

import { useAccount } from './account';
import { useAssistant } from './assistant';

/**
 * One thing said to the assistant, carried out on the phone.
 *
 * Reading the sentence and deciding what it means is shared with the browser
 * (`packages/core/assistant-actions.ts`, `assistant-brain.ts`). Here it becomes
 * this app's own navigation: a screen opened, Send with the person and the
 * amount filled in, a fact said.
 *
 * What it can never do is in what this file does not have. It moves the person
 * to a screen. It holds no way to press Confirm and no way to answer the
 * fingerprint prompt, so a payment the person has not confirmed themselves
 * cannot leave. The one payment it starts itself is inside an allowance, and
 * that goes to the undo sheet like any other.
 */

/** Each screen the assistant knows, as this app's own route for it. */
const ROUTES: Record<AssistantScreen, Href> = {
  home: '/(tabs)',
  pay: '/(tabs)/transfer',
  send: '/send/pick',
  receive: '/receive',
  'add-money': '/add-money',
  activity: '/activity',
  savings: '/grow/savings',
  stocks: '/grow/stocks',
  bills: '/bill',
  business: '/business',
  invoice: '/business/new-invoice',
  people: '/beneficiaries',
  'new-allowance': '/rules/new',
  assistant: '/assistant',
  me: '/(tabs)/me',
  money: '/(tabs)/money',
  plan: '/(tabs)/plan',
};

/**
 * Where a step Ayo offered goes, for a button outside the conversation (the
 * card on Home). Only the steps a nudge can offer: a screen, or savings with
 * the amount filled in. Anything else is Home.
 */
export function assistantHref(step: AssistantStep): Href {
  if (step.kind === 'open') return ROUTES[step.screen];
  if (step.kind === 'savings') {
    return {
      pathname: '/grow/savings',
      params: { mode: step.mode, ...(step.amountMinor !== undefined ? { amount: String(step.amountMinor) } : {}) },
    };
  }
  return '/(tabs)';
}

export type AssistantOutcome = {
  /** What the assistant has to say about it, in one line. Empty when it has nothing to add. */
  said: string;
  /** Whether the person was taken to another screen. */
  moved: boolean;
  /** Whether something was got ready for the person to confirm (a payment, a saving, a bill). The conversation stops there: the next move is theirs. */
  prepared: boolean;
};

/** Screens where the person is part-way through something: asked a fact there, the assistant answers aloud and leaves them where they are. */
const MID_TASK = [/^\/send(\/|$)/, /^\/bill\//, /^\/rules\/new/, /^\/business\/new-invoice/, /^\/add-money/, /^\/grow\/savings/];

/** How one request is made: by voice, the review opens by itself and the assistant reads it out. */
export type RunOptions = { byVoice?: boolean };

/**
 * Something Ayo offered and is waiting on ("Want me to put ₦50,000 aside?").
 * One for the whole app, so a yes said by voice or typed answers it. It waits
 * one turn: a yes or a no answers it, anything else moves on.
 */
let pendingOffer: PendingOffer | null = null;
/** Which turn this is, so Ayo does not say the same thing the same way every time. */
let turnCount = 0;

/**
 * What Ayo opens with: hello by name and the one thing worth saying today,
 * from the person's own figures, worked out on the phone. Its offer, if it
 * makes one, waits for a yes.
 */
export function useAyoOpening(): (options?: { onlyWithNudge?: boolean }) => Promise<string | null> {
  const store = useStore();
  const backend = useBackend();
  const { account } = useAccount();
  return useCallback(
    async (options = {}) => {
      const read = await readNudgeFacts(backend, store).catch(() => null);
      const top = read ? (nudgesFrom(read.facts)[0] ?? null) : null;
      if (!top && options.onlyWithNudge) return null;
      pendingOffer = top?.action ? { step: top.action.step, nudgeId: top.id } : null;
      return openingLine(top, account?.displayName ?? null, new Date(), turnCount);
    },
    [account, backend, store],
  );
}

export function useAssistantRunner(): (text: string, history: TurnHistory, options?: RunOptions) => Promise<AssistantOutcome> {
  const router = useRouter();
  const pathname = usePathname();
  const store = useStore();
  const backend = useBackend();
  const { account } = useAccount();
  const { enabled } = useAssistant();

  return useCallback(
    async (spoken, history, options = {}) => {
      const text = spoken.replace(/\s+/g, ' ').trim();
      if (!text || !account) return { said: '', moved: false, prepared: false };

      turnCount += 1;
      const offer = pendingOffer;
      pendingOffer = null;
      const memory = await backend.memory.list().catch(() => null);
      const answer = offer ? readAnswer(text) : null;

      let steps: AssistantStep[];
      if (offer && answer) {
        steps = answerOffer(answer, offer, { memory, turn: turnCount });
      } else {
        const style = memory ? (readMemory(memory).replyStyle ?? undefined) : undefined;
        const heard = await backend.brain.read(text, { history, style });
        if (heard.kind !== 'reply') {
          return { said: heard.kind === 'grammar-only' ? GRAMMAR_ONLY_HINT : NOT_UNDERSTOOD, moved: false, prepared: false };
        }

        // The money picture and its lines are built here, on the device, only when a reply asks about them.
        const view = asksPicture(heard.reply) ? await readMoneyView(backend, store).catch(() => null) : null;
        const facts: AssistantFacts = {
          balanceMinor: store.balance,
          activity: store.activity,
          allowances: store.allowances,
          savingsMinor: store.growPosition?.balanceMinor ?? null,
          username: account.username || null,
          contactName: (id) => store.contact(id)?.name,
          picture: view?.picture ?? null,
          lines: view?.lines ?? null,
          pockets: heard.reply.actions.some((action) => action.do === 'tell' && action.about === 'pockets')
            ? await backend.near.pockets().catch(() => null)
            : null,
          memory,
          invoices: store.invoices,
          displayName: account.displayName || null,
          turn: turnCount,
        };
        steps = await planReply(
          heard.reply,
          { contacts: store.contacts, allowances: store.allowances, canSpend: enabled, paused: store.paused },
          facts,
          {
            directory: backend.directory,
            resolveContactId: backend.source.resolveContactId,
            stay: MID_TASK.some((screen) => screen.test(pathname)),
            byVoice: options.byVoice === true,
          },
        );
      }

      // The sheet this was said in is put away first, so what opens is on top of the app and not of it.
      const go = (href: Href) => {
        if (router.canDismiss()) router.dismiss();
        router.navigate(href);
      };

      let moved = false;
      let prepared = false;
      const words: string[] = [];
      const carryOut = async (step: AssistantStep) => {
        if (step.kind === 'say') words.push(step.text);
        else if (step.kind === 'open') go(ROUTES[step.screen]);
        else if (step.kind === 'send') {
          go({
            pathname: '/send',
            params: {
              contactId: step.contactId,
              ...(step.amountMinor !== undefined ? { amount: String(step.amountMinor) } : {}),
              ...(step.note ? { note: step.note } : {}),
              // Said aloud: the review opens on its own, and the person answers it with their voice.
              ...(options.byVoice && step.amountMinor !== undefined ? { voice: '1' } : {}),
            },
          });
        } else if (step.kind === 'propose') {
          backend.proposals.put(step.proposal);
          await store.refresh().catch(() => undefined);
          go('/assistant-action');
        } else if (step.kind === 'request') {
          go({
            pathname: '/receive',
            params: step.amountMinor !== undefined ? { amount: String(step.amountMinor) } : {},
          });
        } else if (step.kind === 'savings') {
          go({
            pathname: '/grow/savings',
            params: {
              mode: step.mode,
              ...(step.amountMinor !== undefined ? { amount: String(step.amountMinor) } : {}),
            },
          });
        } else if (step.kind === 'bill') {
          go(
            step.category
              ? {
                  pathname: '/bill/[category]',
                  params: {
                    category: step.category,
                    ...(step.amountMinor !== undefined ? { amount: String(step.amountMinor) } : {}),
                  },
                }
              : '/bill',
          );
        } else if (step.kind === 'swap') {
          // Money's Change currency sheet, filled in: it quotes first, and the person confirms.
          go({
            pathname: '/(tabs)/money',
            params: {
              change: '1',
              from: step.from,
              to: step.to,
              ...(step.amountCents !== undefined ? { amount: String(step.amountCents) } : {}),
              at: String(Date.now()),
            },
          });
        } else if (step.kind === 'add-to-pocket') {
          go({ pathname: '/(tabs)/money', params: { add: step.pocket ?? '1', at: String(Date.now()) } });
        } else if (step.kind === 'remember') {
          await backend.memory.write(step.entries);
        } else if (step.kind === 'offer') {
          pendingOffer = { step: step.step, nudgeId: step.nudgeId };
        } else {
          await store.setPaused(step.paused);
          words.push(step.paused ? 'The assistant is paused.' : 'The assistant is back on.');
        }
        if (step.kind !== 'say' && step.kind !== 'pause' && step.kind !== 'remember' && step.kind !== 'offer') moved = true;
        // A payment named without an amount is not ready yet: the conversation goes on to ask how much.
        if (step.kind === 'send') prepared = !options.byVoice || step.amountMinor !== undefined;
        else if (step.kind === 'propose' || step.kind === 'savings' || step.kind === 'bill' || step.kind === 'swap') prepared = true;
      };
      for (const step of steps) await carryOut(step);
      // Taken somewhere: whatever was offered is no longer what is in front of them.
      if (moved && !steps.some((step) => step.kind === 'offer')) pendingOffer = null;

      return { said: words.join(' '), moved, prepared };
    },
    [account, backend, enabled, pathname, router, store],
  );
}
