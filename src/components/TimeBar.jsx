import React from 'react';
import { Observatory } from '../lib/observatory.js';

const RATES = [
  ['⏮', -86400, '−1 day/s'], ['⏪', -3600, '−1 hr/s'], ['◀', -60, '−1 min/s'],
  ['●', 1, 'real-time'],
  ['▶', 60, '+1 min/s'], ['⏩', 3600, '+1 hr/s'], ['⏭', 86400, '+1 day/s']
];

function toLocalInput(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

// The FOV slider is log-scaled, not linear. FOV_MIN..FOV_MAX now spans
// 0.2°-160° — an 800x range — and a linear slider over that range would put
// the *entire* useful deep-zoom span (where you'd actually zoom in on a
// planet or a tight patch of the Milky Way) into the leftmost fraction of a
// percent of the handle's travel, unreachable by drag. Mapping slider
// position -> FOV exponentially instead makes each increment of drag a
// constant zoom *ratio* rather than a constant number of degrees, which is
// what every real zoom control (including a telescope eyepiece swap) feels
// like, and keeps the deep-zoom end just as reachable as the wide end.
const FOV_MIN = Observatory.FOV_MIN, FOV_MAX = Observatory.FOV_MAX;
const SLIDER_MAX = 1000;
const fovToSlider = fov => Math.round(SLIDER_MAX * Math.log(fov / FOV_MIN) / Math.log(FOV_MAX / FOV_MIN));
const sliderToFov = v => FOV_MIN * Math.pow(FOV_MAX / FOV_MIN, v / SLIDER_MAX);
// e.g. 0.234, 3.4, 42 — matches the precision an actual deep-zoom app (see
// Stellarium's "FOV 0.00387°") shows, instead of always rounding to a whole
// degree which reads as "0°" for anything under a degree.
function formatFov(fov) {
  if (fov < 1) return fov.toFixed(fov < 0.1 ? 3 : 2);
  if (fov < 10) return fov.toFixed(1);
  return fov.toFixed(0);
}

// Rotating heading compass: the ring's N/E/S/W stay fixed to real-world
// directions, and the needle rotates to point wherever the view is currently
// facing (state.center.az, 0°=N clockwise) — same convention the old
// ground-drawn cardinal labels used, just no longer projected onto the sky
// itself (see render.js drawGround), so it can't drift or garble near the
// zenith the way the sky-drawn version did.
function Compass({ az }) {
  return (
    <div className="compass" title={`Facing ${Math.round(az)}°`}>
      <svg viewBox="0 0 60 60" width="42" height="42">
        <circle cx="30" cy="30" r="27" className="compass-ring" />
        <line x1="30" y1="5" x2="30" y2="10" className="compass-tick" />
        <line x1="30" y1="50" x2="30" y2="55" className="compass-tick" />
        <line x1="5" y1="30" x2="10" y2="30" className="compass-tick" />
        <line x1="50" y1="30" x2="55" y2="30" className="compass-tick" />
        <text x="30" y="16" className="compass-lbl compass-n">N</text>
        <text x="30" y="48" className="compass-lbl">S</text>
        <text x="14" y="34" className="compass-lbl">W</text>
        <text x="46" y="34" className="compass-lbl">E</text>
        <g style={{ transform: `rotate(${az}deg)`, transformOrigin: '30px 30px', transition: 'transform .15s linear' }}>
          <polygon points="30,10 25,32 30,27 35,32" className="compass-needle" />
        </g>
      </svg>
    </div>
  );
}

export default function TimeBar({ onChange }) {
  const st = Observatory.state;
  const hud = st.hud;

  return (
    <footer className="timebar">
      <div className="clock">
        <div className="utc">{hud.local || '—'}</div>
        <div className="meta">{hud.utc} · {hud.loc} · JD {hud.jd ? hud.jd.toFixed(3) : '—'} · LST {hud.lst} · {hud.rate}</div>
      </div>

      <div className="controls">
        <input type="datetime-local" value={toLocalInput(st.date)}
               onChange={e => { if (e.target.value) { Observatory.setTime(new Date(e.target.value)); onChange(); } }} />
        <button className="now" onClick={() => { Observatory.now(); onChange(); }}>Now</button>
        <button className="play" onClick={() => { Observatory.togglePlay(); onChange(); }}>
          {st.playing ? '❚❚' : '►'}
        </button>
        <div className="rates">
          {RATES.map(([icon, r, title]) => (
            <button key={r} title={title}
                    className={st.playing && st.timeRate === r ? 'active' : ''}
                    onClick={() => { Observatory.setRate(r); onChange(); }}>{icon}</button>
          ))}
        </div>
      </div>

      <div className="fov-block">
        <Compass az={st.center.az} />
        <div className="fov">
          <span>FOV</span>
          <input type="range" min="0" max={SLIDER_MAX} step="1" value={fovToSlider(st.fov)}
                 onChange={e => { Observatory.setFov(sliderToFov(+e.target.value)); onChange(); }} />
          <b>{formatFov(st.fov)}°</b>
        </div>
      </div>
    </footer>
  );
}
