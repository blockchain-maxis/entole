'use client';

import { ChevronRight } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

import {
  EMPTY_ENTRY,
  entryFromMinor,
  entryToMinor,
  pressKey,
  type AmountEntry,
} from '@entole/core/amount-entry';
import { parseCheckout, type Checkout } from '@entole/core/checkout-link';
import { timeWithSeconds } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { cents, formatDollars, formatNaira, kobo } from '@entole/core/money';
import { isOneOffId, oneOffId } from '@entole/core/one-off';
import { initialsFor } from '@entole/core/profile';
import type { Contact } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { Figure } from '@/components/Amount';
import { Avatar } from '@/components/Avatar';
import { ConfirmSendSheet } from '@/components/ConfirmSendSheet';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { PageLoader } from '@/components/LogoLoader';
import { SaveRecipient } from '@/components/SaveRecipient';
import { ActivityRowSkeleton, Skeleton } from '@/components/Skeleton';
import { nairaAmountOf } from '@/lib/checkout';
import { checkSendAmount, rateLine } from '@/lib/send';

const BAD_CODE = "That code doesn't look right — check it and try again.";

/** Who the recipient is, as a screen names them. A person you saved, or — for a
 * one-off — the name on the link they gave you, else the end of their code. */
type Recipient = { id: string; name: string; caption?: string; initials: string; tone: 1 | 2 | 3 };

function recipientFor(contact: Contact | undefined, link: Checkout | null): Recipient | null {
  if (!contact) return null;
  const linkName = link?.payee;
  const named = Boolean(linkName && linkName !== contact.name);
  return {
    id: contact.id,
    name: linkName ?? contact.name,
    ...(named ? { caption: contact.name } : contact.place ? { caption: contact.place } : {}),
    initials: linkName ? initialsFor(linkName) : contact.initials,
    tone: contact.tone,
  };
}

/** A note an invoice link already implies. */
function noteFor(link: Checkout | null): string | undefined {
  if (link?.kind === 'invoice' && link.reference) return `Invoice ${link.reference}`;
  return undefined;
}

/** What a link or code names, read once — `null` if it isn't one. */
function readRecipient(text: string): { checkout: Checkout; id: string } | null {
  const checkout = text.trim() ? parseCheckout(text) : null;
  const id = checkout ? oneOffId(checkout.code, checkout.payee) : null;
  return checkout && id ? { checkout, id } : null;
}

function PickStep({
  onPick,
}: {
  onPick: (choice: { id: string; link: Checkout | null }) => void;
}) {
  const store = useStore();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const read = useMemo(() => readRecipient(text), [text]);
  const error = text.trim() && !read && touched ? BAD_CODE : null;

  async function paste() {
    setPasteNote(null);
    try {
      const pasted = (await navigator.clipboard.readText()).trim();
      if (!pasted) {
        setPasteNote('There is nothing to paste. Copy their payment code or link first.');
        return;
      }
      setText(pasted);
      setTouched(true);
    } catch {
      setPasteNote("We couldn't read what you copied. Paste it into the box instead.");
    }
  }

  return (
    <>
      <div className="flex-1 px-gutter pb-6">
        <h2 className="pt-2 font-display text-heading text-ink">Who are you paying?</h2>
        <p className="mt-2 text-pretty font-body text-ui text-slate">
          Paste their payment code or payment link. You don&apos;t need to save them first.
        </p>

        <label htmlFor="recipient" className="mt-6 block font-strong text-note text-slate">
          Payment code or link
        </label>
        <div
          className={`mt-2 flex items-center rounded-control border-[1.5px] bg-card px-4 focus-within:border-ink ${
            error ? 'border-halt' : 'border-line'
          }`}
        >
          <input
            id="recipient"
            value={text}
            onChange={(event) => {
              setText(event.target.value.replace(/\s*\n\s*/g, ' '));
              setPasteNote(null);
            }}
            onBlur={() => setTouched(true)}
            placeholder="PAY-XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent font-strong text-ui text-ink outline-none placeholder:font-body placeholder:text-mist"
          />
          <button
            type="button"
            onClick={() => void paste()}
            className="ml-3 flex-none font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
          >
            Paste
          </button>
        </div>
        {error || pasteNote ? (
          <p role="alert" className="mt-2 font-body text-note text-halt">
            {error ?? pasteNote}
          </p>
        ) : (
          <p className="mt-2 font-body text-note text-slate">
            {read
              ? `That checks out.${read.checkout.payee ? ` You are paying ${read.checkout.payee}.` : ''}`
              : 'Dashes and capitals do not matter.'}
          </p>
        )}

        <h3 className="pb-1 pt-9 font-display text-subhead text-ink">Or a beneficiary</h3>
        {store.status === 'loading' ? (
          <div>
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
          </div>
        ) : store.status === 'failed' ? (
          <div className="pt-2">
            <p className="font-body text-ui text-slate">We couldn&apos;t load your beneficiaries.</p>
            <button
              type="button"
              onClick={() => void store.refresh().catch(() => undefined)}
              className="mt-2 font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
            >
              Try again
            </button>
          </div>
        ) : store.contacts.length === 0 ? (
          <p className="text-pretty pt-2 font-body text-ui text-slate">
            No one saved yet. Pay a code above and you can save them from the receipt.
          </p>
        ) : (
          <ul>
            {store.contacts.map((contact, index) => (
              <li key={contact.id} className={index > 0 ? 'border-t border-hairline' : ''}>
                <button
                  type="button"
                  onClick={() => onPick({ id: contact.id, link: null })}
                  className="-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-3 rounded-control px-3 py-3 text-left transition-colors hover:bg-press active:translate-y-px"
                >
                  <Avatar initials={contact.initials} tone={contact.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-strong text-ui text-ink">{contact.name}</span>
                    {contact.place ? (
                      <span className="block truncate font-body text-note text-slate">{contact.place}</span>
                    ) : null}
                  </span>
                  <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="flex-none text-mist" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-gutter pb-28">
        <button
          type="button"
          disabled={!read}
          onClick={() => read && onPick({ id: read.id, link: read.checkout })}
          className="flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
        >
          Continue
        </button>
      </div>
    </>
  );
}

function ReceiptLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-3">
      <dt className="font-body text-ui text-slate">{label}</dt>
      <dd className="tabular text-right font-strong text-ui text-ink">{value}</dd>
    </div>
  );
}

/**
 * A payment is pending until it is delivered, and then it is this: what was
 * sent, as the figure, to whom, and the facts of it as ruled lines. It can be
 * passed on as words, and the person can be saved from it.
 */
function ReceiptStep({ receiptId, link }: { receiptId: string; link: Checkout | null }) {
  const router = useRouter();
  const store = useStore();
  const receipt = store.receipt(receiptId);
  const recipient = receipt ? recipientFor(store.contact(receipt.contactId), link) : null;
  const [shared, setShared] = useState<string | null>(null);

  if (!receipt) {
    return (
      <div className="flex flex-1 flex-col px-gutter pb-28 pt-2">
        <h2 className="font-display text-heading text-ink">That receipt is no longer open</h2>
        <p className="mt-2 text-pretty font-body text-prose text-slate">
          Your activity has every payment that has been delivered.
        </p>
        <button
          type="button"
          onClick={() => router.push('/transfer')}
          className="mt-auto flex h-14 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-prose text-ink transition-colors hover:border-mist active:translate-y-px"
        >
          Done
        </button>
      </div>
    );
  }

  const who = recipient?.name ?? 'someone';
  const seconds = `${receipt.deliveredInSeconds} ${receipt.deliveredInSeconds === 1 ? 'second' : 'seconds'}`;

  async function share() {
    if (!receipt) return;
    const words = `Sent ${formatNaira(kobo(receipt.amountMinor))} to ${who} with Entole. Delivered in ${seconds}. Reference ${receipt.reference}.`;
    try {
      if (navigator.share) {
        await navigator.share({ text: words });
        return;
      }
      await navigator.clipboard.writeText(words);
      setShared('Copied. Paste it wherever you like.');
    } catch {
      // Closing the share panel is not a failure, and nothing here was lost.
    }
  }

  return (
    <div className="flex flex-1 flex-col px-gutter pb-28 pt-2">
      <p className="inline-flex items-center gap-1.5 self-start rounded-pill bg-settled-wash px-2.5 py-1 font-strong text-note text-settled">
        <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-settled" />
        Delivered at {timeWithSeconds(receipt.settledAt)}
      </p>

      <div className="mt-4">
        <Figure value={kobo(receipt.amountMinor)} />
      </div>
      <h2 className="mt-2 text-pretty font-display text-subhead text-ink">to {who}</h2>
      {recipient?.caption ? <p className="mt-0.5 font-body text-ui text-slate">{recipient.caption}</p> : null}

      <dl className="mt-6 border-t border-hairline">
        <ReceiptLine label="They received" value={formatDollars(cents(receipt.receivedMinor))} />
        <ReceiptLine label="Fee" value={formatNaira(kobo(receipt.feeMinor))} />
        <ReceiptLine label="Total from you" value={formatNaira(kobo(receipt.amountMinor + receipt.feeMinor))} />
        <ReceiptLine
          label="Rate"
          value={rateLine({ koboPerDollar: receipt.koboPerDollar, quotedAt: receipt.settledAt })}
        />
        <ReceiptLine label="Sent at" value={timeWithSeconds(receipt.sentAt)} />
        <ReceiptLine label="Delivered in" value={seconds} />
      </dl>

      <p className="tabular mt-3 font-body text-note text-slate">
        Reference {receipt.reference} · nothing is pending
      </p>

      <div className="mt-7 flex flex-col gap-2.5">
        {isOneOffId(receipt.contactId) ? <SaveRecipient recipientId={receipt.contactId} /> : null}
        {shared ? (
          <p role="status" className="text-center font-body text-note text-slate">
            {shared}
          </p>
        ) : null}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => void share()}
            className="flex h-14 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-prose text-ink transition-colors hover:border-mist active:translate-y-px"
          >
            Share receipt
          </button>
          <button
            type="button"
            onClick={() => router.push('/transfer')}
            className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Amount entry. No fee is shown here: the fee is only real once it is quoted,
 * so it appears on the review panel after Review is pressed, next to what the
 * person will actually be charged.
 */
function AmountStep({
  recipientId,
  link,
  onBack,
  onSettled,
}: {
  recipientId: string;
  link: Checkout | null;
  onBack: () => void;
  onSettled: (receiptId: string) => void;
}) {
  const store = useStore();
  const [entry, setEntry] = useState<AmountEntry>(() => {
    const asked = link ? nairaAmountOf(link) : undefined;
    return asked ? entryFromMinor(kobo(asked)) : EMPTY_ENTRY;
  });
  const [reviewing, setReviewing] = useState(false);

  const loading = store.status === 'loading';
  const recipient = recipientFor(store.contact(recipientId), link);
  const amount = useMemo(() => entryToMinor(entry), [entry]);
  const firstName = recipient?.name.split(' ')[0] ?? 'They';

  const check = checkSendAmount({ amount, balance: store.balance, rate: store.rate });
  const reason = check.ok || check.kind === 'empty' ? null : check.reason;
  const canReview = store.status === 'ready' && Boolean(recipient) && check.ok;

  return (
    <div className="flex flex-1 flex-col px-gutter pt-2">
      <div className="flex flex-1 flex-col">
        {recipient ? (
          <div className="flex items-center gap-3">
            <Avatar initials={recipient.initials} tone={recipient.tone} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-strong text-ui text-ink">{recipient.name}</p>
              {recipient.caption ? (
                <p className="truncate font-body text-note text-slate">{recipient.caption}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onBack}
              className="flex-none font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
            >
              Change
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 flex-none rounded-pill" />
            <Skeleton className="h-5 w-36" />
          </div>
        ) : (
          <div>
            <p className="font-display text-subhead text-ink">Who are you paying?</p>
            <button
              type="button"
              onClick={onBack}
              className="mt-2 font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
            >
              Choose who to pay
            </button>
          </div>
        )}

        <p className="mt-9 font-body text-note text-slate">Amount</p>
        <div className="mt-1.5">
          <Figure value={kobo(amount)} steady />
        </div>
        <p className="tabular mt-2 font-body text-ui text-slate">
          {amount > 0 && !loading
            ? `${firstName} receives ${formatDollars(toDollars(kobo(amount), store.rate))}`
            : 'Enter an amount'}
        </p>

        <div className="mt-3 min-h-[44px]">
          {store.status === 'failed' ? (
            <>
              <p className="font-body text-ui text-halt">We couldn&apos;t load your account.</p>
              <button
                type="button"
                onClick={() => void store.refresh().catch(() => undefined)}
                className="mt-1 font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
              >
                Try again
              </button>
            </>
          ) : !loading && check.ok === false && check.kind === 'no-balance' ? (
            <p className="text-pretty font-body text-ui text-slate">{check.reason}</p>
          ) : reason ? (
            <p className="text-pretty font-body text-ui text-caution">{reason}</p>
          ) : null}
        </div>
      </div>

      <div className="w-full pb-28">
        <Keypad onKey={(key) => setEntry((prev) => pressKey(prev, key))} />
        <div className="mt-3 flex">
          <button
            type="button"
            disabled={!canReview}
            onClick={() => setReviewing(true)}
            className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
          >
            Review
          </button>
        </div>
      </div>

      {reviewing && recipient ? (
        <ConfirmSendSheet
          contactId={recipient.id}
          name={recipient.name}
          {...(recipient.caption ? { caption: recipient.caption } : {})}
          initials={recipient.initials}
          amountMinor={amount}
          {...(noteFor(link) ? { defaultNote: noteFor(link)! } : {})}
          onDismiss={() => setReviewing(false)}
          onSettled={onSettled}
        />
      ) : null}
    </div>
  );
}

/**
 * Pay someone: a payment code or link, or a beneficiary you saved. Everyone
 * here is a person, never an address. `?contact=` (a saved beneficiary) and
 * `?to=` (a checkout link, from its public page) jump straight to the amount.
 */
function SendFlow() {
  const params = useSearchParams();

  const [start] = useState(() => {
    const to = params.get('to');
    const read = to ? readRecipient(to) : null;
    return read ? { id: read.id, link: read.checkout } : { id: params.get('contact'), link: null };
  });
  const [recipientId, setRecipientId] = useState<string | null>(start.id);
  const [link, setLink] = useState<Checkout | null>(start.link);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Send money" back="/transfer" />

      {receiptId ? (
        <ReceiptStep receiptId={receiptId} link={link} />
      ) : recipientId ? (
        <AmountStep
          recipientId={recipientId}
          link={link}
          onBack={() => {
            setRecipientId(null);
            setLink(null);
          }}
          onSettled={setReceiptId}
        />
      ) : (
        <PickStep
          onPick={(choice) => {
            setRecipientId(choice.id);
            setLink(choice.link);
          }}
        />
      )}
    </main>
  );
}

export default function SendPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <SendFlow />
    </Suspense>
  );
}
