'use client';

import { useEffect, useState, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusablesIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.closest('[inert]') && element.getClientRects().length > 0,
  );
}

/**
 * What every sheet does with focus. When it opens, focus moves into it (to
 * whatever inside asked for it first, otherwise the sheet itself); Tab and
 * Shift+Tab go round the sheet's own controls and never out behind the scrim;
 * when it closes, focus goes back to whatever opened it.
 */
export function useDialogFocus(panel: RefObject<HTMLElement | null>) {
  // Read while rendering, before anything inside (a field with autoFocus) can take focus.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const node = panel.current;
    // A field inside with autoFocus has already taken it; leave it there.
    if (node && !node.contains(document.activeElement)) node.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !panel.current) return;
      const inside = focusablesIn(panel.current);
      if (inside.length === 0) {
        event.preventDefault();
        panel.current.focus();
        return;
      }
      const first = inside[0]!;
      const last = inside[inside.length - 1]!;
      const active = document.activeElement;
      const within = active instanceof Node && panel.current.contains(active);
      if (event.shiftKey && (active === first || active === panel.current || !within)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !within)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Back to the opener, if it is still on the page to take it.
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [panel, opener]);
}
