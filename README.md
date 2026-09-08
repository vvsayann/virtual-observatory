# Virtual Observatory

A browser-based planetarium ("virtual astronomy observatory") inspired by Stellarium. It renders the real night sky from real catalogs: 8,920 naked-eye stars, 88 constellation stick-figures, 110 Messier deep-sky objects, and live-computed Sun, Moon and planet positions. Pure client-side HTML/CSS/JS — **no build step, no server required**.

## Getting Started

Simply open `index.html` in any modern browser.

## Features

- **Star Catalog:** 8,920 naked-eye stars from HYG Database v41.
- **Constellations:** 88 constellation stick-figures from d3-celestial.
- **Deep Sky Objects:** 110 Messier objects.
- **Live Ephemeris:** Live-computed positions for the Sun, Moon, and planets.
- **Telescope Simulation:** Eyepiece view overlay with magnification control.
- **Guided Tours:** See "What's Up Tonight" for your location.

## Controls

| Action | Control |
|---|---|
| Pan | Click and drag |
| Zoom | Mouse wheel |
| Select | Click on an object |

## Credits and Data Licences

- **Star data:** [HYG Database v41](https://github.com/astronexus/HYG-Database) (astronexus) — CC-BY-SA.
- **Constellation lines, Messier:** [d3-celestial](https://github.com/ofrohn/d3-celestial) (Olaf Frohn) — BSD.
- **Algorithms:** Paul Schlyter, *Computing planetary positions*; Meeus, *Astronomical Algorithms*.
- **Inspiration & scope:** [Stellarium](https://stellarium.org/) (GPL) — this is an independent reimplementation, not a fork.
