'use client';

import { ChevronDown, MessageCircleQuestion, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { HELP_ARTICLES, HELP_CATEGORIES, rankArticles, type HelpArticle } from '@entole/core/help';

import { FeedbackDialog } from '@/components/FeedbackDialog';
import { Header } from '@/components/Header';
import { HelpBotDialog } from '@/components/HelpBotDialog';
import { SectionHeading } from '@/components/SectionHeading';
import { useProfile } from '@/lib/profile';

/**
 * The help center: the questions people ask, each with its answer opening
 * underneath, and a help button floating at the bottom right that opens the
 * support bot. The list and the bot read the same articles
 * (`packages/core/help.ts`), so they can never disagree. The web twin of the
 * phone's help center.
 */
export default function HelpPage() {
  const profile = useProfile();
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [botOpen, setBotOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const cards = useRef<Record<string, HTMLElement | null>>({});

  const found = useMemo(() => {
    const text = query.trim();
    return text.length >= 2 ? new Set(rankArticles(text, 12).map((entry) => entry.article.id)) : null;
  }, [query]);

  const groups = HELP_CATEGORIES.map((category) => ({
    ...category,
    articles: HELP_ARTICLES.filter((article) => article.category === category.id && (found === null || found.has(article.id))),
  })).filter((group) => group.articles.length > 0);

  /** An article the bot pointed to: closes the bot, opens the answer and scrolls to it. */
  function show(id: string) {
    setBotOpen(false);
    setQuery('');
    setOpen(id);
    setTimeout(() => cards.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Help center" back="/me" />

      <div className="flex-1 px-gutter pb-40">
        <p className="font-body text-ui text-slate">
          Quick answers to what people ask most. Can’t find yours? Tap the help button and ask.
        </p>

        <label className="mt-4 flex h-12 items-center gap-3 rounded-control border-[1.5px] border-line bg-card px-4 focus-within:border-ink">
          <Search size={18} strokeWidth={1.75} className="text-slate" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the help"
            aria-label="Search the help"
            className="min-w-0 flex-1 bg-transparent font-body text-ui text-ink outline-none placeholder:text-mist"
          />
        </label>

        {groups.length === 0 ? (
          <div className="mt-8">
            <p className="font-display text-subhead text-ink">Nothing matches that</p>
            <p className="mt-1.5 font-body text-ui text-slate">Try other words, or tap the help button and ask in your own.</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.id}>
              <SectionHeading title={group.title} />
              <div className="flex flex-col gap-2">
                {group.articles.map((article) => (
                  <Question
                    key={article.id}
                    article={article}
                    expanded={open === article.id}
                    onToggle={() => setOpen((current) => (current === article.id ? null : article.id))}
                    register={(node) => {
                      cards.current[article.id] = node;
                    }}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        <div className="mt-10 rounded-card border border-line bg-card p-5">
          <p className="font-display text-subhead text-ink">Still stuck?</p>
          <p className="mt-1.5 font-body text-ui text-slate">
            Ask the support bot, or tell us what happened and a person will read it.
          </p>
          <div className="mt-4 flex gap-2.5">
            <button
              type="button"
              onClick={() => setBotOpen(true)}
              className="flex h-[53px] flex-1 items-center justify-center rounded-control bg-ink font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
            >
              Ask the bot
            </button>
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="flex h-[53px] flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-ui text-ink transition-colors hover:border-mist active:translate-y-px"
            >
              Send feedback
            </button>
          </div>
        </div>
      </div>

      {botOpen || feedbackOpen ? null : (
        <button
          type="button"
          aria-label="Ask for help"
          onClick={() => setBotOpen(true)}
          className="fixed bottom-[max(96px,calc(env(safe-area-inset-bottom)+84px))] right-5 z-20 flex h-14 w-14 items-center justify-center rounded-pill bg-ink text-paper shadow-floating transition-transform hover:scale-105 active:scale-95 lg:right-[max(20px,calc(50%-280px+20px))]"
        >
          <MessageCircleQuestion size={26} strokeWidth={1.75} />
        </button>
      )}

      {botOpen ? (
        <HelpBotDialog
          onDismiss={() => setBotOpen(false)}
          onOpenArticle={show}
          onFeedback={() => {
            setBotOpen(false);
            setFeedbackOpen(true);
          }}
        />
      ) : null}
      {feedbackOpen ? (
        <FeedbackDialog
          person={profile ? { username: profile.username, name: profile.fullName } : null}
          onDismiss={() => setFeedbackOpen(false)}
        />
      ) : null}
    </main>
  );
}

/** One question: a card that opens to its answer. */
function Question({
  article,
  expanded,
  onToggle,
  register,
}: {
  article: HelpArticle;
  expanded: boolean;
  onToggle: () => void;
  register: (node: HTMLElement | null) => void;
}) {
  const id = `answer-${article.id}`;
  return (
    <article ref={register} className="overflow-hidden rounded-control border border-line bg-card">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-press"
        >
          <span className="min-w-0 flex-1 font-strong text-ui text-ink">{article.question}</span>
          <ChevronDown
            size={18}
            strokeWidth={1.75}
            aria-hidden
            className={`flex-none text-mist transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </h3>
      {expanded ? (
        <div id={id} className="landing-rise border-t border-hairline px-4 pb-4 pt-3">
          <p className="text-pretty font-body text-ui text-slate">{article.answer}</p>
        </div>
      ) : null}
    </article>
  );
}
