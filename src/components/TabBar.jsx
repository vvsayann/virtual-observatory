import React from 'react';

const TABS = [
  { id: 'sky', label: 'Sky Map', icon: '✦' },
  { id: 'tonight', label: "What's Up Tonight", icon: '🌙' },
];

export default function TabBar({ active, onChange }) {
  return (
    <div className="tabbar">
      {TABS.map(t => (
        <button
          key={t.id}
          className={'tab' + (t.id === active ? ' active' : '')}
          onClick={() => onChange(t.id)}
        >
          <span className="tab-ic">{t.icon}</span>
          <span className="tab-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
