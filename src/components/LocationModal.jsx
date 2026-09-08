import React, { useState } from 'react';
import { Observatory } from '../lib/observatory.js';

export default function LocationModal({ onClose, onSet }) {
  const st = Observatory.state;
  const [lat, setLat] = useState(st.location.lat);
  const [lon, setLon] = useState(st.location.lon);
  const [name, setName] = useState(st.location.name);
  const [tz, setTz] = useState(st.location.tz || null);
  const [busy, setBusy] = useState(false);

  function apply(la, lo, nm, z) { Observatory.setLocation(+la, +lo, nm, z); onSet(); }
  function pickCity(e) {
    const c = Observatory.CITIES[+e.target.value];
    if (c) { setName(c[0]); setLat(c[1]); setLon(c[2]); setTz(c[3] || null); }
  }
  function geolocate() {
    if (!navigator.geolocation) return;
    setBusy(true);
    // the device's own timezone is the correct one for its current position
    const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    navigator.geolocation.getCurrentPosition(
      p => { setBusy(false); apply(p.coords.latitude, p.coords.longitude, 'My location', myTz); },
      () => setBusy(false), { timeout: 8000 }
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Observing location</h2>
        <label className="fld">Preset city
          <select onChange={pickCity} defaultValue="">
            <option value="" disabled>Choose a city…</option>
            {Observatory.CITIES.map((c, i) => <option key={i} value={i}>{c[0]}</option>)}
          </select>
        </label>
        <div className="fld-row">
          <label className="fld">Latitude °
            <input type="number" step="0.0001" value={lat} onChange={e => { setLat(e.target.value); setTz(null); }} />
          </label>
          <label className="fld">Longitude °
            <input type="number" step="0.0001" value={lon} onChange={e => { setLon(e.target.value); setTz(null); }} />
          </label>
        </div>
        <label className="fld">Label
          <input value={name} onChange={e => setName(e.target.value)} />
        </label>
        {!tz && <div className="tz-note">No known timezone for this spot — local time shown will be an approximation from longitude.</div>}
        <button className="geo" onClick={geolocate} disabled={busy}>
          {busy ? 'Locating…' : '📡 Use my current location'}
        </button>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => apply(lat, lon, name, tz)}>Set location</button>
        </div>
      </div>
    </div>
  );
}
