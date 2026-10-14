import React, { useState } from 'react';
import { getToken, setToken } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Businesses from './pages/Businesses.jsx';
import Payments from './pages/Payments.jsx';
import Plans from './pages/Plans.jsx';
import Leads from './pages/Leads.jsx';
import Referrals from './pages/Referrals.jsx';

const PAGES = {
  dashboard: { label: 'Dashboard', component: Dashboard },
  businesses: { label: 'Businesses', component: Businesses },
  leads: { label: 'Leads', component: Leads },
  referrals: { label: 'Referrals', component: Referrals },
  payments: { label: 'Payments', component: Payments },
  plans: { label: 'Plans', component: Plans },
};

// /privacy and /delete-account are public. If they ever reach the admin app, send them to the static page.
const PUBLIC_PATHS = { '/privacy': '/privacy.html', '/delete-account': '/privacy.html#delete-account' };
const publicTarget = PUBLIC_PATHS[window.location.pathname.replace(/\/+$/, '')];
if (publicTarget) window.location.replace(publicTarget);

export default function App() {
  const [token, setTok] = useState(getToken());
  const [page, setPage] = useState('dashboard');

  if (publicTarget) return null;
  if (!token) return <Login onLogin={(t) => { setToken(t); setTok(t); }} />;

  const Page = PAGES[page].component;
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">DukaSmart <span>Admin</span></div>
        {Object.entries(PAGES).map(([key, p]) => (
          <button key={key} className={`nav ${page === key ? 'active' : ''}`} onClick={() => setPage(key)}>{p.label}</button>
        ))}
        <button className="nav logout" onClick={() => { setToken(null); setTok(null); }}>Sign out</button>
      </aside>
      <main className="content">
        <Page />
      </main>
    </div>
  );
}
