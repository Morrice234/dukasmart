import React, { useEffect, useState } from 'react';
import { api, dateTime, ksh } from '../api.js';

export default function Payments() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ payments: [], pageSize: 50 });

  useEffect(() => {
    api(`/payments?status=${status}&page=${page}`).then(setData).catch((e) => alert(e.message));
  }, [status, page]);

  return (
    <>
      <h2>Payments</h2>
      <div className="toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          {['', 'success', 'pending', 'failed', 'cancelled'].map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Business</th><th>Phone</th><th>Plan</th><th>Amount</th><th>Status</th><th>Receipt</th><th>Details</th></tr></thead>
          <tbody>
            {data.payments.map((p) => (
              <tr key={p.id}>
                <td>{dateTime(p.created_at)}</td>
                <td>{p.business_name}</td>
                <td>{p.phone}</td>
                <td>{p.plan_code}</td>
                <td>{ksh(p.amount)}</td>
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                <td>{p.mpesa_receipt || (p.source === 'manual' ? 'manual' : '-')}</td>
                <td className="muted small">{p.result_desc || ''}</td>
              </tr>
            ))}
            {!data.payments.length && <tr><td colSpan="8" className="muted center">No payments</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page}</span>
        <button className="btn ghost" disabled={data.payments.length < data.pageSize} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </>
  );
}
