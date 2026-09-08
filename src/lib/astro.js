/* =============================================================================
 * astro.js — Astronomical calculation engine
 * Julian date, sidereal time, coordinate transforms, and geocentric positions
 * of the Sun, Moon and planets using P. Schlyter's orbital-element method
 * (accurate to ~1-2 arcminutes; good for naked-eye planetarium work).
 * =========================================================================== */
const Astro = (function () {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const sin = a => Math.sin(a * D2R), cos = a => Math.cos(a * D2R);
  const tan = a => Math.tan(a * D2R);
  const asin = x => Math.asin(x) * R2D, acos = x => Math.acos(x) * R2D;
  const atan2 = (y, x) => Math.atan2(y, x) * R2D;
  const rev = a => ((a % 360) + 360) % 360;               // 0..360
  const rev180 = a => { a = rev(a); return a > 180 ? a - 360 : a; };

  /* ---- Time ---------------------------------------------------------- */
  // Julian Date (UT) from a JS Date (uses its UTC value)
  function julianDate(date) { return date.getTime() / 86400000 + 2440587.5; }

  // Schlyter day number, epoch 2000.0 (1999-12-31 00:00 UT)
  function dayNumber(jd) { return jd - 2451543.5; }

  // Greenwich Mean Sidereal Time in degrees (Meeus)
  function gmst(jd) {
    const T = (jd - 2451545.0) / 36525.0;
    let g = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
          + 0.000387933 * T * T - T * T * T / 38710000.0;
    return rev(g);
  }
  // Local Apparent Sidereal Time (deg), east longitude positive
  function lst(jd, lonDeg) { return rev(gmst(jd) + lonDeg); }

  /* ---- Coordinate transforms ---------------------------------------- */
  // Equatorial (RA/Dec deg) -> Horizontal (alt/az deg). Az 0=N, 90=E.
  function equatorialToHorizontal(raDeg, decDeg, latDeg, lstDeg) {
    const H = rev(lstDeg - raDeg);                 // hour angle
    const sinAlt = sin(decDeg) * sin(latDeg) + cos(decDeg) * cos(latDeg) * cos(H);
    const alt = asin(Math.max(-1, Math.min(1, sinAlt)));
    let az = atan2(sin(H), cos(H) * sin(latDeg) - tan(decDeg) * cos(latDeg));
    az = rev(az + 180);                            // measure from North
    return { alt, az };
  }

  const obliquity = d => 23.4393 - 3.563e-7 * d;   // mean obliquity of ecliptic

  // Solve Kepler's equation (deg), return eccentric anomaly (deg)
  function kepler(M, e) {
    M = rev(M);
    let E = M + R2D * e * sin(M) * (1 + e * cos(M));
    for (let i = 0; i < 8; i++) {
      const dE = (E - R2D * e * sin(E) - M) / (1 - e * cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-6) break;
    }
    return E;
  }

  // ecliptic geocentric lon/lat/r -> equatorial RA/Dec
  function eclToEq(lon, lat, r, ecl) {
    const xg = r * cos(lon) * cos(lat);
    const yg = r * sin(lon) * cos(lat);
    const zg = r * sin(lat);
    const xe = xg;
    const ye = yg * cos(ecl) - zg * sin(ecl);
    const ze = yg * sin(ecl) + zg * cos(ecl);
    return { ra: rev(atan2(ye, xe)), dec: atan2(ze, Math.sqrt(xe * xe + ye * ye)),
             dist: Math.sqrt(xe * xe + ye * ye + ze * ze) };
  }

  /* ---- Sun ----------------------------------------------------------- */
  function sun(d) {
    const w = 282.9404 + 4.70935e-5 * d;
    const e = 0.016709 - 1.151e-9 * d;
    const M = rev(356.0470 + 0.9856002585 * d);
    const ecl = obliquity(d);
    const E = kepler(M, e);
    const xv = cos(E) - e, yv = Math.sqrt(1 - e * e) * sin(E);
    const v = atan2(yv, xv), r = Math.sqrt(xv * xv + yv * yv);
    const lon = rev(v + w);                          // true ecliptic longitude
    const xs = r * cos(lon), ys = r * sin(lon);      // ecliptic rectangular
    const eq = eclToEq(lon, 0, r, ecl);
    return { name: 'Sun', lon, r, xs, ys, M, w, e, L: rev(M + w),
             ra: eq.ra, dec: eq.dec, dist: r, mag: -26.7, ecl };
  }

  /* ---- Moon ---------------------------------------------------------- */
  function moon(d, S) {
    const N = 125.1228 - 0.0529538083 * d;
    const i = 5.1454;
    const w = rev(318.0634 + 0.1643573223 * d);
    const a = 60.2666;                               // Earth radii
    const e = 0.054900;
    const M = rev(115.3654 + 13.0649929509 * d);
    const ecl = obliquity(d);
    const E = kepler(M, e);
    const xv = a * (cos(E) - e), yv = a * Math.sqrt(1 - e * e) * sin(E);
    const v = atan2(yv, xv), r = Math.sqrt(xv * xv + yv * yv);
    // position in ecliptic coords
    let xh = r * (cos(N) * cos(v + w) - sin(N) * sin(v + w) * cos(i));
    let yh = r * (sin(N) * cos(v + w) + cos(N) * sin(v + w) * cos(i));
    let zh = r * (sin(v + w) * sin(i));
    let lon = atan2(yh, xh), lat = atan2(zh, Math.sqrt(xh * xh + yh * yh));
    // perturbations
    const Ms = S.M, Ls = S.L;
    const Lm = rev(N + w + M);
    const Dm = rev(Lm - Ls);                          // mean elongation
    const F = rev(Lm - N);                            // argument of latitude
    lon += -1.274 * sin(M - 2 * Dm) + 0.658 * sin(2 * Dm) - 0.186 * sin(Ms)
         - 0.059 * sin(2 * M - 2 * Dm) - 0.057 * sin(M - 2 * Dm + Ms)
         + 0.053 * sin(M + 2 * Dm) + 0.046 * sin(2 * Dm - Ms)
         + 0.041 * sin(M - Ms) - 0.035 * sin(Dm) - 0.031 * sin(M + Ms)
         - 0.015 * sin(2 * F - 2 * Dm) + 0.011 * sin(M - 4 * Dm);
    lat += -0.173 * sin(F - 2 * Dm) - 0.055 * sin(M - F - 2 * Dm)
         - 0.046 * sin(M + F - 2 * Dm) + 0.033 * sin(F + 2 * Dm)
         + 0.017 * sin(2 * M + F);
    let rr = r - 0.58 * cos(M - 2 * Dm) - 0.46 * cos(2 * Dm);
    const eq = eclToEq(rev(lon), lat, rr, ecl);
    // phase (illuminated fraction) via elongation from Sun
    const elong = acos(cos(S.lon - lon) * cos(lat));
    const phase = (1 - cos(elong)) / 2;
    return { name: 'Moon', ra: eq.ra, dec: eq.dec, dist: rr, mag: -12.7,
             phase, elong, lon: rev(lon), lat };
  }

  /* ---- Planets ------------------------------------------------------- */
  // orbital elements as linear functions of d
  const PLAN = {
    Mercury: d => ({ N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5.00e-8 * d,
      w: 29.1241 + 1.01444e-5 * d, a: 0.387098, e: 0.205635 + 5.59e-10 * d,
      M: 168.6562 + 4.0923344368 * d, H: -0.36, k: 0.027 }),
    Venus: d => ({ N: 76.6799 + 2.46590e-5 * d, i: 3.3946 + 2.75e-8 * d,
      w: 54.8910 + 1.38374e-5 * d, a: 0.723330, e: 0.006773 - 1.302e-9 * d,
      M: 48.0052 + 1.6021302244 * d, H: -4.34, k: 0.013 }),
    Mars: d => ({ N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d,
      w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d,
      M: 18.6021 + 0.5240207766 * d, H: -1.51, k: 0.016 }),
    Jupiter: d => ({ N: 100.4542 + 2.76854e-5 * d, i: 1.3030 - 1.557e-7 * d,
      w: 273.8777 + 1.64505e-5 * d, a: 5.20256, e: 0.048498 + 4.469e-9 * d,
      M: 19.8950 + 0.0830853001 * d, H: -9.25, k: 0.014 }),
    Saturn: d => ({ N: 113.6634 + 2.38980e-5 * d, i: 2.4886 - 1.081e-7 * d,
      w: 339.3939 + 2.97661e-5 * d, a: 9.55475, e: 0.055546 - 9.499e-9 * d,
      M: 316.9670 + 0.0334442282 * d, H: -9.0, k: 0.044 }),
    Uranus: d => ({ N: 74.0005 + 1.3978e-5 * d, i: 0.7733 + 1.9e-8 * d,
      w: 96.6612 + 3.0565e-5 * d, a: 19.18171 - 1.55e-8 * d,
      e: 0.047318 + 7.45e-9 * d, M: 142.5905 + 0.011725806 * d, H: -7.15, k: 0.001 }),
    Neptune: d => ({ N: 131.7806 + 3.0173e-5 * d, i: 1.7700 - 2.55e-7 * d,
      w: 272.8461 - 6.027e-6 * d, a: 30.05826 + 3.313e-8 * d,
      e: 0.008606 + 2.15e-9 * d, M: 260.2471 + 0.005995147 * d, H: -6.90, k: 0.001 })
  };

  function planet(name, d, S) {
    const el = PLAN[name](d);
    const ecl = obliquity(d);
    const E = kepler(el.M, el.e);
    const xv = el.a * (cos(E) - el.e);
    const yv = el.a * Math.sqrt(1 - el.e * el.e) * sin(E);
    const v = atan2(yv, xv), r = Math.sqrt(xv * xv + yv * yv);
    // heliocentric ecliptic rectangular
    let xh = r * (cos(el.N) * cos(v + el.w) - sin(el.N) * sin(v + el.w) * cos(el.i));
    let yh = r * (sin(el.N) * cos(v + el.w) + cos(el.N) * sin(v + el.w) * cos(el.i));
    let zh = r * (sin(v + el.w) * sin(el.i));
    let lonecl = atan2(yh, xh), latecl = atan2(zh, Math.sqrt(xh * xh + yh * yh));

    // major perturbations for Jupiter/Saturn/Uranus
    const Mj = rev(19.8950 + 0.0830853001 * d);
    const Msa = rev(316.9670 + 0.0334442282 * d);
    const Mu = rev(142.5905 + 0.011725806 * d);
    let dl = 0;
    if (name === 'Jupiter') {
      dl = -0.332 * sin(2 * Mj - 5 * Msa - 67.6) - 0.056 * sin(2 * Mj - 2 * Msa + 21)
         + 0.042 * sin(3 * Mj - 5 * Msa + 21) - 0.036 * sin(Mj - 2 * Msa)
         + 0.022 * cos(Mj - Msa) + 0.023 * sin(2 * Mj - 3 * Msa + 52)
         - 0.016 * sin(Mj - 5 * Msa - 69);
    } else if (name === 'Saturn') {
      dl = 0.812 * sin(2 * Mj - 5 * Msa - 67.6) - 0.229 * cos(2 * Mj - 4 * Msa - 2)
         + 0.119 * sin(Mj - 2 * Msa - 3) + 0.046 * sin(2 * Mj - 6 * Msa - 69)
         + 0.014 * sin(Mj - 3 * Msa + 32);
    } else if (name === 'Uranus') {
      dl = 0.040 * sin(Msa - 2 * Mu + 6) + 0.035 * sin(Msa - 3 * Mu + 33)
         - 0.015 * sin(Mj - Mu + 20);
    }
    lonecl = rev(lonecl + dl);

    // geocentric: add Sun's rectangular
    xh = r * cos(lonecl) * cos(latecl);
    yh = r * sin(lonecl) * cos(latecl);
    zh = r * sin(latecl);
    const xg = xh + S.xs, yg = yh + S.ys, zg = zh;
    const xe = xg;
    const ye = yg * cos(ecl) - zg * sin(ecl);
    const ze = yg * sin(ecl) + zg * cos(ecl);
    const ra = rev(atan2(ye, xe));
    const dec = atan2(ze, Math.sqrt(xe * xe + ye * ye));
    const R = Math.sqrt(xg * xg + yg * yg + zg * zg);   // distance to Earth

    // phase angle & magnitude
    const s = S.r;                                       // Sun-Earth distance
    const FV = acos((r * r + R * R - s * s) / (2 * r * R));
    let mag = el.H + 5 * Math.log10(r * R) + el.k * FV;
    if (name === 'Mercury') mag += 2.2e-13 * Math.pow(FV, 6);
    if (name === 'Venus')   mag += 4.2e-7 * Math.pow(FV, 3);
    const phase = (1 + cos(FV)) / 2;
    return { name, ra, dec, dist: R, helioDist: r, mag: Math.round(mag * 100) / 100,
             phase, elong: FV };
  }

  const PLANET_NAMES = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

  /* ---- Convenience: all solar-system bodies for a given Date --------- */
  function bodies(date) {
    const jd = julianDate(date), d = dayNumber(jd);
    const S = sun(d);
    const list = [S, moon(d, S)];
    for (const n of PLANET_NAMES) list.push(planet(n, d, S));
    return list;
  }

  /* ---- Rise / set / transit (approx, iterative) --------------------- */
  function altAtTime(raDec, latDeg, lonDeg, date) {
    const jd = julianDate(date);
    const h = equatorialToHorizontal(raDec.ra, raDec.dec, latDeg, lst(jd, lonDeg));
    return h.alt;
  }

  return {
    D2R, R2D, julianDate, dayNumber, gmst, lst, equatorialToHorizontal,
    obliquity, sun, moon, planet, bodies, PLANET_NAMES, rev, rev180, altAtTime
  };
})();
export { Astro };
if (typeof module !== 'undefined') module.exports = Astro;
