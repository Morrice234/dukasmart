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
      </div>
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
