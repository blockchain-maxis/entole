'use client';

import { useState } from 'react';

import { QrCode } from './QrCode';

/**
 * A one-time code another app sends money to, drawn only as a scan code with a
 * copy button. Decided 10 October (Add money) and 12 November (the invoice pay
 * page): the code may be scanned or copied, and no character of it is ever
 * shown as text.
 */
export function ScanCode({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="w-full max-w-[240px]">
        <QrCode value={value} label={label} />
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-4 min-h-11 rounded-pill border border-line bg-card px-5 py-2.5 font-strong text-ui text-ink transition-colors hover:border-mist active:translate-y-px"
      >
        {copied ? 'Copied' : 'Copy code'}
      </button>
      <span role="status" className="sr-only">
        {copied ? 'Code copied' : ''}
      </span>
    </div>
  );
}
