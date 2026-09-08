# Design: Landing Page + Tabbed Shell

Goal: make the first impression cinematic, then get out of the way. Two screens, one visual language.

## 1. Landing page (`/`)

- Full-bleed background: a slideshow of deep-space photos (nebulae, galaxies, star fields — real imagery, same sourcing pattern as [`images.js`](src/lib/images.js)), crossfading to the next image every **5s**. Slight `Ken Burns` zoom on the active image so it never feels static.
- Dark gradient scrim over the image (top+bottom) so text stays legible regardless of which photo is showing.
- Center/lower-third content, minimal copy:
  - Wordmark: **✦ Virtual Observatory**
  - One-line intro (1–2 sentences): what this is — a live, real-sky planetarium in the browser.
  - Primary CTA button: **"Go to Virtual Observatory →"** — routes into the app shell.
- Small dot indicators for slideshow position (optional, bottom center), purely decorative, no manual controls needed for v1.
- No topbar, no chrome. This screen's only job is to look good and get someone to click the button.

## 2. App shell — browser-style tabs

Once inside, the sky view becomes one tab among several, switched via a tab strip pinned to the top (like browser tabs), replacing/augmenting the current `.topbar` brand row.

- Tabs (v1): **Sky Map** (existing canvas view, default/active) · **What's Up Tonight** (new — highlights, visible planets/objects for the current date+location) · room to add more later (e.g. Search, Learn) without redesigning the shell.
- Each tab is a pill/tab element with icon + label; active tab has an underline/glow using `--accent`; inactive tabs are muted.
- Switching tabs swaps the main content area; the sky canvas stays mounted (just hidden) when on Sky Map so engine state/animation isn't lost when flipping back.
- "What's Up Tonight" tab: a simple card grid pulling from existing `Observatory` state (visible planets, Moon phase, notable DSOs above horizon) — reuses `InfoPanel`-style cards, no new data layer needed for v1.

## Visual language (shared)

- Reuse existing dark theme tokens in [`styles.css`](src/styles.css) (`--bg`, `--panel`, `--accent`, `--accent-2`, blur/glass panels). No new palette.
- Typography, radii, shadows: match current `.topbar` / `.modal` conventions exactly — the landing page should feel like a splash of the same app, not a different product.
- Motion: crossfade (opacity) for slideshow, quick (150–200ms) tab-switch transitions. Nothing else animated — keep it calm.

## Structure (implementation-facing, not part of the ask right now)

- New `Landing.jsx` (+ its slice of `styles.css`) renders standalone; `App.jsx` gains a tiny router: `landing` vs `observatory` view state.
- New `TabBar.jsx` replaces the brand block in `.topbar`; `WhatsUpTonight.jsx` is a new component alongside `InfoPanel`/`LayersPanel`.
- No new dependencies — plain React state for routing/tabs, consistent with the rest of the app.

## Non-goals (v1)

- No client-side routing library, no URL-based tab state, no user-uploaded background images, no more than the two tabs listed above.
