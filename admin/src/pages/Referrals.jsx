import React, { useCallback, useEffect, useState } from 'react';
import { api, dateTime, ksh } from '../api.js';

const TABS = { payouts: 'Payouts', agents: 'Agents', referrals: 'All referrals', settings: 'Bonus rules' };

export default function Referrals() {
  const [tab, setTab] = useState('payouts');
  return (
    <>
      <h2>Referrals</h2>
      <div className="tabs">
        {Object.entries(TABS).map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'payouts' && <Payouts />}
      {tab === 'agents' && <Agents />}
      {tab === 'referrals' && <AllReferrals />}
      {tab === 'settings' && <BonusSettings />}
    </>
  );
}

function Payouts() {
  const [status, setStatus] = useState('pending');
  const [rewards, setRewards] = useState([]);
  const load = useCallback(() => api(`/rewards?kind=cash&status=${status}`).then((r) => setRewards(r.rewards)), [status]);
  useEffect(() => { load(); }, [load]);

  // Group pending cash by agent so you can send one M-Pesa per person
  const byAgent = {};
  rewards.forEach((r) => {
    if (!r.agent_id) return;
    byAgent[r.agent_id] = byAgent[r.agent_id] || { name: r.referrer_name, phone: r.referrer_phone, total: 0, count: 0 };
    byAgent[r.agent_id].total += r.amount;
    byAgent[r.agent_id].count += 1;
  });

  async function payAgent(agentId, a) {
    const ref = prompt(`Send ${ksh(a.total)} to ${a.name} (${a.phone}) on M-Pesa, then enter the M-Pesa confirmation code:`);
    if (ref === null) return;
    await api(`/agents/${agentId}/payout`, { method: 'POST', body: { paidRef: ref.trim() || null } });
    load();
  }

  async function act(r, action) {
    if (action === 'void' && !confirm('Cancel this reward? Use this for fake or refunded sign-ups.')) return;
    const body = action === 'pay' ? { paidRef: (prompt('M-Pesa confirmation code (optional)') || '').trim() || null } : {};
    await api(`/rewards/${r.id}/${action}`, { method: 'POST', body }).catch((e) => alert(e.message));
    load();
  }

  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">To pay</option><option value="paid">Paid</option><option value="void">Cancelled</option><option value="">All</option>
        </select>
      </div>
      {status === 'pending' && Object.keys(byAgent).length > 0 && (
        <div className="stats" style={{ marginBottom: 16 }}>
          {Object.entries(byAgent).map(([id, a]) => (
            <div key={id} className="card stat accent">
              <div className="muted">{a.name} · {a.phone}</div>
              <div className="stat-value">{ksh(a.total)}</div>
              <div className="muted small">{a.count} reward{a.count === 1 ? '' : 's'}</div>
              <button className="btn small" style={{ marginTop: 8 }} onClick={() => payAgent(id, a)}>Mark all paid</button>
            </div>
          ))}
        </div>
      )}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Agent</th><th>For business</th><th>Reason</th><th>Amount</th><th>Status</th><th>M-Pesa ref</th><th /></tr></thead>
          <tbody>
            {rewards.map((r) => (
              <tr key={r.id}>
                <td>{dateTime(r.created_at)}</td>
                <td>{r.referrer_name}<div className="muted small">{r.referrer_phone}</div></td>
                <td>{r.referee_name}</td>
                <td>{r.reason === 'conversion' ? 'First payment' : 'Renewal'}</td>
                <td>{ksh(r.amount)}</td>
                <td><span className={`badge reward-${r.status}`}>{r.status}</span></td>
                <td>{r.paid_ref || ''}</td>
                <td>
                  {r.status === 'pending' && (
                    <>
                      <button className="btn small" onClick={() => act(r, 'pay')}>Paid</button>{' '}
                      <button className="btn small ghost" onClick={() => act(r, 'void')}>Cancel</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!rewards.length && <tr><td colSpan="8" className="muted center">Nothing here</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Agents() {
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState(null);
  const load = () => api('/agents').then((r) => setAgents(r.agents));
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    try {
      if (form.id) await api(`/agents/${form.id}`, { method: 'PATCH', body: { name: form.name, notes: form.notes } });
      else await api('/agents', { method: 'POST', body: form });
      setForm(null);
      load();
    } catch (err) { alert(err.message); }
  }

  async function toggle(a) {
    await api(`/agents/${a.id}`, { method: 'PATCH', body: { isActive: !a.is_active } });
    load();
  }

  return (
    <>
      <p className="muted">Agents are friends or helpers who are not customers. Give them a code; when a business signs up with it and pays, they earn cash that you pay out from the Payouts tab.</p>
      <div className="toolbar"><button className="btn" onClick={() => setForm({ name: '', phone: '', code: '', notes: '' })}>Add agent</button></div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Code</th><th>Sign-ups</th><th>Paid customers</th><th>Open leads</th><th>To pay</th><th>Paid so far</th><th /></tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.5 }}>
                <td><strong>{a.name}</strong><div className="muted small">{a.phone}{a.notes ? ` · ${a.notes}` : ''}</div></td>
                <td><code className="code">{a.code}</code></td>
                <td>{a.signups}</td>
                <td>{a.conversions}</td>
                <td>{a.open_leads}</td>
                <td>{ksh(a.pending_cash)}</td>
                <td>{ksh(a.paid_cash)}</td>
                <td>
                  <button className="btn small ghost" onClick={() => setForm({ id: a.id, name: a.name, notes: a.notes || '' })}>Edit</button>{' '}
                  <button className="btn small ghost" onClick={() => toggle(a)}>{a.is_active ? 'Turn off' : 'Turn on'}</button>
                </td>
              </tr>
            ))}
            {!agents.length && <tr><td colSpan="8" className="muted center">No agents yet</td></tr>}
          </tbody>
        </table>
      </div>
      {form && (
        <div className="drawer-bg" onClick={() => setForm(null)}>
          <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <button type="button" className="close" onClick={() => setForm(null)}>×</button>
            <h2>{form.id ? 'Edit agent' : 'New agent'}</h2>
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            {!form.id && <label>M-Pesa number (for payouts)<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="07..." /></label>}
            {!form.id && <label>Code (leave empty to generate)<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. BRIAN" /></label>}
            <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Covers Kawangware and Kangemi" /></label>
            <button className="btn">Save agent</button>
          </form>
        </div>
      )}
    </>
  );
}

function AllReferrals() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  useEffect(() => { api(`/referrals?type=${type}&status=${status}`).then((r) => setRows(r.referrals)); }, [type, status]);

  return (
    <>
      <div className="toolbar">
        <select value={type} onChange={(e) => setType(e.target.value)}><option value="">Businesses and agents</option><option value="business">From businesses</option><option value="agent">From agents</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option><option value="signed_up">Signed up</option><option value="converted">Paid</option></select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Joined</th><th>New business</th><th>Referred by</th><th>Code</th><th>Status</th><th>Reward</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{dateTime(r.created_at)}</td>
                <td>{r.referee_name}<div className="muted small">{r.referee_phone}</div></td>
                <td>{r.referrer_name} <span className="muted small">({r.referrer_type})</span></td>
                <td><code className="code">{r.code_used}</code></td>
                <td><span className={`badge ${r.status === 'converted' ? 'success' : 'pending'}`}>{r.status === 'converted' ? 'paid' : 'on trial'}</span></td>
                <td>{r.referrer_type === 'business' ? (r.days_total ? `${r.days_total} free days` : '-') : (r.cash_total ? ksh(r.cash_total) : '-')}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="6" className="muted center">No referrals yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BonusSettings() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api('/settings').then((r) => setS(r.settings)); }, []);
  if (!s) return <p className="muted">Loading...</p>;

  async function save(e) {
    e.preventDefault();
    const r = await api('/settings', { method: 'PUT', body: s });
    setS(r.settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  const field = (k) => ({ type: 'number', min: 0, value: s[k], onChange: (e) => setS({ ...s, [k]: e.target.value }) });

  return (
    <form className="card settings" onSubmit={save}>
      <h3>Business referring a business</h3>
      <label>Free days the referring business gets when their friend pays for the first time<input {...field('referrer_bonus_days')} /></label>
      <label>Extra trial days for anyone who signs up with a code (business or agent code)<input {...field('referee_bonus_trial_days')} /></label>
      <h3>Agents</h3>
      <label>Cash (KSh) an agent earns when their business pays for the first time<input {...field('agent_conversion_cash')} /></label>
      <label>Cash (KSh) an agent earns on every renewal after that (0 turns this off)<input {...field('agent_recurring_cash')} /></label>
      <p className="muted small">Changes apply to payments made from now on. Rewards already earned are not changed.</p>
      <button className="btn">{saved ? 'Saved' : 'Save rules'}</button>
    </form>
  );
}
