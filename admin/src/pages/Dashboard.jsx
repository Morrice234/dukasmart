import React, { useEffect, useState } from 'react';
import { api, ksh } from '../api.js';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/stats').then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="muted">Loading...</p>;

  const max = Math.max(1, ...stats.signups.map((s) => s.count));
  const conversion = stats.total ? Math.round((stats.active / stats.total) * 100) : 0;

  return (
    <>
      <h2>Dashboard</h2>
      <div className="stats">
        <Stat label="Total businesses" value={stats.total} />
        <Stat label="On free trial" value={stats.trial} />
        <Stat label="Paying (active)" value={stats.active} accent />
        <Stat label="Expired" value={stats.expired} />
        <Stat label="Suspended" value={stats.suspended} />
        <Stat label="Used app in last 24h" value={stats.activeToday} />
        <Stat label="Revenue this month" value={ksh(stats.revenueMonth)} accent />
        <Stat label="Revenue all time" value={ksh(stats.revenueAllTime)} />
        <Stat label="Paying share" value={`${conversion}%`} />
        <Stat label="Open leads" value={stats.openLeads} />
        <Stat label="Leads to follow up now" value={stats.leadsDue} accent={stats.leadsDue > 0} />
        <Stat label="Referral sign-ups this month" value={stats.referralSignupsMonth} />
        <Stat label="Referrals that paid" value={stats.referralConversions} />
        <Stat label="Agent payouts owed" value={ksh(stats.pendingPayouts)} accent={stats.pendingPayouts > 0} />
        <Stat label="SMS sent this month" value={stats.smsSentMonth || 0} />
        <Stat label="SMS cost this month" value={ksh(stats.smsCostMonth || 0)} />
        <Stat label="App downloads this month" value={stats.downloadsMonth || 0} />
      </div>
      <AppRelease />
      <div className="card">
        <h3>Sign-ups, last 14 days</h3>
        <div className="bars">
          {stats.signups.map((s) => (
            <div key={s.day} className="bar-col" title={`${s.day}: ${s.count}`}>
              <span className="bar-val">{s.count || ''}</span>
              <div className="bar" style={{ height: `${(s.count / max) * 140}px` }} />
              <span className="bar-label">{s.day.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className={`card stat ${accent ? 'accent' : ''}`}>
      <div className="muted">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

// The Android app file people download from the invite links, until DukaSmart is on Play Store
function AppRelease() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ url: '', version: '', notes: '' });
  const [msg, setMsg] = useState('');
  const load = () => api('/app-release').then((r) => {
    setData(r);
    if (r.release) setForm({ url: r.release.url || '', version: r.release.version || '', notes: r.release.notes || '' });
  }).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    setMsg('');
    try {
      await api('/app-release', { method: 'PUT', body: form });
      setMsg('Saved. The download page and the in-app update notice now use this file.');
      load();
    } catch (err) {
      setMsg(err.message);
    }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <form className="card till-form" onSubmit={save}>
      <h3>Android app download</h3>
      {data ? (
        <p className="muted small">
          Download page: <a href={data.downloadPage} target="_blank" rel="noreferrer">{data.downloadPage}</a>
          {' '}· {data.stats.total} downloads ({data.stats.with_code} from invite links)
          {data.topCodes.length ? ` · Top codes: ${data.topCodes.map((c) => `${c.code} (${c.n})`).join(', ')}` : ''}
        </p>
      ) : null}
      <label>APK file link (https)<input value={form.url} onChange={set('url')} placeholder="https://github.com/.../releases/download/v1.0.6/dukasmart.apk" required /></label>
      <label>Version (must match the app's version)<input value={form.version} onChange={set('version')} placeholder="1.0.6" required /></label>
      <label>What is new (shown in the app's update notice, optional)<input value={form.notes} onChange={set('notes')} placeholder="Barcode scanning and M-Pesa prompts" /></label>
      <div className="row-buttons"><button className="btn small">Save</button></div>
      {msg ? <p className="small">{msg}</p> : null}
    </form>
  );
}
