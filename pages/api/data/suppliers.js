// pages/api/data/suppliers.js
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supaFetch = (path, opts = {}) => fetch(`${SUPA_URL}/rest/v1/${path}`, {
  ...opts,
  headers: {
    'apikey': SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    ...opts.headers,
  }
})

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'GET') {
      const r = await supaFetch('suppliers?select=*&order=created_at.asc')
      if (!r.ok) throw new Error(`Supabase error: ${r.status}`)
      const data = await r.json()
      return res.json({ ok: true, suppliers: data || [] })
    }

    if (req.method === 'POST') {
      const supplier = req.body
      const r = await supaFetch('suppliers', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ id: supplier.id, data: supplier, updated_at: new Date().toISOString() })
      })
      if (!r.ok) { const e = await r.text(); throw new Error(e) }
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Missing id' })
      const r = await supaFetch(`suppliers?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`Delete error: ${r.status}`)
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (err) {
    console.error('[Suppliers API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
