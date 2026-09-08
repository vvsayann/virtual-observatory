import React from 'react';

// Small, consistent line-icon set for the layers panel — replaces the old
// mixed emoji glyphs (one of which, 木, was literally the CJK character for
// "tree" standing in for constellation lines) with a single coherent style:
// 15px, currentColor stroke, matching weight, so the panel reads as one
// designed thing instead of whatever glyphs happened to render per-platform.
const base = { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const ICONS = {
  stars: (
    <svg {...base}>
      <path d="M8 1.5l1.3 3.9 4 .3-3.1 2.6 1 3.9L8 10.1l-3.2 2.1 1-3.9-3.1-2.6 4-.3z" />
    </svg>
  ),
  milkyway: (
    <svg {...base}>
      <path d="M1.5 5.5c2-1.6 4.5-1.6 6.5 0s4.5 1.6 6.5 0" />
      <path d="M1.5 8c2-1.6 4.5-1.6 6.5 0s4.5 1.6 6.5 0" />
      <path d="M1.5 10.5c2-1.6 4.5-1.6 6.5 0s4.5 1.6 6.5 0" />
    </svg>
  ),
  constellations: (
    <svg {...base}>
      <circle cx="3" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="8" cy="3" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="13" cy="9" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="13" r="1.15" fill="currentColor" stroke="none" />
      <path d="M3 12L8 3M8 3l5 6M13 9l-3.5 4" strokeWidth="1" opacity=".8" />
    </svg>
  ),
  planets: (
    <svg {...base}>
      <circle cx="8" cy="8" r="3.2" />
      <ellipse cx="8" cy="8" rx="6.7" ry="2.1" transform="rotate(-24 8 8)" />
    </svg>
  ),
  dso: (
    <svg {...base}>
      <path d="M8 1.8c.4 2.6 1.6 3.8 4.2 4.2-2.6.4-3.8 1.6-4.2 4.2-.4-2.6-1.6-3.8-4.2-4.2 2.6-.4 3.8-1.6 4.2-4.2z" />
      <circle cx="12.7" cy="12.7" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  labels: (
    <svg {...base}>
      <path d="M2 7.2V3a1 1 0 0 1 1-1h4.2a1 1 0 0 1 .7.3l6.1 6.1a1 1 0 0 1 0 1.4l-4.4 4.4a1 1 0 0 1-1.4 0L2.3 7.9a1 1 0 0 1-.3-.7z" />
      <circle cx="5" cy="5" r=".9" fill="currentColor" stroke="none" />
    </svg>
  ),
  grid: (
    <svg {...base}>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M1.7 8h12.6M8 1.7v12.6" strokeWidth="1" opacity=".75" />
    </svg>
  ),
  ground: (
    <svg {...base}>
      <path d="M1.3 11.5h13.4" />
      <path d="M3.3 11.5l3-5 2.2 3 1.6-2.5 2.6 4.5" strokeLinejoin="round" />
    </svg>
  ),
};

export default function Icon({ name }) {
  return ICONS[name] || null;
}
