/**
 * An allowance is a sentence you fill in, never a form. Words are words; each
 * value is a blank you can press, and whatever you press opens below. The
 * whole thing reads back in one breath. The phone's `Sentence` is the same
 * idea with the same parts.
 */
export type SentencePart =
  | { kind: 'words'; text: string }
  | {
      kind: 'blank';
      id: string;
      text: string;
      /** False while the blank still holds a placeholder such as "an amount". */
      filled: boolean;
    };

export function Sentence({
  parts,
  activeId,
  onPick,
}: {
  parts: SentencePart[];
  activeId: string;
  onPick: (id: string) => void;
}) {
  return (
    <p className="text-pretty font-display-plain text-heading leading-[48px] text-ink">
      {parts.map((part, index) =>
        part.kind === 'words' ? (
          <span key={`words-${index}`}>{part.text}</span>
        ) : (
          <button
            key={part.id}
            type="button"
            aria-pressed={part.id === activeId}
            aria-label={`Change ${part.text}`}
            onClick={() => onPick(part.id)}
            className={`tabular inline-block rounded-control border-[1.5px] px-2.5 align-baseline font-display text-heading leading-[38px] transition-colors active:translate-y-px ${
              part.id === activeId
                ? 'border-ink bg-ink text-paper'
                : part.filled
                  ? 'border-line bg-card text-ink hover:border-mist'
                  : 'border-dashed border-mist text-slate hover:border-ink hover:text-ink'
            }`}
          >
            {part.text}
          </button>
        ),
      )}
    </p>
  );
}
