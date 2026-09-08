/* =============================================================================
 * images.js — real-image lookup for the info panel.
 *
 * Two sources, both real observatory imagery, never illustrations:
 *  1. Wikipedia's public REST summary API (CORS-enabled, no key) — used first
 *     for named planets/DSOs, since it usually has an actual NASA/Hubble photo.
 *     Results that are constellation-map diagrams (Wikipedia's fallback lead
 *     image for many stars/faint DSOs, always an .svg render) are rejected.
 *  2. hips2fits (CDS Strasbourg) — a real-time cutout service over the DSS2
 *     Digitized Sky Survey, an open-access photographic sky atlas from the
 *     Palomar/UK Schmidt telescopes. Given just RA/Dec it returns an actual
 *     telescope photo of that patch of sky, so it's used as a guaranteed
 *     fallback for stars/DSOs (never for planets/Sun/Moon, which move against
 *     the archival DSS plates and would show the wrong thing).
 * =========================================================================== */
const cache = new Map();

function titleCandidates(obj) {
  const out = [];
  if (obj.kind === 'dso') {
    if (obj.common) out.push(obj.common.replace(/[´’]/g, "'"));
    const m = obj.name && obj.name.match(/^M(\d+)$/);
    if (m) out.push(`Messier ${m[1]}`);
    if (obj.desig) out.push(obj.desig.split('/')[0]);   // e.g. "NGC 224" from "NGC 224/5"
  } else if (obj.kind === 'planet') {
    out.push(obj.name);                                  // Sun, Moon, Mars, ...
  } else if (obj.kind === 'star') {
    if (obj.name) out.push(obj.name);
  }
  return [...new Set(out.filter(Boolean))];
}

// Wikipedia's fallback lead image for stars/asterisms is almost always a
// rendered constellation map — always served from an .svg source, even when
// thumbnailed to a raster format. Reject those; we want real photos only.
function looksLikeDiagram(src) {
  return /\.svg(\.[a-z]+)?(\?|$)/i.test(src) || /constellation.?map/i.test(src);
}

async function fetchSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.type === 'disambiguation') return null;
  const img = data.thumbnail || data.originalimage;   // thumbnail is pre-sized (~320px) — plenty for a small banner, loads fast
  if (!img || !img.source || looksLikeDiagram(img.source)) return null;
  return {
    src: img.source,
    page: data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page,
    credit: 'Wikipedia', icon: '📷',
  };
}

// Rough on-sky framing per DSO type (degrees) — wide for big diffuse objects,
// tight for point-like clusters, so the object actually fills the crop.
const DSO_FOV = {
  gc: 0.4, oc: 0.55, pn: 0.45, snr: 0.7, dn: 0.9, sfr: 0.9, rn: 0.7,
  s: 1.1, e: 0.9, i: 0.7, ga: 1.0, gx: 1.0, pos: 0.8,
};

function hipsCutoutUrl(raDeg, decDeg, fovDeg) {
  const p = new URLSearchParams({
    hips: 'CDS/P/DSS2/color', width: 480, height: 270, fov: fovDeg,
    projection: 'TAN', coordsys: 'icrs', ra: raDeg, dec: decDeg, format: 'jpg',
  });
  return `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${p}`;
}

// Dedicated resolver for the in-sky overlay (render.js draws this directly
// onto the star field at the object's real coordinates). Always DSS2/SDSS
// survey imagery, never Wikipedia — a real astronomical photograph with a
// consistent near-black sky background blends into the rendered sky, where a
// Wikipedia press photo (arbitrary crop, color grading, sometimes a grey or
// white background/caption bar) would show up as an obvious pasted rectangle.
// Framed wider than the object itself (extra margin) so there's real
// surrounding star field for the feathered edge to fade into.
const skyCutoutCache = new Map();
export function resolveSkyCutout(obj) {
  if (!obj || obj.ra == null || obj.dec == null) return null;
  const key = obj.kind + ':' + obj.name;
  if (skyCutoutCache.has(key)) return skyCutoutCache.get(key);
  const base = DSO_FOV[obj.type] || 0.8;
  const fov = obj.kind === 'star' ? 0.35 : base * 1.7;
  const result = { src: hipsCutoutUrl(obj.ra, obj.dec, fov), page: 'https://www.cds.unistra.fr/', credit: 'DSS2/SDSS Sky Survey', icon: '🔭' };
  skyCutoutCache.set(key, result);
  return result;
}

// Returns { src, page, credit, icon } or null. Cached per object identity.
export async function resolveObjectImage(obj) {
  if (!obj || !obj.kind) return null;
  const key = obj.kind + ':' + obj.name;
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    for (const title of titleCandidates(obj)) {
      try {
        const r = await fetchSummary(title);
        if (r) return r;
      } catch { /* network hiccup — try next candidate */ }
    }
    // guaranteed real-photo fallback for stars/DSOs: an actual sky-survey
    // cutout centered on the object's own coordinates (never for planets —
    // the archival plates wouldn't show a body that has since moved).
    if (obj.kind !== 'planet' && obj.ra != null && obj.dec != null) {
      const fov = obj.kind === 'star' ? 0.3 : (DSO_FOV[obj.type] || 0.8);
      return { src: hipsCutoutUrl(obj.ra, obj.dec, fov), page: 'https://www.cds.unistra.fr/', credit: 'DSS2 Sky Survey', icon: '🔭' };
    }
    return null;
  })();
  cache.set(key, promise);
  return promise;
}

/* -----------------------------------------------------------------------
 * fetchHeroImages — wide, high-res deep-space photos for the landing page
 * slideshow. Uses the MediaWiki pageimages API directly (not the summary
 * REST endpoint above) so we can request a real background-sized thumbnail
 * (pithumbsize) instead of the ~320px summary thumb. Same diagram-rejection
 * rule as everywhere else in this file: real photos only, never SVG maps.
 * ------------------------------------------------------------------- */
// The Wikipedia article's auto-picked "page image" isn't always a healthy
// file — e.g. "Pillars of Creation" resolves (via prop=pageimages) to
// File:Eagle_nebula_pillars.jpg, whose master file on Commons itself has a
// corrupted block baked into it (verified: even the unscaled original comes
// back with a solid-black rectangle over one corner at every size). Rather
// than surface that upstream defect, known-bad titles are pinned straight to
// a specific, verified-clean Commons file via the imageinfo API instead of
// going through the fragile article-pageimage lookup.
const HERO_FILE_OVERRIDES = {
  'Pillars of Creation': 'Pillars of Creation (NIRCam Image).jpg',
};

async function fetchHeroFile(fileTitle, title, size) {
  const p = new URLSearchParams({
    action: 'query', titles: `File:${fileTitle}`, prop: 'imageinfo',
    iiprop: 'url', iiurlwidth: String(size), format: 'json', origin: '*',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${p}`);
  if (!res.ok) return null;
  const data = await res.json();
  const pages = data.query && data.query.pages;
  const page = pages && Object.values(pages)[0];
  const info = page && page.imageinfo && page.imageinfo[0];
  const src = info && (info.thumburl || info.url);
  if (!src || looksLikeDiagram(src)) return null;
  return { src, credit: title, page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileTitle.replace(/ /g, '_'))}` };
}

const heroCache = new Map();
async function fetchHero(title, size = 1920) {
  if (heroCache.has(title)) return heroCache.get(title);
  const promise = (async () => {
    const override = HERO_FILE_OVERRIDES[title];
    if (override) {
      try { const r = await fetchHeroFile(override, title, size); if (r) return r; } catch { /* fall through to the normal lookup */ }
    }
    const p = new URLSearchParams({
      action: 'query', titles: title, prop: 'pageimages', format: 'json',
      pithumbsize: String(size), origin: '*',
    });
    try {
      const res = await fetch(`https://en.wikipedia.org/w/api.php?${p}`);
      if (!res.ok) return null;
      const data = await res.json();
      const pages = data.query && data.query.pages;
      const page = pages && Object.values(pages)[0];
      const thumb = page && page.thumbnail;
      if (!thumb || !thumb.source || looksLikeDiagram(thumb.source)) return null;
      return { src: thumb.source, credit: title, page: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` };
    } catch { return null; }
  })();
  heroCache.set(title, promise);
  return promise;
}

// Resolves in parallel, drops any that failed (offline, renamed page, etc.),
// keeps the given order.
export async function fetchHeroImages(titles, size = 1920) {
  const results = await Promise.all(titles.map(t => fetchHero(t, size)));
  return results.filter(Boolean);
}

/* -----------------------------------------------------------------------
 * resolvePlanetImage — dedicated, higher-res photo lookup for the in-sky
 * planet/Sun/Moon disc (render.js blends this onto the real rendered body
 * once you're zoomed in enough to resolve it). Two things the general
 * resolveObjectImage() path above gets wrong for this specific use:
 *
 *  1. It goes through the REST *summary* endpoint, which (a) only returns a
 *     ~320px thumbnail — too soft once stretched across a 100-400px on-screen
 *     disc, which is a real contributor to the "looks fake" complaint — and
 *     (b) 404s/returns nothing for "Mercury", since that plain title is a
 *     disambiguation page on English Wikipedia (planet/element/Roman god),
 *     so Mercury currently never gets a real photo at all.
 *  2. resolveObjectImage() explicitly skips its sky-cutout fallback for
 *     planets (correctly — DSS archival plates don't show a moving body) so
 *     a failed lookup there has no fallback; worth getting the primary
 *     lookup right instead.
 *
 * Uses the same MediaWiki pageimages API as fetchHero (real page thumbnail,
 * not the small REST summary one) with explicit title overrides for the
 * handful of planet names that don't resolve directly.
 * ------------------------------------------------------------------- */
const PLANET_TITLE_OVERRIDES = { Mercury: 'Mercury (planet)' };
// Pinned straight to a specific, verified real published NASA image rather
// than whatever Wikipedia's auto-picked "page image" happens to be — same
// technique as HERO_FILE_OVERRIDES above. Only used where the default lookup
// isn't clearly the best available real photo:
//  - Sun: the default pageimage isn't consistently solar-observatory
//    imagery. This is IAU release iau1508d — credited NASA/SDO/HMI, a real
//    white-light Solar Dynamics Observatory frame that actually shows
//    sunspots, not an illustration or a hazy amateur shot.
// The rest (Mercury/MESSENGER, Venus/Magellan, Mars, Jupiter/Hubble OPAL,
// Saturn/Cassini, Uranus & Neptune/Voyager 2, Moon) already resolve to real
// mission/observatory photos via the plain pageimages lookup below, so they
// don't need pinning.
const PLANET_FILE_OVERRIDES = {
  Sun: 'The Sun with sunspots (iau1508d).jpg',
};
const planetImgCache = new Map();
export async function resolvePlanetImage(name, size = 1920) {
  const title = PLANET_TITLE_OVERRIDES[name] || name;
  const key = title + ':' + size;
  if (planetImgCache.has(key)) return planetImgCache.get(key);
  const promise = (async () => {
    const fileOverride = PLANET_FILE_OVERRIDES[name];
    if (fileOverride) {
      // some individual files 404 on arbitrary requested widths (seen on
      // this exact one) but reliably serve their standard 1920px bucket, so
      // that's requested here regardless of the caller's `size`
      try { const r = await fetchHeroFile(fileOverride, name, 1920); if (r) return r; } catch { /* fall through */ }
    }
    const r = await fetchHero(title, size);
    if (r) return r;
    // last-resort fallback: the small REST summary thumbnail, in case the
    // pageimages lookup above comes back empty for some future title
    try { return await fetchSummary(title); } catch { return null; }
  })();
  planetImgCache.set(key, promise);
  return promise;
}
