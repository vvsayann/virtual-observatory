import React from 'react';
import { createRoot } from 'react-dom/client';
// Side-effect imports: these populate window.STAR_DATA / STAR_NAMES /
// CONST_LINES / CONST_META / DSO_DATA before the engine reads them.
import './data/stars.js';
import './data/constellations.js';
import './data/dso.js';
import App from './App.jsx';
import { Observatory } from './lib/observatory.js';
import { Astro } from './lib/astro.js';
import { Renderer } from './lib/render.js';
import './styles.css';

// Bridge for classic-script plugins (Antigravity WP-B/WP-C, see migration.md):
// they can hook the engine via window.Observatory once it is ready.
window.Observatory = Observatory;
window.Astro = Astro;
window.Renderer = Renderer;

createRoot(document.getElementById('root')).render(<App />);
