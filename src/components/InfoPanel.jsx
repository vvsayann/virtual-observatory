import React, { useEffect, useState } from 'react';
import { Observatory } from '../lib/observatory.js';
import { resolveObjectImage } from '../lib/images.js';

function fmtRa(ra) {
  const h = ra / 15, hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.round(((h - hh) * 60 - mm) * 60);
  return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s`;
}
function fmtDec(dec) {
  const s = dec < 0 ? '−' : '+', a = Math.abs(dec), dd = Math.floor(a), mm = Math.floor((a - dd) * 60);
  return `${s}${dd}° ${String(mm).padStart(2, '0')}′`;
}

// Accent colour keyed to what's actually shown on the sky map (see the
// matching DSO_STYLE / PLANET_COLORS / nebula-glow palettes in render.js) —
// the info panel's top edge and subtitle pick up the same hue as the marker
// you just clicked, so the UI reads as one connected system rather than a
// generic card bolted on top of the canvas.
const PLANET_ACCENT = {
  Sun: '#ffcf6b', Moon: '#cfd3dc', Mercury: '#b8b0a0', Venus: '#ffe9a8',
  Mars: '#e07a4a', Jupiter: '#e0c090', Saturn: '#e8d59a', Uranus: '#8fe0e0', Neptune: '#6a8cff',
};
const DSO_ACCENT = {
  gc: '#ffd27f', oc: '#a8ffb0', pn: '#7fffd4', snr: '#ff9f9f', dn: '#c0a0ff',
  sfr: '#ff8fae', rn: '#8fb0ff', pos: '#c0d0ff',
  ga: '#ffb0e0', gx: '#ffb0e0', s: '#ffb0e0', e: '#ffa0d0', i: '#ffc0e0',
};
function accentFor(object) {
  if (!object) return null;
  if (object.kind === 'planet') return PLANET_ACCENT[object.name] || '#9bd4ff';
  if (object.kind === 'dso') return DSO_ACCENT[object.type] || '#9bd4ff';
  if (object.kind === 'star') return '#dfe6ff';
  return null;
}

export default function InfoPanel({ object, onClose, onGoto }) {
  const [img, setImg] = useState(null);     // { src, page, title } | null
  const [imgState, setImgState] = useState('idle');   // idle | loading | ready | none

  useEffect(() => {
    if (!object || !['planet', 'dso', 'star'].includes(object.kind)) { setImg(null); setImgState('idle'); return; }
    let cancelled = false;
    setImg(null); setImgState('loading');
    resolveObjectImage(object).then(r => {
      if (cancelled) return;
      setImg(r); setImgState(r ? 'ready' : 'none');
    });
    return () => { cancelled = true; };
  }, [object && object.kind, object && object.name]);

  if (!object) return null;
  const aa = Observatory.currentAltAz(object);
  const kindLabel = { planet: 'Solar System', star: 'Star', dso: 'Deep-sky object', const: 'Constellation' }[object.kind] || '';
  let sub = kindLabel;
  if (object.kind === 'star' && object.con && window.CONST_META[object.con]) sub = 'Star in ' + window.CONST_META[object.con][0];
  if (object.kind === 'dso') sub = (Observatory.DSO_TYPES[object.type] || 'Deep-sky') + (object.common ? ' · ' + object.common : '');

  const rows = [
    ['Right ascension', fmtRa(object.ra)],
    ['Declination', fmtDec(object.dec)],
    ['Magnitude', object.mag != null ? object.mag.toFixed(2) : '—'],
  ];
  if (aa) {
    rows.push(['Altitude', `${aa.alt.toFixed(2)}°${aa.alt < 0 ? '  (below horizon)' : ''}`]);
    rows.push(['Azimuth', `${aa.az.toFixed(2)}°`]);
  }
  if (object.kind === 'planet') {
    if (object.phase != null) rows.push(['Illuminated', `${(object.phase * 100).toFixed(0)}%`]);
    if (object.dist != null) rows.push(['Distance', object.name === 'Moon' ? `${Math.round(object.dist * 6371).toLocaleString()} km` : `${object.dist.toFixed(3)} AU`]);
  }
  if (object.kind === 'dso' && object.desig) rows.push(['Designation', object.desig]);

  return (
    <aside className={`info-panel ${imgState === 'ready' ? 'has-img' : ''}`} style={{ '--kind-color': accentFor(object) }}>
      {imgState === 'loading' && <div className="info-img info-img-skeleton" />}
      {imgState === 'ready' && img && (
        <div className="info-img">
          <img src={img.src} alt={object.name} />
          <div className="info-img-fade" />
          {img.page && (
            <a className="info-img-credit" href={img.page} target="_blank" rel="noopener noreferrer" title={`View source (${img.credit})`}>
              {img.icon || '📷'} {img.credit}
            </a>
          )}
        </div>
      )}
      <button className="close" onClick={onClose}>×</button>
      <div className="info-body">
        <div className="info-title">{object.name}</div>
        <div className="info-sub">{sub}</div>
        <div className="info-rows">
          {rows.map((r, i) => <div className="irow" key={i}><span>{r[0]}</span><b>{r[1]}</b></div>)}
        </div>
        <button className="goto" onClick={onGoto}>◎ Center &amp; zoom</button>
      </div>
    </aside>
  );
}
