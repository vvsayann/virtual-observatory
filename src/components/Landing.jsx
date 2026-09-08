import React, { useEffect, useState } from 'react';
import { fetchHeroImages } from '../lib/images.js';

// Curated deep-space photography — real Hubble/Webb/observatory imagery,
// resolved at runtime via Wikipedia so we never ship binary assets. Used as
// an immediate backdrop (no blank flash) and as the permanent fallback if
// the hero video below can't load (offline, blocked, slow connection).
const HERO_TITLES = [
  'Pillars of Creation', 'Andromeda Galaxy', 'Orion Nebula',
  'Carina Nebula', 'Whirlpool Galaxy', 'Horsehead Nebula',
  'Crab Nebula', 'Sombrero Galaxy',
];
const SLIDE_MS = 5000;

// Hero background: NASA Goddard's Solar System visualization — the Sun and
// all eight planets in realistic-rendered motion — streamed directly from
// NASA's Scientific Visualization Studio archive, the same "real imagery at
// runtime, no shipped binary assets" approach as the rest of the app. Only a
// WebM rendition exists for this one (no MP4 fallback is published); if a
// browser can't play it, onError below falls back to the photo slideshow.
const SPACE_VIDEO_SOURCES = [
  { src: 'https://svs.gsfc.nasa.gov/vis/a020000/a020200/a020249/SolarSystem_H264_1080p.webm', type: 'video/webm' },
];

// Transition length for the "zoom into the site" effect below — kept in one
// place so the CSS animation (landingZoom, in styles.css) and the timer that
// actually swaps in the observatory stay in sync.
const ZOOM_MS = 650;

export default function Landing({ onEnter }) {
  const [slides, setSlides] = useState([]);
  const [i, setI] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [zooming, setZooming] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchHeroImages(HERO_TITLES).then(imgs => { if (alive) setSlides(imgs); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    // slideshow only needed until the video takes over, and stops once we're
    // mid zoom-transition into the app
    if (videoReady || zooming || slides.length < 2) return;
    const t = setInterval(() => setI(v => (v + 1) % slides.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [slides.length, videoReady, zooming]);

  const showDots = !videoReady && !zooming && slides.length > 1;

  // "Go to Virtual Observatory" zooms into the current view instead of
  // hard-cutting to the app — the landing page scales up and fades under the
  // click point (see .landing.zooming in styles.css), then onEnter() swaps
  // in the observatory once that animation has actually finished, so the
  // reveal reads as "zoom in, then it pops out" rather than a jump-cut.
  function handleEnter(e) {
    if (zooming) return;
    const r = e.currentTarget.getBoundingClientRect();
    document.documentElement.style.setProperty('--zoom-x', `${r.left + r.width / 2}px`);
    document.documentElement.style.setProperty('--zoom-y', `${r.top + r.height / 2}px`);
    setZooming(true);
    setTimeout(onEnter, ZOOM_MS);
  }

  return (
    <div className={'landing' + (zooming ? ' zooming' : '')}>
      <div className="landing-bg">
        {slides.map((s, idx) => (
          <div
            key={s.src}
            className={'landing-slide' + (idx === i ? ' active' : '')}
            style={{ backgroundImage: `url(${s.src})` }}
          />
        ))}
        {!videoFailed && (
          <video
            className={'landing-video' + (videoReady ? ' active' : '')}
            autoPlay muted loop playsInline preload="auto"
            onCanPlay={() => setVideoReady(true)}
            onError={() => setVideoFailed(true)}
          >
            {SPACE_VIDEO_SOURCES.map(s => <source key={s.src} src={s.src} type={s.type} />)}
          </video>
        )}
      </div>
      <div className="landing-scrim" />

      <div className="landing-content">
        <div className="landing-kicker">Real-Time Sky Simulation</div>
        <div className="landing-brand">
          <span className="logo">✦</span> Virtual Observatory
        </div>
        <p className="landing-tagline">
          A live, real-sky planetarium in your browser — real stars, planets and
          deep-sky objects, positioned exactly as they appear from anywhere on
          Earth, right now.
        </p>
        <button className="landing-cta" onClick={handleEnter} disabled={zooming}>
          Go to Virtual Observatory <span>→</span>
        </button>
      </div>

      <div className="landing-credit">
        {videoReady
          ? 'Video: NASA Goddard Space Flight Center — Solar System Visualization'
          : 'Imagery: NASA · ESA · Wikimedia Commons'}
      </div>

      {showDots && (
        <div className="landing-dots">
          {slides.map((s, idx) => (
            <span key={s.src} className={idx === i ? 'active' : ''} />
          ))}
        </div>
      )}
    </div>
  );
}
