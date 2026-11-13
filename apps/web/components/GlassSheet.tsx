'use client';

import { useEffect, useRef } from 'react';

import { useDialogFocus } from '@/lib/dialog-focus';

/**
 * A bottom sheet: one opaque sheet of `card` rising from the bottom over a
 * scrim. Until 13 November 2026 every sheet was frosted glass; under the
 * pockets and the statement reader what was behind it (pocket figures, the
 * tab bar's labels) read through and fought the sheet's own words. Solid is
 * the default now, in both themes.
 *
 * `glass` keeps the frosted pane for the feedback and help sheets, where it was
 * decided (docs/ARCHITECTURE.md): a blur, a wash of `card` strong enough that
 * nothing behind it can be read, a sheen from the top edge and a lit rim.
 *
 * It is a dialog: focus moves into it when it opens, Tab goes round its own
 * controls and never out behind it, focus returns to whatever opened it when
 * it closes, it closes on Escape or a tap on the ground behind it, and it says
 * so to a screen reader.
 */
export function GlassSheet({
  label,
  onDismiss,
  locked = false,
  glass = false,
  children,
}: {
  label: string;
  onDismiss: () => void;
  locked?: boolean;
  glass?: boolean;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useDialogFocus(panel);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !locked) onDismiss();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss, locked]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        disabled={locked}
        onClick={onDismiss}
        className="scrim-fade absolute inset-0 bg-scrim"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`sheet-rise relative max-h-[88dvh] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-t-sheet border-x border-t px-gutter-lg pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-floating outline-none ${
          glass
            ? 'border-card/80 bg-card/95 supports-[backdrop-filter]:bg-card/90 supports-[backdrop-filter]:backdrop-blur-2xl supports-[backdrop-filter]:backdrop-saturate-150'
            : 'border-hairline bg-card'
        }`}
      >
        {glass ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-28 rounded-t-sheet bg-gradient-to-b from-card/70 to-transparent"
          />
        ) : null}
        <div className="relative">
          <div aria-hidden className="mx-auto h-1 w-10 rounded-pill bg-line" />
          {children}
        </div>
      </div>
    </div>
  );
}
