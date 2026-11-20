# Grok Bot Timer

A full-screen countdown in the Grok Bot tracks-guide style. Flat sticker bots wait in a pile at the top and land in a mound at the bottom. The last one touches down at 0:00.

Light is the default: white canvas, ink type, purple eyebrows, and the black hero beside the clock. Dark mode turns the page black and the hero white.

## Run locally

```bash
npm install
npm run dev
```

Open http://127.0.0.1:43123.

```bash
npm test
```

## Set a time

- Presets: 1m, 5m, 10m, 15m, 25m, 2h.
- Hours, minutes, and seconds steppers. While the timer is idle they apply as you type. Hit **Set** to apply them while it is running.
- The text field accepts `10` (minutes), `10:00`, `1:30:00`, `90s`, or `1h30m`.
- **−1 min**, **+1 min**, and **+5 min** work while the clock is running. Adding time drops more bots onto the top pile. The last bot still lands at 0:00.
- Space starts and pauses, unless you are typing.

The eyebrow above the clock is editable. It remembers what you wrote.

## Links and memory

`?t=` opens the timer already set:

- `?t=10m`
- `?t=600` (bare numbers in the URL are seconds)
- `?t=1h30m`
- `?t=1:30:00`

The last duration, label, and theme are stored in the browser. A URL parameter wins over that memory.

Bot count grows with the square root of the duration and caps at 64, so a two-hour timer stays a mound.

At zero the pile hops, confetti made of tiny bots bursts, a chime plays, and the line reads “Build something that works.”

## Brand notes

Shapes follow the tracks-guide characters: yellow cloud, orange flower, teal rounded square, purple hex and square, pink ghost, blue pill, gray leaf with sleepy dashes, and the black circle hero. Eyes are two slanted pills with no pupils. Blink squashes them flat.

Inter is self-hosted (Latin WOFF2) for the UI and, as a fallback, the big numerals. The brand face is Universal Sans Display Medium. That font file was not in this environment, so drop `UniversalSans-Display-Medium.woff2` into `public/fonts/` and add this to `css/styles.css` if you have it:

```css
@font-face {
  font-family: "Universal Sans Display";
  src: url("/fonts/UniversalSans-Display-Medium.woff2") format("woff2");
  font-weight: 500;
  font-display: swap;
}
```

The clock and the closing line already ask for that family first.

Inter is used under the [SIL Open Font License](https://scripts.sil.org/OFL).
