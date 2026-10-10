# asciicord

Turn images and drawings into Discord-ready ASCII art — auto-capped to the 2,000-character limit.

## Use it

[Live site](https://ilikecodinginrust.github.io/asciicord/)

No build step, no dependencies, no server — open the page and use it.

### Enable GitHub Pages

1. Push these files to a repo named `asciicord`.
2. Repo → **Settings → Pages** → **Deploy from a branch** → branch `main`, folder `/ (root)` → **Save**.
3. Open `https://<your-username>.github.io/asciicord/`.

## Features

- **Upload / drag & drop / paste from clipboard** (`Ctrl+V` anywhere)
- **Closest-to-photo output:** 70-level detailed charset, Rec.709 luminance, Floyd–Steinberg dithering, brightness/contrast, char-aspect correction
- **Size adjustable, hard-capped:** width slider + **Max fit** button; output (including ```` ``` ```` fences and ANSI escapes) never exceeds 2,000 chars — width auto-shrinks until it fits, live counter + meter
- **Mono + ANSI color modes:** color mode emits ```` ```ansi ```` with run-length-optimized escape codes (nearest of Discord's 16 ANSI colors) and an in-preview color approximation
- **Discord-ready copy:** one click copies with code fences; raw copy + `.txt` download included
- Transparency composites onto black or white (your choice)

## Draw tab

- Freehand paint canvas (pen / eraser / undo / redo), brush-size ring cursor
- 🖼 Add picture: place a photo fitted (never cropped) and draw over it — pasting (Ctrl+V) and drag-drop also land here while this tab is active
- Draw directly on the 1:1 preview; smallest brush edits half-blocks precisely
- Mobile-friendly: layout stacks, touch targets grow, and preview text
  auto-shrinks so the whole message stays visible without sideways scrolling
- Black outline frame around each preview marks the exact Discord message bounds
- 📱 Mobile view button constrains the preview to phone width to check mobile fit
- 📱 Mobile-safe mode: plain-fence ASCII-only output with zero escape codes — looks identical on phones, where Discord flattens ```ansi art to a single color and phone fonts can misalign ▀▄█ blocks

## Limit math

- Mono: `cols × rows + newlines + 8 (fences) ≤ 2000`
- ANSI: same + escape-code bytes `≤ 2000` (codes are only emitted on color change, reset per line)
