import React, { useState, useRef, useEffect } from 'react';
import { Observatory } from '../lib/observatory.js';

const KIND_ICON = { planet: '🪐', star: '★', dso: '✧', const: '⬡' };

export default function SearchBar({ onGoto }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    const onDoc = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, []);

  function update(val) {
    setQ(val);
    const r = Observatory.search(val);
    setResults(r); setOpen(r.length > 0);
  }
  function choose(obj) {
    onGoto(obj); setOpen(false); setQ(obj.name);
  }

  return (
    <div className="search" ref={box}>
      <input
        value={q}
        placeholder="Search stars, planets, Messier, constellations…"
        onChange={e => update(e.target.value)}
        onFocus={() => q && setOpen(results.length > 0)}
        onKeyDown={e => { if (e.key === 'Enter' && results[0]) choose(results[0]); if (e.key === 'Escape') setOpen(false); }}
      />
      {open && (
        <ul className="results">
          {results.map((r, i) => (
            <li key={i} onClick={() => choose(r)}>
              <span className="k">{KIND_ICON[r.kind] || '•'}</span>
              <span className="n">{r.name}</span>
              <span className="m">{r.mag != null ? `mag ${r.mag.toFixed(1)}` : r.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
