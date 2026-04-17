// pages/api/data/suppliers.js
import { createClient } from '@supabase/supabase-js'

const supa = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const db = supa()

  try {
    if (req.method === 'GET') {
      const { data, error } = await db.from('suppliers').select('*').order('created_at', { ascending: true })
      if (error) throw error
      return res.json({ ok: true, suppliers: data || [] })
    }

    if (req.method === 'POST') {
      const supplier = req.body
      const { data, error } = await db.from('suppliers').upsert({
        id: supplier.id,
        data: supplier,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' }).select()
      if (error) throw error
      return res.json({ ok: true, supplier: data?.[0] })
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Missing id' })
      const { error } = await db.from('suppliers').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (err) {
    console.error('[Suppliers API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
