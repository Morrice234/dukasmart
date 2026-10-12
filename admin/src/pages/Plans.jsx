import React, { useEffect, useState } from 'react';
import { api, ksh } from '../api.js';

const EMPTY = { code: '', name: '', price_kes: '', duration_days: 30, features: '', is_active: true, sort_order: 0, max_branches: 1, max_employees: 0 };

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
      <div className="plans">
        {plans.map((p) => (
          <div key={p.code} className={`card plan ${p.is_active ? '' : 'inactive'}`}>
            <div className="plan-head"><strong>{p.name}</strong><span className="muted">{p.code}</span></div>
            <div className="stat-value">{ksh(p.price_kes)}<span className="muted small"> / {p.duration_days} days</span></div>
            <div className="muted small">{p.max_branches} branch{p.max_branches === 1 ? '' : 'es'} · {p.max_employees} staff</div>
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
