import type { CSSProperties, ReactNode } from 'react';

import { SLIP_ZONE_WORDS, type SlipFacts, type SlipParty } from '@entole/core/receipt-slip';
import { raisedShadow, token as colour, watermarkToken } from '@entole/tokens';

import letters from '@/assets/receipt/advances.json';
import stampWord from '@/assets/receipt/watermark-word.json';

/**
 * The receipt as a picture: what "Share receipt" hands on, and what a shared
 * receipt link shows in a chat. It is drawn on the server by `next/og`, which
 * lays out a small subset of CSS: flex boxes and inline styles only, so this
 * is not a component any page renders.
 *
 * It is the same slip the apps draw, at three times the size: the mark, that
 * it was delivered, the amount as the figure, who paid whom, when, the note,
 * the reference and where it can be checked. Behind all of it the name runs
 * small and many, as the paper's watermark. Everything it says comes in as
 * `SlipFacts`, which is made from a kept payment and nothing else.
 */

/** One unit a screen is laid out in is this many pixels of the picture. */
const SCALE = 3;
const u = (units: number) => units * SCALE;

export const PICTURE_WIDTH = u(360);

const DISPLAY = 'Source Serif 4';
const SANS = 'Plus Jakarta Sans';

const EDGE = u(16);
const PAD = u(24);
const INNER = PICTURE_WIDTH - 2 * EDGE - 2 * PAD;

/** The seven type roles, as far as a slip uses them: size, then line. */
const TYPE = {
  figure: { fontSize: u(56), lineHeight: `${u(60)}px`, letterSpacing: u(-0.5) },
  'figure-md': { fontSize: u(44), lineHeight: `${u(48)}px`, letterSpacing: u(-0.4) },
  'figure-sm': { fontSize: u(36), lineHeight: `${u(40)}px`, letterSpacing: u(-0.3) },
  subhead: { fontSize: u(20), lineHeight: `${u(26)}px`, letterSpacing: u(-0.2) },
  ui: { fontSize: u(15), lineHeight: `${u(21)}px`, letterSpacing: u(-0.1) },
  note: { fontSize: u(13), lineHeight: `${u(18)}px` },
} as const;

const LINE = { ui: u(21), note: u(18) };
const ROW_PAD = u(12);
const RULE = SCALE;

/**
 * The `raised` shadow, as a few sheets of tint, each a little wider than the
 * last. A true blur this size takes the renderer seconds; these take none,
 * and at this strength the eye cannot tell them apart.
 */
const SHADOW_STEPS = [0, 1, 2, 3, 4, 5].map((step) => Math.round((step * u(raisedShadow.blur)) / 10));

/** A token colour as its three channels. */
function channels(hex: string): [number, number, number] {
  const channel = (at: number) => parseInt(hex.slice(at, at + 2), 16);
  return [channel(1), channel(3), channel(5)];
}

/** A token colour at part strength, for the shadow. */
function tint(hex: string, alpha: number): string {
  return `rgba(${channels(hex).join(',')},${alpha})`;
}

const WIDTHS: Record<string, number> = letters.widths;

/** How wide some words are at the `ui` size, in the face names and notes are set in. */
function widthOf(words: string): number {
  let units = 0;
  for (const letter of words) units += WIDTHS[String(letter.codePointAt(0))] ?? letters.unknown;
  // A hair over, so a line that only just fits on paper is counted as one that does not.
  return (units / letters.unitsPerEm) * TYPE.ui.fontSize * 1.02;
}

/**
 * How many lines some words take in a given width, worked out from the real
 * width of every letter (`assets/receipt/advances.json`). The picture is made
 * exactly as tall as what it says, so this has to be known before anything is
 * drawn. It breaks where the renderer does: at a space, after a hyphen, and
 * inside a word too long for the line. Where the two could still differ, this
 * counts a line more, never a line fewer.
 */
function linesFor(text: string, width: number): number {
  const space = widthOf(' ');
  let lines = 1;
  let used = 0;
  // "Adebayo-Williams" is two pieces that sit together with no space between.
  const pieces = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => (word.match(/[^-]+-*|-+/g) ?? [word]).map((piece, at) => ({ piece, joined: at > 0 })));
  for (const { piece: word, joined } of pieces) {
    const length = widthOf(word);
    const gap = joined ? 0 : space;
    if (used > 0 && used + gap + length <= width) {
      used += gap + length;
      continue;
    }
    if (used > 0) lines += 1;
    if (length <= width) {
      used = length;
      continue;
    }
    // A word too long for a line is broken letter by letter.
    used = 0;
    for (const letter of word) {
      const one = widthOf(letter);
      if (used + one > width) {
        lines += 1;
        used = 0;
      }
      used += one;
    }
  }
  return lines;
}

const VALUE_WIDTH = Math.round(INNER * 0.66);

function figureRole(digits: string): keyof typeof TYPE {
  return digits.length <= 9 ? 'figure' : digits.length <= 12 ? 'figure-md' : 'figure-sm';
}

/** A ruled row: its rule, its padding, the fact's lines and the small print under it. */
function rowHeight(lines: number, under: boolean): number {
  return RULE + 2 * ROW_PAD + lines * LINE.ui + (under ? LINE.note : 0);
}

/** The note sits under its own label, the full width of the slip. */
function noteHeight(lines: number): number {
  return RULE + 2 * ROW_PAD + LINE.note + u(4) + lines * LINE.ui;
}

/** Every block's height, top to bottom. The picture is exactly as tall as its slip. */
function measure(facts: SlipFacts) {
  const role = figureRole(facts.figure.digits);
  const partyLines = (who: SlipParty) => linesFor(who.name, VALUE_WIDTH);
  const noteLines = facts.note ? linesFor(facts.note, INNER) : 0;

  const blocks = {
    head: u(24),
    status: u(28) + u(26),
    statusGap: u(12),
    figure: parseInt(TYPE[role].lineHeight, 10),
    arrived: facts.arrived ? u(6) + LINE.ui : 0,
    from: rowHeight(partyLines(facts.from), Boolean(facts.from.username)),
    to: rowHeight(partyLines(facts.to), Boolean(facts.to.username)),
    when: rowHeight(1, true),
    note: facts.note ? noteHeight(noteLines) : 0,
    reference: rowHeight(1, false),
    foot: RULE + u(16) + 2 * LINE.note,
  };
  const rowsGap = u(22);
  const content = Object.values(blocks).reduce((sum, height) => sum + height, 0) + rowsGap;
  return { role, blocks, rowsGap, noteLines, fromLines: partyLines(facts.from), toLines: partyLines(facts.to), height: content + 2 * PAD + 2 * EDGE };
}

/** The picture's size for one receipt: a fixed width, and as tall as what it says. */
export function receiptPictureSize(facts: SlipFacts): { width: number; height: number } {
  return { width: PICTURE_WIDTH, height: measure(facts).height };
}

const text = (role: keyof typeof TYPE, weight: 500 | 600, color: string, more: CSSProperties = {}): CSSProperties => ({
  ...TYPE[role],
  fontFamily: role.startsWith('figure') || role === 'subhead' ? DISPLAY : SANS,
  fontWeight: role.startsWith('figure') || role === 'subhead' ? 600 : weight,
  color,
  ...more,
});

/**
 * The watermark is laid from one square stamp, repeated straight across the
 * picture. The words lean inside the stamp; the stamp itself is never turned,
 * because the renderer takes seconds to repeat a picture at an angle and no
 * time at all to repeat it straight.
 *
 * Leaning rows only meet themselves again on a square when the lean and the
 * spacing agree. They do when a row drops one for every two it runs
 * (`watermarkToken.angle`) and words sit twice as far apart as rows
 * (`advance` is twice `row`): then every word lands on a grid of steps
 * `g`, a word is `(4g, -2g)` from the next in its row and `(3g, g)` from its
 * neighbour in the row below, half a step along, and the whole thing repeats
 * every `10g` both ways with ten words to a stamp.
 *
 * The stamp is a drawing, not a photograph of one: the word's outline comes
 * from the display face itself (`assets/receipt/watermark-word.json`), so it
 * is sharp at any size and nothing has to be drawn ahead of the picture.
 */
const STAMP_SIDE = Math.round((10 * u(watermarkToken.row)) / Math.sqrt(5));

function watermarkStamp(): string {
  const { angle, size, row, opacity } = watermarkToken;
  const side = STAMP_SIDE;
  const g = side / 10;
  // The word's size follows the stamp, which was rounded to a whole pixel.
  const scale = ((u(size) / stampWord.unitsPerEm) * side * Math.sqrt(5)) / (10 * u(row));
  const reach = (stampWord.width * scale) / 2 + g;

  const words: string[] = [];
  for (let along = -8; along <= 8; along += 1) {
    for (let down = -8; down <= 8; down += 1) {
      const x = along * 4 * g + down * 3 * g;
      const y = along * -2 * g + down * g;
      // Every word that shows in the stamp at all, so a word cut by one edge comes in again at the other.
      if (x < -reach || x > side + reach || y < -reach || y > side + reach) continue;
      words.push(
        `<path transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle}) scale(${scale.toFixed(5)}) translate(${-stampWord.width / 2} ${stampWord.xHeight / 2})" d="${stampWord.path}"/>`,
      );
    }
  }

  const [red, green, blue] = channels(colour.ink);
  const drawing =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">` +
    `<g fill="rgb(${red},${green},${blue})" fill-opacity="${opacity}">${words.join('')}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(drawing).toString('base64')}`;
}

/** Made once: it depends on nothing but the tokens and the font. */
const STAMP = watermarkStamp();

function Watermark({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        display: 'flex',
        backgroundImage: `url(${STAMP})`,
        backgroundRepeat: 'repeat',
        backgroundSize: `${STAMP_SIDE}px ${STAMP_SIDE}px`,
      }}
    />
  );
}

/** A ruled row: what it is on the left, the fact on the right, small print under the fact. */
function Row({ label, value, under, lines = 1, spaced = false }: { label: string; value: string; under?: string | undefined; lines?: number; spaced?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexShrink: 0,
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        // The row is as tall as it was measured to be; if the words turn out a
        // line shorter, the room is left under them and not in their middle.
        height: rowHeight(lines, Boolean(under)),
        borderTop: `${RULE}px solid ${colour.line}`,
        paddingTop: ROW_PAD,
        paddingBottom: ROW_PAD,
      }}
    >
      <div style={{ display: 'flex', ...text('ui', 500, colour.slate) }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: VALUE_WIDTH }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            width: VALUE_WIDTH,
            textAlign: 'right',
            wordBreak: 'break-word',
            ...text('ui', 600, colour.ink, spaced ? { letterSpacing: u(0.6) } : {}),
          }}
        >
          {value}
        </div>
        {under ? <div style={{ display: 'flex', ...text('note', 500, colour.slate) }}>{under}</div> : null}
      </div>
    </div>
  );
}

function Block({ height, children, style }: { height: number; children?: ReactNode; style?: CSSProperties }) {
  return <div style={{ display: 'flex', flexShrink: 0, height, ...style }}>{children}</div>;
}

export function ReceiptPicture({
  facts,
  mark,
  checkLine,
}: {
  facts: SlipFacts;
  /** The Entole mark, as the icon file. */
  mark: string;
  checkLine: string;
}) {
  const { role, blocks, rowsGap, noteLines, fromLines, toLines, height } = measure(facts);
  const width = PICTURE_WIDTH;
  const symbolRole = role === 'figure' ? 'figure-sm' : 'subhead';

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width,
        height,
        backgroundColor: colour.paper,
        fontFamily: SANS,
      }}
    >
      {/* The slip's shadow, then the slip: the one raised surface. */}
      {SHADOW_STEPS.map((step) => (
        <div
          key={step}
          style={{
            position: 'absolute',
            left: EDGE + u(raisedShadow.offsetX) - step,
            top: EDGE + u(raisedShadow.offsetY) - step,
            width: width - 2 * EDGE + 2 * step,
            height: height - 2 * EDGE + 2 * step,
            display: 'flex',
            borderRadius: u(20) + step,
            backgroundColor: tint(colour.ink, raisedShadow.opacity / SHADOW_STEPS.length),
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: EDGE,
          top: EDGE,
          width: width - 2 * EDGE,
          height: height - 2 * EDGE,
          display: 'flex',
          backgroundColor: colour.card,
          borderRadius: u(20),
          border: `${RULE}px solid ${colour.line}`,
        }}
      />

      <Watermark width={width} height={height} />

      <div
        style={{
          position: 'absolute',
          left: EDGE + PAD,
          top: EDGE + PAD,
          width: INNER,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Block height={blocks.head} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <img src={mark} width={u(22)} height={u(22)} />
            <div style={{ display: 'flex', marginLeft: u(8), ...text('subhead', 600, colour.ink) }}>Entole</div>
          </div>
          <div style={{ display: 'flex', ...text('note', 600, colour.slate) }}>Receipt</div>
        </Block>

        <Block height={blocks.status} style={{ alignItems: 'flex-end' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              height: u(26),
              paddingLeft: u(10),
              paddingRight: u(12),
              borderRadius: u(999),
              backgroundColor: colour.settled.wash,
            }}
          >
            <div style={{ display: 'flex', width: u(6), height: u(6), borderRadius: u(999), backgroundColor: colour.settled.DEFAULT }} />
            <div style={{ display: 'flex', marginLeft: u(6), ...text('note', 600, colour.settled.DEFAULT) }}>Delivered</div>
          </div>
        </Block>

        <Block height={blocks.statusGap} />

        <Block height={blocks.figure} style={{ alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', height: blocks.figure - u(8) }}>
            <div style={{ display: 'flex', marginTop: u(role === 'figure' ? 6 : 4), ...text(symbolRole, 600, colour.ink) }}>{facts.figure.symbol}</div>
            <div style={{ display: 'flex', marginLeft: u(2), ...text(role, 600, colour.ink, { lineHeight: `${blocks.figure - u(8)}px` }) }}>{facts.figure.digits}</div>
          </div>
        </Block>

        {facts.arrived ? (
          <Block height={blocks.arrived} style={{ alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', ...text('ui', 500, colour.slate) }}>Arrived as</div>
            <div style={{ display: 'flex', marginLeft: u(5), ...text('ui', 600, colour.ink) }}>{facts.arrived}</div>
          </Block>
        ) : null}

        <Block height={rowsGap} />

        <Row label="From" value={facts.from.name} under={facts.from.username} lines={fromLines} />
        <Row label="To" value={facts.to.name} under={facts.to.username} lines={toLines} />
        <Row label="When" value={`${facts.delivered.date}, ${facts.delivered.time}`} under={SLIP_ZONE_WORDS} />

        {facts.note ? (
          <div
            style={{
              display: 'flex',
              flexShrink: 0,
              flexDirection: 'column',
              height: noteHeight(noteLines),
              borderTop: `${RULE}px solid ${colour.line}`,
              paddingTop: ROW_PAD,
              paddingBottom: ROW_PAD,
            }}
          >
            <div style={{ display: 'flex', ...text('note', 500, colour.slate) }}>Note</div>
            <div
              style={{
                display: 'flex',
                marginTop: u(4),
                width: INNER,
                wordBreak: 'break-word',
                ...text('ui', 600, colour.ink),
              }}
            >
              {facts.note}
            </div>
          </div>
        ) : null}

        <Row label="Reference" value={facts.reference} spaced />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            borderTop: `${RULE}px solid ${colour.line}`,
            paddingTop: u(16),
          }}
        >
          <div style={{ display: 'flex', ...text('note', 500, colour.slate) }}>Check this receipt at</div>
          <div style={{ display: 'flex', ...text('note', 600, colour.ink) }}>{checkLine}</div>
        </div>
      </div>
    </div>
  );
}
