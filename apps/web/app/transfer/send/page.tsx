'use client';

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
import { settledAt, timeWithSeconds } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { cents, formatDollars, formatNaira, kobo } from '@entole/core/money';
import { isOneOffId, oneOffId } from '@entole/core/one-off';
import { initialsFor } from '@entole/core/profile';
import type { Contact } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/Amount';
import { Avatar } from '@/components/Avatar';
import { ConfirmSendSheet } from '@/components/ConfirmSendSheet';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { RowSkeleton, Skeleton } from '@/components/Skeleton';
import { nairaAmountOf } from '@/lib/checkout';
import { checkSendAmount, rateLine } from '@/lib/send';

const BAD_CODE = "That code doesn't look right — check it and try again.";

/** Who the recipient is, as a screen names them. A person you saved, or — for a
 * one-off — the name on the link they gave you, else the end of their code. */
type Recipient = { id: string; name: string; caption?: string; initials: string; tone: 1 | 2 | 3 };

function recipientFor(contact: Contact | undefined, link: Checkout | null): Recipient | null {
  if (!contact) return null;
  const linkName = link?.payee;
  return {
    id: contact.id,
    name: linkName ?? contact.name,
    ...(linkName ? { caption: contact.name } : contact.place ? { caption: contact.place } : {}),
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
  const id = checkout ? oneOffId(checkout.code) : null;
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
        <p className="pb-1 pt-[10px] font-strong text-body-lg text-ink">Who are you paying?</p>
        <p className="text-pretty font-body text-label-sm text-slate">
          Paste their payment code or payment link. You don&apos;t need to save them first.
        </p>

        <label htmlFor="recipient" className="mt-5 block font-strong text-caption text-slate">
          Payment code or link
        </label>
        <div
          className={`mt-2 flex items-center rounded-control border-[1.5px] bg-card px-4 focus-within:border-indigo ${
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
            className="h-14 min-w-0 flex-1 bg-transparent font-strong text-body text-ink outline-none placeholder:font-body placeholder:text-mist"
          />
          <button
            type="button"
            onClick={() => void paste()}
            className="ml-3 flex-none font-strong text-label text-indigo hover:text-indigo-deep"
          >
            Paste
          </button>
        </div>
        {error || pasteNote ? (
          <p className="mt-2 font-body text-caption text-halt">{error ?? pasteNote}</p>
        ) : (
          <p className="mt-2 font-body text-caption text-slate">
            {read
              ? `That checks out.${read.checkout.payee ? ` You are paying ${read.checkout.payee}.` : ''}`
              : 'Dashes and capitals do not matter.'}
          </p>
        )}

        <p className="pb-3 pt-8 font-heavy text-body-sm text-ink">Or choose someone you saved</p>
        {store.status === 'loading' ? (
          <div className="flex flex-col gap-2">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : store.status === 'failed' ? (
          <div>
            <p className="font-body text-label-sm text-slate">We couldn&apos;t load your saved beneficiaries.</p>
            <button
              type="button"
              onClick={() => void store.refresh().catch(() => undefined)}
              className="mt-2 font-strong text-label-sm text-indigo hover:text-indigo-deep"
            >
              Try again
            </button>
          </div>
        ) : store.contacts.length === 0 ? (
          <p className="text-pretty font-body text-label-sm text-slate">
            No one saved yet. Pay a code above and you can save them from the receipt.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {store.contacts.map((contact) => (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => onPick({ id: contact.id, link: null })}
                  className="flex w-full items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 text-left transition-colors hover:border-mist"
                >
                  <Avatar initials={contact.initials} tone={contact.tone} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-strong text-body text-ink">{contact.name}</p>
                    {contact.place ? <p className="font-body text-caption text-slate">{contact.place}</p> : null}
                  </div>
                  <span className="font-strong text-caption-sm text-indigo">Send</span>
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
          className="flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px disabled:opacity-60"
        >
          Continue
        </button>
      </div>
    </>
  );
}

function ReceiptLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-2">
      <dt className="font-body text-label text-slate">{label}</dt>
      <dd className="tabular font-strong text-label text-ink">{value}</dd>
    </div>
  );
}

/** A payment is pending until it settles, and then it is this. */
function ReceiptStep({ receiptId, link }: { receiptId: string; link: Checkout | null }) {
  const router = useRouter();
  const store = useStore();
  const receipt = store.receipt(receiptId);
  const recipient = receipt ? recipientFor(store.contact(receipt.contactId), link) : null;

  if (!receipt) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-gutter-lg pb-28 text-center">
        <p className="font-body text-body-sm text-slate">
          That receipt is no longer open. Your activity has every payment that has settled.
        </p>
        <button
          type="button"
          onClick={() => router.push('/transfer')}
          className="mt-6 flex h-14 items-center justify-center rounded-control border border-line bg-card px-8 font-strong text-body-lg text-ink"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col px-gutter pb-28 pt-2">
      <div className="flex flex-col items-center pb-6 pt-3.5 text-center">
        <span
          aria-hidden
          className="flex h-[52px] w-[52px] items-center justify-center rounded-pill bg-settled font-strong text-amount text-card"
        >
          ✓
        </span>
        <h2 className="mt-4 font-strong text-title text-ink">Money delivered</h2>
        <p className="tabular mt-1.5 font-body text-label text-slate">{settledAt(receipt.settledAt)}</p>
      </div>

      <div className="rounded-tile border border-line bg-card px-[18px] py-5">
        <div className="flex items-center gap-3 border-b border-hairline pb-[18px]">
          <Avatar initials={recipient?.initials ?? '?'} tone={recipient?.tone ?? 1} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-strong text-body-lg text-ink">{recipient?.name ?? 'Recipient'}</p>
            {recipient?.caption ? <p className="font-body text-caption text-slate">{recipient.caption}</p> : null}
          </div>
          <span className="rounded-chip bg-settled-wash px-2.5 py-1 font-heavy text-caption-sm text-settled">
            Final
          </span>
        </div>

        <dl className="pt-2">
          <ReceiptLine label="Amount sent" value={formatNaira(kobo(receipt.amountMinor))} />
          <ReceiptLine label="Fee" value={formatNaira(kobo(receipt.feeMinor))} />
          <ReceiptLine label="Total from you" value={formatNaira(kobo(receipt.amountMinor + receipt.feeMinor))} />
          <ReceiptLine
            label="Rate"
            value={rateLine({ koboPerDollar: receipt.koboPerDollar, quotedAt: receipt.settledAt })}
          />
          <ReceiptLine label="Sent at" value={timeWithSeconds(receipt.sentAt)} />
          <ReceiptLine
            label="Delivered in"
            value={`${receipt.deliveredInSeconds} ${receipt.deliveredInSeconds === 1 ? 'second' : 'seconds'}`}
          />
        </dl>

        <div className="mt-1.5 flex items-baseline justify-between border-t border-hairline pt-4">
          <p className="font-heavy text-body-sm text-ink">Amount received</p>
          <p className="tabular font-strong text-amount-xs text-settled">
            {formatDollars(cents(receipt.receivedMinor))}
          </p>
        </div>
      </div>

      <p className="tabular mt-4 text-center font-body text-label-sm text-mist">
        Reference {receipt.reference} · nothing is pending
      </p>

      <div className="mt-6 flex flex-col gap-2.5">
        {isOneOffId(receipt.contactId) ? (
          <p className="text-pretty text-center font-body text-label-sm text-slate">
            Paid with a code. Add them as a beneficiary from the phone app to save them for next time.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => router.push('/transfer')}
          className="flex h-14 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep"
        >
          Done
        </button>
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
    <div className="flex flex-1 flex-col items-center px-gutter-lg pt-3">
      <div className="flex flex-1 flex-col items-center">
        {recipient ? (
          <>
            <Avatar initials={recipient.initials} tone={recipient.tone} />
            <p className="mt-3 max-w-full truncate font-strong text-headline text-ink">{recipient.name}</p>
            <div className="mt-1 flex items-center gap-1.5">
              {recipient.caption ? (
                <p className="font-body text-label-sm text-slate">{recipient.caption}</p>
              ) : null}
              <button
                type="button"
                onClick={onBack}
                className="font-strong text-label-sm text-indigo hover:text-indigo-deep"
              >
                Change
              </button>
            </div>
          </>
        ) : loading ? (
          <div className="flex flex-col items-center">
            <Skeleton className="h-10 w-10 rounded-pill" />
            <Skeleton className="mt-3 h-5 w-36" />
          </div>
        ) : (
          <div className="flex flex-col items-center pt-4">
            <p className="font-strong text-headline text-ink">Who are you paying?</p>
            <button
              type="button"
              onClick={onBack}
              className="mt-3 rounded-pill border border-line bg-card px-4 py-2.5 font-strong text-label text-indigo"
            >
              Choose a recipient
            </button>
          </div>
        )}

        <div className="mt-7">
          <Amount value={kobo(amount)} size="large" />
        </div>
        <p className="tabular mt-2.5 font-body text-body-sm text-slate">
          {amount > 0 && !loading
            ? `${firstName} receives ${formatDollars(toDollars(kobo(amount), store.rate))}`
            : 'Enter an amount'}
        </p>

        <div className="mt-3 min-h-[44px] text-center">
          {store.status === 'failed' ? (
            <>
              <p className="font-body text-label-sm text-halt">We couldn&apos;t load your account.</p>
              <button
                type="button"
                onClick={() => void store.refresh().catch(() => undefined)}
                className="mt-1 font-strong text-label-sm text-indigo hover:text-indigo-deep"
              >
                Try again
              </button>
            </>
          ) : !loading && check.ok === false && check.kind === 'no-balance' ? (
            <p className="font-body text-label-sm text-slate">{check.reason}</p>
          ) : reason ? (
            <p className="font-body text-label-sm text-caution">{reason}</p>
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
            className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px disabled:opacity-60"
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
    <Suspense fallback={null}>
      <SendFlow />
    </Suspense>
  );
}
