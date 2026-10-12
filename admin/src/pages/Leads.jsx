import React, { useCallback, useEffect, useState } from 'react';
import { api, apiDownload, date, dateTime } from '../api.js';

const STATUSES = ['new', 'contacted', 'interested', 'follow_up', 'converted', 'lost'];
const STATUS_LABEL = { new: 'New', contacted: 'Contacted', interested: 'Interested', follow_up: 'Follow up', converted: 'Converted', lost: 'Lost' };
const TYPES = ['duka', 'barbershop', 'salon', 'food', 'other'];
const OBJECTIONS = ['No money right now', 'Wants to ask partner', 'Uses a book already', 'Not comfortable with phones', 'Wants to see it working first', 'Busy, come back later'];
const EMPTY = {
  business_name: '', contact_name: '', phone: '', business_type: 'duka', location: '', status: 'interested',
  interest: 'warm', objection: '', source: '', agent_id: '', next_follow_up: '', note: '',
};

function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

export default function Leads() {
  const [filters, setFilters] = useState({ search: '', status: 'open', interest: '', due: '', agentId: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ leads: [], total: 0, pageSize: 50 });
  const [summary, setSummary] = useState(null);
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState(null);
  const [openId, setOpenId] = useState(null);

  const qs = () => new URLSearchParams({ ...filters, page }).toString();
  const load = useCallback(() => {
    api(`/leads?${qs()}`).then(setData).catch((e) => alert(e.message));
    api('/leads/summary').then(setSummary).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { api('/agents').then((r) => setAgents(r.agents)).catch(() => {}); }, []);

  const setF = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };

  async function save(e) {
    e.preventDefault();
    try {
      const body = { ...form };
      if (form.id) {
        delete body.note;
        await api(`/leads/${form.id}`, { method: 'PATCH', body });
      } else {
        await api('/leads', { method: 'POST', body });
      }
      setForm(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <>
      <h2>Leads <span className="muted">({data.total})</span></h2>
      {summary && (
        <div className="chip-row">
          <button className={`chip ${filters.due === 'today' ? 'on' : ''}`} onClick={() => setFilters({ ...filters, due: filters.due === 'today' ? '' : 'today', status: 'open' })}>
            Due today or earlier: <strong>{summary.dueToday + summary.overdue}</strong>
          </button>
          <button className={`chip ${filters.due === 'overdue' ? 'on' : ''}`} onClick={() => setFilters({ ...filters, due: filters.due === 'overdue' ? '' : 'overdue', status: 'open' })}>
            Overdue: <strong>{summary.overdue}</strong>
          </button>
          {STATUSES.map((s) => (
            <button key={s} className={`chip ${filters.status === s ? 'on' : ''}`} onClick={() => setFilters({ ...filters, status: filters.status === s ? 'open' : s, due: '' })}>
              {STATUS_LABEL[s]}: <strong>{summary.byStatus[s] || 0}</strong>
            </button>
          ))}
        </div>
      )}
      <div className="toolbar">
        <input placeholder="Search name, phone or area" value={filters.search} onChange={setF('search')} />
        <select value={filters.status} onChange={setF('status')}>
          <option value="open">Open leads</option>
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={filters.interest} onChange={setF('interest')}>
          <option value="">Any interest</option>
          <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
        </select>
        <select value={filters.agentId} onChange={setF('agentId')}>
          <option value="">Any agent</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="btn ghost" onClick={() => apiDownload(`/leads/export.csv?${qs()}`, `dukasmart-leads-${today()}.csv`)}>Export CSV</button>
        <button className="btn" onClick={() => setForm({ ...EMPTY, next_follow_up: today(7) })}>Add lead</button>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Business</th><th>Contact</th><th>Status</th><th>Interest</th><th>Objection</th><th>Follow up</th><th>Last note</th><th>Agent</th></tr>
          </thead>
          <tbody>
            {data.leads.map((l) => {
              const overdue = l.next_follow_up && l.next_follow_up.slice(0, 10) < today() && !['converted', 'lost'].includes(l.status);
              return (
                <tr key={l.id} className="clickable" onClick={() => setOpenId(l.id)}>
                  <td><strong>{l.business_name}</strong><div className="muted small">{[l.business_type, l.location].filter(Boolean).join(' · ')}</div></td>
                  <td>{l.contact_name || '-'}<div className="muted small">{l.phone || ''}</div></td>
                  <td><span className={`badge lead-${l.status}`}>{STATUS_LABEL[l.status]}</span></td>
                  <td><span className={`badge interest-${l.interest}`}>{l.interest}</span></td>
                  <td className="small">{l.objection || ''}</td>
                  <td className={overdue ? 'error' : ''}>{l.next_follow_up ? date(l.next_follow_up) : '-'}</td>
                  <td className="small muted" style={{ maxWidth: 220 }}>{l.last_note || ''}</td>
                  <td className="small">{l.agent_name || ''}</td>
                </tr>
              );
            })}
            {!data.leads.length && <tr><td colSpan="8" className="muted center">No leads match these filters</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className="btn ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>

      {form && <LeadForm form={form} setForm={setForm} agents={agents} onSubmit={save} />}
      {openId && (
        <LeadDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onEdit={(lead) => { setOpenId(null); setForm({ ...EMPTY, ...lead, agent_id: lead.agent_id || '', next_follow_up: lead.next_follow_up ? lead.next_follow_up.slice(0, 10) : '' }); }}
        />
      )}
    </>
  );
}

function LeadForm({ form, setForm, agents, onSubmit }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="drawer-bg" onClick={() => setForm(null)}>
      <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <button type="button" className="close" onClick={() => setForm(null)}>×</button>
        <h2>{form.id ? 'Edit lead' : 'New lead'}</h2>
        <label>Business name<input value={form.business_name} onChange={set('business_name')} required /></label>
        <div className="grid2">
          <label>Contact person<input value={form.contact_name || ''} onChange={set('contact_name')} /></label>
          <label>Phone<input value={form.phone || ''} onChange={set('phone')} placeholder="07..." /></label>
          <label>Type<select value={form.business_type || ''} onChange={set('business_type')}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label>Area<input value={form.location || ''} onChange={set('location')} placeholder="e.g. Githurai 45" /></label>
          <label>Status<select value={form.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
          <label>Interest<select value={form.interest} onChange={set('interest')}><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select></label>
          <label>Next follow up<input type="date" value={form.next_follow_up || ''} onChange={set('next_follow_up')} /></label>
          <label>Brought in by<select value={form.agent_id || ''} onChange={set('agent_id')}><option value="">Me</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        </div>
        <label>Why not ready yet
          <input list="objections" value={form.objection || ''} onChange={set('objection')} placeholder="Pick or type" />
          <datalist id="objections">{OBJECTIONS.map((o) => <option key={o} value={o} />)}</datalist>
        </label>
        <label>Source<input value={form.source || ''} onChange={set('source')} placeholder="e.g. Door to door, WhatsApp group" /></label>
        {!form.id && <label>First note<textarea rows="3" value={form.note} onChange={set('note')} placeholder="What did they say?" /></label>}
        <button className="btn">Save lead</button>
      </form>
    </div>
  );
}

function LeadDrawer({ id, onClose, onChanged, onEdit }) {
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(() => api(`/leads/${id}`).then((d) => { setData(d); setStatus(d.lead.status); }), [id]);
  useEffect(() => { load(); }, [load]);

  async function addNote(e) {
    e.preventDefault();
    try {
      await api(`/leads/${id}/notes`, { method: 'POST', body: { note, status, ...(nextDate ? { nextFollowUp: nextDate } : {}) } });
      setNote(''); setNextDate('');
      await load(); onChanged();
    } catch (err) { alert(err.message); }
  }

  async function remove() {
    if (!confirm('Delete this lead and its notes?')) return;
    await api(`/leads/${id}`, { method: 'DELETE' });
    onChanged(); onClose();
  }

  if (!data) return <div className="drawer-bg" onClick={onClose}><div className="drawer">Loading...</div></div>;
  const l = data.lead;
  const waText = encodeURIComponent(`Habari ${l.contact_name || ''}, this is about DukaSmart, the app for tracking sales, expenses and deni. Are you ready to start your free trial?`);
  const wa = l.phone ? `https://wa.me/${l.phone}?text=${waText}` : null;

  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <h2>{l.business_name}</h2>
        <p className="muted">{[l.contact_name, l.phone, l.business_type, l.location].filter(Boolean).join(' · ')}</p>
        <p>
          <span className={`badge lead-${l.status}`}>{STATUS_LABEL[l.status]}</span>{' '}
          <span className={`badge interest-${l.interest}`}>{l.interest}</span>
          {l.converted_business_name && <span className="muted"> Signed up as {l.converted_business_name}</span>}
        </p>
        <div className="kv">
          <span>Why not ready</span><span>{l.objection || '-'}</span>
          <span>Next follow up</span><span>{l.next_follow_up ? date(l.next_follow_up) : '-'}</span>
          <span>Source</span><span>{l.source || '-'}</span>
          <span>Brought in by</span><span>{l.agent_name || 'You'}</span>
          <span>Added</span><span>{dateTime(l.created_at)} {l.created_by ? `by ${l.created_by}` : ''}</span>
        </div>
        <div className="action" style={{ marginTop: 14 }}>
          {l.phone && <a className="btn small" href={`tel:+${l.phone}`}>Call</a>}
          {wa && <a className="btn small ghost" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
          <button className="btn small ghost" onClick={() => onEdit(l)}>Edit</button>
          <button className="btn small danger" onClick={remove}>Delete</button>
        </div>

        <h3>Log a follow up</h3>
        <form onSubmit={addNote} className="note-form">
          <textarea rows="3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called, says come back after the 15th when salary comes" required />
          <div className="action">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
            <span className="muted small">Next follow up</span>
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            {[3, 7, 14, 30].map((d) => <button type="button" key={d} className="btn small ghost" onClick={() => setNextDate(today(d))}>+{d}d</button>)}
          </div>
          <button className="btn">Save note</button>
        </form>

        <h3>History</h3>
        {data.notes.map((n) => (
          <div key={n.id} className="note">
            <div className="muted small">{dateTime(n.created_at)} {n.author ? `· ${n.author}` : ''}</div>
            <div>{n.note}</div>
          </div>
        ))}
        {!data.notes.length && <p className="muted">No notes yet</p>}
      </div>
    </div>
  );
}
