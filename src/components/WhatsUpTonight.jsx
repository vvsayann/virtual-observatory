import React, { useMemo } from 'react';
import { Observatory } from '../lib/observatory.js';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const dir = az => COMPASS[Math.round(az / 45) % 8];

// Re-derives from live engine state on every render — App already re-renders
// this tree at ~5Hz via useTick, so no separate polling needed here.
export default function WhatsUpTonight() {
  const st = Observatory.state;

  const { moon, planets, dsos } = useMemo(() => {
    const bodies = st.bodies || [];
    const withAltAz = bodies.map(b => ({ ...b, altaz: Observatory.currentAltAz(b) }))
      .filter(b => b.altaz);
    const moon = withAltAz.find(b => b.name === 'Moon');
    const planets = withAltAz
      .filter(b => b.name !== 'Sun' && b.name !== 'Moon' && b.altaz.alt > 0)
      .sort((a, b) => b.altaz.alt - a.altaz.alt);

    const dsos = (window.DSO_DATA || [])
      .map(([name, ra, dec, mag, type, common, desig]) => ({ name, ra, dec, mag, type, common, desig }))
      .filter(o => o.mag <= 6.5)
      .map(o => ({ ...o, altaz: Observatory.currentAltAz(o) }))
      .filter(o => o.altaz && o.altaz.alt > 0)
      .sort((a, b) => a.mag - b.mag)
      .slice(0, 8);

    return { moon, planets, dsos };
  }, [st.date, st.location]);

  const goto = obj => Observatory.goToObject({ kind: obj.kind || 'planet', ...obj });

  return (
    <div className="tonight">
      <div className="tonight-head">
        <h2>What's Up Tonight</h2>
        <div className="tonight-sub">{st.hud.loc} · {st.hud.local}</div>
      </div>

      {moon && (
        <div className="tonight-moon">
          <div className="moon-disc" style={{ '--illum': moon.phase }} />
          <div>
            <div className="moon-title">Moon</div>
            <div className="moon-meta">{Math.round(moon.phase * 100)}% illuminated · alt {Math.round(moon.altaz.alt)}° {dir(moon.altaz.az)}</div>
          </div>
          <button className="tonight-goto" onClick={() => goto(moon)}>View →</button>
        </div>
      )}

      <div className="tonight-section">
        <div className="tonight-h">Planets above the horizon</div>
        {planets.length === 0 && <div className="tonight-empty">No planets are up right now.</div>}
        <div className="tonight-grid">
          {planets.map(p => (
            <button className="tonight-card" key={p.name} onClick={() => goto(p)}>
              <div className="tc-name">{p.name}</div>
              <div className="tc-meta">mag {p.mag?.toFixed(1)} · alt {Math.round(p.altaz.alt)}° {dir(p.altaz.az)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="tonight-section">
        <div className="tonight-h">Deep-sky highlights</div>
        {dsos.length === 0 && <div className="tonight-empty">Nothing bright enough is up right now.</div>}
        <div className="tonight-grid">
          {dsos.map(o => (
            <button className="tonight-card" key={o.name} onClick={() => goto(o)}>
              <div className="tc-name">{o.common || o.name}</div>
              <div className="tc-meta">{o.common ? o.name + ' · ' : ''}mag {o.mag} · alt {Math.round(o.altaz.alt)}° {dir(o.altaz.az)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
