'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { EMPTY_ENTRY, entryDisplay, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { formatNaira, kobo } from '@entole/core/money';
import { affordCheck, type MoneyPicture } from '@entole/core/money-picture';
import { SPENDING_KIND_WORDS } from '@entole/core/statement';
import { TAX_BANDS_CONFIRMED } from '@entole/core/tax-ng';

import { FigureText } from './Amount';
import { GlassSheet } from './GlassSheet';
import { Keypad } from './Keypad';
import { SafeToSpendFigure } from './SafeToSpend';
import { THIN_WORDS, affordWords, dayWords, monthsWords, percentWords, suggestionRow } from '@/lib/plan-words';

/**
 * The money picture, read top to bottom as a friend would say it: what is safe
 * today, what comes in, what goes out, what repeats, what leaks, how long it
 * lasts, whether something fits, what tax to expect, and what to do next.
 * Every figure is the person's own. Where one cannot be worked out honestly
 * the section says why, and shows no number.
 */

const naira = (minor: number) => formatNaira(kobo(Math.max(0, Math.round(minor))));

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="scroll-mt-6">
      <h2 id={id ? `${id}-title` : undefined} className="pb-3 pt-10 font-display text-subhead text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Lead({ figure, caption }: { figure: string; caption: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="tabular font-display text-heading text-ink">{figure}</span>
      <span className="font-body text-ui text-slate">{caption}</span>
    </p>
  );
}

function Why({ children }: { children: React.ReactNode }) {
  return <p className="border-y border-hairline py-4 text-pretty font-body text-ui text-slate">{children}</p>;
}

function Row({ label, sub, value }: { label: string; sub?: string | undefined; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-hairline py-3">
      <span className="min-w-0">
        <span className="block truncate font-strong text-ui text-ink">{label}</span>
        {sub ? <span className="block font-body text-note text-slate">{sub}</span> : null}
      </span>
      <span className="tabular flex-none font-strong text-ui text-ink">{value}</span>
    </li>
  );
}

export function MoneyPictureView({ picture }: { picture: MoneyPicture }) {
  const [affording, setAffording] = useState(false);
  const safe = picture.safeToSpend;
  const leaks = picture.leaks;
  const kinds = picture.byKind.filter((kind) => kind.monthlyMinor > 0).slice(0, 6);

  return (
    <>
      <section aria-label="Safe to spend" className="mt-6 rounded-card bg-card p-5 shadow-raised">
        {safe ? (
          <>
            <SafeToSpendFigure picture={picture} safe={safe} />
            <dl className="mt-4 divide-y divide-hairline border-t border-hairline">
              {safe.committedMinor > 0 ? (
                <Fact label={`Due before then (${safe.dueBeforeIncome.length})`} value={naira(safe.committedMinor)} />
              ) : null}
              {safe.savingsSetAsideMinor > 0 ? <Fact label="Put aside for savings" value={naira(safe.savingsSetAsideMinor)} /> : null}
              {safe.taxSetAsideMinor > 0 ? <Fact label="Put aside for tax" value={naira(safe.taxSetAsideMinor)} /> : null}
            </dl>
          </>
        ) : (
          <>
            <p className="font-strong text-note text-slate">Safe to spend today</p>
            <p className="mt-2 text-pretty font-body text-ui text-ink">
              {picture.thin
                ? THIN_WORDS
                : 'This needs your balance. Read a statement that shows its closing balance.'}
            </p>
          </>
        )}
      </section>

      <Section title="Money in">
        {picture.income.monthlyMinor > 0 ? (
          <>
            <Lead figure={naira(picture.income.monthlyMinor)} caption="a month" />
            <p className="mt-1 font-body text-note text-slate">
              {picture.income.nextExpected
                ? `Next expected about ${dayWords(picture.income.nextExpected)}`
                : 'No regular payday found yet'}
            </p>
            {picture.income.sources.length ? (
              <ul className="mt-3 border-t border-hairline">
                {picture.income.sources.slice(0, 3).map((source) => (
                  <Row
                    key={source.name}
                    label={source.name}
                    sub={`${source.count} ${source.count === 1 ? 'payment' : 'payments'}${source.monthly ? ', monthly' : ''}`}
                    value={naira(source.totalMinor)}
                  />
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <Why>No money coming in was found in what has been read.</Why>
        )}
      </Section>

      <Section title="Money out">
        {picture.out.monthlyMinor > 0 ? (
          <>
            <Lead figure={naira(picture.out.monthlyMinor)} caption="a month" />
            <ul className="mt-3 border-t border-hairline">
              {kinds.map((kind) => (
                <Row
                  key={kind.kind}
                  label={SPENDING_KIND_WORDS[kind.kind]}
                  sub={`${percentWords(kind.shareBps)} of spending`}
                  value={`${naira(kind.monthlyMinor)} a month`}
                />
              ))}
            </ul>
          </>
        ) : (
          <Why>No spending was found in what has been read.</Why>
        )}
      </Section>

      <Section id="subscriptions" title="Subscriptions">
        {picture.subscriptions.count > 0 ? (
          <>
            <Lead figure={naira(picture.subscriptions.monthlyMinor)} caption={`a month, across ${picture.subscriptions.count}`} />
            <ul className="mt-3 border-t border-hairline">
              {picture.subscriptions.items.map((item) => (
                <Row key={item.key} label={item.name} sub={`Next about ${dayWords(item.nextDate)}`} value={naira(item.typicalMinor)} />
              ))}
            </ul>
          </>
        ) : (
          <Why>{picture.thin ? THIN_WORDS : 'No subscriptions found. A payment counts once it repeats each month.'}</Why>
        )}
      </Section>

      <Section id="leaks" title="Small leaks">
        {leaks.count > 0 ? (
          <>
            <p className="text-pretty font-body text-prose text-ink">
              {leaks.count} payments under {naira(leaks.thresholdMinor)} in the last {leaks.days} days came to{' '}
              <span className="tabular font-strong">{naira(leaks.totalMinor)}</span>
              {leaks.shareOfIncomeBps !== null ? `, ${percentWords(leaks.shareOfIncomeBps)} of a month's income.` : '.'}
            </p>
            {leaks.top.length ? (
              <ul className="mt-3 border-t border-hairline">
                {leaks.top.slice(0, 5).map((payee) => (
                  <Row
                    key={payee.name}
                    label={payee.name}
                    sub={`${payee.count} ${payee.count === 1 ? 'time' : 'times'}`}
                    value={naira(payee.totalMinor)}
                  />
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <Why>{picture.thin ? THIN_WORDS : 'No run of small payments stood out.'}</Why>
        )}
      </Section>

      <Section title="How long your money lasts">
        {picture.runwayMonths !== null ? (
          <>
            <Lead figure={monthsWords(picture.runwayMonths)} caption="" />
            <p className="mt-1 text-pretty font-body text-note text-slate">If nothing came in, at your usual spending.</p>
          </>
        ) : (
          <Why>
            {picture.balanceMinor === null
              ? 'This needs your balance. Read a statement that shows its closing balance.'
              : 'This needs a month of spending to measure against.'}
          </Why>
        )}
      </Section>

      <Section title="Can I afford it?">
        <p className="text-pretty font-body text-ui text-slate">Enter a price and see what it does to the rest of your month.</p>
        <button
          type="button"
          onClick={() => setAffording(true)}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-ui text-ink transition-colors hover:border-mist active:translate-y-px"
        >
          Check a price
        </button>
      </Section>

      <Section id="tax" title="Tax estimate">
        {picture.tax ? (
          <>
            <Lead figure={naira(picture.tax.monthlyTaxMinor)} caption="a month" />
            <ul className="mt-3 border-t border-hairline">
              <Row label="A year" value={naira(picture.tax.yearlyTaxMinor)} />
              <Row label="Of your income" value={percentWords(picture.tax.effectiveBps)} />
              <Row label="Income it is worked out from" value={`${naira(picture.tax.yearlyIncomeMinor)} a year`} />
            </ul>
            <p className="mt-2 text-pretty font-body text-note text-slate">
              Estimate under the 2026 rules, not a filing.
              {TAX_BANDS_CONFIRMED ? '' : ' The bands are still being checked against the Act.'}
            </p>
          </>
        ) : (
          <Why>No income was found to estimate from.</Why>
        )}
      </Section>

      {picture.suggestions.length ? (
        <Section title="What you could do">
          <ul className="border-t border-hairline">
            {picture.suggestions.map((suggestion) => {
              const row = suggestionRow(suggestion);
              return (
                <li key={suggestion.kind} className="border-b border-hairline">
                  <Link href={row.href} className="flex min-h-14 items-center gap-3 py-3.5 transition-colors hover:bg-press active:translate-y-px">
                    <span className="min-w-0 flex-1">
                      <span className="block font-strong text-ui text-ink">{row.title}</span>
                      <span className="block text-pretty font-body text-note text-slate">{row.detail}</span>
                    </span>
                    <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="flex-none text-mist" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {affording ? <AffordSheet picture={picture} onDismiss={() => setAffording(false)} /> : null}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="font-body text-note text-slate">{label}</dt>
      <dd className="tabular font-strong text-note text-ink">{value}</dd>
    </div>
  );
}

/** A price on the keypad, and what it would do: one sentence, from the person's own figures. */
function AffordSheet({ picture, onDismiss }: { picture: MoneyPicture; onDismiss: () => void }) {
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [asked, setAsked] = useState<number | null>(null);
  const amount = entryToMinor(entry);
  const check = asked !== null ? affordCheck(picture, asked) : null;
  const answer = check ? affordWords(check) : null;

  return (
    <GlassSheet label="Can I afford it?" onDismiss={onDismiss}>
      <h2 className="pt-5 font-display text-subhead text-ink">Can I afford it?</h2>
      <div className="mt-4 flex justify-center">
        <FigureText symbol="₦" digits={entryDisplay(entry)} steady />
      </div>

      <div aria-live="polite" className="min-h-[72px]">
        {asked === null ? (
          <p className="mt-2 text-center font-body text-ui text-slate">{amount > 0 ? 'Then check it' : 'Enter the price'}</p>
        ) : answer ? (
          <div className="mt-3 border-y border-hairline py-3">
            <p
              className={`font-strong text-prose ${
                check?.verdict === 'not-now' ? 'text-halt' : check?.verdict === 'tight' ? 'text-caution' : 'text-settled'
              }`}
            >
              {answer.headline}
            </p>
            <p className="mt-1 text-pretty font-body text-ui text-ink">{answer.detail}</p>
          </div>
        ) : (
          <p className="mt-3 text-pretty text-center font-body text-ui text-slate">
            {picture.thin ? THIN_WORDS : 'This needs your balance. Read a statement that shows its closing balance.'}
          </p>
        )}
      </div>

      <div className="mt-4">
        <Keypad
          onKey={(key) => {
            setEntry((current) => pressKey(current, key));
            setAsked(null);
          }}
        />
      </div>
      <button
        type="button"
        disabled={amount <= 0}
        onClick={() => setAsked(amount)}
        className="mt-4 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
      >
        Check {amount > 0 ? naira(amount) : 'it'}
      </button>
      <p className="mt-2 text-center font-body text-note text-slate">Nothing is spent. This only works it out.</p>
    </GlassSheet>
  );
}
