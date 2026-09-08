// Engine moved to src/lib/ during the Vite/React migration; project is ESM.
import { Astro } from '../src/lib/astro.js';

function assertClose(actual, expected, tolerance, message) {
    if (Math.abs(actual - expected) > tolerance) {
        console.error(`FAIL: ${message} - expected ~${expected}, got ${actual}`);
    } else {
        console.log(`PASS: ${message}`);
    }
}

console.log('--- Astro Engine Regression Tests ---\n');

// 1. Julian Date sanity
let d = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));
let jd = Astro.julianDate(d);
assertClose(jd, 2451545.0, 0.0001, 'J2000 epoch JD');

// 2. Alt/Az sanity (Polaris from London)
let lstv = Astro.lst(jd, 0);
let h = Astro.equatorialToHorizontal(37.95, 89.26, 51.5, lstv);
assertClose(h.alt, 51.5, 1.0, 'Polaris Altitude from lat 51.5');
assertClose(h.az < 5 || h.az > 355 ? 0 : h.az, 0, 5.0, 'Polaris Azimuth ~0');

// 3. Equinox Sun Dec ≈ 0
// Vernal Equinox 2024: March 20, 2024 ~03:06 UT
let equinoxDate = new Date(Date.UTC(2024, 2, 20, 3, 6, 0));
let eqJD = Astro.dayNumber(Astro.julianDate(equinoxDate));
let sunEquinox = Astro.sun(eqJD);
assertClose(sunEquinox.dec, 0.0, 0.1, 'Sun Declination at Vernal Equinox ~0');

// 4. Moon phase at known new/full moons
// Full Moon: Jan 25, 2024 ~17:54 UT
let fullMoonDate = new Date(Date.UTC(2024, 0, 25, 17, 54, 0));
let fmJD = Astro.dayNumber(Astro.julianDate(fullMoonDate));
let moonFull = Astro.moon(fmJD, Astro.sun(fmJD));
assertClose(moonFull.phase, 1.0, 0.02, 'Moon Phase at Full Moon ~1.0');

// New Moon: Jan 11, 2024 ~11:57 UT
let newMoonDate = new Date(Date.UTC(2024, 0, 11, 11, 57, 0));
let nmJD = Astro.dayNumber(Astro.julianDate(newMoonDate));
let moonNew = Astro.moon(nmJD, Astro.sun(nmJD));
assertClose(moonNew.phase, 0.0, 0.02, 'Moon Phase at New Moon ~0.0');

// 5. Planet magnitudes within tolerance
let datePlanets = new Date(Date.UTC(2026, 6, 21, 22, 0, 0));
let planets = Astro.bodies(datePlanets);
for (const p of planets) {
    if (p.name === 'Venus') {
        assertClose(p.mag, -4.0, 1.0, 'Venus magnitude ~-4.0');
    } else if (p.name === 'Jupiter') {
        assertClose(p.mag, -2.0, 1.0, 'Jupiter magnitude ~-2.0');
    } else if (p.name === 'Sun') {
        assertClose(p.mag, -26.7, 0.5, 'Sun magnitude ~-26.7');
    } else if (p.name === 'Moon') {
        // Moon mag varies greatly with phase, just check it's negative
        if (p.mag > 0 && p.phase > 0.1) {
            console.error(`FAIL: Moon magnitude should be negative, got ${p.mag}`);
        } else {
            console.log(`PASS: Moon magnitude sanity check`);
        }
    }
}

console.log('\nAll tests completed.');
