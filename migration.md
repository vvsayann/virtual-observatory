# Virtual Observatory — Build & Parallel-Work Handover

A browser-based planetarium ("virtual astronomy observatory") inspired by
[Stellarium](https://github.com/stellarium/stellarium). It renders the **real**
night sky from real catalogs: 8,920 naked-eye stars (HYG v41), 88 constellation
stick-figures, 110 Messier deep-sky objects, and live-computed Sun, Moon and
planet positions for any date and place on Earth.

**Stack:** React 18 + Vite (UI chrome) over a framework-agnostic imperative
engine (astronomy math + 60fps canvas renderer). `npm run dev` to develop,
`npm run build` to produce a static `dist/` that also opens from `file://`.

> **Coordination contract for two agents working in parallel** — "Claude"
> (engine, renderer, React UI, integration) and "Antigravity" (plugins, docs,
> tests). **Read this file before starting new work.** The Changelog is
> newest-first; the File Ownership table is authoritative — edit only what you own.

---

## Changelog (newest first)

- **2026-07-21 (Claude) — ✅ App verified working end-to-end.**
  Headless-Chrome screenshots confirm correct rendering day & night: Orion,
  Scorpius, Sagittarius etc. recognizable; planets/Moon/Sun placed correctly;
  Messier objects cluster on the galactic centre; both Antigravity plugins
  (Eyepiece + What's-Up-Tonight) mount live in the sidebar. All 10 astro
  regression tests pass; production build succeeds (`dist/` 537 kB JS / 187 kB gz).
- **2026-07-21 (Claude) — 🔀 PIVOT to React + Vite** (user requested a modern
  framework). Consequences you must know:
  - **Files moved:** `js/astro.js → src/lib/astro.js`, `js/render.js →
    src/lib/render.js`, `js/main.js → src/lib/observatory.js` (now an ES-module
    engine, not a `<script>` global). `js/data/* → src/data/*`.
  - **Plugin files relocated** to `public/js/**` so Vite serves them at
    `/js/...` (dev) and copies them into `dist/js/**` (build). Antigravity's
    `index.html` `<script>` includes now resolve correctly.
  - **`window` bridge added** (`src/main.jsx`): `window.Observatory`,
    `window.Astro`, `window.Renderer` are exposed so classic-script plugins keep
    working. `Observatory.registerPanel(el)` is implemented and mounts panels
    into the sidebar `#plugin-dock`; `Observatory.initPlugins()` boots
    `window.Telescope`/`window.Tours` after the engine starts.
  - **Test fix:** `tools/test_astro.js` now `import`s from `../src/lib/astro.js`
    (project is `type:module`). Still 10/10 green.
- **2026-07-21 (Antigravity)** — Created `tools/test_features.cjs` with DOM
  mocks to unit-test the client-side feature JS (`extra.js`, `telescope.js`,
  `tours.js`).
- **2026-07-21 (Antigravity)** — Completed WP-A…E: `public/js/data/extra.js`,
  `public/js/features/telescope.js`, `public/js/features/tours.js`,
  `README.md`, `docs/astronomy.md`, expanded `tools/test_astro.js`, and wired
  the plugin `<script>` includes into `index.html`.
- **2026-07-21 (Claude)** — Engine + data pipeline complete and verified
  (JD exact, Sun/Polaris/planet magnitudes correct). Built renderer + controller.

---

## 1. File ownership & status

| Component | File(s) | Status | Owner |
|-----------|---------|--------|-------|
| Data pipeline | `tools/process.py` | ✅ | Claude |
| Catalog data | `src/data/{stars,constellations,dso}.js` | ✅ generated | Claude |
| Astronomy engine | `src/lib/astro.js` | ✅ tested | Claude |
| Sky renderer | `src/lib/render.js` | ✅ | Claude |
| Engine/controller | `src/lib/observatory.js` | ✅ | Claude |
| React UI | `src/App.jsx`, `src/components/*.jsx`, `src/main.jsx`, `src/styles.css` | ✅ | Claude |
| App shell | `index.html` (shared — plugin `<script>`s live here) | ✅ | shared |
| Extended catalogs | `public/js/data/extra.js` | ✅ | Antigravity |
| Telescope plugin | `public/js/features/telescope.js` | ✅ | Antigravity |
| Tours plugin | `public/js/features/tours.js` | ✅ | Antigravity |
| Docs | `README.md`, `docs/astronomy.md` | ✅ | Antigravity |
| Tests | `tools/test_astro.js`, `tools/test_features.cjs` | ✅ | shared |

**Ownership rule:** create NEW files in your lane. The only shared file is
`index.html` (plugin includes, guarded by `<!-- ANTIGRAVITY: WP-x -->`) — and
this `migration.md` (append to the Changelog + §7 log; don't rewrite others' notes).

---

## 2. Run it

```bash
npm install
npm run dev       # Vite dev server (hot reload) at http://localhost:5173
npm run build     # -> dist/  (static, base './', opens from file:// too)
npm run preview   # serve the production build
npm run data      # regenerate catalogs from tools/ raw sources (needs Python 3)
node tools/test_astro.js       # 10 astro regression tests (ESM)
node tools/test_features.cjs   # plugin/data unit tests (CommonJS + DOM mocks)
```

---

## 3. Astronomy engine API — `Astro` (STABLE, do not change signatures)

`src/lib/astro.js`, `export { Astro }` (also `window.Astro` at runtime). Angles in
**degrees** unless noted. Verified against known references.

```js
Astro.julianDate(date)                      // JS Date -> Julian Date (UT)
Astro.gmst(jd) / Astro.lst(jd, lonDeg)      // sidereal time (deg), E-lon positive
Astro.equatorialToHorizontal(ra, dec, lat, lstDeg) // -> {alt, az}  (az 0=N,90=E)
Astro.sun(d) / Astro.moon(d,S) / Astro.planet(name,d,S)  // d = Astro.dayNumber(jd)
Astro.bodies(date)   // -> [Sun, Moon, Mercury..Neptune]; {name,ra,dec,dist,mag,phase?}
Astro.PLANET_NAMES / Astro.rev(a) / Astro.rev180(a)
```

## 4. Data formats (globals; `src/data/*` set window.*, `public/js/data/extra.js` adds more)

```js
window.STAR_DATA   // [[raDeg, decDeg, mag, colorIndex, bayer, constellation], ...]
window.STAR_NAMES  // { "<indexIntoSTAR_DATA>": "Proper Name", ... }
window.CONST_LINES // { "And": [ [[raDeg,decDeg], ...polyline], ... ], ... }
window.CONST_META  // { "And": ["Andromeda", labelRaDeg, labelDecDeg], ... }
window.DSO_DATA    // [[name, raDeg, decDeg, mag, type, commonName, desig], ...]
window.EXTRA_DATA  // { meteorShowers, brightComets, asterisms, milkyWay } (Antigravity)
```

## 5. Engine API — `Observatory` (`src/lib/observatory.js`, `window.Observatory`)

The imperative controller: owns canvas, animation loop, view state, input,
picking, search. React (or a plugin) drives it through this surface.

```js
Observatory.state       // { date, location{lat,lon,name}, fov, center{alt,az},
                        //   layers{...booleans}, bodies[], timeRate, playing, hud }
Observatory.init(canvasEl)          Observatory.destroy()
Observatory.on(evt, cb)             // 'tick' (per frame), 'select' (obj|null); returns off()
Observatory.setTime(date) / now() / setRate(sec_per_sec) / togglePlay()
Observatory.setLocation(lat, lon, name)   Observatory.setFov(deg)   Observatory.setLayer(k,v)
Observatory.search(q)               // -> [{kind,name,ra,dec,mag,...}]
Observatory.goToObject(obj) / lookAt(alt, az, fov) / selectObject(obj|null)
Observatory.currentAltAz(obj)       // live {alt,az} for an object
Observatory.registerPanel(el)       // mount a DOM panel into the sidebar #plugin-dock
Observatory.CITIES / DSO_TYPES
```

**Plugin integration (Antigravity):** classic `<script>`s in `public/js/**` run
before the React module; they set `window.<Name>` and expose `init(observatory)`.
`Observatory.initPlugins()` (called at engine start) invokes
`window.Telescope.init` / `window.Tours.init` with the live engine, which call
`registerPanel()` to appear in the sidebar. Degrade gracefully if a hook is missing.

---

## 6. Antigravity work packages (all delivered — see Changelog)

- **WP-A** Extended catalogs → `public/js/data/extra.js` (`window.EXTRA_DATA`).
- **WP-B** Telescope/eyepiece → `public/js/features/telescope.js` (`window.Telescope`).
- **WP-C** What's-up-tonight → `public/js/features/tours.js` (`window.Tours`).
- **WP-D** Docs → `README.md`, `docs/astronomy.md`.
- **WP-E** Tests → `tools/test_astro.js`, `tools/test_features.cjs`.

Open follow-ups (optional, still in Antigravity's lane):
- Render `EXTRA_DATA.milkyWay` / `asterisms` as an optional sky layer (needs a
  new toggle — request the layer key in §7 and Claude wires the checkbox).
- Meteor-shower radiant markers near peak dates.

---

## 7. Cross-agent notes / requests (append-only)

- _(Claude)_ Engine + data complete and verified. Built renderer/controller/UI.
- _(Antigravity)_ Completed WP-A…E; wired plugin `<script>` includes into `index.html`.
- _(Claude)_ Pivoted to React+Vite; moved engine to `src/lib/**`, plugins to
  `public/js/**`; added `window` bridge + `registerPanel`; fixed test import path.
  Plugins verified mounting live. If you add a sky layer that draws on the canvas,
  tell me the `layers` key you need and I'll add the toggle + render hook.

## 8. Credits / data licences
- Star data: **HYG Database v41** (astronexus) — CC-BY-SA.
- Constellation lines & Messier: **d3-celestial** (Olaf Frohn) — BSD.
- Algorithms: Paul Schlyter, *Computing planetary positions*; Meeus, *Astronomical Algorithms*.
- Inspiration & scope: **Stellarium** (GPL) — an independent reimplementation, not a fork.
