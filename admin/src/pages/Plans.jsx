import React, { useEffect, useState } from 'react';
import { api, ksh } from '../api.js';

const EMPTY = { code: '', name: '', price_kes: '', duration_days: 30, features: '', is_active: true, sort_order: 0, max_branches: 1, max_employees: 0, sms_credits: 0 };

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState(null);
  const [isNew, setIsNew] = useState(false);

  const load = () => api('/plans').then((r) => setPlans(r.plans));
  useEffect(() => { load(); }, []);

  function edit(p) {
    setIsNew(false);
    setForm({ ...p, features: (p.features || []).join('\n') });
  }

  async function save(e) {
    e.preventDefault();
    try {
      await api(`/plans/${encodeURIComponent(form.code.trim().toLowerCase())}`, {
        method: 'PUT',
        body: { ...form, features: form.features.split('\n').map((f) => f.trim()).filter(Boolean) },
      });
      setForm(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <>
      <h2>Plans</h2>
      <div className="toolbar"><button className="btn" onClick={() => { setIsNew(true); setForm(EMPTY); }}>New plan</button></div>
      <TrialSms />
      <div className="plans">
        {plans.map((p) => (
          <div key={p.code} className={`card plan ${p.is_active ? '' : 'inactive'}`}>
            <div className="plan-head"><strong>{p.name}</strong><span className="muted">{p.code}</span></div>
            <div className="stat-value">{ksh(p.price_kes)}<span className="muted small"> / {p.duration_days} days</span></div>
            <div className="muted small">{p.max_branches} branch{p.max_branches === 1 ? '' : 'es'} · {p.max_employees} staff · {p.sms_credits || 0} SMS</div>
            <ul>{(p.features || []).map((f) => <li key={f}>{f}</li>)}</ul>
            {!p.is_active && <p className="muted small">Hidden from app</p>}
            <button className="btn ghost small" onClick={() => edit(p)}>Edit</button>
          </div>
        ))}
      </div>

      {form && (
        <div className="drawer-bg" onClick={() => setForm(null)}>
          <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <button type="button" className="close" onClick={() => setForm(null)}>×</button>
            <h2>{isNew ? 'New plan' : `Edit ${form.name}`}</h2>
            <label>Code<input value={form.code} onChange={set('code')} disabled={!isNew} required placeholder="e.g. basic" /></label>
            <label>Name<input value={form.name} onChange={set('name')} required /></label>
            <label>Price (KSh)<input type="number" min="1" value={form.price_kes} onChange={set('price_kes')} required /></label>
            <label>Duration (days)<input type="number" min="1" value={form.duration_days} onChange={set('duration_days')} required /></label>
            <label>Max branches<input type="number" min="1" value={form.max_branches} onChange={set('max_branches')} required /></label>
            <label>Max staff accounts<input type="number" min="0" value={form.max_employees} onChange={set('max_employees')} required /></label>
            <label>SMS reminders included with each payment<input type="number" min="0" value={form.sms_credits} onChange={set('sms_credits')} /></label>
            <p className="muted small">Unused SMS carry over to the next period. Africa's Talking charges you roughly KSh 0.8 to 1 per SMS.</p>
            <label>Sort order<input type="number" value={form.sort_order} onChange={set('sort_order')} /></label>
            <label>Features (one per line)<textarea rows="5" value={form.features} onChange={set('features')} /></label>
            <label className="check"><input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> Show in app</label>
            <button className="btn">Save plan</button>
          </form>
        </div>
      )}
    </>
  );
}

// SMS reminders every new shop gets for its free trial
function TrialSms() {
  const [value, setValue] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api('/settings').then((r) => setValue(r.settings.trial_sms_credits)); }, []);
  if (value === null) return null;

  async function save(e) {
    e.preventDefault();
    try {
      const r = await api('/settings', { method: 'PUT', body: { trial_sms_credits: value } });
      setValue(r.settings.trial_sms_credits);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <form className="card action" onSubmit={save} style={{ marginBottom: 16 }}>
      <span>SMS reminders for new shops on free trial</span>
      <input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 70 }} />
      <button className="btn small">{saved ? 'Saved' : 'Save'}</button>
    </form>
  );
}
