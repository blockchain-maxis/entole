'use client';

import { ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { payBill, type PayBillResponse } from '@entole/core/bill-payment';
import { formatNaira, kobo } from '@entole/core/money';
import { BILL_CATEGORIES, type BillCategoryInfo } from '@entole/core/pay-hub';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/Amount';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { BILL_ICONS, billsSetup } from '@/lib/bills';

type Step = 'category' | 'reference' | 'amount' | 'done';

function UnavailableNote({ body }: { body: string }) {
  return (
    <div className="rounded-control border border-line bg-card px-4 py-3.5">
      <p className="font-strong text-body-sm text-caution">Bill payments aren&apos;t available yet</p>
      <p className="mt-1 font-body text-label-sm text-slate">{body}</p>
    </div>
  );
}

export default function PayBillPage() {
  const router = useRouter();
  const store = useStore();
  const setup = billsSetup();

  const [step, setStep] = useState<Step>('category');
  const [info, setInfo] = useState<BillCategoryInfo | null>(null);
  const [reference, setReference] = useState('');
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [paying, setPaying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PayBillResponse | null>(null);

  const trimmed = reference.trim();
  const amount = useMemo(() => entryToMinor(entry), [entry]);
  const enough = amount > 0 && amount <= store.balance;

  function chooseCategory(next: BillCategoryInfo) {
    setInfo(next);
    setReference('');
    setEntry(EMPTY_ENTRY);
    setProblem(null);
    setStep('reference');
  }

  async function submit() {
    if (!info || !setup || !enough || paying) return;
    const itemCode = setup.itemCodes[info.id];
    if (!itemCode) {
      setProblem("This biller isn't set up yet.");
      return;
    }
    setProblem(null);
    setPaying(true);
    try {
      // Resolves only once the aggregator answers — nothing shows as paid before then.
      const result = await payBill(
        {
          category: info.id,
          customerIdentifier: trimmed,
          itemCode,
          amountMinor: amount,
          reference: `bill-${Date.now()}`,
        },
        setup.config,
      );
      if (result.status === 'failed') {
        setProblem('That payment did not go through. Nothing left your balance.');
      } else {
        setOutcome(result);
        setStep('done');
      }
    } catch {
      setProblem('That payment did not go through. Nothing left your balance.');
    } finally {
      setPaying(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title={info && step !== 'category' ? info.label : 'Pay a bill'} back="/transfer" />

      {step === 'category' ? (
        <div className="flex-1 px-gutter pb-28">
          {setup ? null : (
            <div className="mb-5">
              <UnavailableNote body="You can look around. Paying switches on once bill payments are set up." />
            </div>
          )}
          <p className="pb-3 font-heavy text-body-sm text-ink">What are you paying?</p>
          <ul className="flex flex-col gap-2">
            {BILL_CATEGORIES.map((category) => {
              const Icon = BILL_ICONS[category.id];
              return (
                <li key={category.id}>
                  <button
                    type="button"
                    onClick={() => chooseCategory(category)}
                    className="flex w-full items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 text-left transition-colors hover:border-mist"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-indigo-wash text-indigo">
                      <Icon size={20} strokeWidth={1.5} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-strong text-body text-ink">{category.label}</span>
                      <span className="mt-0.5 block font-body text-caption text-slate">{category.hint}</span>
                    </span>
                    <ChevronRight size={16} strokeWidth={1.5} className="text-mist" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {step === 'reference' && info ? (
        <div className="flex flex-1 flex-col px-gutter-lg pt-4">
          <h1 className="font-strong text-title-xl text-ink">{info.identifierLabel}</h1>
          <p className="mt-3 font-body text-body-sm text-slate">
            We check it before any money moves, so you know whose bill it is.
          </p>
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder={info.identifierLabel}
            autoFocus
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) setStep('amount');
            }}
            className="mt-7 h-14 w-full rounded-control border-[1.5px] border-indigo bg-card px-4 font-strong text-body-lg text-ink outline-none"
          />
          <div className="mt-auto flex gap-2.5 pb-28 pt-6">
            <button
              type="button"
              onClick={() => setStep('category')}
              className="flex h-14 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-body-lg text-ink"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!trimmed}
              onClick={() => setStep('amount')}
              className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {step === 'amount' && info ? (
        <div className="flex flex-1 flex-col items-center px-gutter-lg pt-3">
          <div className="flex flex-1 flex-col items-center">
            {setup ? null : (
              <div className="mb-5 w-full">
                <UnavailableNote body="Nothing will be charged. Paying switches on once bill payments are set up." />
              </div>
            )}
            <p className="font-body text-label-sm text-slate">How much?</p>
            <div className="mt-4">
              <Amount value={amount} size="large" />
            </div>
            {problem ? <p className="mt-4 text-center font-body text-label-sm text-halt">{problem}</p> : null}
            {amount > 0 && !enough ? (
              <p className="mt-4 text-center font-body text-label-sm text-caution">
                That is more than your balance covers.
              </p>
            ) : null}
          </div>

          <div className="w-full pb-28">
            <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
            <div className="mt-3 flex gap-2.5">
              <button
                type="button"
                onClick={() => setStep('reference')}
                className="flex h-14 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-body-lg text-ink"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!setup || !enough || paying}
                onClick={() => void submit()}
                className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
              >
                {paying ? 'Paying' : amount > 0 ? `Pay ${formatNaira(amount)}` : 'Pay'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 'done' && info && outcome ? (
        <div className="flex flex-1 flex-col items-center justify-center px-gutter-lg pb-28 text-center">
          <span className="rounded-chip bg-settled-wash px-2.5 py-1 font-heavy text-caption-sm uppercase text-settled">
            {outcome.status === 'successful' ? 'Paid' : 'Submitted'}
          </span>
          <div className="mt-4">
            <Amount value={kobo(amount)} size="large" />
          </div>
          <p className="mt-2 font-body text-body-sm text-slate">for {info.label}</p>
          <p className="tabular mt-1 font-body text-caption text-mist">{outcome.reference}</p>
          <button
            type="button"
            onClick={() => router.push('/transfer')}
            className="mt-8 flex h-14 items-center justify-center rounded-control bg-ink px-8 font-strong text-body-lg text-paper"
          >
            Done
          </button>
        </div>
      ) : null}
    </main>
  );
}
