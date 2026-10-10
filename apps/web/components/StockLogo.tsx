'use client';

import { useState } from 'react';

const BOX = { 40: 'h-10 w-10', 52: 'h-[52px] w-[52px]' } as const;

/**
 * A company's own mark, as published with its listing. If there is none, or
 * it does not load, the first letter of its name stands in.
 */
export function StockLogo({ src, name, size = 40 }: { src?: string | undefined; name: string; size?: keyof typeof BOX }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        aria-hidden
        className={`flex flex-none items-center justify-center rounded-pill bg-press font-strong text-label text-slate ${BOX[size]}`}
      >
        {name.trim().charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`flex-none rounded-pill bg-press object-cover ${BOX[size]}`}
    />
  );
}
