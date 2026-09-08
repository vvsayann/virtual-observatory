# Astronomy Engine

The astronomy engine (`js/astro.js`) exposes the global `Astro` API. It uses established algorithms to compute the positions of celestial bodies.

## Coordinate Systems

- **Equatorial Coordinates:** Right Ascension (RA) and Declination (Dec).
- **Horizontal Coordinates:** Altitude (Alt) and Azimuth (Az). `Astro.equatorialToHorizontal` converts between these based on location and Local Sidereal Time (LST).

## Algorithms

- **Julian Date (JD):** Calculated from standard UTC time.
- **Greenwich Mean Sidereal Time (GMST) and LST:** Computed to find the local sky orientation.
- **Planetary Ephemeris:** Calculated using Keplerian orbital elements and perturbations from Paul Schlyter's "Computing planetary positions".

## Precision

The engine provides precision sufficient for naked-eye and amateur telescope observations, generally within a few arcminutes of true position, making it perfect for a browser-based planetarium.
