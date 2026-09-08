import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Observatory } from './lib/observatory.js';
import SearchBar from './components/SearchBar.jsx';
import InfoPanel from './components/InfoPanel.jsx';
import TimeBar from './components/TimeBar.jsx';
import LayersPanel from './components/LayersPanel.jsx';
import LocationModal from './components/LocationModal.jsx';
import Landing from './components/Landing.jsx';
import TabBar from './components/TabBar.jsx';
import WhatsUpTonight from './components/WhatsUpTonight.jsx';

// Re-render React at ~5Hz driven by the engine's per-frame 'tick'.
function useTick() {
  const [, bump] = useState(0);
  const last = useRef(0);
  useEffect(() => Observatory.on('tick', () => {
    const t = performance.now();
    if (t - last.current > 200) { last.current = t; bump(v => v + 1); }
  }), []);
}

export default function App() {
  const canvasRef = useRef(null);
  const booted = useRef(false);
  const [entered, setEntered] = useState(false);
  const [tab, setTab] = useState('sky');
  const [selected, setSelected] = useState(null);
  const [showLoc, setShowLoc] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [, force] = useState(0);
  useTick();

  useEffect(() => {
    if (!entered || booted.current) return;      // init only once, on entry
    booted.current = true;
    Observatory.init(canvasRef.current);
    const un = Observatory.on('select', obj => setSelected(obj));
    return un;
  }, [entered]);

  const st = Observatory.state;
  const rerender = useCallback(() => force(v => v + 1), []);

  if (!entered) return <Landing onEnter={() => setEntered(true)} />;

  return (
    <div className="app">
      <canvas id="sky" ref={canvasRef} style={{ visibility: tab === 'sky' ? 'visible' : 'hidden' }} />

      <header className="topbar">
        <div className="brand-mark"><span className="logo">✦</span><span className="name">Virtual Observatory</span></div>
        <TabBar active={tab} onChange={setTab} />
        {tab === 'sky' && (
          <>
            <SearchBar onGoto={obj => { Observatory.goToObject(obj); setShowHelp(false); }} />
            <button className="loc-btn" onClick={() => setShowLoc(true)} title="Set observing location">
              📍 {st.location.name}
            </button>
          </>
        )}
      </header>

      {tab === 'sky' && (
        <>
          <LayersPanel onChange={rerender} />

          <InfoPanel object={selected} onClose={() => { setSelected(null); Observatory.selectObject(null); }}
                     onGoto={() => selected && Observatory.goToObject(selected)} />

          <TimeBar onChange={rerender} />

          {showHelp && (
            <div className="help-hint" onClick={() => setShowHelp(false)}>
              <b>Drag</b> to look around · <b>Scroll</b> to zoom · <b>Click</b> an object · <b>Search</b> above
              <span className="dismiss">tap to dismiss</span>
            </div>
          )}
        </>
      )}

      {tab === 'tonight' && (
        <div className="tab-view">
          <WhatsUpTonight />
        </div>
      )}

      {showLoc && <LocationModal onClose={() => setShowLoc(false)} onSet={() => { rerender(); setShowLoc(false); }} />}
    </div>
  );
}
