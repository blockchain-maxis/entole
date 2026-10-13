import { useId, type ReactNode } from 'react';

import { watermarkToken } from '@entole/tokens';

import { FigureText } from './Amount';
import { AssistantBadge } from './Badge';
import { BrandGlyph } from './Header';

/**
 * The receipt as a slip: the one raised surface on the screen it is on. The
 * same slip is drawn on the receipt's public page, inside the app after a
 * payment is delivered, and as the picture that is shared
 * (`ReceiptPicture`, laid out to match this at three times the size).
 *
 * Top to bottom: the mark, that it was delivered, the amount as the figure,
 * then the facts as ruled rows. Behind all of it the name runs small and
 * many, as the paper's watermark.
 */

/**
 * The watermark. One small tile, repeated: the name, and under it the name
 * again half a step along, so every other row is offset; the whole pattern
 * leans. The numbers are the ones the picture and the phone use.
 */
function SlipWatermark() {
  const { word, angle, size, advance, row, opacity } = watermarkToken;
  const id = `slip-paper-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // The word sits on the middle of its row.
  const baseline = (line: number) => line * row + row / 2 + size * 0.24;
  // How faint the word is belongs to the word. Set on the whole drawing it
  // would count twice, once for the word and once for the sheet it is laid
  // on, and the paper came out blank.
  const set = { fontSize: size, textAnchor: 'middle' as const, fillOpacity: opacity, className: 'fill-ink font-display' };

  return (
    <svg
      aria-hidden
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
    >
      <defs>
        <pattern
          id={id}
          width={advance}
          height={row * 2}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${angle})`}
        >
          <text x={advance / 2} y={baseline(0)} {...set}>
            {word}
          </text>
          <text x={0} y={baseline(1)} {...set}>
            {word}
          </text>
          <text x={advance} y={baseline(1)} {...set}>
            {word}
          </text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

export function ReceiptSlip({ children }: { children: ReactNode }) {
  return (
    <article className="relative isolate overflow-hidden rounded-card border border-line bg-card shadow-raised">
      <SlipWatermark />
      <div className="relative px-5 pb-6 pt-5 sm:px-6">{children}</div>
    </article>
  );
}

/**
 * The slip's letterhead: the mark and the name, and what this piece of paper
 * is. `Receipt` is the page's heading where the slip is the page, and a
 * section's where the page already has one.
 */
export function SlipHead({ level = 2 }: { level?: 1 | 2 }) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2">
        <BrandGlyph size={22} />
        <span className="font-display text-subhead text-ink">Entole</span>
      </span>
      <Heading className="font-strong text-note text-slate">Receipt</Heading>
    </div>
  );
}

/**
 * That it was delivered. A slip is only ever drawn for a payment that has
 * been, so this never says anything else. A payment the assistant made is
 * marked as the assistant's, here as everywhere.
 */
export function SlipStatus({ children, byAssistant = false }: { children: ReactNode; byAssistant?: boolean }) {
  return (
    <div className="mt-7 flex flex-wrap items-center gap-2">
      <p className="tabular inline-flex items-center gap-1.5 rounded-pill bg-settled-wash py-1 pl-2.5 pr-3 font-strong text-note text-settled">
        <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-pill bg-settled" />
        {children}
      </p>
      {byAssistant ? <AssistantBadge /> : null}
    </div>
  );
}

/** The amount the slip is about, and one line under it. */
export function SlipFigure({ symbol, digits, children }: { symbol: string; digits: string; children?: ReactNode }) {
  return (
    <div className="mt-3">
      <FigureText symbol={symbol} digits={digits} />
      {children}
    </div>
  );
}

/** The facts, as ruled rows. */
export function SlipRows({ children }: { children: ReactNode }) {
  return <dl className="mt-5">{children}</dl>;
}

/** A ruled row: what it is on the left, the fact on the right, small print under the fact. */
export function SlipRow({
  label,
  value,
  under,
  spaced = false,
}: {
  label: string;
  value: string;
  under?: string | undefined;
  /** For a reference: a little air between its characters, so it can be read out. */
  spaced?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-3">
      <dt className="flex-none font-body text-ui text-slate">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className={`tabular block break-words font-strong text-ui text-ink ${spaced ? 'tracking-[0.6px]' : ''}`}>
          {value}
        </span>
        {under ? <span className="tabular block font-body text-note text-slate">{under}</span> : null}
      </dd>
    </div>
  );
}

/** The sender's own words, under their label, the full width of the slip. */
export function SlipNote({ children }: { children: string }) {
  return (
    <div className="border-t border-line py-3">
      <dt className="font-body text-note text-slate">Note</dt>
      <dd className="mt-1 break-words font-strong text-ui text-ink">{children}</dd>
    </div>
  );
}

/** The slip's last line, under a rule. */
export function SlipFoot({ children }: { children: ReactNode }) {
  return <p className="tabular border-t border-line pt-4 font-body text-note text-slate">{children}</p>;
}
