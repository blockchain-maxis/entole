import { KEYPAD_KEYS, type KeypadKey } from '@entole/core/amount-entry';

/**
 * The only way to enter an amount. The system keyboard never opens for
 * money — no `<input type="number">`, no text field. Same key set and
 * layout as the phone app's `Keypad.tsx`.
 */
export function Keypad({ onKey }: { onKey: (key: KeypadKey) => void }) {
  return (
    <div className="flex flex-wrap" style={{ margin: '0 -4px' }}>
      {KEYPAD_KEYS.map((key) => (
        <div key={key} className="w-1/3 p-1">
          <button
            type="button"
            aria-label={key === '⌫' ? 'Delete last digit' : key}
            onClick={() => onKey(key)}
            className="tabular flex w-full items-center justify-center rounded-control border border-line bg-card py-[15px] font-body text-key text-ink transition-colors hover:bg-press active:bg-press"
          >
            {key}
          </button>
        </div>
      ))}
    </div>
  );
}
