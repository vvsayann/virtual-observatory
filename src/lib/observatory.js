import { Astro } from './astro.js';
import { Renderer } from './render.js';

export const Observatory = (function () {
// Field-of-view bounds shared by every zoom entry point (slider, scroll
// wheel, pinch, setFov). FOV_MIN used to be 2° — plenty to see a whole
// constellation, nowhere near enough to actually zoom in on a planet disc or
// a tight patch of the Milky Way the way the rendering now supports.
const FOV_MIN = 0.2, FOV_MAX = 160;
// [name, lat, lon, IANA timezone] — the tz drives the real local-time readout (DST-aware).
const CITIES = [
    ['Beijing, China', 39.9042, 116.4074, 'Asia/Shanghai'], ['Cairo, Egypt', 30.0444, 31.2357, 'Africa/Cairo'],
    ['Cape Town, ZA', -33.9249, 18.4241, 'Africa/Johannesburg'], ['Greenwich, UK', 51.4779, -0.0015, 'Europe/London'],
    ['Islamabad, Pakistan', 33.6844, 73.0479, 'Asia/Karachi'], ['London, UK', 51.5074, -0.1278, 'Europe/London'],
    ['Los Angeles, USA', 34.0522, -118.2437, 'America/Los_Angeles'], ['Mauna Kea, HI', 19.8207, -155.4681, 'Pacific/Honolulu'],
    ['Moscow, Russia', 55.7558, 37.6173, 'Europe/Moscow'], ['Mumbai, India', 19.0760, 72.8777, 'Asia/Kolkata'],
    ['Nairobi, Kenya', -1.2921, 36.8219, 'Africa/Nairobi'], ['New York, USA', 40.7128, -74.0060, 'America/New_York'],
    ['Paris, France', 48.8566, 2.3522, 'Europe/Paris'], ['Reykjavik, Iceland', 64.1466, -21.9426, 'Atlantic/Reykjavik'],
    ['Rio de Janeiro, BR', -22.9068, -43.1729, 'America/Sao_Paulo'], ['Sydney, Australia', -33.8688, 151.2093, 'Australia/Sydney'],
    ['Tokyo, Japan', 35.6762, 139.6503, 'Asia/Tokyo']
];

  const state = {
    date: new Date(),
    location: { lat: 51.4779, lon: -0.0015, name: 'Greenwich, UK', tz: 'Europe/London' },
    fov: 100,
    center: { alt: 20, az: 180 },
    layers: { stars: true, milkyway: true, constellations: true, constLabels: true, planets: true,
              dso: true, grid: false, ground: true, labels: true },
    bodies: [],
    timeRate: 1,
    playing: true,
    hud: { utc: '', local: '', loc: '', jd: 0, lst: '', fov: 0, rate: '' },
    _picks: [], _proj: null
  };

  let canvas, ctx, W, H, dpr = 1, running = false;
  const listeners = {};
  let selected = null;
  let lastReal = 0;

  function on(ev, cb) { (listeners[ev] || (listeners[ev] = [])).push(cb); return () => off(ev, cb); }
  function off(ev, cb) { if (listeners[ev]) listeners[ev] = listeners[ev].filter(f => f !== cb); }
  function emit(ev, d) { (listeners[ev] || []).forEach(cb => cb(d)); }


  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.max(1, W * dpr); canvas.height = Math.max(1, H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }


  function frame(now) {
    if (!running) return;
    const dtReal = lastReal ? (now - lastReal) / 1000 : 0; lastReal = now;
    if (state.playing) state.date = new Date(state.date.getTime() + dtReal * state.timeRate * 1000);
    state.bodies = Astro.bodies(state.date);
    const sun = state.bodies[0];
    const P0 = Renderer.makeProjector(state, W, H);
    const sa = P0.projRaDec(sun.ra, sun.dec); sun.altaz = { alt: sa.alt, az: sa.az };

    ctx.clearRect(0, 0, W, H);
    Renderer.draw(state, ctx, W, H, sun);
    drawSelectionMarker();
    computeHud();
    emit('tick', state);
    requestAnimationFrame(frame);
  }

  function drawSelectionMarker() {
    if (!selected || !state._proj) return;
    const P = state._proj;
    const p = selected.kind === 'star' ? P.projStar(selected.index) : P.projRaDec(selected.ra, selected.dec);
    if (!p || p.behind) return;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 480);   // slow breathing pulse
    ctx.save();
    ctx.lineCap = 'round';

    // soft outer glow ring
    ctx.beginPath(); ctx.arc(p.x, p.y, 18 + pulse * 2, 0, 6.2832);
    ctx.strokeStyle = `rgba(106,160,255,${0.12 + pulse * 0.1})`; ctx.lineWidth = 5;
    ctx.stroke();

    // crisp reticle ring
    ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, 6.2832);
    ctx.strokeStyle = 'rgba(155,212,255,0.95)'; ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(106,160,255,0.9)'; ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // corner tick marks instead of a full crosshair (cleaner, Stellarium-style)
    const inner = 11, outer = 22;
    ctx.strokeStyle = 'rgba(155,212,255,0.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x - outer, p.y); ctx.lineTo(p.x - inner, p.y);
    ctx.moveTo(p.x + inner, p.y); ctx.lineTo(p.x + outer, p.y);
    ctx.moveTo(p.x, p.y - outer); ctx.lineTo(p.x, p.y - inner);
    ctx.moveTo(p.x, p.y + inner); ctx.lineTo(p.x, p.y + outer);
    ctx.stroke();
    ctx.restore();
  }

  const pad = n => String(n).padStart(2, '0');

  // Local clock time at the observing location. Uses the city's real IANA
  // timezone when known (correct, DST-aware, via Intl). Falls back to a
  // longitude-based mean-solar-time approximation (UTC + round(lon/15)h) for
  // manually-entered coordinates that have no timezone attached.
  function localTimeString(d, loc) {
    if (loc.tz) {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: loc.tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        }).formatToParts(d);
        const get = t => parts.find(p => p.type === t).value;
        return { text: `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`, approx: false };
      } catch { /* unknown/invalid tz string — fall through to the approximation */ }
    }
    const off = Math.round(loc.lon / 15);
    const l = new Date(d.getTime() + off * 3600000);
    return {
      text: `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())} ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}:${pad(l.getUTCSeconds())}`,
      approx: true,
    };
  }

  function computeHud() {
    const d = state.date;
    const jd = Astro.julianDate(d);
    const lst = Astro.lst(jd, state.location.lon) / 15;
    const lstH = Math.floor(lst), lstM = Math.floor((lst - lstH) * 60);
    const local = localTimeString(d, state.location);
    state.hud = {
      utc: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`,
      local: `${local.text}${local.approx ? ' (local, approx)' : ' local'}`,
      loc: `${state.location.name}  (${state.location.lat.toFixed(2)}°, ${state.location.lon.toFixed(2)}°)`,
      jd, lst: `${pad(lstH)}h${pad(lstM)}m`, fov: state.fov,
      rate: state.playing ? rateLabel(state.timeRate) : 'paused'
    };
  }
  function rateLabel(r) {
    if (r === 1) return 'real-time';
    const abs = Math.abs(r), sign = r < 0 ? '−' : '';
    if (abs >= 86400) return `${sign}${(abs / 86400).toFixed(0)}d/s`;
    if (abs >= 3600) return `${sign}${(abs / 3600).toFixed(0)}h/s`;
    if (abs >= 60) return `${sign}${(abs / 60).toFixed(0)}m/s`;
    return `${sign}${abs.toFixed(0)}×`;
  }


  function bindInput() {
    let dragging = false, lx = 0, ly = 0, moved = 0;
    canvas.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; moved = 0; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', e => { dragging = false; if (moved < 5) pick(e.offsetX, e.offsetY); });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      const k = state.fov / H;
      state.center.az = Astro.rev(state.center.az - dx * k);
      state.center.alt = Math.max(-85, Math.min(85, state.center.alt + dy * k));
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      state.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, state.fov * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    let pinch = 0;
    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (pinch) state.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, state.fov * pinch / d));
        pinch = d; e.preventDefault();
      }
    }, { passive: false });
    canvas.addEventListener('touchend', () => pinch = 0);
  }


  function pick(sx, sy) {
    let best = null, bestD = 22 * 22;
    for (const pk of state._picks || []) {
      const dd = (pk.x - sx) ** 2 + (pk.y - sy) ** 2;
      if (dd < bestD && dd < pk.r * pk.r * 4) { bestD = dd; best = pk.obj; }
    }
    const P = state._proj;
    if (P) {
      const D = window.STAR_DATA;
      for (let i = 0; i < D.length; i++) {
        if (D[i][2] > 4.6) continue;
        const p = P.projStar(i); if (!p) continue;
        const dd = (p.x - sx) ** 2 + (p.y - sy) ** 2;
        if (dd < bestD) { bestD = dd; best = starObj(i, p); }
      }
    }
    if (best) selectObject(best); else selectObject(null);
  }
  function starObj(i, p) {
    const d = window.STAR_DATA[i];
    return { kind: 'star', index: i, name: window.STAR_NAMES[i] || (d[4] ? d[4] + ' ' + d[5] : 'Star ' + i),
             ra: d[0], dec: d[1], mag: d[2], con: d[5] };
  }
  function selectObject(obj) { selected = obj; emit('select', obj); }

  /* ---- plugin panel mounting (for classic-script plugins, see migration.md) ---- */
  let pendingPanels = [];
  function registerPanel(el) {
    const dock = document.getElementById('plugin-dock');
    if (dock) dock.appendChild(el); else pendingPanels.push(el);
  }
  function flushPanels() {
    const dock = document.getElementById('plugin-dock');
    if (dock) { pendingPanels.forEach(el => dock.appendChild(el)); pendingPanels = []; }
  }


  function lookAt(alt, az, fov) {
    const start = { alt: state.center.alt, az: state.center.az, fov: state.fov };
    const daz = Astro.rev180(az - start.az);
    const t0 = performance.now(), dur = 700, tf = fov != null ? fov : state.fov;
    (function step(t) {
      const k = Math.min(1, (t - t0) / dur), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      state.center.alt = start.alt + (alt - start.alt) * e;
      state.center.az = Astro.rev(start.az + daz * e);
      state.fov = start.fov + (tf - start.fov) * e;
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function goToObject(obj) {
    if (state._proj) { const p = state._proj.projRaDec(obj.ra, obj.dec); lookAt(p.alt, p.az, Math.min(state.fov, 45)); }
    selectObject(obj);
  }


  function search(q) {
    q = (q || '').trim().toLowerCase(); if (!q) return [];
    const out = [];
    for (const b of state.bodies) if (b.name.toLowerCase().includes(q)) out.push({ kind: 'planet', ...b });
    for (const idx in window.STAR_NAMES) {
      if (window.STAR_NAMES[idx].toLowerCase().includes(q)) { const i = +idx, d = window.STAR_DATA[i]; out.push({ kind: 'star', index: i, name: window.STAR_NAMES[idx], ra: d[0], dec: d[1], mag: d[2], con: d[5] }); }
    }
    for (const o of window.DSO_DATA) if (o[0].toLowerCase().includes(q) || (o[5] && o[5].toLowerCase().includes(q))) out.push({ kind: 'dso', name: o[0], ra: o[1], dec: o[2], mag: o[3], type: o[4], common: o[5], desig: o[6] });
    for (const cid in window.CONST_META) if (window.CONST_META[cid][0].toLowerCase().includes(q)) { const m = window.CONST_META[cid]; out.push({ kind: 'const', name: m[0], ra: m[1], dec: m[2], mag: null, con: cid }); }
    return out.slice(0, 14);
  }

  function currentAltAz(obj) {
    if (!state._proj) return null;
    const p = state._proj.projRaDec(obj.ra, obj.dec);
    return { alt: p.alt, az: p.az };
  }

  // Every type code actually used in DSO_DATA — the catalog has always
  // included emission/reflection nebulae and spiral/elliptical/irregular
  // galaxies (sfr, rn, s, e, i, pos), but this map only ever named the
  // cluster/planetary-nebula/galaxy-shorthand codes, so those objects (M42,
  // M31, M78, M104... and every new nebula added alongside them) silently
  // fell back to the generic "Deep-sky" label instead of their real type.
  const DSO_TYPES = {
    gc: 'Globular Cluster', oc: 'Open Cluster', pn: 'Planetary Nebula', snr: 'Supernova Remnant',
    dn: 'Dark Nebula', sfr: 'Emission Nebula', rn: 'Reflection Nebula', pos: 'Star Cloud',
    ga: 'Galaxy', gx: 'Galaxy', s: 'Spiral Galaxy', e: 'Elliptical Galaxy', i: 'Irregular Galaxy',
  };


  function init(canvasEl) {
    canvas = canvasEl; ctx = canvas.getContext('2d');
    resize(); window.addEventListener('resize', resize);
    Renderer.prepare();
    bindInput();
    running = true; lastReal = 0;
    requestAnimationFrame(frame);
    initPlugins();
  }
  function destroy() { running = false; window.removeEventListener('resize', resize); }

  // Boot classic-script plugins (Antigravity WP-B/WP-C) once the engine is up.
  function initPlugins() {
    flushPanels();
    try { window.Telescope && window.Telescope.init && window.Telescope.init(api); } catch (e) { console.warn('Telescope plugin:', e); }
    try { window.Tours && window.Tours.init && window.Tours.init(api); } catch (e) { console.warn('Tours plugin:', e); }
  }

  const api = {
    state, on, off, emit, init, destroy, resize, search, goToObject, selectObject,
    lookAt, currentAltAz, getSelected: () => selected, registerPanel, flushPanels, initPlugins,
    setLocation(lat, lon, name, tz) { state.location = { lat, lon, name: name || `${(+lat).toFixed(2)}, ${(+lon).toFixed(2)}`, tz: tz || null }; },
    setTime(date) { state.date = new Date(date); },
    now() { state.date = new Date(); state.playing = true; state.timeRate = 1; },
    setRate(r) { state.timeRate = r; state.playing = true; },
    togglePlay() { state.playing = !state.playing; return state.playing; },
    setFov(f) { state.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, f)); },
    setLayer(k, v) { state.layers[k] = v; },
    CITIES, DSO_TYPES, FOV_MIN, FOV_MAX
  };
  return api;
})();
