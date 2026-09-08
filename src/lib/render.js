/* =============================================================================
 * render.js — Sky renderer
 * Stereographic projection of the celestial sphere onto a 2D canvas.
 * Fast path: every star's equatorial unit vector is precomputed once, so the
 * per-frame hot loop is pure multiply-add (no trig) -> ~9k stars at 60fps.
 * =========================================================================== */
const Renderer = (function () {
  const DEG = Math.PI / 180;

  // ---- star color from B-V color index -> css rgb ----
  function bv2rgb(bv) {
    bv = Math.max(-0.4, Math.min(2.0, bv));
    let r, g, b;
    if (bv < 0.0)      { r = 0.61 + 0.11 * bv + 0.1 * bv * bv; g = 0.70 + 0.07 * bv + 0.1 * bv * bv; b = 1.0; }
    else if (bv < 0.4) { r = 0.83 + 0.17 * bv;                 g = 0.87 + 0.11 * bv;                 b = 1.0; }
    else if (bv < 1.6) { r = 1.0; g = 0.98 - 0.16 * (bv - 0.4); b = 1.0 - 0.5 * (bv - 0.4); }
    else               { r = 1.0; g = 0.82 - 0.5 * (bv - 1.6);  b = 0.5 - 0.1 * (bv - 1.6); }
    r = Math.max(0, Math.min(1, r)); g = Math.max(0, Math.min(1, g)); b = Math.max(0, Math.min(1, b));
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  const PLANET_COLORS = {
    Sun: '#fff4d6', Moon: '#e6e6e0', Mercury: '#b8b0a0', Venus: '#fff5d0',
    Mars: '#e07a4a', Jupiter: '#e0c090', Saturn: '#e8d59a',
    Uranus: '#a8e0e0', Neptune: '#5a7ff0'
  };
  // NB: 's' (spiral), 'e' (elliptical), 'i' (irregular) are the actual galaxy
  // type codes used in the catalog — they were missing here, so every galaxy
  // (M31 included) was silently falling through to the generic nebula
  // crosshair marker instead of the galaxy ellipse.
  const DSO_STYLE = {
    gc: ['#ffd27f', 'cluster'], oc: ['#a8ffb0', 'cluster'],
    pn: ['#7fffd4', 'nebula'], snr: ['#ff9f9f', 'nebula'], dn: ['#c0a0ff', 'nebula'],
    sfr: ['#ff9fc0', 'nebula'], rn: ['#a0c0ff', 'nebula'], pos: ['#c0d0ff', 'nebula'],
    ga: ['#ffc0e0', 'galaxy'], gx: ['#ffc0e0', 'galaxy'],
    s: ['#ffc0e0', 'galaxy'], e: ['#ffb0d8', 'galaxy'], i: ['#ffd0e8', 'galaxy'],
  };

  // ---- real astrophoto overlay for DSOs, shown once you're zoomed in on one
  // (the "reserve photorealism for zooming into one object" idea) ----
  const DSO_ANGULAR_SIZE = {   // rough apparent width in degrees, by object type
    gc: 0.35, oc: 0.5, pn: 0.35, snr: 0.6, dn: 0.8, sfr: 0.8, rn: 0.6,
    s: 1.0, e: 0.8, i: 0.6, ga: 0.9, gx: 0.9, pos: 0.7,
  };
  const dsoImageCache = new Map();   // name -> { status: 'loading'|'ready'|'error', masked: <canvas>, aspect }

  // Pre-feathers the loaded image once (not per frame): copies it onto an
  // offscreen canvas and punches a soft elliptical alpha fade through the
  // edges with 'destination-in', so there is no hard rectangle left to draw —
  // by the time it hits the sky it already fades to nothing at its border.
  function buildMaskedImage(img, featherStart) {
    featherStart = featherStart == null ? 0.45 : featherStart;
    const w = img.naturalWidth, h = img.naturalHeight;
    const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
    const octx = oc.getContext('2d');
    octx.drawImage(img, 0, 0, w, h);
    octx.globalCompositeOperation = 'destination-in';
    octx.save();
    octx.translate(w / 2, h / 2);
    octx.scale(w / 2, h / 2);
    const grad = octx.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(featherStart, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    octx.fillStyle = grad;
    octx.fillRect(-1, -1, 2, 2);
    octx.restore();
    return oc;
  }

  function getDsoImage(dsoObj) {
    let entry = dsoImageCache.get(dsoObj.name);
    if (entry) return entry.status === 'ready' ? entry : null;
    entry = { status: 'loading', masked: null, aspect: 1 };
    dsoImageCache.set(dsoObj.name, entry);
    const r = resolveSkyCutout(dsoObj);   // always DSS2/SDSS — a real sky photo whose near-black
    if (!r) { entry.status = 'error'; return null; }   // background actually blends, unlike a Wikipedia crop
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      entry.masked = buildMaskedImage(im);
      entry.aspect = im.naturalHeight / im.naturalWidth;
      entry.status = 'ready';
    };
    im.onerror = () => { entry.status = 'error'; };
    im.src = r.src;
    return null;
  }

  // 'screen' blend so the DSS plate's near-black sky background falls away
  // into the rendered night sky rather than showing as a box; the alpha
  // feathering already removed the hard rectangular edge. Fades in as you
  // zoom rather than popping in abruptly.
  function drawDsoImage(ctx, entry, p, sizeDeg, P, state) {
    const wDeg = sizeDeg, hDeg = sizeDeg * entry.aspect;
    const wPx = P.f * wDeg * DEG, hPx = P.f * hDeg * DEG;
    if (wPx < 24) return;   // too small to be worth it yet — the marker alone reads better
    const zoomT = Math.max(0, Math.min(1, (18 - state.fov) / 12));   // fade in as fov drops from 18°->6°
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.5 + zoomT * 0.42;
    ctx.drawImage(entry.masked, p.x - wPx / 2, p.y - hPx / 2, wPx, hPx);
    ctx.restore();
  }

  // ---- planets: real apparent size (so zooming in actually magnifies the
  // disk, instead of a fixed-pixel dot) + a real blended photo once you're
  // zoomed in enough to actually resolve detail. ----
  const PLANET_DIAMETER_KM = {
    Mercury: 4879, Venus: 12104, Mars: 6779, Jupiter: 139820,
    Saturn: 116460, Uranus: 50724, Neptune: 49244,
    Sun: 1391000, Moon: 3474,
  };
  const AU_KM = 149597870;
  const EARTH_RADIUS_KM = 6371;

  // True angular diameter in degrees from the body's real distance — the
  // same physics a real ephemeris uses, not a guess. Astro.bodies() reports
  // the Moon's distance in Earth radii and everything else in AU.
  function planetApparentDeg(name, dist) {
    const dKm = PLANET_DIAMETER_KM[name];
    if (!dKm || !dist) return null;
    const distKm = name === 'Moon' ? dist * EARTH_RADIUS_KM : dist * AU_KM;
    return (dKm / distKm) * (180 / Math.PI);
  }

  const planetImageCache = new Map();   // name -> { status, masked, aspect }
  function getPlanetImage(name) {
    let entry = planetImageCache.get(name);
    if (entry) return entry.status === 'ready' ? entry : null;
    entry = { status: 'loading', masked: null, aspect: 1 };
    planetImageCache.set(name, entry);
    // resolvePlanetImage (not the generic resolveObjectImage) — a real
    // ~1024px page photo instead of the ~320px REST-summary thumbnail, which
    // was visibly soft once stretched across a large on-screen disc, plus
    // title overrides for names (Mercury) that dead-end on a disambiguation
    // page under the summary API.
    resolvePlanetImage(name).then(r => {
      if (!r) { entry.status = 'error'; return; }
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        entry.masked = buildMaskedImage(im, 0.72);   // tighter feather — a clean planetary limb, not a soft blend into starfield
        entry.aspect = im.naturalHeight / im.naturalWidth;
        entry.status = 'ready';
      };
      im.onerror = () => { entry.status = 'error'; };
      im.src = r.src;
    }).catch(() => { entry.status = 'error'; });
    return null;
  }

  let stars = null;     // prepared star arrays
  let MAGLIMIT = 6.5;

  // ---- galactic-plane geometry (J2000), used to place the Milky Way band and
  // bias the extra field-star density realistically instead of guessing a shape ----
  function eqToVec(raDeg, decDeg) {
    const ra = raDeg * DEG, dec = decDeg * DEG;
    return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  }
  function vnorm(v) { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; }
  function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vcross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  // Inverse of the alt/az<-RA/Dec transform used throughout this file (see
  // makeProjector's projRaDec) — given a horizontal alt/az and the observer's
  // latitude + local sidereal time, recovers the equatorial RA/Dec. Used by
  // the deep-zoom procedural dust below to find which patch of sky the
  // current view is actually centred on.
  function eqFromAltAz(altDeg, azDeg, latDeg, lstDeg) {
    const al = altDeg * DEG, az = azDeg * DEG;
    const cal = Math.cos(al), sal = Math.sin(al);
    const E = cal * Math.sin(az), Nn = cal * Math.cos(az), Uu = sal;
    const cLat = Math.cos(latDeg * DEG), sLat = Math.sin(latDeg * DEG);
    const dec = Math.asin(Math.max(-1, Math.min(1, sLat * Uu + cLat * Nn))) / DEG;
    const H = Math.atan2(E, cLat * Uu - sLat * Nn) / DEG;
    return [((lstDeg - H) % 360 + 360) % 360, dec];
  }

  // Cheap deterministic 32-bit hash -> [0,1), keyed by two grid indices plus
  // a salt (so several independent "random" values can be pulled from the
  // same cell). Powers the procedural deep-zoom dust field below: rather
  // than storing points, each grid cell's contents are recomputed from its
  // own coordinates on demand, so there's no fixed pool to run out of
  // resolution as you zoom in.
  function hashN(ix, iy, salt) {
    let h = (ix * 0x27d4eb2d) ^ (iy * 0x165667b1) ^ (salt * 0x9e3779b9);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const NGP = eqToVec(192.85948, 27.12825);        // north galactic pole
  const GC0 = eqToVec(266.40510, -28.936175);       // galactic center (Sgr A*)
  const gcd = vdot(GC0, NGP);
  const GX = vnorm([GC0[0] - gcd * NGP[0], GC0[1] - gcd * NGP[1], GC0[2] - gcd * NGP[2]]);  // galactic l=0 axis
  const GY = vcross(NGP, GX);                                                                // galactic l=90 axis

  function galToEq(lDeg, bDeg) {
    const l = lDeg * DEG, b = bDeg * DEG;
    const cb = Math.cos(b), sb = Math.sin(b), cl = Math.cos(l), sl = Math.sin(l);
    const vx = cb * cl * GX[0] + cb * sl * GY[0] + sb * NGP[0];
    const vy = cb * cl * GX[1] + cb * sl * GY[1] + sb * NGP[1];
    const vz = cb * cl * GX[2] + cb * sl * GY[2] + sb * NGP[2];
    return [(Math.atan2(vy, vx) / DEG + 360) % 360, Math.asin(Math.max(-1, Math.min(1, vz))) / DEG];
  }
  function galLat(raDeg, decDeg) {
    return Math.asin(Math.max(-1, Math.min(1, vdot(eqToVec(raDeg, decDeg), NGP)))) / DEG;
  }

  // Milky Way band, traced along the real galactic plane (fixed once, not
  // per-frame). Built as a *dense, heavily-overlapping* field of small,
  // pure-Gaussian (no hard plateau) dabs rather than a sparse necklace of big
  // blobs — that's the difference between a smooth photographic glow (real
  // Milky Way, Stellarium, Seestar stacks) and visible "smoke puffs"/dots.
  // Layers, in order: (1) a wide, soft base wash across the whole band width,
  // (2) a warm core glow near Sagittarius/Scutum, (3) patchy brightness
  // texture (mottling, not individual dots), (4) a dark dust-lane rift,
  // (5) very fine sub-pixel grain for grit at close range only.
  const MW_HAZE_COL  = [46, 52, 66];    // cool blue-grey — the outer-arm glow (unresolved distant starlight)
  const MW_HAZE_COL2 = [58, 58, 70];    // cool mottle variant
  const MW_WARM_COL  = [150, 122, 88];  // warm tan/gold — the star-cloud light real photos show near the core
  const MW_WARM_COL2 = [130, 104, 80];  // warm mottle variant
  const MW_DUST_COL  = [168, 128, 84];  // richer warm core glow (Sagittarius/Scutum star clouds)
  const MW_RIFT_COL  = [3, 3, 5];       // near-black, multiplied in to darken — the Great Rift dust lane
  // Orange/brown dust-cloud palette — the reddish-brown nebulosity a real
  // wide-field or zoomed Milky Way photo shows as actual coloured cloud, not
  // just a brightness gradient. Two shades so clouds have some internal
  // colour variation instead of reading as one flat tint.
  const MW_DUST_ORANGE  = [148, 84, 38];
  const MW_DUST_ORANGE2 = [110, 58, 26];
  const MW_FIL_COL      = [10, 6, 4];     // dark filament tendrils, multiplied in like the rift but smaller/scattered

  // Pure-Gaussian dab: full alpha at the centre, smooth falloff, zero at the
  // edge — no plateau, so overlapping dabs never show a ring/disc boundary.
  // Each dab may carry its own `.col` (e.g. warm vs cool patches) that
  // overrides the layer's default colour, so a single pass can mix hues.
  // Dabs may also carry `.sq` (squash 0-1) + `.rot` (radians) to render as a
  // stretched, rotated streak instead of a perfect circle — real dust/gas
  // structure is filamentary, not a field of round puffs, and a mix of
  // streak orientations reads as much more like turbulent cloud texture
  // than more circular blobs would, however many are stacked. `sharp` swaps
  // in a steeper falloff (less soft midtone) so individual dabs stay
  // individually visible instead of just averaging into a smoother field —
  // used for the fine detail/filament layers, where that's the point.
  function paintGauss(ctx, P, state, arr, col, alphaMul, composite, sharp) {
    if (composite) { ctx.save(); ctx.globalCompositeOperation = composite; }
    for (const b of arr) {
      const p = P.projRaDec(b.ra, b.dec);
      if (p.behind || (state.layers.ground && p.alt < -3)) continue;
      const rpx = P.f * b.r * DEG;
      if (rpx < 0.6) continue;
      const [cr, cg, cb] = b.col || col;
      const a = (b.a * alphaMul).toFixed(3);
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rpx);
      if (sharp) {
        rg.addColorStop(0,    `rgba(${cr},${cg},${cb},${a})`);
        rg.addColorStop(0.5,  `rgba(${cr},${cg},${cb},${(a * 0.55).toFixed(3)})`);
        rg.addColorStop(0.82, `rgba(${cr},${cg},${cb},${(a * 0.14).toFixed(3)})`);
        rg.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
      } else {
        rg.addColorStop(0,    `rgba(${cr},${cg},${cb},${a})`);
        rg.addColorStop(0.35, `rgba(${cr},${cg},${cb},${(a * 0.75).toFixed(3)})`);
        rg.addColorStop(0.7,  `rgba(${cr},${cg},${cb},${(a * 0.28).toFixed(3)})`);
        rg.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
      }
      ctx.fillStyle = rg;
      if (b.blob) {
        // Organic, non-circular cloud: the gradient still falls off radially
        // (so colour/brightness reads the same as a plain dab), but it's
        // clipped through a wobbly closed path instead of a perfect circle —
        // real dust/nebulosity is torn and lumpy, not a disc, and this is
        // what keeps individual dabs from reading as "spots" once you're
        // zoomed in close enough to see one on its own.
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(b.rot || 0); if (b.sq != null) ctx.scale(1, b.sq);
        drawBlobPath(ctx, rpx, b.blob);
        ctx.fill();
        ctx.restore();
      } else if (b.sq != null) {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(b.rot || 0); ctx.scale(1, b.sq);
        ctx.beginPath(); ctx.arc(0, 0, rpx, 0, 6.2832); ctx.fill();
        ctx.restore();
      } else {
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.beginPath(); ctx.arc(0, 0, rpx, 0, 6.2832); ctx.fill();
        ctx.restore();
      }
    }
    if (composite) ctx.restore();
  }

  // Deterministic pseudo-random (not Math.random) so the field is fixed once
  // and reproducible — same shape every reload, like the real sky.
  let _mwSeed = 1;
  function mrand() { _mwSeed = (_mwSeed * 16807) % 2147483647; return (_mwSeed - 1) / 2147483646; }

  // A closed, wobbly path through `n` radius multipliers spaced evenly in
  // angle, smoothed with quadratic curves through their midpoints (classic
  // "organic blob" construction) — cheap, and avoids the perfectly round
  // silhouette a plain arc() always has, however soft its gradient is.
  function drawBlobPath(ctx, rpx, blob) {
    const n = blob.length;
    const pts = new Array(n);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * 6.2832;
      const r = rpx * blob[i];
      pts[i] = [Math.cos(ang) * r, Math.sin(ang) * r];
    }
    ctx.beginPath();
    const first = pts[0], last = pts[n - 1];
    ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
    for (let i = 0; i < n; i++) {
      const cur = pts[i], next = pts[(i + 1) % n];
      ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2);
    }
    ctx.closePath();
  }

  // A fixed set of small, reusable irregular-radius profiles (rather than a
  // fresh random array per dab) — plenty of shape variety across thousands
  // of dabs without the extra per-dab array cost mattering.
  const BLOB_PROFILES = (() => {
    const profiles = [];
    for (let p = 0; p < 10; p++) {
      const n = 6 + (p % 3);
      const arr = new Array(n);
      for (let i = 0; i < n; i++) arr[i] = 0.62 + mrand() * 0.7;
      profiles.push(arr);
    }
    return profiles;
  })();
  function pickBlob() { return BLOB_PROFILES[Math.floor(mrand() * BLOB_PROFILES.length)]; }

  // width profile of the band (deg, 1-sigma) at galactic longitude l —
  // widest and brightest through the core, narrowing toward the anti-centre.
  function mwCoreFactor(l) {
    const dl = Math.min(l, 360 - l);
    return Math.exp(-(dl * dl) / (2 * 55 * 55));
  }

  // Main wash: a dense 2D grid over (l, b) so the band has real width, not
  // just a wobbling centreline. ~2° steps in l, several jittered samples in b
  // per step weighted toward the centre — thousands of small, cheap, heavily
  // overlapping dabs that blend into one continuous glow.
  const MW_WASH = (() => {
    const arr = [];
    const NL = 190;
    for (let i = 0; i < NL; i++) {
      const l = (i / NL) * 360;
      const core = mwCoreFactor(l);
      const centreline = Math.sin(l * 0.11) * 1.4 + Math.sin(l * 0.4) * 0.6;   // organic waviness
      const halfWidth = 5 + core * 11;                                         // deg, 1-sigma-ish
      const samples = 3 + Math.round(core * 4);
      for (let s = 0; s < samples; s++) {
        const b = centreline + (mrand() - 0.5) * 2 * halfWidth * Math.sqrt(mrand());
        const [ra, dec] = galToEq(l, b);
        // Real Milky Way photos read warm (star-cloud light) toward the core
        // and cool blue-grey out toward the arms — not a single flat hue.
        // Chance of a warm dab rises with core proximity instead of being
        // fixed, so the core/arm colour gradient falls out naturally.
        const warm = mrand() < 0.15 + core * 0.55;
        arr.push({
          ra, dec,
          r: 2.6 + core * 3.2 + mrand() * 2.2,
          a: (0.011 + core * 0.016 + mrand() * 0.008),
          col: warm ? MW_WARM_COL : MW_HAZE_COL,
        });
      }
    }
    return arr;
  })();

  // Patchy brightness texture — bigger, softer clumps that give the band
  // real mottled structure (the real Milky Way is patchy star-cloud texture,
  // not a uniform wash) — visibly stronger contrast than the base wash so it
  // actually reads after the anti-dither blur softens it back down.
  const MW_MOTTLE = (() => {
    const arr = [];
    for (let i = 0; i < 220; i++) {
      const l = mrand() * 360;
      const core = mwCoreFactor(l);
      if (mrand() > 0.3 + core * 0.6) continue;               // sparser away from the core
      const centreline = Math.sin(l * 0.11) * 1.4 + Math.sin(l * 0.4) * 0.6;
      const b = centreline + (mrand() - 0.5) * 2 * (4 + core * 8);
      const [ra, dec] = galToEq(l, b);
      const warm = mrand() < 0.2 + core * 0.5;
      arr.push({ ra, dec, r: 3 + mrand() * 6, a: 0.02 + core * 0.02 + mrand() * 0.035, col: warm ? MW_WARM_COL2 : MW_HAZE_COL2, blob: pickBlob() });
    }
    return arr;
  })();

  // Bright warm core-region glow — the real Sagittarius/Scutum star clouds.
  const MW_CORE = (() => {
    const arr = [];
    for (let i = 0; i < 34; i++) {
      const l = (mrand() - 0.5) * 44;
      const b = (mrand() - 0.5) * 8;
      const [ra, dec] = galToEq((l + 360) % 360, b);
      arr.push({ ra, dec, r: 3 + mrand() * 5, a: 0.022 + mrand() * 0.03 });
    }
    return arr;
  })();

  // Orange/brown dust clouds — real coloured nebulosity, not just a
  // brightness gradient, scattered across a much wider stretch of the band
  // than the tight core glow above (real dust clouds run the whole length of
  // the Milky Way, not just the Sagittarius direction). Bigger, patchier
  // blobs than the wash/mottle layers so they read as distinct cloud
  // structure once you're zoomed in on a stretch of the band, the way a real
  // wide-field photo shows rust-coloured clouds threaded through the glow.
  const MW_DUST_CLOUDS = (() => {
    const arr = [];
    for (let i = 0; i < 130; i++) {
      const l = mrand() * 360;
      const core = mwCoreFactor(l);
      if (mrand() > 0.22 + core * 0.7) continue;                    // still core-biased, but reaches much further round the band
      const centreline = Math.sin(l * 0.11) * 1.4 + Math.sin(l * 0.4) * 0.6;
      const b = centreline + (mrand() - 0.5) * 2 * (4.5 + core * 7);
      const [ra, dec] = galToEq(l, b);
      const shade = mrand() < 0.5;
      arr.push({ ra, dec, r: 3.5 + mrand() * 7.5, a: 0.018 + core * 0.02 + mrand() * 0.026, col: shade ? MW_DUST_ORANGE : MW_DUST_ORANGE2, blob: pickBlob() });
    }
    return arr;
  })();

  // Dark "holes" within/around the dust clouds — the same clouds that glow
  // orange from starlight also block the light behind them, so real photos
  // show dark gaps and torn edges right next to the bright cloud colour, not
  // a uniform tint. Multiplied in like the rift, but smaller and scattered
  // rather than one continuous lane.
  const MW_DUST_HOLES = (() => {
    const arr = [];
    for (let i = 0; i < 90; i++) {
      const l = mrand() * 360;
      const core = mwCoreFactor(l);
      if (mrand() > 0.25 + core * 0.65) continue;
      const centreline = Math.sin(l * 0.11) * 1.4 + Math.sin(l * 0.4) * 0.6;
      const b = centreline + (mrand() - 0.5) * 2 * (5 + core * 7);
      const [ra, dec] = galToEq(l, b);
      arr.push({ ra, dec, r: 1.5 + mrand() * 3.5, a: 0.05 + core * 0.05 + mrand() * 0.05, blob: pickBlob() });
    }
    return arr;
  })();

  // Dust-lane ribbon: a narrower, darker line that wobbles independently of
  // the main wash's centreline so it reads as a distinct rift running
  // through (not exactly under) the brightest part of the band — noticeably
  // higher contrast than before so the Great Rift actually reads as a dark
  // lane cutting through the glow (as in every real wide-field Milky Way
  // photo) instead of disappearing once blurred.
  const MW_RIFT = (() => {
    const arr = [];
    const N = 260;
    for (let i = 0; i < N; i++) {
      const l = (i / N) * 360;
      const dl = Math.min(l, 360 - l);
      if (dl > 130) continue;                                       // fades out on the dim far side, like the real rift
      const wobble = Math.sin(l * 0.09 + 1.3) * 1.6 + Math.sin(l * 0.31) * 0.7;
      const [ra, dec] = galToEq(l, wobble);
      const core = mwCoreFactor(l);
      arr.push({ ra, dec, r: 1.8 + core * 1.6 + mrand() * 2.2, a: 0.11 + core * 0.09 + mrand() * 0.08 });
    }
    return arr;
  })();

  // Fine dark filaments branching off the rift/dust clouds — small, scattered
  // (not a clean continuous line, unlike MW_RIFT) so the torn, wispy edges of
  // real dust clouds show up once you zoom into a stretch of the band,
  // instead of the dust lane reading as one smooth-edged ribbon.
  const MW_FILAMENTS = (() => {
    const arr = [];
    for (let i = 0; i < 460; i++) {
      const l = mrand() * 360;
      const dl = Math.min(l, 360 - l);
      if (dl > 140) continue;
      const core = mwCoreFactor(l);
      if (mrand() > 0.35 + core * 0.55) continue;
      const wobble = Math.sin(l * 0.09 + 1.3) * 1.6 + Math.sin(l * 0.31) * 0.7;
      const b = wobble + (mrand() - 0.5) * 2 * (2.5 + core * 3.5);
      const [ra, dec] = galToEq(l, b);
      // stretched/rotated (not circular) so a stack of these reads as torn
      // wispy tendrils rather than a row of soft dark dots
      arr.push({ ra, dec, r: 0.7 + mrand() * 2.4, a: 0.09 + core * 0.08 + mrand() * 0.1, sq: 0.25 + mrand() * 0.35, rot: mrand() * 6.2832, blob: pickBlob() });
    }
    return arr;
  })();

  // Fine-scale texture — a much smaller dab radius (well under a degree)
  // than every layer above, so there's actual sub-structure left to resolve
  // once the FOV drops low enough to zoom into a single stretch of the band.
  // Without this, every layer's dabs are several degrees across, so zooming
  // in just magnifies the same blobs rather than revealing more detail —
  // which is what read as "flat"/undetailed at close range. Mixes warm, cool
  // and dark dabs so it reads as texture, not a uniform tint; stretched into
  // short streaks (not circles) and rendered with the sharper falloff (see
  // paintGauss's `sharp` mode) so individual dabs stay visible as grain
  // instead of the usual heavy overlap averaging into a smooth wash — that
  // averaging is exactly what made zoomed-in detail disappear before.
  const MW_FINE_TEXTURE = (() => {
    const arr = [];
    for (let i = 0; i < 2200; i++) {
      const l = mrand() * 360;
      const core = mwCoreFactor(l);
      const centreline = Math.sin(l * 0.11) * 1.4 + Math.sin(l * 0.4) * 0.6;
      const b = centreline + (mrand() - 0.5) * 2 * (5 + core * 8) * Math.sqrt(mrand());
      const [ra, dec] = galToEq(l, b);
      const roll = mrand();
      const col = roll < 0.3 ? MW_WARM_COL2 : roll < 0.55 ? MW_HAZE_COL2 : MW_DUST_ORANGE2;
      arr.push({ ra, dec, r: 0.3 + mrand() * 0.8, a: 0.045 + core * 0.03 + mrand() * 0.055, col, sq: 0.3 + mrand() * 0.45, rot: mrand() * 6.2832, blob: pickBlob() });
    }
    return arr;
  })();

  // Very fine sub-pixel grain — grit at close range. Kept sparse and dim: in
  // testing, a dense bright grain layer was the main thing that blurred into
  // a flat whitish haze instead of texture, which is what "looks washed out"
  // instead of like a real photo.
  const MW_GRAIN = (() => {
    const arr = [];
    for (let i = 0; i < 700; i++) {
      const l = mrand() * 360;
      const core = mwCoreFactor(l);
      const centreline = Math.sin(l * 0.11) * 1.4 + Math.sin(l * 0.4) * 0.6;
      const b = centreline + (mrand() - 0.5) * 2 * (5.5 + core * 6) * Math.sqrt(mrand());
      const [ra, dec] = galToEq(l, b);
      arr.push({ ra, dec, r: 0.4 + mrand() * 0.7, a: 0.012 + mrand() * 0.02 });
    }
    return arr;
  })();

  // Named H-II emission-region "knots" — real bright star-forming complexes
  // strung along the plane (Sagittarius/Scutum, Carina, Cygnus, Vela, the
  // Cassiopeia/Perseus arm, Monoceros, Norma...) rendered in saturated
  // H-alpha pink with a 'screen' blend on top of everything above. Distinct
  // from the orange/brown dust-cloud palette (MW_DUST_ORANGE) which is
  // reflected/obscuring dust, not glowing ionised gas — real wide-field
  // photos show both colours threaded through the band, not just one. Each
  // real complex is built from several jittered, overlapping sub-blobs so it
  // reads as an irregular gas cloud rather than a glowing disc.
  const MW_KNOT_COL = [255, 92, 122];
  const MW_KNOT_CENTERS = [
    // [l deg, b deg, strength 0-1, radius deg] — approximate real galactic coords
    [0,     -0.4, 1.00, 9],   // Sagittarius/Scutum star clouds — the galactic core
    [287.5, -0.6, 0.95, 7],   // Carina Nebula complex
    [85,     0.0, 0.85, 8],   // Cygnus: North America / Pelican / Gamma Cygni
    [265,   -1.5, 0.55, 6],   // Vela / Gum Nebula
    [135,    1.0, 0.55, 6],   // Perseus arm: Heart & Soul (Cassiopeia)
    [206,   -2.0, 0.55, 5],   // Monoceros: Rosette / Cone
    [27,     0.0, 0.50, 5],   // Scutum star cloud
    [352,   -1.0, 0.60, 6],   // Norma arm: Lobster / Cat's Paw
    [305,    0.2, 0.40, 5],   // Carina-Crux extension
    [99,     4.0, 0.35, 6],   // Cepheus bubble (IC 1396 region)
  ];
  const MW_KNOTS = (() => {
    const arr = [];
    for (const [l0, b0, strength, rad] of MW_KNOT_CENTERS) {
      const subs = 5 + Math.round(strength * 5);
      for (let i = 0; i < subs; i++) {
        const dl = (mrand() - 0.5) * rad * 1.8;
        const db = (mrand() - 0.5) * rad * 1.1;
        const [ra, dec] = galToEq((l0 + dl + 360) % 360, b0 + db);
        arr.push({ ra, dec, r: rad * (0.35 + mrand() * 0.5), a: strength * (0.032 + mrand() * 0.04), blob: pickBlob() });
      }
    }
    return arr;
  })();

  let filler = null;    // extra procedural field stars (not catalog data), denser near the Milky Way
  function prepareFiller() {
    // Bumped up from 10k so a deep zoom actually reveals a proper dust-like
    // speckle of unresolved background stars everywhere on the sky (not just
    // near the galactic plane) — real astrophotos read far busier than the
    // naked-eye catalog alone once you're in close.
    // Bumped again (24k -> 40k) and the away-from-the-plane floor raised
    // (0.12 -> 0.22): the earlier density left visibly empty gaps once
    // zoomed into a region away from the Milky Way band (e.g. Cassiopeia at
    // a tight FOV) — real deep exposures never show truly empty sky.
    const TARGET = 40000;
    const cra = [], sra = [], cdec = [], sdec = [], mag = [], phase = [], col = [];
    let guard = 0;
    while (cra.length < TARGET && guard < TARGET * 6) {
      guard++;
      const ra = Math.random() * 360;
      const dec = Math.asin(Math.random() * 2 - 1) / DEG;   // uniform over the sphere
      const b = galLat(ra, dec);
      const density = 0.22 + 0.78 * Math.exp(-(b * b) / (2 * 8 * 8));   // realistically denser near the galactic plane
      if (Math.random() > density) continue;
      const raR = ra * DEG, decR = dec * DEG;
      cra.push(Math.cos(raR)); sra.push(Math.sin(raR)); cdec.push(Math.cos(decR)); sdec.push(Math.sin(decR));
      mag.push(6.5 + Math.pow(Math.random(), 0.6) * 3.0);   // just past naked-eye limit, skewed faint — deeper tail than before for a proper "dust" layer at close zoom
      phase.push(Math.random() * 6.2832);
      col.push(bv2rgb(Math.random() * 1.6 - 0.25));
    }
    filler = {
      N: cra.length,
      cra: Float64Array.from(cra), sra: Float64Array.from(sra),
      cdec: Float64Array.from(cdec), sdec: Float64Array.from(sdec),
      mag: Float32Array.from(mag), phase: Float32Array.from(phase), col,
    };
  }

  // Crisp dust speckle field — drawn straight onto the visible canvas (like
  // the star filler above), never through the blurred offscreen Milky Way
  // buffers. That distinction is the actual fix for "still blurry": a
  // Gaussian dab is soft *by construction*, no matter how little canvas blur
  // gets layered on top of it, so hundreds of overlapping ones can only ever
  // read as fog. Small solid-edged dots — the same technique that already
  // makes the star field look crisp — read as genuine grain/particles
  // instead, and only need to be biased toward the dust-cloud regions
  // (galactic-plane concentrated, same shape as the wash/cloud layers) and
  // strongly zoom-boosted to work as the "when I zoom in" dust the sky
  // itself doesn't otherwise provide (see the render loop below).
  let mwDust = null;
  function prepareMwDust() {
    const TARGET = 9000;
    const cra = [], sra = [], cdec = [], sdec = [], size = [], phase = [], col = [];
    for (let i = 0; i < TARGET; i++) {
      const l = mrand() * 360;
      const core = mwCoreFactor(l);
      const centreline = Math.sin(l * 0.11) * 1.4 + Math.sin(l * 0.4) * 0.6;
      const b = centreline + (mrand() - 0.5) * 2 * (4.5 + core * 7.5) * Math.sqrt(mrand());
      const [ra, dec] = galToEq(l, b);
      const raR = ra * DEG, decR = dec * DEG;
      cra.push(Math.cos(raR)); sra.push(Math.sin(raR)); cdec.push(Math.cos(decR)); sdec.push(Math.sin(decR));
      size.push(0.35 + Math.pow(mrand(), 1.8) * 2.1);   // px once fully zoomed in — skewed small, a few standouts
      phase.push(mrand() * 6.2832);
      const roll = mrand();
      col.push(roll < 0.32 ? MW_WARM_COL2 : roll < 0.58 ? MW_HAZE_COL2 : roll < 0.8 ? MW_DUST_ORANGE2 : [22, 17, 14]);
    }
    mwDust = {
      N: TARGET,
      cra: Float64Array.from(cra), sra: Float64Array.from(sra),
      cdec: Float64Array.from(cdec), sdec: Float64Array.from(sdec),
      size: Float32Array.from(size), phase: Float32Array.from(phase), col,
    };
  }

  // Whole-sky cosmic dust: unlike mwDust (biased hard to the galactic plane),
  // this is scattered isotropically across the *entire* celestial sphere —
  // "subtle cosmic dust particles drift through the void" needs specks away
  // from the Milky Way band too, not just within it. Kept very sparse and
  // dim (this is background texture, not a second star field) with a slow
  // independent twinkle/size wobble per particle so it reads as drifting
  // motes catching starlight rather than static noise.
  let voidDust = null;
  function prepareVoidDust() {
    const TARGET = 2600;
    const cra = [], sra = [], cdec = [], sdec = [], size = [], phase = [], drift = [], col = [];
    for (let i = 0; i < TARGET; i++) {
      const ra = mrand() * 360;
      const dec = Math.asin(mrand() * 2 - 1) / DEG;   // uniform over the whole sphere, no galactic-plane bias
      const raR = ra * DEG, decR = dec * DEG;
      cra.push(Math.cos(raR)); sra.push(Math.sin(raR)); cdec.push(Math.cos(decR)); sdec.push(Math.sin(decR));
      size.push(0.3 + Math.pow(mrand(), 2.0) * 1.5);   // skewed small — a few faint standouts, mostly tiny grain
      phase.push(mrand() * 6.2832);
      drift.push(0.5 + mrand() * 1.2);                  // per-particle twinkle speed so the field doesn't pulse in unison
      const roll = mrand();
      col.push(roll < 0.5 ? [200, 210, 230] : roll < 0.8 ? MW_HAZE_COL2 : [30, 24, 20]);
    }
    voidDust = {
      N: TARGET,
      cra: Float64Array.from(cra), sra: Float64Array.from(sra),
      cdec: Float64Array.from(cdec), sdec: Float64Array.from(sdec),
      size: Float32Array.from(size), phase: Float32Array.from(phase), drift: Float32Array.from(drift), col,
    };
  }

  // Every unique vertex used by the constellation stick-figures, deduped by
  // position. CONST_LINES comes from a separate stick-figure dataset
  // (d3-celestial) keyed purely by RA/Dec, not by star ID — so its vertices
  // don't reliably line up with an entry in the star catalog, and stick
  // figures were rendering as lines floating with no stars marking their own
  // joints. Drawing a small dot at each vertex directly from this data
  // guarantees every line actually connects visible stars, regardless of
  // what the catalog happens to contain nearby.
  let constVerts = null;
  function prepareConstVerts() {
    const seen = new Set();
    const arr = [];
    for (const cid in window.CONST_LINES) {
      for (const seg of window.CONST_LINES[cid]) {
        for (const pt of seg) {
          const key = pt[0].toFixed(2) + ',' + pt[1].toFixed(2);
          if (seen.has(key)) continue;
          seen.add(key);
          arr.push({ ra: pt[0], dec: pt[1] });
        }
      }
    }
    constVerts = arr;
  }

  // Hidden offscreen canvas the Milky Way's diffuse layers are painted onto
  // before being blur-composited onto the sky (see draw()) — cached and only
  // resized when the viewport size actually changes. Rendered at the same
  // device-pixel resolution as the main canvas (not just its CSS size), and
  // with the same dpr transform, so the blur composite doesn't also blur in
  // an unintended resolution downgrade on high-DPI screens.
  // `slot` distinguishes the base-glow buffer from the fine-detail buffer
  // (see draw()) — two separate offscreens so each can get its own blur
  // amount without either bleeding into the other's cached canvas.
  const mwOffscreens = {};
  function getMwOffscreen(W, H, slot) {
    slot = slot || 'base';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(W * dpr)), ph = Math.max(1, Math.round(H * dpr));
    let mwOff = mwOffscreens[slot];
    if (!mwOff || mwOff.canvas.width !== pw || mwOff.canvas.height !== ph) {
      const canvas = document.createElement('canvas');
      canvas.width = pw; canvas.height = ph;
      const ctx = canvas.getContext('2d');
      mwOff = mwOffscreens[slot] = { canvas, ctx };
    }
    mwOff.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return mwOff;
  }

  function prepare() {
    const D = window.STAR_DATA, N = D.length;
    const cra = new Float64Array(N), sra = new Float64Array(N),
          cdec = new Float64Array(N), sdec = new Float64Array(N),
          mag = new Float32Array(N), phase = new Float32Array(N);
    const col = new Array(N);
    for (let i = 0; i < N; i++) {
      const ra = D[i][0] * DEG, dec = D[i][1] * DEG;
      cra[i] = Math.cos(ra); sra[i] = Math.sin(ra);
      cdec[i] = Math.cos(dec); sdec[i] = Math.sin(dec);
      mag[i] = D[i][2];
      phase[i] = (i * 2654435761 % 1000) / 1000 * 6.2832;   // deterministic pseudo-random twinkle phase
      const c = bv2rgb(D[i][3]);
      col[i] = c;
    }
    stars = { N, cra, sra, cdec, sdec, mag, col, phase };
  }

  // ---- projection context built once per frame ----
  function makeProjector(state, W, H) {
    const jd = Astro.julianDate(state.date);
    const lstDeg = Astro.lst(jd, state.location.lon);
    const lat = state.location.lat;
    const cLat = Math.cos(lat * DEG), sLat = Math.sin(lat * DEG);
    const lstR = lstDeg * DEG, cLST = Math.cos(lstR), sLST = Math.sin(lstR);

    // view frame from center alt/az
    const a = state.center.alt * DEG, z = state.center.az * DEG;
    const ca = Math.cos(a), sa = Math.sin(a), cz = Math.cos(z), sz = Math.sin(z);
    // Fwd, Up, Right in (E,N,U) coords
    const F = [ca * sz, ca * cz, sa];
    const U = [-sa * sz, -sa * cz, ca];
    const R = [cz, -sz, 0];
    const cx = W / 2, cy = H / 2;
    const minDim = Math.min(W, H);
    const f = (minDim / 2) / Math.tan((state.fov / 2) * DEG / 2); // stereographic focal

    // eq (precomputed cos/sin) -> screen. Returns null if culled. Shared fast
    // path for both the real catalog and the procedural filler field.
    function projTrig(cra_, sra_, cdec_, sdec_) {
      const cH = cLST * cra_ + sLST * sra_;
      const sH = sLST * cra_ - cLST * sra_;
      const E = cdec_ * sH;
      const Nn = cLat * sdec_ - sLat * cdec_ * cH;
      const Uu = sLat * sdec_ + cLat * cdec_ * cH;
      const Vz = E * F[0] + Nn * F[1] + Uu * F[2];
      if (Vz < -0.4) return null;
      const Vx = E * R[0] + Nn * R[1] + Uu * R[2];
      const Vy = E * U[0] + Nn * U[1] + Uu * U[2];
      const d = 1 + Vz;
      return { x: cx + f * Vx / d, y: cy - f * Vy / d, alt: Uu };
    }
    function projStar(i) { return projTrig(stars.cra[i], stars.sra[i], stars.cdec[i], stars.sdec[i]); }
    function projFiller(i) { return projTrig(filler.cra[i], filler.sra[i], filler.cdec[i], filler.sdec[i]); }
    function projMwDust(i) { return projTrig(mwDust.cra[i], mwDust.sra[i], mwDust.cdec[i], mwDust.sdec[i]); }
    function projVoidDust(i) { return projTrig(voidDust.cra[i], voidDust.sra[i], voidDust.cdec[i], voidDust.sdec[i]); }
    // generic ra/dec (deg) -> screen (+alt/az)
    function projRaDec(raDeg, decDeg) {
      const ra = raDeg * DEG, dec = decDeg * DEG;
      const cd = Math.cos(dec), sd = Math.sin(dec);
      const cra = Math.cos(ra), sra = Math.sin(ra);
      const cH = cLST * cra + sLST * sra, sH = sLST * cra - cLST * sra;
      const E = cd * sH, Nn = cLat * sd - sLat * cd * cH, Uu = sLat * sd + cLat * cd * cH;
      const Vz = E * F[0] + Nn * F[1] + Uu * F[2];
      const Vx = E * R[0] + Nn * R[1] + Uu * R[2];
      const Vy = E * U[0] + Nn * U[1] + Uu * U[2];
      const d = 1 + Vz;
      return { x: cx + f * Vx / d, y: cy - f * Vy / d, alt: Math.asin(Math.max(-1, Math.min(1, Uu))) / DEG,
               az: (Math.atan2(E, Nn) / DEG + 360) % 360, Vz, behind: Vz < -0.4 };
    }
    // alt/az (deg) -> screen
    function projAltAz(altDeg, azDeg) {
      const al = altDeg * DEG, azr = azDeg * DEG;
      const cal = Math.cos(al), sal = Math.sin(al);
      const E = cal * Math.sin(azr), Nn = cal * Math.cos(azr), Uu = sal;
      const Vz = E * F[0] + Nn * F[1] + Uu * F[2];
      const Vx = E * R[0] + Nn * R[1] + Uu * R[2];
      const Vy = E * U[0] + Nn * U[1] + Uu * U[2];
      const d = 1 + Vz;
      return { x: cx + f * Vx / d, y: cy - f * Vy / d, Vz, behind: Vz < -0.4 };
    }
    // screen -> alt/az (deg) for picking / corners
    function unproject(sx, sy) {
      const px = (sx - cx) / f, py = -(sy - cy) / f;
      const r2 = px * px + py * py;
      const Vz = (1 - r2) / (1 + r2), s = 2 / (1 + r2);
      const Vx = px * s, Vy = py * s;
      const E = Vx * R[0] + Vy * U[0] + Vz * F[0];
      const Nn = Vx * R[1] + Vy * U[1] + Vz * F[1];
      const Uu = Vx * R[2] + Vy * U[2] + Vz * F[2];
      return { alt: Math.asin(Math.max(-1, Math.min(1, Uu))) / DEG,
               az: (Math.atan2(E, Nn) / DEG + 360) % 360 };
    }
    // Cheap alt-sign probe for screen -> sky: same math as unproject() but
    // skips the asin/atan2 (only their sign matters for the ground scanline
    // fill, and it runs tens of thousands of times a frame there).
    function unprojectAlt(sx, sy) {
      const px = (sx - cx) / f, py = -(sy - cy) / f;
      const r2 = px * px + py * py;
      const Vz = (1 - r2) / (1 + r2), s = 2 / (1 + r2);
      const Vx = px * s, Vy = py * s;
      return Vx * R[2] + Vy * U[2] + Vz * F[2];   // == sin(alt)
    }
    return { projStar, projFiller, projMwDust, projVoidDust, projRaDec, projAltAz, unproject, unprojectAlt, f, cx, cy, jd, lstDeg, lat };
  }

  // ---- atmospheric extinction: brightness multiplier from airmass ----
  // Real starlight loses ~0.28 mag per airmass to atmospheric absorption/
  // scattering, and airmass grows fast below ~25° altitude (roughly 1/sin(alt)
  // near the zenith, capped near the horizon where the flat-Earth approximation
  // breaks down). Takes sin(altitude) directly since that's what the fast star
  // projection already computes — no extra trig needed per star.
  function extinctionFromSinAlt(sinAlt) {
    if (sinAlt >= 0.42) return 1;             // ~25°+: negligible extinction
    const s = Math.max(sinAlt, 0.03);
    const airmass = Math.min(38, 1 / s);
    return Math.pow(10, -0.28 * (airmass - 1) / 2.5);
  }

  // ---- sky background color from Sun altitude ----
  function skyColors(sunAlt) {
    // returns {top, bottom, starAlpha}
    if (sunAlt > 0) {                       // daytime
      const t = Math.min(1, sunAlt / 30);
      return { top: `rgb(${40 + 30 * t},${90 + 60 * t},${170 + 40 * t})`,
               bottom: `rgb(${120 + 60 * t},${160 + 40 * t},${210 + 30 * t})`, starAlpha: Math.max(0, 0.15 - sunAlt / 40) };
    } else if (sunAlt > -18) {              // twilight
      const t = (sunAlt + 18) / 18;         // 0..1
      const r = Math.round(6 + 40 * t), g = Math.round(10 + 45 * t), b = Math.round(28 + 90 * t);
      return { top: `rgb(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.7)})`,
               bottom: `rgb(${r},${g},${b})`, starAlpha: 1 - 0.85 * t };
    }
    return { top: '#000000', bottom: '#030305', starAlpha: 1 };  // night — true black of space, only the faintest hint of depth at the horizon
  }

  // ---- label collision avoidance ----
  // A label only gets drawn if its approximate bounding box doesn't overlap
  // one already claimed this frame — without this, crowded regions (e.g. the
  // Alpha/Beta Centauri pair) render two names garbled on top of each other.
  // Draw order sets priority: whatever calls this first wins the space, so
  // planets/Sun/Moon > DSOs > named stars (sorted brightest-first) >
  // constellation names, matching how much each actually matters to read.
  function tryLabel(state, ctx, text, x, y) {
    const w = ctx.measureText(text).width;
    const align = ctx.textAlign || 'left';
    const x1 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const x2 = x1 + w, y1 = y - 10, y2 = y + 3;
    const boxes = state._labelBoxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x1 < b.x2 && x2 > b.x1 && y1 < b.y2 && y2 > b.y1) return false;
    }
    boxes.push({ x1, y1, x2, y2 });
    ctx.fillText(text, x, y);
    return true;
  }

  function draw(state, ctx, W, H, sunBody) {
    if (!stars) prepare();
    if (!filler) prepareFiller();
    if (!mwDust) prepareMwDust();
    if (!voidDust) prepareVoidDust();
    if (!constVerts) prepareConstVerts();
    const P = makeProjector(state, W, H);
    const sky = skyColors(sunBody ? sunBody.altaz.alt : -90);
    state._labelBoxes = [];

    // background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, sky.top); grad.addColorStop(1, sky.bottom);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    // ---------- Milky Way band: a dense, continuous glow traced along the
    // real galactic plane — soft base wash, mottled texture, warm core glow,
    // dark rift, fine grain, all pure-Gaussian dabs so nothing reads as an
    // individual dot or puff; only the unresolved-star speckle beneath it
    // (below) is allowed to show as points, and only once zoomed in.
    //
    // These layers are painted onto a hidden offscreen canvas and then
    // composited onto the sky through a small blur, rather than drawn
    // straight onto the visible canvas. Reason: stacking thousands of very
    // low-alpha overlapping radial gradients directly (which is what a
    // smooth, grain-free glow needs) makes Chrome's canvas dither each one
    // to avoid 8-bit banding — and because they all land on the same pixel
    // grid, that dithering compounds into a fixed, visible crosshatch/moiré
    // over the whole band instead of averaging out. A couple of pixels of
    // blur on the composited result erases that high-frequency dither
    // pattern while leaving the (much lower-frequency) band shape intact —
    // exactly what turns "grid of dots" into "smooth photographic glow". ----------
    if (state.layers.milkyway) {
      // Base pass: the big, smooth glow/colour shape (wash, mottle, dust-
      // cloud colour, core, main rift) — this is meant to be soft, so it
      // keeps the heavier blur.
      const off = getMwOffscreen(W, H, 'base');
      off.ctx.clearRect(0, 0, W, H);
      paintGauss(off.ctx, P, state, MW_WASH, MW_HAZE_COL, sky.starAlpha);
      paintGauss(off.ctx, P, state, MW_MOTTLE, MW_HAZE_COL2, sky.starAlpha);
      paintGauss(off.ctx, P, state, MW_DUST_CLOUDS, MW_DUST_ORANGE, sky.starAlpha);   // real coloured (orange/brown) nebulosity, not just brightness
      paintGauss(off.ctx, P, state, MW_CORE, MW_DUST_COL, sky.starAlpha);
      paintGauss(off.ctx, P, state, MW_RIFT, MW_RIFT_COL, sky.starAlpha, 'multiply');
      paintGauss(off.ctx, P, state, MW_KNOTS, MW_KNOT_COL, sky.starAlpha, 'screen');   // real H-alpha emission complexes — glowing gas, not dust
      ctx.save();
      // Trimmed further (1.6px -> 1.1px -> 0.6px): now that the cloud/mottle/
      // core dabs render through drawBlobPath's wobbly silhouette instead of
      // a perfect arc(), their edges are already irregular, which breaks up
      // the flat dithering pattern almost as effectively as blur did — so
      // much less blur is needed to hide it, and the band reads noticeably
      // sharper without the banding coming back.
      ctx.filter = 'blur(0.6px)';
      ctx.drawImage(off.canvas, 0, 0, W, H);
      ctx.restore();

      // Detail pass: fine-scale texture, torn dust-cloud edges and grain —
      // kept in its own buffer with much less blur, and boosted specifically
      // as the FOV drops, so there's something new to resolve as you zoom
      // in rather than the base glow above just getting bigger. Stacking
      // many soft overlapping dabs mathematically tends toward a smooth
      // field no matter how little blur is applied on top (that's what
      // "detail disappears at close range" actually was), so this also
      // relies on paintGauss's `sharp` falloff + the streaked (non-circular)
      // dabs defined for these layers to keep individual dabs visible as
      // grain instead of averaging away.
      const detailT = Math.max(0, Math.min(1, (80 - state.fov) / 70));   // 0 at fov>=80 (wide), 1 at fov<=10 (zoomed in) — starts ramping earlier than before
      const detailBoost = (0.55 + 1.7 * detailT) * sky.starAlpha;
      const off2 = getMwOffscreen(W, H, 'detail');
      off2.ctx.clearRect(0, 0, W, H);
      paintGauss(off2.ctx, P, state, MW_FINE_TEXTURE, MW_WARM_COL2, detailBoost, null, true);
      paintGauss(off2.ctx, P, state, MW_DUST_HOLES, MW_RIFT_COL, sky.starAlpha, 'multiply');
      paintGauss(off2.ctx, P, state, MW_FILAMENTS, MW_FIL_COL, detailBoost, 'multiply', true);
      paintGauss(off2.ctx, P, state, MW_GRAIN, MW_HAZE_COL, detailBoost);
      ctx.save();
      // As little blur as we can get away with — down from 0.25px, for the
      // same reason as the base pass above (blob silhouettes on the dust-
      // hole/filament dabs already break up the dither pattern). This
      // buffer only carries the fine/sharp-falloff layers, which is what
      // makes going this low safe (the moiré risk is worse the more
      // overlapping soft dabs share the buffer; keeping the smooth wash out
      // of it in the base pass above is what earns back this headroom).
      ctx.filter = 'blur(0.12px)';
      ctx.drawImage(off2.canvas, 0, 0, W, H);
      ctx.restore();

      // Dust speckle field — small solid-edged dots drawn straight onto the
      // visible canvas, no blur pass at all (see prepareMwDust for why this
      // is what actually reads as crisp "dust particles" rather than another
      // shade of fog). Effectively invisible at the default wide view and
      // ramps in hard toward max zoom — this is specifically what "no dust
      // particles when I zoom in" was missing, since every other Milky Way
      // layer above is a soft glow by construction.
      const dustT = Math.max(0, Math.min(1, (70 - state.fov) / 65));   // 0 at fov>=70, 1 at fov<=5
      const dustAlphaScale = (0.05 + 1.1 * dustT) * sky.starAlpha;
      const dustSizeScale = 0.5 + 1.5 * dustT;
      if (dustAlphaScale > 0.015) {
        const now = performance.now();
        for (let i = 0; i < mwDust.N; i++) {
          const p = P.projMwDust(i);
          if (!p) continue;
          if (state.layers.ground && p.alt < -0.02) continue;
          if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
          const rad = mwDust.size[i] * dustSizeScale;
          if (rad < 0.3) continue;
          let alpha = dustAlphaScale * (0.35 + 0.65 * (mwDust.size[i] / 2.45));
          alpha *= 0.8 + 0.2 * Math.sin(now / 260 + mwDust.phase[i]);
          if (alpha < 0.02) continue;
          const c = mwDust.col[i];
          ctx.beginPath();
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, alpha).toFixed(3)})`;
          ctx.arc(p.x, p.y, rad, 0, 6.2832); ctx.fill();
        }
      }
    }

    // ---------- unresolved background star field ("dust") ----------
    // Procedural filler stars (see prepareFiller — denser near the galactic
    // plane but present across the whole sky), rendered independently of the
    // Milky Way toggle so the sky still gets richer as you zoom in even with
    // that layer off. At wide FOV these merge into a smooth glow (like a
    // real photograph or Stellarium's Milky Way texture) — both size and
    // opacity shrink well below one pixel — and only grow into individually
    // visible dust-like pinpricks once you're zoomed in far enough to
    // actually resolve them, continuing to intensify all the way in to the
    // FOV slider's minimum for a genuinely busy deep-zoom starfield.
    if (state.layers.stars) {
      const zoomT = Math.max(0, Math.min(1, (60 - state.fov) / 58));   // 0 at fov>=60 (wide), 1 at fov<=2 (max zoom)
      const fillerSizeScale = 0.14 + 0.95 * zoomT;
      const fillerAlphaScale = 0.12 + 1.05 * zoomT;
      if (fillerAlphaScale > 0.02) {
        const now = performance.now();
        for (let i = 0; i < filler.N; i++) {
          const p = P.projFiller(i);
          if (!p) continue;
          if (state.layers.ground && p.alt < -0.02) continue;
          if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
          const m = filler.mag[i];
          const rad = Math.max(0.15, (9.6 - m) * 0.3) * fillerSizeScale;
          let alpha = sky.starAlpha * fillerAlphaScale * 0.42 * Math.max(0.12, (9.8 - m) / 9.8);
          alpha *= 0.82 + 0.18 * Math.sin(now / 300 + filler.phase[i]);
          if (alpha < 0.02) continue;
          // dimmed ~15% off the raw catalog colour — at full brightness these
          // skew near-white and, in the numbers needed to suggest unresolved
          // starlight, wash the band out pale instead of reading as texture
          const c = filler.col[i];
          const aClamped = Math.min(1, alpha);
          // brighter tail of the field gets a soft glow halo once zoomed in
          // enough for it to matter — the flat pinpricks alone read as noise;
          // a little bloom is what actually sells "faint background star"
          if (rad > 1.1 && m < 7.6) {
            const gr = rad * 2.6;
            const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr);
            glow.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${(aClamped * 0.35).toFixed(3)})`);
            glow.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
            ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(p.x, p.y, gr, 0, 6.2832); ctx.fill();
          }
          ctx.beginPath();
          ctx.fillStyle = `rgba(${Math.round(c[0] * 0.85)},${Math.round(c[1] * 0.85)},${Math.round(c[2] * 0.85)},${aClamped.toFixed(3)})`;
          ctx.arc(p.x, p.y, rad, 0, 6.2832); ctx.fill();
        }
      }

      // ---------- whole-sky cosmic dust motes ----------
      // Present at every FOV (not just deep zoom) and everywhere on the sky
      // (not just near the galactic plane, unlike mwDust above) — faint
      // drifting specks that catch a little light, adding depth/texture to
      // the void itself rather than only to the Milky Way band.
      const now2 = performance.now();
      for (let i = 0; i < voidDust.N; i++) {
        const p = P.projVoidDust(i);
        if (!p) continue;
        if (state.layers.ground && p.alt < -0.02) continue;
        if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
        const sizeT = Math.max(0.55, Math.min(2.4, 60 / state.fov));   // gently larger as you zoom in, never dominant
        const rad = voidDust.size[i] * sizeT;
        let alpha = sky.starAlpha * 0.16 * (0.3 + 0.7 * (voidDust.size[i] / 1.8));
        alpha *= 0.75 + 0.25 * Math.sin(now2 / (900 / voidDust.drift[i]) + voidDust.phase[i]);   // slow, per-particle drift/twinkle
        if (alpha < 0.02) continue;
        const c = voidDust.col[i];
        ctx.beginPath();
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, alpha).toFixed(3)})`;
        ctx.arc(p.x, p.y, rad, 0, 6.2832); ctx.fill();
      }

      // ---------- deep-zoom procedural dust (screen-space-constant density) ----------
      // filler/mwDust/voidDust above are each a *fixed* pool of points spread
      // across the whole sphere, so the number actually inside the view
      // necessarily collapses as FOV shrinks — visible solid angle falls off
      // with fov^2, so a view a few degrees wide only ever contains a
      // handful of them no matter how large the pool is (this is what "still
      // empty" at deep zoom actually was — not too few stars generated, too
      // few of them landing in a tiny visible patch of a big fixed sphere).
      // This layer instead has no stored pool at all: each point is derived
      // on demand from a deterministic hash of its RA/Dec grid cell, and the
      // cell size is kept proportional to the *current* FOV (~200 cells
      // across the view, always) — so the on-screen density of specks stays
      // roughly constant regardless of zoom level, the way resolving power
      // actually works in a real deep exposure, instead of thinning out.
      if (state.fov < 46) {
        const [raC, decC] = eqFromAltAz(state.center.alt, state.center.az, state.location.lat, P.lstDeg);
        const cellDeg = Math.max(0.008, state.fov / 130);
        const iRaCenter = Math.floor(raC / cellDeg);
        const iDecCenter = Math.floor(decC / cellDeg);
        const fadeT = Math.max(0, Math.min(1, (46 - state.fov) / 40));   // ramps in below fov 46, full by ~fov 6
        const R = 100;   // grid radius in cells — bounds this to a fixed (2R+1)^2 iterations regardless of fov/declination
        for (let dj = -R; dj <= R; dj++) {
          const jd = iDecCenter + dj;
          const cellDec = (jd + 0.5) * cellDeg;
          if (cellDec < -90 || cellDec > 90) continue;
          for (let di = -R; di <= R; di++) {
            const ir = iRaCenter + di;
            if (hashN(ir, jd, 1) > 0.5) continue;   // ~half of cells carry a speck
            const cellRa = (((ir + 0.5) * cellDeg) % 360 + 360) % 360;
            const ra = (cellRa + (hashN(ir, jd, 2) - 0.5) * cellDeg * 0.9 + 360) % 360;
            const dec = Math.max(-90, Math.min(90, cellDec + (hashN(ir, jd, 3) - 0.5) * cellDeg * 0.9));
            const p = P.projRaDec(ra, dec);
            if (p.behind || (state.layers.ground && p.alt < -0.02)) continue;
            if (p.x < -2 || p.x > W + 2 || p.y < -2 || p.y > H + 2) continue;
            const mroll = hashN(ir, jd, 4);
            const rad = 0.35 + Math.pow(mroll, 2.2) * 1.15;
            const alpha = sky.starAlpha * fadeT * (0.18 + 0.55 * (1 - mroll));
            if (alpha < 0.02) continue;
            const croll = hashN(ir, jd, 5);
            const c2 = croll < 0.55 ? [225, 230, 245] : croll < 0.8 ? [255, 214, 170] : [180, 200, 255];
            ctx.beginPath();
            ctx.fillStyle = `rgba(${c2[0]},${c2[1]},${c2[2]},${Math.min(1, alpha).toFixed(3)})`;
            ctx.arc(p.x, p.y, rad, 0, 6.2832); ctx.fill();
          }
        }
      }
    }

    // ---------- stars ----------
    const zoomBoost = Math.max(0.7, Math.min(2.2, 60 / state.fov));
    if (state.layers.stars) {
      const now = performance.now();
      for (let i = 0; i < stars.N; i++) {
        const p = P.projStar(i);
        if (!p) continue;
        if (state.layers.ground && p.alt < -0.02) continue;
        if (p.x < -5 || p.x > W + 5 || p.y < -5 || p.y > H + 5) continue;
        const m = stars.mag[i];
        let rad = (MAGLIMIT - m) * 0.42 * zoomBoost;
        if (rad < 0.35) rad = 0.35;
        let alpha = sky.starAlpha * Math.min(1, Math.max(0.4, (MAGLIMIT + 0.6 - m) / (MAGLIMIT + 0.6)));
        // atmospheric extinction: real starlight dims (and reddens) with airmass
        // as altitude drops, not just at the ground-clipped horizon line — this
        // is what makes stars visibly fade and warm up as they rise/set instead
        // of holding full brightness right up to the cutoff. p.alt here is
        // sin(altitude) (see projTrig), which is exactly what airmass needs.
        const ext = extinctionFromSinAlt(p.alt);
        alpha *= ext;
        if (alpha < 0.03) continue;
        // gentle atmospheric twinkle on fainter stars only (bright stars stay steady)
        if (m > 1.2) alpha *= 0.86 + 0.14 * Math.sin(now / 260 + stars.phase[i]);
        let c = stars.col[i];
        if (ext < 0.94) {
          const t = Math.min(1, (1 - ext) * 1.15);
          c = [c[0] + (255 - c[0]) * t * 0.35, c[1] + (140 - c[1]) * t * 0.35, c[2] + (70 - c[2]) * t * 0.35];
        }
        // Halo/spikes are an artistic point-spread-function effect, not real
        // size (stars are true point sources) — so unlike the star's own
        // solid disk, their radius is allowed to keep growing the closer you
        // zoom in on one, uncapped, to get the big glowing-ball look of a
        // bright star seen up close through a real eyepiece/telescope photo.
        const haloZoom = m < 2.3 ? Math.max(1, Math.min(55, 45 / state.fov)) : 1;
        if (m < 2.3) {
          const gr = rad * 3.4 * haloZoom;
          // outer soft halo
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr);
          glow.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${(alpha * 0.4).toFixed(3)})`);
          glow.addColorStop(0.55, `rgba(${c[0]},${c[1]},${c[2]},${(alpha * 0.14).toFixed(3)})`);
          glow.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(p.x, p.y, gr, 0, 6.2832); ctx.fill();
          if (haloZoom > 4) {
            // once zoomed in a bit: a brighter inner glow ring, and a faint
            // visible boundary line at the halo's edge — the "onion ring"
            // look of a real bright-star photo, not just a smooth blur
            const gr2 = gr * 0.4;
            const glow2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr2);
            glow2.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${(alpha * 0.55).toFixed(3)})`);
            glow2.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
            ctx.fillStyle = glow2;
            ctx.beginPath(); ctx.arc(p.x, p.y, gr2, 0, 6.2832); ctx.fill();
            ctx.beginPath(); ctx.arc(p.x, p.y, gr * 0.85, 0, 6.2832);
            ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(alpha * 0.1).toFixed(3)})`;
            ctx.lineWidth = Math.max(1, gr * 0.025);
            ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
        ctx.arc(p.x, p.y, rad, 0, 6.2832);
        ctx.fill();
        // fine diffraction spikes on the handful of brightest stars in the sky
        if (m < 0.3) {
          ctx.save();
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(alpha * 0.55).toFixed(3)})`;
          ctx.lineWidth = 0.75;
          const s = rad * 5.5 * Math.max(1, haloZoom * 0.7);
          ctx.beginPath();
          ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y);
          ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x, p.y + s);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // ---------- constellation lines ----------
    // Dimmer and thinner than before — real star charts keep the connecting
    // lines as a quiet reference, not competing for attention with the stars.
    if (state.layers.constellations) {
      ctx.strokeStyle = 'rgba(90,150,220,0.30)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (const cid in window.CONST_LINES) {
        for (const seg of window.CONST_LINES[cid]) {
          let started = false, prev = null;
          for (const pt of seg) {
            const p = P.projRaDec(pt[0], pt[1]);
            if (p.behind || (state.layers.ground && p.alt < -1)) { started = false; prev = p; continue; }
            if (!started || !prev || Math.hypot(p.x - prev.x, p.y - prev.y) > Math.min(W, H)) {
              ctx.moveTo(p.x, p.y); started = true;
            } else ctx.lineTo(p.x, p.y);
            prev = p;
          }
        }
      }
      ctx.stroke();

      // guaranteed star marker at every stick-figure joint (see prepareConstVerts) —
      // a small soft dot, styled like a faint catalog star, so the lines always
      // read as connecting real points of light instead of floating in space
      ctx.fillStyle = 'rgba(215,225,255,0.8)';
      for (const v of constVerts) {
        const p = P.projRaDec(v.ra, v.dec);
        if (p.behind || (state.layers.ground && p.alt < -1)) continue;
        if (p.x < -4 || p.x > W + 4 || p.y < -4 || p.y > H + 4) continue;
        const rad = Math.max(0.6, 0.85 * zoomBoost);
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, 6.2832); ctx.fill();
      }
    }

    // ---------- coordinate grid (alt/az) ----------
    if (state.layers.grid) drawGrid(ctx, P, W, H);

    // ---------- deep-sky objects ----------
    const picks = [];
    if (state.layers.dso) {
      ctx.textAlign = 'left';
      ctx.font = '10px system-ui';
      for (const o of window.DSO_DATA) {
        const p = P.projRaDec(o[1], o[2]);
        if (p.behind || (state.layers.ground && p.alt < 0)) continue;
        if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
        const style = DSO_STYLE[o[4]] || ['#c0d0ff', 'nebula'];
        const dsoObj = { kind: 'dso', name: o[0], ra: o[1], dec: o[2], mag: o[3], type: o[4], common: o[5], desig: o[6], altaz: { alt: p.alt, az: p.az } };
        // soft colour-tinted gas glow, always on for nebula-type objects (not
        // gated behind the close-zoom photo) — the Stellarium/Seestar-atlas
        // "nebula hint" look, so emission/reflection/planetary nebulae read
        // as glowing gas clouds at a glance across the whole sky
        if (style[1] === 'nebula') drawNebulaGlow(ctx, p, DSO_ANGULAR_SIZE[o[4]] || 0.7, o[4], o[0], state, P);
        // real astrophoto once zoomed in close enough for it to be worth it,
        // drawn under the marker/label so those stay readable on top
        if (state.fov < 18) {
          const entry = getDsoImage(dsoObj);
          if (entry) drawDsoImage(ctx, entry, p, DSO_ANGULAR_SIZE[o[4]] || 0.7, P, state);
        }
        // marker glyph only for galaxies, and only once you've zoomed in a
        // little from the default wide view — otherwise it's just clutter of
        // crosshairs/circles over faint objects you can barely see anyway
        if (style[1] === 'galaxy' && state.fov < 55) drawDsoMarker(ctx, p.x, p.y, style);
        picks.push({ x: p.x, y: p.y, r: 9, obj: dsoObj });
        if (state.fov < 45) { ctx.fillStyle = 'rgba(160,190,255,0.7)'; tryLabel(state, ctx, o[0], p.x + 7, p.y + 3); }
      }
    }

    // ---------- Solar system bodies ----------
    if (state.bodies) {
      // annotate every body with current alt/az (used by info & tonight panels)
      for (const b of state.bodies) {
        const aa = P.projRaDec(b.ra, b.dec);
        b.altaz = { alt: aa.alt, az: aa.az };
      }
    }
    if (state.layers.planets && state.bodies) {
      // draw planets + Moon (Sun drawn last so it sits on top)
      for (const b of state.bodies) {
        if (b.name === 'Sun') continue;
        const p = P.projRaDec(b.ra, b.dec);
        if (p.behind || (state.layers.ground && p.alt < -1)) continue;
        drawBody(ctx, b, p, state, P, sky);
        picks.push({ x: p.x, y: p.y, r: 12, obj: Object.assign({ kind: 'planet' }, b, { altaz: { alt: p.alt, az: p.az } }) });
      }
      if (sunBody) {
        const p = P.projRaDec(sunBody.ra, sunBody.dec);
        if (!p.behind && !(state.layers.ground && p.alt < -1)) {
          drawSun(ctx, sunBody, p, state, P);
          picks.push({ x: p.x, y: p.y, r: 16, obj: Object.assign({ kind: 'planet' }, sunBody, { altaz: { alt: p.alt, az: p.az } }) });
        }
      }
    }

    // ---------- star labels (named, bright / zoomed) ----------
    // Sorted brightest-first so that when two named stars sit close together
    // (e.g. Alpha/Beta Centauri), the brighter one claims the label space and
    // the dimmer one is skipped rather than the two rendering garbled on top
    // of each other.
    if (state.layers.labels && state.layers.stars) {
      ctx.font = '11px system-ui'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(220,220,255,0.72)';
      const namedIdx = Object.keys(window.STAR_NAMES).map(Number)
        .filter(i => stars.mag[i] <= 4.5 && !(stars.mag[i] > 2.6 && state.fov > 30))
        .sort((a, b) => stars.mag[a] - stars.mag[b]);
      for (const i of namedIdx) {
        const p = P.projStar(i);
        if (!p || (state.layers.ground && p.alt < 0) || p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
        tryLabel(state, ctx, window.STAR_NAMES[i], p.x + 5, p.y - 4);
      }
    }

    // ---------- constellation labels ----------
    // Lowest label priority — decorative context, so it only fills gaps left
    // by planets, DSOs, and named stars rather than covering them.
    if (state.layers.constLabels) {
      ctx.fillStyle = 'rgba(120,170,235,0.75)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const cid in window.CONST_META) {
        const m = window.CONST_META[cid];
        const p = P.projRaDec(m[1], m[2]);
        if (p.behind || p.alt < 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
        tryLabel(state, ctx, m[0], p.x, p.y);
      }
    }

    // ---------- ground & horizon ----------
    if (state.layers.ground) drawGround(ctx, P, W, H);

    state._picks = picks;
    state._proj = P;
  }

  // ---- grid lines (altitude circles + azimuth meridians) ----
  function drawGrid(ctx, P, W, H) {
    ctx.strokeStyle = 'rgba(80,160,140,0.20)'; ctx.lineWidth = 1;
    for (let alt = -60; alt <= 80; alt += 20) {
      ctx.beginPath(); let started = false, prev = null;
      for (let az = 0; az <= 360; az += 3) {
        const p = P.projAltAz(alt, az);
        if (p.behind) { started = false; prev = p; continue; }
        if (!started || (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > Math.min(W, H))) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
        prev = p;
      }
      ctx.stroke();
    }
    for (let az = 0; az < 360; az += 30) {
      ctx.beginPath(); let started = false, prev = null;
      for (let alt = -10; alt <= 88; alt += 3) {
        const p = P.projAltAz(alt, az);
        if (p.behind) { started = false; prev = p; continue; }
        if (!started || (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > Math.min(W, H))) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
        prev = p;
      }
      ctx.stroke();
    }
  }

  // ---- nebula glow: a soft, colour-tinted gas cloud under every emission/
  // reflection/planetary/supernova-remnant/dark DSO, visible at every zoom
  // level (not just once the close-up DSS photo overlay kicks in) — this is
  // what makes nebulae read as glowing gas at a glance, the way Stellarium's
  // nebula hints and the Seestar Sky Atlas render them, instead of a plain
  // crosshair marker. Reuses the same wobbly drawBlobPath/pickBlob organic-
  // silhouette technique as the Milky Way's dust clouds above — a flat
  // radial-gradient disc is exactly what reads as "pasted on" instead of a
  // real gas cloud. Each object's blob shape + off-centre core knot is
  // generated once (deterministically, seeded off the shared mrand stream)
  // and cached by name, never re-rolled per frame.
  const NEBULA_GLOW_COL = {
    sfr: [255, 100, 130], snr: [190, 120, 235], pn: [120, 255, 205],
    rn: [120, 165, 255], dn: [110, 80, 60], pos: [180, 190, 255],
  };
  const nebulaGlowCache = new Map();
  function nebulaGlowDesc(name) {
    let d = nebulaGlowCache.get(name);
    if (d) return d;
    const n = 8 + Math.floor(mrand() * 5);
    const outer = new Array(n);
    for (let i = 0; i < n; i++) outer[i] = 0.55 + mrand() * 0.75;
    const cn = 6 + Math.floor(mrand() * 3);
    const core = new Array(cn);
    for (let i = 0; i < cn; i++) core[i] = 0.5 + mrand() * 0.6;
    d = { outer, core, ox: (mrand() - 0.5) * 0.32, oy: (mrand() - 0.5) * 0.32 };
    nebulaGlowCache.set(name, d);
    return d;
  }
  function drawNebulaGlow(ctx, p, sizeDeg, type, name, state, P) {
    const rDeg = Math.max(0.35, sizeDeg * 0.85);
    const rpx = P.f * rDeg * DEG;
    if (rpx < 3) return;
    const col = NEBULA_GLOW_COL[type];
    if (!col) return;
    const isDark = type === 'dn';
    // barely-there at the default wide view, richer as you close in; and eases
    // back off once the real DSS photo (fov<18) has taken over so they don't
    // double up and blow out
    const zoomT = Math.max(0, Math.min(1, (120 - state.fov) / 100));
    const photoT = Math.max(0, Math.min(1, (state.fov - 9) / 9));
    const baseA = (isDark ? 0.16 : 0.42) * (0.28 + 0.72 * zoomT) * (isDark ? 1 : (0.4 + 0.6 * photoT));
    if (baseA < 0.015) return;
    const [r, g, b] = col;
    const desc = nebulaGlowDesc(name);
    ctx.save();
    ctx.globalCompositeOperation = isDark ? 'multiply' : 'screen';
    ctx.translate(p.x, p.y);
    // wide, soft outer halo — the wobbly silhouette itself is what blends
    // into the surrounding starfield instead of stopping at a hard edge
    const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, rpx);
    g1.addColorStop(0,    `rgba(${r},${g},${b},${(baseA * 0.8).toFixed(3)})`);
    g1.addColorStop(0.55, `rgba(${r},${g},${b},${(baseA * 0.38).toFixed(3)})`);
    g1.addColorStop(1,    `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = g1;
    drawBlobPath(ctx, rpx, desc.outer);
    ctx.fill();
    // brighter, tighter core knot, off-centre — real nebulae have irregular
    // bright patches, not a concentric bullseye
    const cr = rpx * 0.55;
    if (cr > 1.5) {
      ctx.save();
      ctx.translate(desc.ox * rpx, desc.oy * rpx);
      const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, cr);
      g2.addColorStop(0, `rgba(${r},${g},${b},${(baseA * 0.7).toFixed(3)})`);
      g2.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = g2;
      drawBlobPath(ctx, cr, desc.core);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawDsoMarker(ctx, x, y, style) {
    ctx.strokeStyle = style[0]; ctx.lineWidth = 1.2;
    if (style[1] === 'galaxy') {
      ctx.beginPath(); ctx.ellipse(x, y, 6, 3, Math.PI / 5, 0, 6.2832); ctx.stroke();
    } else if (style[1] === 'cluster') {
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.2832); ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.2832); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke();
    }
  }

  function hex2rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Shades a small disc as a lit sphere — offset highlight + limb darkening —
  // instead of a flat filled circle. Cheap (one radial gradient), but reads
  // as a solid 3D body rather than a dot at these sizes.
  function shadeSphere(ctx, x, y, r, rgb, lx, ly) {
    lx = lx == null ? -0.35 : lx; ly = ly == null ? -0.4 : ly;
    const [br, bg, bb] = rgb;
    const hi = [Math.min(255, br + 95), Math.min(255, bg + 95), Math.min(255, bb + 85)];
    const lo = [Math.round(br * 0.22), Math.round(bg * 0.22), Math.round(bb * 0.3)];
    const grad = ctx.createRadialGradient(x + lx * r, y + ly * r, r * 0.05, x, y, r * 1.05);
    grad.addColorStop(0, `rgb(${hi[0]},${hi[1]},${hi[2]})`);
    grad.addColorStop(0.45, `rgb(${br},${bg},${bb})`);
    grad.addColorStop(1, `rgb(${lo[0]},${lo[1]},${lo[2]})`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }

  // ---- planet marker in "dot" mode (default/wide FOV): a bright point like
  // any other star on the chart, not a rendered 3D body — the sphere/photo
  // treatment below is reserved for once you've actually zoomed in on one. ----
  // Pushed way down from the old 55°/20° band: at the default ~100° FOV (and
  // for most of the zoom range down to ~20°) a planet is genuinely just a
  // point of light, the same way it looks to the naked eye — the rendered
  // sphere/photo should only take over once you've actually zoomed in a lot,
  // which on this app's 2°-160° slider means the last stretch near its
  // minimum, not the wide end.
  const PLANET_DOT_FOV = 8;     // at/above this FOV, planets read as plain dots
  const PLANET_ZOOM_FADE = 12;  // deg of FOV over which the dot <-> sphere swap fades
  function drawPlanetDot(ctx, x, y, rgb, mag, state, sky, alphaMul) {
    const r = Math.max(1.3, Math.min(4.5, (5.5 - mag) * 0.55));
    const [cr, cg, cb] = rgb;
    // Real sky brightness would make these near-invisible in daylight (same as
    // stars), but a planet marker is a UI aid as much as a simulation, so its
    // floor brightness stays well above the star-alpha floor during the day.
    const alpha = Math.max(0.6, sky.starAlpha * 1.2) * alphaMul;
    const dayness = 1 - Math.min(1, sky.starAlpha * 3);   // ~0 at night, ~1 in bright day
    if (dayness > 0.15) {
      // dark contrast ring so the bright marker still reads against a pale-blue daytime sky
      ctx.beginPath(); ctx.arc(x, y, r + 1.6, 0, 6.2832);
      ctx.strokeStyle = `rgba(8,16,34,${(0.4 * dayness * alphaMul).toFixed(3)})`;
      ctx.lineWidth = 1.6; ctx.stroke();
    }
    // No soft outer glow here (removed — it read as a stray halo blob rather
    // than a realistic point of light, especially once a real photo takes
    // over at closer zoom); just the crisp marker dot itself.
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }

  function drawBody(ctx, b, p, state, P, sky) {
    const hex = PLANET_COLORS[b.name] || '#ffffff';
    const rgb = hex2rgb(hex);
    if (b.name === 'Moon') { drawMoon(ctx, b, p, state, P); return; }

    // dotT: 1 = pure dot (default wide view), 0 = pure rendered sphere (zoomed in)
    const dotT = Math.max(0, Math.min(1, (state.fov - PLANET_DOT_FOV) / PLANET_ZOOM_FADE));
    if (dotT > 0.001) drawPlanetDot(ctx, p.x, p.y, rgb, b.mag, state, sky, dotT);
    if (dotT >= 0.999) {
      if (state.layers.labels) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; tryLabel(state, ctx, b.name, p.x + 8, p.y + 4); }
      return;
    }

    ctx.save();
    ctx.globalAlpha = 1 - dotT;
    let r = Math.max(2.2, (5.5 - b.mag) * 1.1);
    r = Math.min(r, 9);
    // real apparent size takes over once it exceeds the default dot — this is
    // what makes "zoom in on a planet" actually work, instead of a fixed-size marker
    const angDeg = planetApparentDeg(b.name, b.dist);
    if (angDeg) {
      // Real planetary angular size is a fraction of a degree — true-scale
      // rendering wouldn't show any growth until zooming far past what the
      // FOV slider (2°-160°) even allows. PLANET_ZOOM amplifies it (uniformly
      // across all planets, so their real relative sizes stay proportional)
      // just enough that "zoom in on a planet" is reachable through the
      // normal UI instead of needing sub-degree FOV.
      const PLANET_ZOOM = 90;
      r = Math.min(200, Math.max(r, (P.f * angDeg * PLANET_ZOOM * DEG) / 2));
    }
    // Real illuminated fraction (Astro.bodies already computes this from Sun
    // elongation for every body, the same way it does for the Moon). Mercury
    // and Venus show genuine crescent/gibbous phases from Earth — a real
    // telescope view of Venus looks nothing like a flat lit ball — and Mars
    // occasionally shows a slight gibbous too; Jupiter/Saturn/Uranus/Neptune
    // are essentially always full (phase > 0.99) so they keep the cheaper
    // flat-lit sphere, which looks identical at that phase anyway.
    const k = typeof b.phase === 'number' ? Math.max(0, Math.min(1, b.phase)) : 1;
    const showPhase = k < 0.97;

    if (showPhase) {
      drawPhasedBody(ctx, b, p, r, rgb, k, state, dotT, P);
    } else {
      // 3D-shaded sphere (directional highlight + limb darkening) instead of a flat disc —
      // stays as the base layer under the photo too, so a body still reads as a
      // correctly-lit sphere at the feathered edge where the photo's alpha fades out
      shadeSphere(ctx, p.x, p.y, r, rgb);
      if (b.name === 'Jupiter' && r > 3) {   // faint cloud-band hint
        ctx.save();
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.clip();
        ctx.strokeStyle = 'rgba(110,80,55,0.32)'; ctx.lineWidth = Math.max(1, r * 0.22);
        for (const dy of [-0.35, 0.05, 0.42]) {
          ctx.beginPath(); ctx.moveTo(p.x - r, p.y + dy * r); ctx.lineTo(p.x + r, p.y + dy * r); ctx.stroke();
        }
        ctx.restore();
      }
      if (b.name === 'Saturn' && r > 3) { // ring hint
        ctx.strokeStyle = hexA('#e8d59a', 0.8); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 2.1, r * 0.7, -0.5, 0, 6.2832); ctx.stroke();
      }
      // Real photo, blended in once you've zoomed in enough to actually resolve
      // it. Drawn with normal alpha compositing (not 'screen') so it reads as
      // an actual surface instead of a washed-out translucent overlay — that
      // 'screen' blend was the main reason zoomed-in planets looked "fake".
      if (r > 22) {
        const entry = getPlanetImage(b.name);
        if (entry) {
          const wPx = r * 2, hPx = wPx * entry.aspect;
          const fadeT = Math.min(1, (r - 22) / 38);
          ctx.save();
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.clip();   // keep the photo inside the disc, matching the shaded sphere's silhouette
          ctx.globalAlpha = fadeT * 0.97 * (1 - dotT);
          ctx.drawImage(entry.masked, p.x - wPx / 2, p.y - hPx / 2, wPx, hPx);
          ctx.restore();
        }
      }
    }
    ctx.restore();
    if (state.layers.labels) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; tryLabel(state, ctx, b.name, p.x + r + 4, p.y + 4); }
  }

  // Phase-correct crescent/gibbous rendering for Mercury/Venus(/Mars), using
  // the same terminator-ellipse technique as drawMoon: rotate so the sunward
  // direction is +x, fill a dim night-side base disc, then clip a lit-side
  // path sized by the real illuminated fraction k. The real photo (once
  // loaded) is clipped to that same lit path, so it only ever shows on the
  // actually-lit crescent/gibbous — not painted across the whole disc.
  function drawPhasedBody(ctx, b, p, r, rgb, k, state, dotT, P) {
    let ang = 0;
    const sun = (state.bodies || []).find(x => x.name === 'Sun');
    if (sun) { const sp = P.projRaDec(sun.ra, sun.dec); ang = Math.atan2(sp.y - p.y, sp.x - p.x); }
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(ang);
    const [br, bg, bb] = rgb;
    // Dark side: was using the Moon's off-centre "earthshine" gradient
    // (bright hotspot offset toward one corner) — physically that's specific
    // to the Moon actually being lit by reflected Earthlight; Mercury/Venus/
    // Mars have no such companion, so the real night side of these is just
    // black. On a bright body like Venus that offset hotspot rendered as an
    // obvious separate pale "ghost" crescent bleeding out near the
    // terminator instead of subtle shading. Centred, much darker, no hotspot.
    const dg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    dg.addColorStop(0, `rgb(${Math.round(br * 0.09)},${Math.round(bg * 0.09)},${Math.round(bb * 0.11)})`);
    dg.addColorStop(1, `rgb(${Math.round(br * 0.04)},${Math.round(bg * 0.04)},${Math.round(bb * 0.05)})`);
    ctx.beginPath(); ctx.fillStyle = dg; ctx.arc(0, 0, r, 0, 6.2832); ctx.fill();
    // lit side: bright limb toward +x (sun), same terminator-ellipse construction as the Moon
    const term = r * (1 - 2 * k);
    const litPath = new Path2D();
    litPath.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    if (term >= 0) litPath.ellipse(0, 0, term, r, 0, Math.PI / 2, -Math.PI / 2, true);
    else litPath.ellipse(0, 0, -term, r, 0, Math.PI / 2, -Math.PI / 2, false);
    litPath.closePath();
    const hi = [Math.min(255, br + 95), Math.min(255, bg + 95), Math.min(255, bb + 85)];
    const lg = ctx.createRadialGradient(r * 0.2, -r * 0.25, 0, 0, 0, r * 1.05);
    lg.addColorStop(0, `rgb(${hi[0]},${hi[1]},${hi[2]})`);
    lg.addColorStop(0.55, `rgb(${br},${bg},${bb})`);
    lg.addColorStop(1, `rgb(${Math.round(br * 0.45)},${Math.round(bg * 0.45)},${Math.round(bb * 0.5)})`);
    ctx.fillStyle = lg; ctx.fill(litPath);
    if (r > 22) {
      const entry = getPlanetImage(b.name);
      if (entry) {
        const wPx = r * 2, hPx = wPx * entry.aspect;
        const fadeT = Math.min(1, (r - 22) / 38);
        ctx.save();
        ctx.clip(litPath);
        ctx.globalAlpha = fadeT * 0.97 * (1 - dotT);
        ctx.drawImage(entry.masked, -wPx / 2, -hPx / 2, wPx, hPx);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // Deterministic sunspot layout (normalized disc coordinates, computed once)
  // — real sunspots move/change day to day so there's nothing to look up,
  // but a fixed procedural set means the Sun always shows *some* believable
  // surface texture immediately, rather than depending entirely on a network
  // photo landing before you look at it. Faded down (not removed) once the
  // real photo takes over so the two don't visibly double up.
  const SUNSPOTS = (() => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const arr = [];
    for (let i = 0; i < 10; i++) {
      const ang = rnd() * 6.2832, rad = 0.12 + rnd() * 0.68;
      arr.push({
        x: Math.cos(ang) * rad, y: Math.sin(ang) * rad,
        size: 0.018 + rnd() * 0.05, squash: 0.55 + rnd() * 0.4, rot: rnd() * 6.2832,
      });
    }
    return arr;
  })();

  function drawSunTexture(ctx, x, y, r, alphaMul) {
    if (r < 9 || alphaMul <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = alphaMul;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.clip();
    // soft granulation mottling — a couple of large, very faint warm/pale
    // patches read as surface texture without needing per-cell detail
    for (const s of [[-0.3, -0.15, 0.55, 'rgba(255,214,140,0.10)'], [0.35, 0.25, 0.5, 'rgba(180,90,30,0.08)'], [0.05, -0.4, 0.4, 'rgba(255,225,170,0.09)']]) {
      const [sx, sy, srr, col] = s;
      const g = ctx.createRadialGradient(x + sx * r, y + sy * r, 0, x + sx * r, y + sy * r, srr * r);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + sx * r, y + sy * r, srr * r, 0, 6.2832); ctx.fill();
    }
    // sunspots: dark umbra core fading through a warmer penumbra, squashed
    // and rotated per-spot for an irregular (not perfectly circular) look
    for (const s of SUNSPOTS) {
      const sx = x + s.x * r, sy = y + s.y * r, sr = Math.max(0.5, s.size * r);
      if (sr < 0.7) continue;   // too small to read as anything but noise
      ctx.save();
      ctx.translate(sx, sy); ctx.rotate(s.rot); ctx.scale(1, s.squash);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sr);
      g.addColorStop(0, 'rgba(50,18,6,0.88)');
      g.addColorStop(0.45, 'rgba(130,60,18,0.55)');
      g.addColorStop(0.8, 'rgba(210,130,45,0.2)');
      g.addColorStop(1, 'rgba(210,130,45,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, sr, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawSun(ctx, b, p, state, P) {
    let r = 10;
    const angDeg = planetApparentDeg('Sun', b.dist);
    if (angDeg) r = Math.min(220, Math.max(r, (P.f * angDeg * DEG) / 2));   // real size, grows on zoom like the planets
    const photoFade = Math.min(1, Math.max(0, (r - 22) / 38));
    // (The soft outer corona/bloom circles that used to sit here are gone —
    // they read as a stray glow ring around the Sun at every zoom level
    // rather than looking like part of a real photo.)
    // glowing plasma sphere: bright core -> warm mid -> orange limb, instead of a flat disc
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, '#fffdf2'); g.addColorStop(0.55, '#fff0b8'); g.addColorStop(0.85, '#ffc766'); g.addColorStop(1, '#ff9a3d');
    ctx.beginPath(); ctx.fillStyle = g; ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
    // real photo (surface granulation/sunspots) blended in once zoomed in
    // enough to matter — normal alpha, not 'screen' (which just washed the
    // photo out into a pale, unconvincing overlay instead of a real surface)
    drawSunTexture(ctx, p.x, p.y, r, 1 - photoFade * 0.7);   // procedural texture always shows something; fades down (not out) once the real photo takes over
    if (photoFade > 0) {
      const entry = getPlanetImage('Sun');
      if (entry) {
        const wPx = r * 2, hPx = wPx * entry.aspect;
        ctx.save();
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.clip();
        ctx.globalAlpha = photoFade * 0.92;
        ctx.drawImage(entry.masked, p.x - wPx / 2, p.y - hPx / 2, wPx, hPx);
        ctx.restore();
      }
    }
    if (state.layers.labels) { ctx.fillStyle = 'rgba(255,250,220,0.95)'; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; tryLabel(state, ctx, 'Sun', p.x + r + 4, p.y + 4); }
  }

  // Deterministic crater layout (normalized disc coords), computed once —
  // guaranteed lunar surface texture even before any photo has loaded, and
  // layered under the dark-side earthshine too so a mostly-new/crescent Moon
  // doesn't render as a flat grey smudge (the old dark-side gradient had no
  // texture at all, which is what made a thin-crescent Moon look fake).
  const MOON_CRATERS = (() => {
    let seed = 41;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const arr = [];
    for (let i = 0; i < 26; i++) {
      const ang = rnd() * 6.2832, rad = Math.sqrt(rnd()) * 0.92;   // sqrt bias -> even areal density, not centre-clumped
      arr.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, size: 0.03 + rnd() * 0.09 });
    }
    return arr;
  })();
  function drawMoonCraters(ctx, r, alphaMul) {
    if (alphaMul <= 0.02) return;
    ctx.save(); ctx.globalAlpha = alphaMul;
    for (const c of MOON_CRATERS) {
      const cx = c.x * r, cy = c.y * r, cr = c.size * r;
      if (cr < 0.6) continue;
      const g = ctx.createRadialGradient(cx - cr * 0.15, cy - cr * 0.15, 0, cx, cy, cr);
      g.addColorStop(0, 'rgba(255,255,255,0.16)');   // sunward crater rim catches a little light
      g.addColorStop(0.35, 'rgba(0,0,0,0.22)');
      g.addColorStop(0.75, 'rgba(0,0,0,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  function drawMoon(ctx, b, p, state, P) {
    let r = 10;
    const angDeg = planetApparentDeg('Moon', b.dist);
    if (angDeg) r = Math.min(220, Math.max(r, (P.f * angDeg * DEG) / 2));   // real size, grows on zoom like the planets
    // direction toward Sun on screen for phase orientation
    let ang = 0;
    const sun = (state.bodies || []).find(x => x.name === 'Sun');
    if (sun) { const sp = P.projRaDec(sun.ra, sun.dec); ang = Math.atan2(sp.y - p.y, sp.x - p.x); }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
    const entry = r > 14 ? getPlanetImage('Moon') : null;
    // dark side: dimmer, less prominent earthshine gradient than before (the
    // old version's off-centre highlight was large/bright enough to read as
    // a glow smudge rather than subtle earthshine) plus real photo detail at
    // very low opacity across the whole disc, so a mostly-dark crescent Moon
    // still shows genuine surface texture instead of one flat grey blob.
    const dg = ctx.createRadialGradient(-r * 0.25, -r * 0.2, 0, 0, 0, r);
    dg.addColorStop(0, '#38383f'); dg.addColorStop(0.6, '#222227'); dg.addColorStop(1, '#151519');
    ctx.beginPath(); ctx.fillStyle = dg; ctx.arc(0, 0, r, 0, 6.2832); ctx.fill();
    if (entry) {
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.clip();
      ctx.globalAlpha = Math.min(1, (r - 14) / 40) * 0.22;   // earthshine-level detail, not full brightness
      const wPxE = r * 2, hPxE = wPxE * entry.aspect;
      ctx.drawImage(entry.masked, -wPxE / 2, -hPxE / 2, wPxE, hPxE);
      ctx.restore();
    }
    drawMoonCraters(ctx, r, entry ? 0.35 : 0.6);   // always some crater texture; a bit stronger as a stand-in when there's no photo yet
    // lit side: bright limb toward +x (sun), shaded rather than flat. terminator ellipse,
    // built as a path so it can be reused below to clip the real photo to just the lit side.
    const k = b.phase;                       // illuminated fraction
    const term = r * (1 - 2 * k);            // signed semi-axis of terminator
    const lg = ctx.createRadialGradient(r * 0.2, -r * 0.25, 0, 0, 0, r * 1.05);
    lg.addColorStop(0, '#fdfdf3'); lg.addColorStop(0.6, '#e2e0d2'); lg.addColorStop(1, '#a29e90');
    const litPath = new Path2D();
    litPath.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);      // sunward semicircle
    if (term >= 0) litPath.ellipse(0, 0, term, r, 0, Math.PI / 2, -Math.PI / 2, true);
    else litPath.ellipse(0, 0, -term, r, 0, Math.PI / 2, -Math.PI / 2, false);
    litPath.closePath();
    ctx.fillStyle = lg; ctx.fill(litPath);
    ctx.save(); ctx.clip(litPath); drawMoonCraters(ctx, r, entry ? 0.28 : 0.5); ctx.restore();
    // real lunar photo, clipped to the same lit-side path so the phase shape
    // stays correct — only the illuminated portion gets full-strength real
    // surface detail. Normal alpha (not 'screen'), same reasoning as the
    // Sun/planets above.
    if (entry && r > 22) {
      ctx.save();
      ctx.clip(litPath);
      ctx.globalAlpha = Math.min(1, (r - 22) / 38) * 0.92;
      const wPx = r * 2, hPx = wPx * entry.aspect;
      ctx.drawImage(entry.masked, -wPx / 2, -hPx / 2, wPx, hPx);
      ctx.restore();
    }
    ctx.restore();
    if (state.layers.labels) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; tryLabel(state, ctx, 'Moon', p.x + r + 4, p.y + 4); }
  }

  // ---- ground fill (common orientation: looking toward/above horizon) ----
  //
  // Previous approach sampled the alt=0 horizon circle in azimuth order, then
  // *sorted the resulting screen points by x* before connecting them into a
  // fill polygon. That sort throws away the curve's actual connectivity: as
  // soon as the horizon isn't x-monotonic on screen (wide FOV, looking near
  // the zenith/nadir, or the horizon wrapping through the projection's far
  // side) neighbouring-in-x points are frequently far apart in y, so the
  // "polygon" zigzags top-to-bottom across the whole canvas — the vertical
  // stripe artifact. A polygon built from screen-space points also can't
  // represent the ground when it's not a single simple loop (e.g. it hugs
  // the screen edges when the horizon exits/re-enters the frustum).
  //
  // Fixed with a scanline fill instead: for each screen row, walk across in
  // x and use unprojectAlt (cheap: no atan2/asin, just the raw up-component)
  // to find where alt crosses zero, refining each crossing with a short
  // bisection. This reproduces the *actual* below-horizon region pixel-row
  // by pixel-row regardless of the horizon curve's topology, so it can never
  // produce a self-intersecting/zigzag fill.
  function drawGroundFill(ctx, P, W, H) {
    // rowStep=1 — one scanline per screen row. The earlier coarser row step
    // (H/140-ish) turned a smooth, gently-sloped horizon into a visible
    // staircase, since each multi-pixel-tall band could only start/end at
    // that row's sampled x, not the true curve underneath it. Sampling every
    // row instead reproduces the exact circular/elliptical horizon curve,
    // pixel by pixel — colStep only controls how coarse the *search* for a
    // crossing is; the crossing position itself is always refined to
    // sub-pixel accuracy by the bisection below, so it doesn't blur the edge.
    const rowStep = 1;
    const colStep = Math.max(4, Math.round(W / 220));
    const topCol = [11, 21, 18], botCol = [5, 16, 12];   // '#0b1512' -> '#05100c'
    for (let y = 0; y <= H; y += rowStep) {
      let prevAlt = P.unprojectAlt(0, y);
      let segStart = prevAlt < 0 ? 0 : null;
      const spans = [];
      for (let x = colStep; x <= W + colStep; x += colStep) {
        const xx = Math.min(x, W);
        const alt = P.unprojectAlt(xx, y);
        if ((alt < 0) !== (prevAlt < 0)) {
          // bracketed a horizon crossing between (xx-colStep) and xx — refine
          let lo = xx - colStep, hi = xx, loNeg = prevAlt < 0;
          for (let it = 0; it < 6; it++) {
            const mid = (lo + hi) / 2;
            const midNeg = P.unprojectAlt(mid, y) < 0;
            if (midNeg === loNeg) lo = mid; else hi = mid;
          }
          const cx_ = (lo + hi) / 2;
          if (prevAlt < 0) { spans.push([segStart, cx_]); segStart = null; }
          else segStart = cx_;
        }
        prevAlt = alt;
        if (xx >= W) break;
      }
      if (segStart != null) spans.push([segStart, W]);
      if (!spans.length) continue;
      const t = Math.min(1, y / H);
      const r = Math.round(topCol[0] + (botCol[0] - topCol[0]) * t);
      const g = Math.round(topCol[1] + (botCol[1] - topCol[1]) * t);
      const b = Math.round(topCol[2] + (botCol[2] - topCol[2]) * t);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      for (const [x0, x1] of spans) {
        if (x1 - x0 < 0.5) continue;
        ctx.fillRect(x0, y, x1 - x0 + 0.5, rowStep + 0.5);
      }
    }
  }

  // Horizon glow line, traced in natural azimuth order (never re-sorted) and
  // split into a fresh subpath whenever a step lands behind the camera or
  // jumps implausibly far on screen — the same "break on a big jump" rule
  // already used for constellation stick-figures above, which is what keeps
  // a curve that exits/re-enters the frustum from drawing a stray line
  // straight across the canvas.
  function drawHorizonLine(ctx, P, W, H) {
    ctx.save();
    ctx.strokeStyle = 'rgba(70,110,120,0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false, prev = null;
    for (let az = 0; az <= 360; az += 1.5) {
      const p = P.projAltAz(0, az);
      if (p.behind) { started = false; prev = null; continue; }
      if (!started || !prev || Math.hypot(p.x - prev.x, p.y - prev.y) > Math.min(W, H) * 0.5) {
        ctx.moveTo(p.x, p.y); started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
      prev = p;
    }
    ctx.stroke();
    ctx.restore();
  }

  // Cardinal direction (N/E/S/W…) labels used to be stamped onto the ground
  // right here — which put them through the same fragile screen-space
  // projection as everything else on the horizon and let them drift to
  // strange places (e.g. off the top of the screen) whenever the view got
  // near the zenith. They now live in a dedicated rotating compass widget in
  // the UI (see TimeBar.jsx) driven directly by state.center.az, so this
  // function no longer draws any text on the sky itself.
  function drawGround(ctx, P, W, H) {
    ctx.save();
    drawGroundFill(ctx, P, W, H);
    drawHorizonLine(ctx, P, W, H);
    ctx.restore();
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  return { prepare, draw, makeProjector, bv2rgb, get MAGLIMIT() { return MAGLIMIT; } };
})();
import { Astro } from './astro.js';
import { resolveSkyCutout, resolvePlanetImage } from './images.js';
export { Renderer };
