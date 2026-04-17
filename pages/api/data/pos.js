// pages/api/data/pos.js
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supaFetch = (path, opts = {}) => fetch(`${SUPA_URL}/rest/v1/${path}`, {
  ...opts,
  headers: {
    'apikey': SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': opts.prefer || '',
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
      const r = await supaFetch('purchase_orders?select=*&order=created_at.desc')
      if (!r.ok) throw new Error(`Supabase error: ${r.status}`)
      const data = await r.json()
      return res.json({ ok: true, pos: data || [] })
    }

    if (req.method === 'POST') {
      const po = req.body
      const r = await supaFetch('purchase_orders', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ id: po.id, data: po, updated_at: new Date().toISOString() })
      })
      if (!r.ok) { const e = await r.text(); throw new Error(e) }
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Missing id' })
      const r = await supaFetch(`purchase_orders?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`Delete error: ${r.status}`)
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (err) {
    console.error('[POs API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
