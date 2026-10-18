import { usePathname, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';

import {
  planReply,
  type AssistantFacts,
  type AssistantScreen,
  type AssistantStep,
} from '@entole/core/assistant-actions';
import { GRAMMAR_ONLY_HINT, NOT_UNDERSTOOD, type TurnHistory } from '@entole/core/assistant-brain';
import { useBackend } from '@entole/core/backend';
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
  business: '/(tabs)/business',
  invoice: '/business/new-invoice',
  people: '/beneficiaries',
  'new-allowance': '/rules/new',
  assistant: '/assistant',
  me: '/(tabs)/me',
};

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

export function useAssistantRunner(): (text: string, history: TurnHistory) => Promise<AssistantOutcome> {
  const router = useRouter();
  const pathname = usePathname();
  const store = useStore();
  const backend = useBackend();
  const { account } = useAccount();
  const { enabled } = useAssistant();

  return useCallback(
    async (spoken, history) => {
      const text = spoken.replace(/\s+/g, ' ').trim();
      if (!text || !account) return { said: '', moved: false, prepared: false };

      const heard = await backend.brain.read(text, { history });
      if (heard.kind !== 'reply') {
        return { said: heard.kind === 'grammar-only' ? GRAMMAR_ONLY_HINT : NOT_UNDERSTOOD, moved: false, prepared: false };
      }

      const facts: AssistantFacts = {
        balanceMinor: store.balance,
        activity: store.activity,
        allowances: store.allowances,
        savingsMinor: store.growPosition?.balanceMinor ?? null,
        username: account.username || null,
        contactName: (id) => store.contact(id)?.name,
      };
      const steps = await planReply(
        heard.reply,
        { contacts: store.contacts, allowances: store.allowances, canSpend: enabled, paused: store.paused },
        facts,
        {
          directory: backend.directory,
          resolveContactId: backend.source.resolveContactId,
          stay: MID_TASK.some((screen) => screen.test(pathname)),
        },
      );

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
        } else {
          await store.setPaused(step.paused);
          words.push(step.paused ? 'The assistant is paused.' : 'The assistant is back on.');
        }
        if (step.kind !== 'say' && step.kind !== 'pause') moved = true;
        if (step.kind === 'send' || step.kind === 'propose' || step.kind === 'savings' || step.kind === 'bill') prepared = true;
      };
      for (const step of steps) await carryOut(step);

      return { said: words.join(' '), moved, prepared };
    },
    [account, backend, enabled, pathname, router, store],
  );
}
