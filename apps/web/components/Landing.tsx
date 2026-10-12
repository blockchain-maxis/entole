'use client';

import { Check, Clock, Fingerprint } from 'lucide-react';
import Link from 'next/link';

import { viewAllowance } from '@entole/core/allowance';
import { ASK_UNDO_SECONDS } from '@entole/core/assistant-ask';
import { formatNaira, kobo } from '@entole/core/money';
import type { Activity, Allowance, Contact } from '@entole/core/schemas';

import { ActivityRow } from './ActivityRow';
import { AllowanceCard } from './AllowanceCard';
import { Figure } from './Amount';
import { Avatar } from './Avatar';
import { AssistantBadge } from './Badge';
import { BrandGlyph } from './Header';

/**
 * The first page: what someone sees before they have an account, on a phone
 * or a desk. It says what Entole is, shows it, and has one way in. Everything
 * drawn as the product here is the product's own components, given an example
 * to show; none of it is anyone's money, and the page says so.
 */

// The example the previews draw. Times are worked out once, when the page
// loads, so nothing is read from the clock while drawing.
const LOADED_AT = Date.now();
const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(LOADED_AT - hours * HOUR).toISOString();
const firstOfNextMonth = (() => {
  const now = new Date(LOADED_AT);
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
})();

const MUM: Contact = { id: 'example-mum', name: 'Mum', initials: 'MU', tone: 1 };
const TUNDE: Contact = { id: 'example-tunde', name: 'Tunde Bakare', initials: 'TB', tone: 2 };

const EXAMPLE_ALLOWANCE: Allowance = {
  id: 'example-allowance',
  name: 'every month to Mum',
  recipientId: MUM.id,
  limitMinor: 10_000_000,
  spentMinor: 5_000_000,
  perRunMinor: 5_000_000,
  cadence: 'monthly',
  resetsAt: firstOfNextMonth,
  paused: false,
};

const EXAMPLE_ACTIVITY: Activity[] = [
  {
    id: 'example-1',
    contactId: MUM.id,
    note: 'Monthly',
    at: hoursAgo(2),
    amountMinor: 5_000_000,
    direction: 'out',
    initiatedBy: 'assistant',
    state: 'settled',
    allowanceId: EXAMPLE_ALLOWANCE.id,
  },
  {
    id: 'example-2',
    contactId: TUNDE.id,
    note: 'Rent share',
    at: hoursAgo(26),
    amountMinor: 1_800_000,
    direction: 'out',
    initiatedBy: 'you',
    state: 'settled',
  },
];

const CONTACTS = new Map([MUM, TUNDE].map((contact) => [contact.id, contact]));

const WORKS_TODAY = [
  'Open an account with a name and your fingerprint',
  'Add test money and send it in seconds',
  'Get paid with a link or a payment code',
  'Give the assistant an allowance and ask it to pay',
  'Stop the assistant from the top of any screen',
];

const NOT_YET = [
  'Real money. Everything runs on test money for now',
  'Buying shares. You can look at them, not buy',
  'Paying in from a Nigerian bank account',
];

const PRIMARY =
  'flex h-14 items-center justify-center rounded-control bg-ink px-8 font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60';

/**
 * The home screen, drawn with the product's own parts and an example to show.
 * It stands on a tinted stage and runs off its bottom edge, the way a phone
 * does when only the top of it is in the picture. On a wide screen one card
 * sits across the stage's edge, clear of the phone: the assistant's undo
 * window, the thing no other money app has.
 */
function ProductPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-[440px]">
      <div className="overflow-hidden rounded-sheet bg-press px-4 pt-8 min-[400px]:px-6 sm:px-12 sm:pt-10">
        <div
          aria-hidden
          inert
          className="mx-auto h-[540px] max-w-[340px] overflow-hidden rounded-t-sheet border-x border-t border-line bg-paper px-5 pt-5 shadow-floating max-[399px]:[zoom:0.75]"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar initials="AO" tone={3} />
              <span className="truncate font-strong text-ui text-ink">Adaeze Okafor</span>
            </div>
            <span className="flex h-9 flex-none items-center rounded-pill border border-line bg-card px-3 font-strong text-note text-slate">
              Assistant · On
            </span>
          </div>

          <p className="pt-5 font-body text-ui text-slate">Good evening</p>
          <div className="pt-1.5">
            <Figure value={kobo(12_840_000)} />
          </div>
          <p className="mt-2 font-body text-ui text-slate">Available</p>

          <div className="mt-6 flex gap-2.5 font-strong text-ui">
            <span className="flex h-12 flex-1 items-center justify-center rounded-control bg-ink text-paper">Send</span>
            <span className="flex h-12 flex-1 items-center justify-center rounded-control border border-line bg-card text-ink">
              Add money
            </span>
            <span className="flex h-12 flex-1 items-center justify-center rounded-control border border-line bg-card text-ink">
              Receive
            </span>
          </div>

          <h3 className="pb-2 pt-8 font-display text-subhead text-ink">Allowances</h3>
          <ul className="border-y border-hairline">
            <AllowanceCard
              allowance={viewAllowance(EXAMPLE_ALLOWANCE)}
              recipientName={MUM.name}
              resetsAt={EXAMPLE_ALLOWANCE.resetsAt}
              href="#"
            />
          </ul>

          <h3 className="pb-1 pt-8 font-display text-subhead text-ink">Activity</h3>
          <ul>
            {EXAMPLE_ACTIVITY.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} contact={CONTACTS.get(entry.contactId)} />
            ))}
          </ul>
        </div>
      </div>

      <div
        aria-hidden
        className="absolute -left-[188px] bottom-12 hidden w-[236px] rounded-card bg-card p-4 shadow-floating xl:block"
      >
        <AssistantBadge />
        <p className="tabular mt-2.5 font-strong text-ui text-ink">
          Sending {formatNaira(kobo(EXAMPLE_ALLOWANCE.perRunMinor))} to {MUM.name}
        </p>
        <p className="mt-0.5 font-body text-note text-slate">You have {ASK_UNDO_SECONDS} seconds to stop it.</p>
        <span className="mt-3 flex h-9 items-center justify-center rounded-control bg-ink font-strong text-note text-paper">
          Cancel this payment
        </span>
      </div>

      <figcaption className="pt-3 text-center font-body text-note text-slate">An example account</figcaption>
    </figure>
  );
}

export function Landing({
  busy,
  problem,
  onStart,
  onSignIn,
}: {
  busy: boolean;
  problem: string | null;
  onStart: () => void;
  onSignIn: () => void;
}) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex h-[68px] w-full max-w-[1180px] items-center justify-between gap-4 px-gutter lg:px-10">
        <div className="flex items-center gap-2.5">
          <BrandGlyph size={28} />
          <span className="font-display text-subhead text-ink">Entole</span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onSignIn}
          className="text-right font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink disabled:opacity-60 max-[359px]:text-note"
        >
          I already have an account
        </button>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-[1180px] grid-cols-1 items-center gap-12 px-gutter pb-16 pt-8 lg:min-h-[min(calc(100dvh-68px),780px)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-14 lg:px-10 lg:pb-16 lg:pt-2">
          <div className="landing-rise min-w-0">
            <h1 className="text-pretty font-display text-figure-sm text-ink sm:text-figure-md lg:text-figure xl:text-poster">
              <span className="lg:block lg:whitespace-nowrap">Money that moves </span>
              <span className="lg:block lg:whitespace-nowrap">like a message</span>
            </h1>
            <p className="mt-5 max-w-[42ch] text-pretty font-body text-prose text-slate lg:text-subhead lg:leading-[30px]">
              Send naira in seconds, and let an assistant pay for you inside limits it cannot pass.
            </p>
            <div className="mt-8 flex">
              <button type="button" disabled={busy} onClick={onStart} className={`${PRIMARY} w-full sm:w-auto`}>
                Get started
              </button>
            </div>
            {problem ? (
              <p role="alert" className="mt-4 max-w-[46ch] text-pretty font-body text-ui text-halt">
                {problem}
              </p>
            ) : null}
          </div>

          <div className="landing-rise min-w-0 [animation-delay:120ms]">
            <ProductPreview />
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1180px] px-gutter py-16 lg:px-10 lg:py-24">
          <h2 className="max-w-[20ch] text-pretty font-display text-heading text-ink lg:text-figure-md">
            What Entole does
          </h2>

          <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <article className="landing-reveal flex flex-col justify-between gap-10 rounded-card bg-card p-7 shadow-raised lg:col-span-7 lg:p-9">
              <div>
                <h3 className="font-display text-subhead text-ink">Sent, and delivered while you watch</h3>
                <p className="mt-2 max-w-[44ch] text-pretty font-body text-ui text-slate">
                  A payment shows as delivered only when it has been, and that takes seconds, not days.
                </p>
              </div>
              <div aria-hidden>
                <p className="inline-flex items-center gap-1.5 rounded-pill bg-settled-wash px-2.5 py-1 font-strong text-note text-settled">
                  <span className="h-1.5 w-1.5 rounded-pill bg-settled" />
                  Delivered
                </p>
                <div className="mt-3">
                  <Figure value={kobo(2_500_000)} />
                </div>
                <p className="mt-1 font-display text-subhead text-ink">to Tunde Bakare</p>
              </div>
            </article>

            <article className="landing-reveal flex flex-col justify-between gap-8 rounded-card bg-indigo-wash p-7 lg:col-span-5 lg:p-9">
              <div>
                <h3 className="font-display text-subhead text-ink">An assistant with a limit it cannot pass</h3>
                <p className="mt-2 text-pretty font-body text-ui text-slate">
                  Write it once: who, how much, how often, and the most it may ever come to.
                </p>
              </div>
              <ul aria-hidden inert>
                <AllowanceCard
                  allowance={viewAllowance(EXAMPLE_ALLOWANCE)}
                  recipientName={MUM.name}
                  resetsAt={EXAMPLE_ALLOWANCE.resetsAt}
                  href="#"
                />
              </ul>
            </article>

            <article className="landing-reveal flex flex-col justify-between gap-8 rounded-card bg-press p-7 lg:col-span-5 lg:p-9">
              <div>
                <h3 className="font-display text-subhead text-ink">One tap stops it</h3>
                <p className="mt-2 text-pretty font-body text-ui text-slate">
                  The assistant can be paused from the top of every screen. Your allowances stay as they are.
                </p>
              </div>
              <div aria-hidden className="flex flex-wrap items-center gap-2.5 font-strong text-note">
                <span className="flex h-9 items-center rounded-pill border border-line bg-card px-3 text-slate">
                  Assistant · On
                </span>
                <span className="text-slate">then</span>
                <span className="flex h-9 items-center rounded-pill border border-halt bg-halt-wash px-3 text-halt">
                  Assistant · Paused
                </span>
              </div>
            </article>

            <article className="landing-reveal flex flex-col justify-between gap-8 rounded-card bg-card p-7 shadow-raised lg:col-span-7 lg:flex-row lg:items-end lg:p-9">
              <div>
                <h3 className="font-display text-subhead text-ink">No password to lose</h3>
                <p className="mt-2 max-w-[44ch] text-pretty font-body text-ui text-slate">
                  Your account opens with your fingerprint, face or screen lock. There is nothing to remember and
                  nothing to write down.
                </p>
              </div>
              <span
                aria-hidden
                className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-pill bg-press text-ink"
              >
                <Fingerprint size={36} strokeWidth={1.5} />
              </span>
            </article>
          </div>
        </section>

        <section className="border-y border-hairline bg-card">
          <div className="landing-reveal mx-auto w-full max-w-[880px] px-gutter py-16 text-center lg:py-24">
            <p className="text-pretty font-display-plain text-heading text-indigo lg:text-figure-md">
              Send ₦50,000 to Mum every month, never more than ₦100,000 a month.
            </p>
            <p className="mx-auto mt-6 max-w-[54ch] text-pretty font-body text-prose text-slate">
              That sentence is the whole agreement. A payment inside it goes through. One past it is refused, whoever
              asks, because the limit is kept by the network and not by a promise.
            </p>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-12 px-gutter py-16 lg:grid-cols-2 lg:gap-16 lg:px-10 lg:py-24">
          <div className="landing-reveal">
            <h2 className="font-display text-heading text-ink">What works today</h2>
            <ul className="mt-6 space-y-3.5">
              {WORKS_TODAY.map((item) => (
                <li key={item} className="flex items-start gap-3 font-body text-prose text-ink">
                  <Check size={20} strokeWidth={1.75} aria-hidden className="mt-0.5 flex-none text-settled" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="landing-reveal">
            <h2 className="font-display text-heading text-ink">Not yet</h2>
            <ul className="mt-6 space-y-3.5">
              {NOT_YET.map((item) => (
                <li key={item} className="flex items-start gap-3 font-body text-prose text-slate">
                  <Clock size={20} strokeWidth={1.75} aria-hidden className="mt-0.5 flex-none text-slate" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1180px] px-gutter pb-20 lg:px-10 lg:pb-28">
          <div className="landing-reveal rounded-card bg-press px-7 py-10 lg:flex lg:items-center lg:justify-between lg:gap-10 lg:px-12 lg:py-14">
            <h2 className="max-w-[22ch] text-pretty font-display text-heading text-ink lg:text-figure-sm">
              An account takes a name and your fingerprint
            </h2>
            <button
              type="button"
              disabled={busy}
              onClick={onStart}
              className={`${PRIMARY} mt-7 w-full flex-none sm:w-auto lg:mt-0`}
            >
              Get started
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 px-gutter py-8 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <div className="flex items-center gap-2.5">
            <BrandGlyph size={22} />
            <span className="font-display text-ui text-ink">Entole</span>
          </div>
          <nav aria-label="Legal and contact" className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/legal/terms" className="font-body text-note text-slate underline decoration-mist underline-offset-4 transition-colors hover:text-ink hover:decoration-ink">
              Terms
            </Link>
            <Link href="/legal/privacy" className="font-body text-note text-slate underline decoration-mist underline-offset-4 transition-colors hover:text-ink hover:decoration-ink">
              Privacy
            </Link>
            <a href="mailto:support@entole.pro" className="font-body text-note text-slate underline decoration-mist underline-offset-4 transition-colors hover:text-ink hover:decoration-ink">
              support@entole.pro
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
