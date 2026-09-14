# Entole — Brand marks

Four directions. `mandate` is the recommended primary.

| File | Name | Idea |
|---|---|---|
| `entole-mandate.svg` | Mandate | A 270 degree arc running from the top and stopping dead against a bar. The arc is what the assistant may do, the bar is the allowance ceiling, the centre dot is you. It is the allowance meter from `docs/DESIGN.md` turned into the mark. |
| `entole-monogram.svg` | Ledger E | An `E` whose middle arm is short and `indigo`. The arm reads as a part-spent allowance against two full-width rules. |
| `entole-handover.svg` | Handover | Two facing arcs in `ink` and `indigo` with money in the gap. Two people, one transfer, no third party drawn. |
| `entole-pot.svg` | Pot | One ring split into four unequal shares, the user's own in `indigo`. For group spending. |

Each mark also ships as `*-mono.svg`, drawn entirely in `currentColor`, for
single-colour contexts: app store icon masks, print, embossing, disabled states.

## Colour

Marks use tokens only, never new hex:

- `ink` `#12100E` — the structural strokes
- `indigo` `#2B4EE6` — the one accent, always the allowance
- `paper` `#FBF9F5` — the ground the mark is drawn on

On `indigo` or on `ink`, use the mono mark knocked out in `paper`. Never place
the colour mark on a dark ground: the vertical bar in `mandate` disappears.

## Geometry

100 x 100 viewBox, 9 unit strokes, 34 unit radius. Round caps only on
`handover`, which is the one mark meant to feel like two hands. Everything else
is butt-capped so the stop reads as a stop.

## Clear space and minimum size

Clear space on all four sides is the width of one stroke, 9 units, scaled with
the mark. Minimum size is 20 px for `mandate`, `monogram` and `pot`. `handover`
needs 28 px before the centre dot merges with the arcs, so use `mandate` for the
favicon.

## Lockup

Wordmark is `entole`, lowercase, in the app's own UI sans at 600 weight with
-0.02em tracking. Lowercase is deliberate: the product is a bank that does not
raise its voice.

- Horizontal: mark height equals cap height x 1.7, gap equals 0.45 x mark width.
- Stacked: same mark size, gap equals 0.35 x mark height, wordmark centred.

Set the wordmark in `ink`, never in `indigo`. The accent belongs to the money.

## Shipped icons

`mandate` is the chosen mark. Rendered from `entole-mandate.svg` onto `paper`,
centred on the mark's bounding box rather than its viewBox, because the stop bar
overhangs the arc on the left and viewBox centring leaves it sitting 3 units off.

```
apps/web/public/favicon.ico              16 + 32 + 48
apps/web/public/icons/favicon.svg        small cut, scalable
apps/web/public/icons/favicon-{16,32,48}.png
apps/web/public/icons/icon.svg           full mark, scalable
apps/web/public/icons/icon-{192,512}.png       mark at 62 percent
apps/web/public/icons/maskable-{192,512}.png   mark at 44 percent
apps/web/public/icons/apple-touch-icon.png     180
apps/mobile/assets/icon.png                    1024
apps/mobile/assets/favicon.png                 48
apps/mobile/assets/android-icon-foreground.png 1024, transparent
apps/mobile/assets/android-icon-background.png 1024, solid paper
apps/mobile/assets/android-icon-monochrome.png 1024, black on transparent
apps/mobile/assets/splash-icon.png             1024, transparent
```

The favicon slots use a heavier cut of the same geometry: stroke 11 instead of
9, arc radius 32, dot radius 8. At 16 px the 9 unit stroke drops below one and a
half pixels and the arc greys out. Everything else is the mark as drawn.

Regenerate after any change to `entole-mandate.svg`. Nothing here is hand
edited.
