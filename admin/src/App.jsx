import React, { useEffect, useState } from 'react';
import { getToken, setToken } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Businesses from './pages/Businesses.jsx';
import Payments from './pages/Payments.jsx';
import Plans from './pages/Plans.jsx';
import Leads from './pages/Leads.jsx';
import Referrals from './pages/Referrals.jsx';

// Simple line icons (24px grid), drawn with currentColor
const ICONS = {
  dashboard: 'M4 13h6V4H4zm10 7h6V11h-6zM4 20h6v-4H4zm10-11h6V4h-6z',
  businesses: 'M4 10l1.5-5h13L20 10M4 10h16M4 10v9h16v-9M9 19v-5h6v5',
  leads: 'M12 4a4 4 0 110 8 4 4 0 010-8zm-7 16c0-3.3 3.1-6 7-6s7 2.7 7 6M19 4v4m-2-2h4',
  referrals: 'M7 7a3 3 0 110 6 3 3 0 010-6zm10 4a3 3 0 110 6 3 3 0 010-6zM9.6 11.4l4.8 2.2M3 20c0-2.5 1.8-4 4-4m10 4c0-2.2-1.6-3.6-3.6-3.9',
  payments: 'M3 7h18v10H3zM3 11h18M7 15h3',
  plans: 'M5 4h14v16l-7-4-7 4z',
  logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
};
export function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const PAGES = {
  dashboard: { label: 'Dashboard', component: Dashboard },
  businesses: { label: 'Businesses', component: Businesses },
  leads: { label: 'Leads', component: Leads },
  referrals: { label: 'Agents and referrals', component: Referrals },
  payments: { label: 'Payments', component: Payments },
  plans: { label: 'Plans and app', component: Plans },
};

// /privacy and /delete-account are public. If they ever reach the admin app, send them to the static page.
const PUBLIC_PATHS = { '/privacy': '/privacy.html', '/delete-account': '/privacy.html#delete-account', '/download': '/download.html', '/agent': '/agent.html' };
const path = window.location.pathname.replace(/\/+$/, '');
const inviteCode = (path.match(/^\/i\/([A-Za-z0-9]{3,20})$/) || [])[1];
const publicTarget = inviteCode ? `/download.html?code=${inviteCode}` : PUBLIC_PATHS[path];
if (publicTarget) window.location.replace(publicTarget);

export default function App() {
  const [token, setTok] = useState(getToken());
  // The open page lives in the address (#leads), so refreshing keeps you where you were
  const fromHash = () => (PAGES[window.location.hash.slice(1)] ? window.location.hash.slice(1) : 'dashboard');
  const [page, setPageState] = useState(fromHash);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setPageState(fromHash());
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey); };
  }, []);

  if (publicTarget) return null;
  if (!token) return <Login onLogin={(t) => { setToken(t); setTok(t); }} />;

  function go(key) {
    window.location.hash = key;
    setPageState(key);
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }

  const Page = PAGES[page].component;
  return (
    <div className={`layout ${menuOpen ? 'menu-open' : ''}`}>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen} aria-controls="sidebar">
          <Icon name="menu" size={24} />
        </button>
        <div className="brand-small"><span className="mark">D</span>{PAGES[page].label}</div>
      </header>

      <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />

      <aside className="sidebar" id="sidebar">
        <div className="sidebar-head">
          <div className="brand"><span className="mark">D</span><div>DukaSmart<small>Admin</small></div></div>
          <button className="icon-btn close-menu" onClick={() => setMenuOpen(false)} aria-label="Close menu"><Icon name="close" size={22} /></button>
        </div>
        <nav aria-label="Main">
          {Object.entries(PAGES).map(([key, p]) => (
            <button key={key} className={`nav ${page === key ? 'active' : ''}`} aria-current={page === key ? 'page' : undefined} onClick={() => go(key)}>
              <Icon name={key} />
              <span>{p.label}</span>
            </button>
          ))}
        </nav>
        <button className="nav logout" onClick={() => { setToken(null); setTok(null); }}>
          <Icon name="logout" />
          <span>Sign out</span>
        </button>
      </aside>

      <main className="content">
        <Page />
      </main>
    </div>
  );
}
