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
  const [newPin, setNewPin] = useState(null);
  const [smsAmount, setSmsAmount] = useState(20); // { who, phone, pin } shown after a reset

  const load = useCallback(() => api(`/businesses/${id}`).then(setData), [id]);
  useEffect(() => {
    load();
    api('/plans').then((r) => setPlans(r.plans));
  }, [load]);

  async function act(fn) {
    setBusy(true);
    try { await fn(); await load(); onChanged(); } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  // Owner or staff forgot their PIN: set a temporary one and show it so you can tell them
  async function resetPin(path, who) {
    if (!confirm(`Set a new PIN for ${who}? Only do this after confirming it is really them, for example by calling the phone number on the account.`)) return;
    setBusy(true);
    try {
      const r = await api(path, { method: 'POST' });
      setNewPin({ who, phone: r.phone, pin: r.pin });
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  async function deleteForever() {
    const typed = prompt(`This permanently deletes ${data.business.name} and ALL its sales, expenses, deni, stock, staff and payment records. It cannot be undone.\n\nType the business name exactly to confirm:`);
    if (typed === null) return;
    setBusy(true);
    try {
      await api(`/businesses/${id}`, { method: 'DELETE', body: { confirmName: typed.trim() } });
      onChanged();
      onClose();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
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
              <span>
                {e.name} · {e.phone}{e.is_active ? '' : ' (off)'}{e.last_seen_at ? ` · seen ${dateTime(e.last_seen_at)}` : ''}{' '}
                <button className="link-btn" disabled={busy} onClick={() => resetPin(`/employees/${e.id}/reset-pin`, e.name)}>Reset PIN</button>
              </span>
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
          <span>SMS left</span><span>{b.smsCredits}</span>
          <span>SMS sent</span><span>{data.sms ? `${data.sms.sent} messages (${data.sms.used} SMS)${data.sms.last_sent ? `, last ${dateTime(data.sms.last_sent)}` : ''}` : '-'}</span>
        </div>

        <TillPanel businessId={id} branches={data.branches} />

        <h3>Actions</h3>
        {newPin && (
          <div className="pin-box">
            <div>New PIN for <strong>{newPin.who}</strong> ({newPin.phone}):</div>
            <div className="pin">{newPin.pin}</div>
            <div className="muted small">Tell them this PIN by phone call. It is shown only once. They sign in with their phone number and this PIN.</div>
            <button className="btn small ghost" onClick={() => setNewPin(null)}>Done</button>
          </div>
        )}
        <div className="action">
          <span>Owner forgot their PIN</span>
          <button className="btn small" disabled={busy} onClick={() => resetPin(`/businesses/${id}/reset-pin`, `${b.ownerName || b.name} (owner)`)}>Reset owner PIN</button>
        </div>
        <div className="action">
          <span>Give SMS reminders</span>
          <input type="number" value={smsAmount} onChange={(e) => setSmsAmount(e.target.value)} style={{ width: 70 }} />
          <button className="btn small" disabled={busy || !Number(smsAmount)} onClick={() => act(() => api(`/businesses/${id}/sms-credits`, { method: 'POST', body: { amount: Number(smsAmount) } }))}>Add</button>
          <span className="muted small">Use a minus number to take some back</span>
        </div>
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
        <div className="action">
          <span className="muted small">Shop asked for its data to be deleted?</span>
          <button className="btn small danger" disabled={busy} onClick={deleteForever}>Delete business permanently</button>
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

const TILL_STATUS = {
  active: ['Connected', 'active'],
  pending: ['Waiting for first payment', 'trial'],
  failed: ['Not connected', 'failed'],
  disabled: ['Paused', 'suspended'],
};

// Connects the shop's own Lipa na M-Pesa till so every payment becomes a sale in the app
function TillPanel({ businessId, branches }) {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => api(`/businesses/${businessId}/till`).then((r) => {
    setInfo(r);
    const c = r.connection;
    setForm({
      environment: c ? c.environment : 'production',
      kind: c ? c.kind || 'till' : 'till',
      passkey: '',
      shortcode: c ? c.shortcode : '',
      tillNumber: c ? c.tillNumber || '' : '',
      branchId: c ? c.branchId || '' : '',
      consumerKey: '',
      consumerSecret: '',
    });
  }).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [businessId]);

  if (!info || !form) return <><h3>M-Pesa till</h3><p className="muted small">{msg || 'Loading...'}</p></>;
  const c = info.connection;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function run(fn, done) {
    setBusy(true); setMsg('');
    try { const r = await fn(); await load(); if (done) setMsg(done(r)); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  const save = (e) => {
    e.preventDefault();
    run(() => api(`/businesses/${businessId}/till`, { method: 'PUT', body: form }),
      (r) => (r.connection.status === 'active' ? 'Connected. Ask the owner to pay KSh 10 to the till to test it.' : r.connection.lastError || 'Saved'));
  };

  return (
    <>
      <h3>M-Pesa till</h3>
      {c ? (
        <div className="kv">
          <span>Status</span><span><span className={`badge ${TILL_STATUS[c.status][1]}`}>{TILL_STATUS[c.status][0]}</span> {c.environment === 'sandbox' ? '(sandbox)' : ''}</span>
          <span>Till / store</span><span>{c.tillNumber || '-'} / {c.shortcode}</span>
          <span>Last payment</span><span>{c.lastPaymentAt ? dateTime(c.lastPaymentAt) : 'none yet'}</span>
          <span>Payment prompts</span><span>{c.stkEnabled ? 'On (staff can send M-Pesa prompts)' : 'Off (add the passkey to turn on)'}</span>
          {c.lastError ? <><span>Problem</span><span className="error">{c.lastError}</span></> : null}
        </div>
      ) : <p className="muted small">Not connected. The owner must first take the till live on Daraja (see the steps in the setup guide), then enter the live app's keys here.</p>}

      <form className="till-form" onSubmit={save}>
        <label>Environment
          <select value={form.environment} onChange={set('environment')}>
            <option value="production">Live (real payments)</option>
            <option value="sandbox">Sandbox (testing)</option>
          </select>
        </label>
        <label>Type
          <select value={form.kind} onChange={set('kind')}>
            <option value="till">Till (Buy Goods)</option>
            <option value="paybill">Paybill</option>
          </select>
        </label>
        <label>Store number or paybill (the shortcode used on Daraja)<input value={form.shortcode} onChange={set('shortcode')} required placeholder="e.g. 5123456" /></label>
        <label>Till number customers pay to<input value={form.tillNumber} onChange={set('tillNumber')} placeholder="e.g. 9123456" /></label>
        {branches.length > 1 ? (
          <label>Record payments in branch
            <select value={form.branchId} onChange={set('branchId')}>
              <option value="">Main branch</option>
              {branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
            </select>
          </label>
        ) : null}
        <label>Consumer key{c ? ' (leave empty to keep the saved one)' : ''}<input value={form.consumerKey} onChange={set('consumerKey')} autoComplete="off" required={!c} /></label>
        <label>Consumer secret{c ? ' (leave empty to keep the saved one)' : ''}<input type="password" value={form.consumerSecret} onChange={set('consumerSecret')} autoComplete="new-password" required={!c} /></label>
        <label>M-Pesa Express passkey, for payment prompts (from Safaricom's go-live email){c && c.stkEnabled ? ' (leave empty to keep the saved one)' : ' (optional)'}<input type="password" value={form.passkey} onChange={set('passkey')} autoComplete="new-password" /></label>
        <div className="row-buttons">
          <button className="btn small" disabled={busy}>{c ? 'Save and register again' : 'Connect till'}</button>
          {c && c.environment === 'sandbox' ? (
            <button type="button" className="btn small ghost" disabled={busy} onClick={() => run(() => api(`/businesses/${businessId}/till/simulate`, { method: 'POST', body: { amount: 10 } }), () => 'Test payment sent. It should appear below in a few seconds; click Refresh.')}>Send test payment</button>
          ) : null}
          {c && c.status !== 'disabled' ? (
            <button type="button" className="btn small ghost" disabled={busy} onClick={() => confirm('Stop recording this till\'s payments?') && run(() => api(`/businesses/${businessId}/till/disable`, { method: 'POST' }), () => 'Paused')}>Pause</button>
          ) : null}
          {c ? <button type="button" className="btn small ghost" disabled={busy} onClick={() => run(async () => {}, () => '')}>Refresh</button> : null}
        </div>
        {msg ? <p className="small" style={{ marginTop: 8 }}>{msg}</p> : null}
      </form>

      {info.payments.length ? (
        <table className="table small">
          <tbody>
            {info.payments.map((p) => (
              <tr key={p.trans_id}><td>{dateTime(Number(p.paid_at))}</td><td>{p.trans_id}</td><td>{p.payer_name || '-'}</td><td>{ksh(p.amount)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
