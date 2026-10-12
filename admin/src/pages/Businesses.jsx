import React, { useCallback, useEffect, useState } from 'react';
import { api, date, dateTime, ksh } from '../api.js';

const STATES = ['', 'trial', 'active', 'expired', 'suspended'];

export function StateBadge({ state }) {
  return <span className={`badge ${state}`}>{state}</span>;
}

export default function Businesses() {
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ businesses: [], total: 0, pageSize: 25 });
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    api(`/businesses?search=${encodeURIComponent(search)}&state=${state}&page=${page}`).then(setData).catch((e) => alert(e.message));
  }, [search, state, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <>
      <h2>Businesses <span className="muted">({data.total})</span></h2>
      <div className="toolbar">
        <input placeholder="Search name, owner or phone" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}>
          {STATES.map((s) => <option key={s} value={s}>{s || 'All states'}</option>)}
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Business</th><th>Owner</th><th>Phone</th><th>Type</th><th>Status</th><th>Ends</th><th>Last sync</th><th>Joined</th></tr>
          </thead>
          <tbody>
            {data.businesses.map((b) => (
              <tr key={b.id} onClick={() => setSelected(b.id)} className="clickable">
                <td><strong>{b.name}</strong><div className="muted small">{b.location || ''}</div></td>
                <td>{b.ownerName || '-'}</td>
                <td>{b.phone}</td>
                <td>{b.businessType}</td>
                <td><StateBadge state={b.subscription.state} /></td>
                <td>{date(b.subscription.endsAt)}</td>
                <td>{dateTime(b.lastSyncAt)}</td>
                <td>{date(b.createdAt)}</td>
              </tr>
            ))}
            {!data.businesses.length && <tr><td colSpan="8" className="muted center">No businesses found</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className="btn ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
      {selected && <BusinessDrawer id={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </>
  );
}

function BusinessDrawer({ id, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [grant, setGrant] = useState({ planCode: 'basic', months: 1, note: '' });
  const [trialDays, setTrialDays] = useState(7);
  const [attachCode, setAttachCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/businesses/${id}`).then(setData), [id]);
  useEffect(() => {
    load();
    api('/plans').then((r) => setPlans(r.plans));
  }, [load]);

  async function act(fn) {
    setBusy(true);
    try { await fn(); await load(); onChanged(); } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  if (!data) return <div className="drawer-bg" onClick={onClose}><div className="drawer" onClick={(e) => e.stopPropagation()}>Loading...</div></div>;
  const b = data.business;

  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <h2>{b.name}</h2>
        <p className="muted">{b.ownerName} · {b.phone} · {b.businessType}{b.location ? ` · ${b.location}` : ''}</p>
        <p><StateBadge state={b.subscription.state} /> {b.planCode ? `Plan: ${b.planCode}` : ''}</p>
        <div className="kv">
          <span>Trial ends</span><span>{dateTime(b.trialEndsAt)}</span>
          <span>Subscription ends</span><span>{dateTime(b.subscriptionEndsAt)}</span>
          <span>Last sync</span><span>{dateTime(b.lastSyncAt)}</span>
          <span>Joined</span><span>{dateTime(b.createdAt)}</span>
        </div>

        <h3>Referrals</h3>
        <div className="kv">
          <span>Their invite code</span><span><code className="code">{b.referralCode}</code></span>
          <span>Referred by</span><span>{data.referredBy ? `${data.referredBy.referrer_name} (${data.referredBy.referrer_type}, ${data.referredBy.status === 'converted' ? 'paid' : 'on trial'})` : 'Nobody'}</span>
          <span>They referred</span><span>{data.referred.n} businesses, {data.referred.converted} paid</span>
        </div>
        {!data.referredBy && (
          <div className="action" style={{ marginTop: 8 }}>
            <input placeholder="Agent or business code" value={attachCode} onChange={(e) => setAttachCode(e.target.value.toUpperCase())} style={{ width: 180 }} />
            <button className="btn small ghost" disabled={busy || !attachCode} onClick={() => act(() => api('/referrals/attach', { method: 'POST', body: { businessId: id, code: attachCode } }))}>Link referrer</button>
          </div>
        )}

        <h3>Branches and staff</h3>
        <div className="kv">
          {data.branches.map((br) => (
            <React.Fragment key={br.id}><span>Branch</span><span>{br.name}{br.location ? ` · ${br.location}` : ''}</span></React.Fragment>
          ))}
          {data.employees.map((e) => (
            <React.Fragment key={e.id}>
              <span>{e.role}</span>
              <span>{e.name} · {e.phone}{e.is_active ? '' : ' (off)'}{e.last_seen_at ? ` · seen ${dateTime(e.last_seen_at)}` : ''}</span>
            </React.Fragment>
          ))}
          {!data.employees.length && <><span>Staff</span><span className="muted">None</span></>}
        </div>

        <h3>Usage</h3>
        <div className="kv">
          <span>Sales</span><span>{data.usage.sales}</span>
          <span>Expenses</span><span>{data.usage.expenses}</span>
          <span>Customers</span><span>{data.usage.customers}</span>
          <span>Deni entries</span><span>{data.usage.debt_entries}</span>
          <span>Products</span><span>{data.usage.products}</span>
        </div>

        <h3>Actions</h3>
        <div className="action">
          <span>Extend trial by</span>
          <input type="number" min="1" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} style={{ width: 70 }} />
          <span>days</span>
          <button className="btn small" disabled={busy} onClick={() => act(() => api(`/businesses/${id}`, { method: 'PATCH', body: { extendTrialDays: Number(trialDays) } }))}>Extend</button>
        </div>
        <div className="action">
          <span>Record cash payment</span>
          <select value={grant.planCode} onChange={(e) => setGrant({ ...grant, planCode: e.target.value })}>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name} ({ksh(p.price_kes)})</option>)}
          </select>
          <input type="number" min="1" max="24" value={grant.months} onChange={(e) => setGrant({ ...grant, months: e.target.value })} style={{ width: 60 }} />
          <span>periods</span>
          <button className="btn small" disabled={busy} onClick={() => act(() => api(`/businesses/${id}/grant`, { method: 'POST', body: { ...grant, months: Number(grant.months) } }))}>Activate</button>
        </div>
        <div className="action">
          {b.status === 'active'
            ? <button className="btn danger small" disabled={busy} onClick={() => confirm('Suspend this business?') && act(() => api(`/businesses/${id}`, { method: 'PATCH', body: { status: 'suspended' } }))}>Suspend account</button>
            : <button className="btn small" disabled={busy} onClick={() => act(() => api(`/businesses/${id}`, { method: 'PATCH', body: { status: 'active' } }))}>Reactivate account</button>}
        </div>

        <h3>Payments</h3>
        <table>
          <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead>
          <tbody>
            {data.payments.map((p) => (
              <tr key={p.id}>
                <td>{dateTime(p.created_at)}</td><td>{p.plan_code}</td><td>{ksh(p.amount)}</td>
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                <td>{p.mpesa_receipt || (p.source === 'manual' ? 'manual' : '-')}</td>
              </tr>
            ))}
            {!data.payments.length && <tr><td colSpan="5" className="muted center">No payments yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
