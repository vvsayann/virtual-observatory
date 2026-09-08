import React, { useState } from 'react';
import { Observatory } from '../lib/observatory.js';
import Icon from './icons.jsx';

// Each entry is [key(s), label, icon name (see icons.jsx)]. A key may be a
// single layer-state key or an array of keys that toggle together as one
// checkbox (used to merge "Constellation lines" + "Constellation names"
// into a single control).
const LAYERS = [
  ['stars', 'Stars', 'stars'],
  ['milkyway', 'Milky Way & field stars', 'milkyway'],
  [['constellations', 'constLabels'], 'Constellations', 'constellations'],
  ['planets', 'Planets, Sun & Moon', 'planets'],
  ['dso', 'Deep-sky (Messier)', 'dso'],
  ['labels', 'Object labels', 'labels'],
  ['grid', 'Az/Alt grid', 'grid', 'divider'],
  ['ground', 'Ground & horizon', 'ground'],
];

export default function LayersPanel({ onChange }) {
  const [open, setOpen] = useState(true);
  const L = Observatory.state.layers;
  function toggle(k) {
    const keys = Array.isArray(k) ? k : [k];
    const next = !L[keys[0]];
    keys.forEach(key => Observatory.setLayer(key, next));
    onChange();
  }

  return (
    <div className={`layers ${open ? 'open' : 'closed'}`}>
      <button className="layers-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '‹' : '›'} <span>Sky</span>
      </button>
      {open && (
        <div className="layers-body">
          <div className="layers-h">Layers</div>
          {LAYERS.map(([k, label, icon, mark]) => {
            const keys = Array.isArray(k) ? k : [k];
            const on = !!L[keys[0]];
            return (
              <React.Fragment key={keys.join('+')}>
                {mark === 'divider' && <div className="layers-div" />}
                <label className={on ? 'on' : ''}>
                  <input type="checkbox" checked={on} onChange={() => toggle(k)} />
                  <span className="ic"><Icon name={icon} /></span>{label}
                </label>
              </React.Fragment>
            );
          })}
          <div id="plugin-dock" className="plugin-dock" />
        </div>
      )}
    </div>
  );
}
