'use client';

import { useEffect, useRef } from 'react';

/**
 * A bottom sheet in frosted glass: what is behind it shows through, blurred,
 * with a wash of the card colour so text stays readable, a sheen from the top
 * edge and a lit rim. The blur is the browser's own (`backdrop-filter`); a
 * browser without it gets the same pane, more opaque.
 *
 * It is a dialog: it takes focus when it opens, closes on Escape or a tap on the
 * ground behind it, and says so to a screen reader.
 */
export function GlassSheet({
  label,
  onDismiss,
  locked = false,
  children,
}: {
  label: string;
  onDismiss: () => void;
  locked?: boolean;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

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
        className="sheet-rise relative max-h-[88dvh] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-t-[32px] border-x border-t border-card/80 bg-card/90 px-gutter-lg pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-floating outline-none supports-[backdrop-filter]:bg-card/55 supports-[backdrop-filter]:backdrop-blur-2xl supports-[backdrop-filter]:backdrop-saturate-150"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-28 rounded-t-[32px] bg-gradient-to-b from-card/70 to-transparent"
        />
        <div className="relative">
          <div aria-hidden className="mx-auto h-1 w-10 rounded-pill bg-line" />
          {children}
        </div>
      </div>
    </div>
  );
}
