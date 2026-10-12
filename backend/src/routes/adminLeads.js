const express = require('express');
const { query } = require('../db');
const { HttpError, normalizePhone } = require('../utils');

// Mounted under /api/admin/leads, after requireAdmin
const router = express.Router();

const STATUSES = ['new', 'contacted', 'interested', 'follow_up', 'converted', 'lost'];
const INTEREST = ['hot', 'warm', 'cold'];
const FIELDS = ['business_name', 'contact_name', 'phone', 'business_type', 'location', 'status', 'interest', 'objection', 'source', 'agent_id', 'next_follow_up'];

function buildFilters(q) {
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (q.search) {
    params.push(`%${q.search}%`);
    const n = params.length;
    where.push(`(l.business_name ILIKE $${n} OR l.contact_name ILIKE $${n} OR l.phone ILIKE $${n} OR l.location ILIKE $${n})`);
  }
  if (STATUSES.includes(q.status)) add('l.status = ?', q.status);
  else if (q.status === 'open') where.push(`l.status NOT IN ('converted', 'lost')`);
  if (INTEREST.includes(q.interest)) add('l.interest = ?', q.interest);
  if (q.agentId) add('l.agent_id = ?', q.agentId);
  if (q.businessType) add('l.business_type = ?', q.businessType);
  if (q.due === 'today') where.push(`l.next_follow_up <= current_date AND l.status NOT IN ('converted', 'lost')`);
  if (q.due === 'overdue') where.push(`l.next_follow_up < current_date AND l.status NOT IN ('converted', 'lost')`);
  if (q.due === 'week') where.push(`l.next_follow_up <= current_date + 7 AND l.status NOT IN ('converted', 'lost')`);
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function clean(body) {
  const out = {};
  for (const f of FIELDS) {
    if (body[f] === undefined) continue;
    let v = body[f] === '' ? null : body[f];
    if (f === 'phone' && v) {
      const p = normalizePhone(v);
      if (!p) throw new HttpError(400, 'Enter a valid phone number or leave it empty');
      v = p;
    }
    if (f === 'status' && !STATUSES.includes(v)) throw new HttpError(400, 'Invalid status');
    if (f === 'interest' && !INTEREST.includes(v)) throw new HttpError(400, 'Invalid interest level');
    out[f] = v;
  }
  return out;
}

router.get('/summary', async (req, res) => {
  const counts = (await query('SELECT status, count(*)::int AS n FROM leads GROUP BY status')).rows;
  const due = (await query(`
    SELECT count(*) FILTER (WHERE next_follow_up = current_date)::int AS today,
           count(*) FILTER (WHERE next_follow_up < current_date)::int AS overdue
      FROM leads WHERE status NOT IN ('converted', 'lost')`)).rows[0];
  res.json({ byStatus: Object.fromEntries(counts.map((c) => [c.status, c.n])), dueToday: due.today, overdue: due.overdue });
});

router.get('/export.csv', async (req, res) => {
  const { whereSql, params } = buildFilters(req.query);
  const { rows } = await query(
    `SELECT l.*, a.name AS agent_name FROM leads l LEFT JOIN agents a ON a.id = l.agent_id ${whereSql} ORDER BY l.created_at DESC`,
    params
  );
  const cols = ['business_name', 'contact_name', 'phone', 'business_type', 'location', 'status', 'interest', 'objection', 'source', 'agent_name', 'next_follow_up', 'created_at'];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="dukasmart-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

router.get('/', async (req, res) => {
  const pageSize = 50;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const { whereSql, params } = buildFilters(req.query);
  const total = Number((await query(`SELECT count(*) FROM leads l ${whereSql}`, params)).rows[0].count);
  const { rows } = await query(
    `SELECT l.*, a.name AS agent_name,
            (SELECT note FROM lead_notes n WHERE n.lead_id = l.id ORDER BY created_at DESC LIMIT 1) AS last_note,
            (SELECT count(*)::int FROM lead_notes n WHERE n.lead_id = l.id) AS notes_count
       FROM leads l LEFT JOIN agents a ON a.id = l.agent_id
       ${whereSql}
      ORDER BY (l.status IN ('converted', 'lost')), l.next_follow_up NULLS LAST, l.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  res.json({ leads: rows, total, pageSize });
});

router.get('/:id', async (req, res) => {
  const lead = (await query(
    `SELECT l.*, a.name AS agent_name, b.name AS converted_business_name
       FROM leads l LEFT JOIN agents a ON a.id = l.agent_id LEFT JOIN businesses b ON b.id = l.converted_business_id
      WHERE l.id = $1`, [req.params.id])).rows[0];
  if (!lead) throw new HttpError(404, 'Lead not found');
  const notes = (await query('SELECT * FROM lead_notes WHERE lead_id = $1 ORDER BY created_at DESC', [lead.id])).rows;
  res.json({ lead, notes });
});

router.post('/', async (req, res) => {
  const data = clean(req.body || {});
  if (!data.business_name || !String(data.business_name).trim()) throw new HttpError(400, 'Business name is required');
  if (data.phone) {
    const customer = (await query('SELECT id, name FROM businesses WHERE phone = $1', [data.phone])).rows[0];
    if (customer) throw new HttpError(409, `${customer.name} is already a customer with this number`);
    const dup = (await query(`SELECT id FROM leads WHERE phone = $1 AND status NOT IN ('converted', 'lost')`, [data.phone])).rows[0];
    if (dup) throw new HttpError(409, 'There is already an open lead with this phone number');
  }
  const cols = Object.keys(data);
  const { rows } = await query(
    `INSERT INTO leads (${[...cols, 'created_by'].join(', ')}) VALUES (${[...cols, 'created_by'].map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    [...cols.map((c) => data[c]), req.admin.email]
  );
  const firstNote = req.body && req.body.note && String(req.body.note).trim();
  if (firstNote) await query('INSERT INTO lead_notes (lead_id, note, author) VALUES ($1, $2, $3)', [rows[0].id, firstNote, req.admin.email]);
  res.status(201).json({ lead: rows[0] });
});

router.patch('/:id', async (req, res) => {
  const data = clean(req.body || {});
  const cols = Object.keys(data);
  if (!cols.length) throw new HttpError(400, 'Nothing to update');
  const { rows } = await query(
    `UPDATE leads SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [req.params.id, ...cols.map((c) => data[c])]
  );
  if (!rows[0]) throw new HttpError(404, 'Lead not found');
  res.json({ lead: rows[0] });
});

// Body: { note, status?, nextFollowUp? }  Logging a call and setting the next date in one go
router.post('/:id/notes', async (req, res) => {
  const { note, status, nextFollowUp } = req.body || {};
  if (!note || !String(note).trim()) throw new HttpError(400, 'Write a note');
  const lead = (await query('SELECT id FROM leads WHERE id = $1', [req.params.id])).rows[0];
  if (!lead) throw new HttpError(404, 'Lead not found');
  if (status && !STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
  await query('INSERT INTO lead_notes (lead_id, note, author) VALUES ($1, $2, $3)', [lead.id, String(note).trim(), req.admin.email]);
  await query(
    `UPDATE leads SET status = COALESCE($2, status),
            next_follow_up = CASE WHEN $3::text IS NULL THEN next_follow_up WHEN $3::text = '' THEN NULL ELSE $3::date END,
            updated_at = now()
      WHERE id = $1`,
    [lead.id, status || null, nextFollowUp === undefined ? null : nextFollowUp]
  );
  res.status(201).json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM leads WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
