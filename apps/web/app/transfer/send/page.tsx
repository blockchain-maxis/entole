'use client';

import { ChevronRight } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  EMPTY_ENTRY,
  entryFromMinor,
  entryToMinor,
  pressKey,
  type AmountEntry,
} from '@entole/core/amount-entry';
import { useBackend } from '@entole/core/backend';
import type { Checkout } from '@entole/core/checkout-link';
import { timeWithSeconds } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { formatHandle } from '@entole/core/handle';
import { cents, formatDollars, formatNaira, kobo } from '@entole/core/money';
import { isOneOffId, oneOffId } from '@entole/core/one-off';
import { initialsFor } from '@entole/core/profile';
import { reportForReceipt } from '@entole/core/receipt-slip';
import { findRecipient, readRecipient, type Sought } from '@entole/core/recipient';
import type { Contact, Receipt } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { Figure } from '@/components/Amount';
import { Avatar } from '@/components/Avatar';
import { ConfirmSendSheet } from '@/components/ConfirmSendSheet';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { LogoLoader, PageLoader } from '@/components/LogoLoader';
import { ReceiptSlip, SlipFoot, SlipHead, SlipRow, SlipRows, SlipStatus } from '@/components/ReceiptSlip';
import { SaveRecipient } from '@/components/SaveRecipient';
import { ActivityRowSkeleton, Skeleton } from '@/components/Skeleton';
import { nairaAmountOf } from '@/lib/checkout';
import { checkSendAmount, rateLine } from '@/lib/send';
import {
  canSharePicture,
  prepareReceiptPicture,
  savePicture,
  sharePicture,
  shareReceiptLink,
} from '@/lib/share-receipt';

const NOT_SOMEONE = "That doesn't look like a username, a phone number or a pay link.";

/** Who the recipient is, as a screen names them. A person you saved, or — for a
 * one-off — the name the directory has for their username or number. */
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

type Read = { checkout: Checkout; id: string };

/** A person the send flow can carry: who they are, and the id their payment goes by. */
function readFor(checkout: Checkout | null): Read | null {
  const id = checkout ? oneOffId(checkout.code, checkout.payee) : null;
  return checkout && id ? { checkout, id } : null;
}

function PickStep({
  initialText,
  onPick,
}: {
  /** What a link that named nobody was asking for, so the field can say so. */
  initialText: string;
  onPick: (choice: { id: string; link: Checkout | null }) => void;
}) {
  const store = useStore();
  const [text, setText] = useState(initialText);
  const [touched, setTouched] = useState(Boolean(initialText));
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const backend = useBackend();
  // A username, a number or a pay link. The directory turns it into a person a
  // moment after typing stops.
  const sought = useMemo(() => readRecipient(text), [text]);
  const direct = useMemo(() => (sought?.kind === 'known' ? readFor(sought.checkout) : null), [sought]);
  const handle = sought?.kind === 'handle' ? sought.handle : null;
  const [found, setFound] = useState<{ text: string; who: Read | 'nobody' } | null>(null);

  useEffect(() => {
    if (sought?.kind !== 'handle') return;
    let live = true;
    const timer = setTimeout(() => {
      void findRecipient(backend.directory, sought)
        .catch(() => null)
        .then((checkout) => {
          if (live) setFound({ text, who: readFor(checkout) ?? 'nobody' });
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sought, text, backend]);

  const looked = handle && found?.text === text ? found.who : null;
  const read = direct ?? (looked && looked !== 'nobody' ? looked : null);
  const nobody = looked === 'nobody' && handle ? `Nobody on Entole has ${formatHandle(handle)} yet.` : null;
  const error = nobody ?? (text.trim() && !read && !handle && touched ? NOT_SOMEONE : null);

  async function paste() {
    setPasteNote(null);
    try {
      const pasted = (await navigator.clipboard.readText()).trim();
      if (!pasted) {
        setPasteNote('There is nothing to paste. Copy their username or link first.');
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
          Their username or phone number is enough. A link they shared works too.
        </p>

        <label htmlFor="recipient" className="mt-6 block font-strong text-note text-slate">
          Username, number or link
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
            placeholder="@username or 0803 123 4567"
            autoComplete="off"
            autoCapitalize="none"
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
              : handle
                ? `Looking for ${formatHandle(handle)}.`
                : 'Type who it is for, or paste the link they sent you.'}
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
            No one saved yet. Pay someone above and you can save them from the receipt.
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

const PICTURE_READY = 'The picture is ready. Press Share receipt again.';
const NOT_SHARED = "We couldn't share this receipt. Try again in a moment.";

/**
 * Sharing a receipt shares a picture of it. The picture is drawn by the server
 * from the payment it kept, so the first thing done is to make sure it has
 * kept this one; that starts as soon as the receipt is on screen, and a press
 * usually finds the picture waiting. A browser only opens its share panel
 * straight after a press, which is the other reason not to start then.
 */
function useReceiptShare(receipt: Receipt | undefined, note: string | undefined) {
  const backend = useBackend();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  // The picture once it is known: a file, or `null` when it could not be had.
  const known = useRef<File | null | undefined>(undefined);
  const getting = useRef<Promise<File | null> | null>(null);

  const prepare = useCallback((): Promise<File | null> => {
    if (!receipt) return Promise.resolve(null);
    if (!getting.current) {
      const report = reportForReceipt(receipt, note);
      const tell = async () => (report ? backend.payments.record(report) : false);
      getting.current = prepareReceiptPicture(receipt.reference, tell).then((picture) => {
        known.current = picture;
        // Not had this time: the next press may ask again.
        if (!picture) getting.current = null;
        return picture;
      });
    }
    return getting.current;
  }, [receipt, note, backend]);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  async function byLink(reference: string) {
    const outcome = await shareReceiptLink(reference);
    if (outcome === 'shared') setLine("We couldn't make the picture, so the link was shared. It opens this receipt.");
    else if (outcome === 'copied') setLine("We couldn't make the picture, so the link is copied. It opens this receipt.");
    else if (outcome === 'failed') setLine(NOT_SHARED);
  }

  async function share() {
    if (!receipt || busy) return;
    setLine(null);

    const waiting = known.current;
    if (waiting === null) {
      // Already known not to be there. The link goes now, while the press still counts; the picture is asked for again behind it.
      void prepare();
      await byLink(receipt.reference);
      return;
    }

    let picture = waiting ?? null;
    if (!waiting) {
      setBusy(true);
      picture = await prepare();
      setBusy(false);
    }
    if (!picture) {
      await byLink(receipt.reference);
      return;
    }

    if (canSharePicture(picture)) {
      const outcome = await sharePicture(picture);
      if (outcome === 'shared') {
        setLine('Shared as a picture.');
        return;
      }
      if (outcome === 'dismissed') return;
      // The browser would not open its share panel: the press was too long ago.
      if (!waiting) {
        setLine(PICTURE_READY);
        return;
      }
    }
    savePicture(picture);
    setLine('Saved as a picture. Look in your downloads.');
  }

  return { busy, line, share };
}

/**
 * A payment is pending until it is delivered, and then it is this: a slip.
 * The amount as the figure, to whom, and the facts of it as ruled rows, on the
 * one raised surface of the screen. It can be passed on as a picture, and the
 * person can be saved from it.
 */
function ReceiptStep({ receiptId, link }: { receiptId: string; link: Checkout | null }) {
  const router = useRouter();
  const store = useStore();
  const receipt = store.receipt(receiptId);
  const recipient = receipt ? recipientFor(store.contact(receipt.contactId), link) : null;
  // The same payment as it sits in activity: it has the note, and who made it.
  const entry = receipt ? store.activity.find((item) => item.id === receipt.id) : undefined;
  const { busy, line, share } = useReceiptShare(receipt, entry?.note);

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

  return (
    <div className="flex flex-1 flex-col px-gutter pb-28 pt-2">
      <ReceiptSlip>
        <SlipHead />
        <SlipStatus byAssistant={entry?.initiatedBy === 'assistant'}>
          Delivered at {timeWithSeconds(receipt.settledAt)}
        </SlipStatus>

        <div className="mt-3">
          <Figure value={kobo(receipt.amountMinor)} />
        </div>
        <p className="mt-1.5 text-pretty font-display text-subhead text-ink">to {who}</p>
        {recipient?.caption ? <p className="mt-0.5 font-body text-ui text-slate">{recipient.caption}</p> : null}

        <SlipRows>
          <SlipRow label="They received" value={formatDollars(cents(receipt.receivedMinor))} />
          <SlipRow label="Fee" value={formatNaira(kobo(receipt.feeMinor))} />
          <SlipRow label="Total from you" value={formatNaira(kobo(receipt.amountMinor + receipt.feeMinor))} />
          <SlipRow
            label="Rate"
            value={rateLine({ koboPerDollar: receipt.koboPerDollar, quotedAt: receipt.settledAt })}
          />
          <SlipRow label="Sent at" value={timeWithSeconds(receipt.sentAt)} />
          <SlipRow label="Delivered in" value={seconds} />
          <SlipRow label="Reference" value={receipt.reference} spaced />
        </SlipRows>
        <SlipFoot>Nothing is pending.</SlipFoot>
      </ReceiptSlip>

      <div className="mt-6 flex flex-col gap-2.5">
        {isOneOffId(receipt.contactId) ? <SaveRecipient recipientId={receipt.contactId} /> : null}
        <p role="status" className="min-h-[18px] text-center font-body text-note text-slate">
          {busy ? 'Getting the picture ready.' : line}
        </p>
        <div className="flex gap-2.5">
          <button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void share()}
            className="flex h-14 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-prose text-ink transition-colors hover:border-mist active:translate-y-px disabled:opacity-60"
          >
            {busy ? <LogoLoader size={22} mono label="Share receipt, in progress" /> : 'Share receipt'}
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
  askedMinor,
  askedNote,
  onBack,
  onSettled,
}: {
  recipientId: string;
  link: Checkout | null;
  /** An amount and a note already known when the page opened: the assistant filled them in. */
  askedMinor?: number | undefined;
  askedNote?: string | undefined;
  onBack: () => void;
  onSettled: (receiptId: string) => void;
}) {
  const store = useStore();
  const [entry, setEntry] = useState<AmountEntry>(() => {
    const asked = link ? nairaAmountOf(link) : askedMinor;
    return asked ? entryFromMinor(kobo(asked)) : EMPTY_ENTRY;
  });
  const defaultNote = noteFor(link) ?? askedNote;
  // An invoice link's reference travels in the payment, so the business sees it paid.
  const invoiceReference = link?.kind === 'invoice' ? link.reference : undefined;
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
          {...(defaultNote ? { defaultNote } : {})}
          {...(invoiceReference ? { invoiceReference } : {})}
          onDismiss={() => setReviewing(false)}
          onSettled={onSettled}
        />
      ) : null}
    </div>
  );
}

/** A pay link is being looked up: the page it leads to is not known yet. */
function OpeningStep() {
  return (
    <div aria-label="Finding who this is for" className="flex-1 px-gutter pt-2">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 flex-none rounded-pill" />
        <Skeleton className="h-5 w-36" />
      </div>
      <Skeleton className="mt-9 h-3 w-16" />
      <Skeleton className="mt-3 h-12 w-48" />
    </div>
  );
}

/**
 * Pay someone: by username, by number, with the link they shared, or a
 * beneficiary you saved. Everyone here is a person, never an address.
 * `?contact=` (a saved beneficiary, or someone the assistant has just found)
 * and `?to=` (a pay link, from its public page) jump straight to the amount. A
 * pay link names a username, so the directory is asked who that is first.
 * `?amount=` (kobo) and `?note=` fill those in beside `?contact=`: that is the
 * assistant getting a payment ready. It stops at the amount screen. Review and
 * Confirm are still pressed by the person.
 */
function SendFlow() {
  const params = useSearchParams();
  const backend = useBackend();

  const [start] = useState(() => {
    const to = params.get('to');
    const sought = to ? readRecipient(to) : null;
    const known = sought?.kind === 'known' ? readFor(sought.checkout) : null;
    if (known) return { id: known.id, link: known.checkout, sought: null };
    if (sought?.kind === 'handle') return { id: null, link: null, sought };
    return { id: params.get('contact'), link: null, sought: null };
  });
  const [asked] = useState(() => {
    const amount = params.get('amount');
    const minor = amount && /^\d{1,13}$/.test(amount) ? Number(amount) : undefined;
    const note = params.get('note')?.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined;
    return { minor: minor && Number.isSafeInteger(minor) && minor > 0 ? minor : undefined, note };
  });
  const [recipientId, setRecipientId] = useState<string | null>(start.id);
  const [link, setLink] = useState<Checkout | null>(start.link);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [opening, setOpening] = useState<Extract<Sought, { kind: 'handle' }> | null>(start.sought);
  const [unfound, setUnfound] = useState('');

  useEffect(() => {
    if (!opening) return;
    let live = true;
    void findRecipient(backend.directory, opening)
      .catch(() => null)
      .then((checkout) => {
        if (!live) return;
        const read = readFor(checkout);
        if (read) {
          setRecipientId(read.id);
          setLink(read.checkout);
        } else {
          // Nobody holds it: the field says so, with what the link asked for in it.
          setUnfound(formatHandle(opening.handle));
        }
        setOpening(null);
      });
    return () => {
      live = false;
    };
  }, [opening, backend]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Send money" back="/transfer" />

      {receiptId ? (
        <ReceiptStep receiptId={receiptId} link={link} />
      ) : opening ? (
        <OpeningStep />
      ) : recipientId ? (
        <AmountStep
          recipientId={recipientId}
          link={link}
          askedMinor={asked.minor}
          askedNote={asked.note}
          onBack={() => {
            setRecipientId(null);
            setLink(null);
          }}
          onSettled={setReceiptId}
        />
      ) : (
        <PickStep
          initialText={unfound}
          onPick={(choice) => {
            setRecipientId(choice.id);
            setLink(choice.link);
          }}
        />
      )}
    </main>
  );
}

/** A different person or amount in the address is a different payment: start it afresh. */
function SendFlowForAddress() {
  const params = useSearchParams();
  return <SendFlow key={params.toString()} />;
}

export default function SendPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <SendFlowForAddress />
    </Suspense>
  );
}
