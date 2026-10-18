'use client';

import { ArrowUp, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { HELP_QUESTION_MAX, helpArticle, type HelpHistory } from '@entole/core/help';

import { askHelp, rateHelp } from '@/lib/support';

import { GlassSheet } from './GlassSheet';
import { Skeleton } from './Skeleton';

type Turn =
  | { from: 'you'; text: string }
  | { from: 'bot'; text: string; id?: string; articles: string[]; covered: boolean; rated?: boolean };

const GREETING =
  'Hi, I’m here to help with Entole. Ask me about sending money, adding money, allowances or your account.';
const STARTERS = ['How do I add money?', 'What is an allowance?', 'Is my money safe?', 'I lost my phone'];
const UNREACHABLE = 'I couldn’t reach the help just now. Check your connection and ask again.';

/**
 * The support bot, in a glass sheet over the help center: the web twin of the
 * phone's `HelpBot`. It answers from the help articles and from nothing else,
 * so it can say it is not sure and point to a person instead of guessing. It
 * sees no account. Each answer can be marked helpful or not.
 */
export function HelpBotDialog({
  onDismiss,
  onOpenArticle,
  onFeedback,
}: {
  onDismiss: () => void;
  onOpenArticle: (id: string) => void;
  onFeedback: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([{ from: 'bot', text: GREETING, articles: [], covered: true }]);
  const [typed, setTyped] = useState('');
  const [thinking, setThinking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const live = useRef(true);

  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns, thinking]);

  async function ask(question: string) {
    const text = question.replace(/\s+/g, ' ').trim().slice(0, HELP_QUESTION_MAX);
    if (!text || thinking) return;
    setTyped('');
    const history: HelpHistory = turns
      .slice(1)
      .slice(-6)
      .map((turn) => ({ from: turn.from, text: turn.text }));
    setTurns((current) => [...current, { from: 'you', text }]);
    setThinking(true);
    const answer = await askHelp(text, history);
    if (!live.current) return;
    setThinking(false);
    setTurns((current) => [
      ...current,
      answer
        ? { from: 'bot', text: answer.answer, id: answer.id, articles: answer.articles, covered: answer.by !== 'none' }
        : { from: 'bot', text: UNREACHABLE, articles: [], covered: true, rated: true },
    ]);
  }

  function rate(index: number, helpful: boolean) {
    const turn = turns[index];
    if (!turn || turn.from !== 'bot' || !turn.id || turn.rated) return;
    void rateHelp(turn.id, helpful);
    setTurns((current) => current.map((entry, at) => (at === index && entry.from === 'bot' ? { ...entry, rated: true } : entry)));
  }

  return (
    <GlassSheet label="Ask for help" onDismiss={onDismiss}>
      <div className="pt-4">
        <p className="font-strong text-note text-slate">Support</p>
        <h2 className="mt-0.5 font-display text-heading text-ink">Ask for help</h2>

        <div className="mt-3 flex max-h-[44dvh] flex-col gap-3 overflow-y-auto pb-1" aria-live="polite">
          {turns.map((turn, index) =>
            turn.from === 'you' ? (
              <div key={index} className="flex justify-end">
                <p className="max-w-[85%] rounded-card rounded-br-[6px] bg-ink px-4 py-3 font-body text-ui text-paper">{turn.text}</p>
              </div>
            ) : (
              <div key={index} className="flex flex-col items-start">
                <div className="max-w-[92%] rounded-card rounded-bl-[6px] border border-line bg-card/80 px-4 py-3">
                  <p className="text-pretty font-body text-ui text-ink">{turn.text}</p>
                  {turn.articles.length > 0 ? (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {turn.articles.map((id) => {
                        const article = helpArticle(id);
                        return article ? (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onOpenArticle(id)}
                            className="max-w-[240px] truncate rounded-pill border border-line bg-paper px-3 py-1.5 font-strong text-note text-ink transition-colors hover:bg-press"
                          >
                            {article.question}
                          </button>
                        ) : null;
                      })}
                    </div>
                  ) : null}
                  {!turn.covered ? (
                    <button type="button" onClick={onFeedback} className="mt-2.5 font-strong text-note text-ink underline">
                      Send us a message
                    </button>
                  ) : null}
                </div>
                {turn.id ? (
                  <div className="mt-1.5 flex items-center gap-1 pl-1">
                    {turn.rated ? (
                      <span className="font-body text-note text-slate">Thanks, that helps us.</span>
                    ) : (
                      <>
                        <span className="mr-1 font-body text-note text-slate">Did that help?</span>
                        <button
                          type="button"
                          aria-label="Yes, that helped"
                          onClick={() => rate(index, true)}
                          className="flex h-8 w-8 items-center justify-center rounded-pill text-slate transition-colors hover:bg-press"
                        >
                          <ThumbsUp size={16} strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          aria-label="No, that did not help"
                          onClick={() => rate(index, false)}
                          className="flex h-8 w-8 items-center justify-center rounded-pill text-slate transition-colors hover:bg-press"
                        >
                          <ThumbsDown size={16} strokeWidth={1.75} />
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ),
          )}

          {thinking ? (
            <div role="status" aria-label="Looking that up" className="w-[70%] rounded-card rounded-bl-[6px] border border-line bg-card/80 px-4 py-3.5">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="mt-2 h-3.5 w-2/3" />
            </div>
          ) : null}

          {turns.length === 1 && !thinking ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => void ask(starter)}
                  className="rounded-pill border border-line bg-card/70 px-3.5 py-2 font-strong text-note text-ink transition-colors hover:bg-press"
                >
                  {starter}
                </button>
              ))}
            </div>
          ) : null}
          <div ref={end} />
        </div>

        <form
          className="mt-4 flex items-center rounded-control border-[1.5px] border-line bg-card/80 pl-4 pr-1.5 focus-within:border-ink"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(typed);
          }}
        >
          <label htmlFor="help-question" className="sr-only">
            Ask a question
          </label>
          <input
            id="help-question"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            maxLength={HELP_QUESTION_MAX}
            placeholder="Ask a question"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent font-body text-ui text-ink outline-none placeholder:text-mist"
          />
          <button
            type="submit"
            aria-label="Send your question"
            disabled={!typed.trim() || thinking}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-ink text-paper transition-opacity disabled:opacity-30"
          >
            <ArrowUp size={18} strokeWidth={2} />
          </button>
        </form>
        <p className="mt-3 font-body text-note text-slate">
          I answer from Entole’s help and can’t see your account. For anything else, send us a message.
        </p>
      </div>
    </GlassSheet>
  );
}
