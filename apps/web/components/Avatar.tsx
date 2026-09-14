const TONES = {
  1: 'bg-avatar-1',
  2: 'bg-avatar-2',
  3: 'bg-avatar-3',
} as const;

export function Avatar({ initials, tone = 1 }: { initials: string; tone?: 1 | 2 | 3 }) {
  return (
    <span
      aria-hidden
      className={`flex h-10 w-10 flex-none items-center justify-center rounded-pill font-strong text-label text-paper ${TONES[tone]}`}
    >
      {initials}
    </span>
  );
}
