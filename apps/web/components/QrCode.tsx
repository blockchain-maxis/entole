import { create } from 'qrcode';

/** Modules of empty margin the QR spec asks for on every side. */
const QUIET_ZONE = 4;

/**
 * A QR code drawn as one SVG path. Scanners need dark modules on a light field
 * in either theme, so it sits on the never-themed `white`/`black` tokens rather
 * than on `card`/`ink`, which invert in dark mode.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { modules } = create(value, { errorCorrectionLevel: 'M' });
  const size = modules.size + QUIET_ZONE * 2;

  let path = '';
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (modules.get(row, column)) path += `M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="block aspect-square w-full rounded-control bg-white text-black"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
