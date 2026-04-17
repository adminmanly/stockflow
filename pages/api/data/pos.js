// pages/api/data/pos.js
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
      const { data, error } = await db.from('purchase_orders').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return res.json({ ok: true, pos: data || [] })
    }

    if (req.method === 'POST') {
      const po = req.body
      const { data, error } = await db.from('purchase_orders').upsert({
        id: po.id,
        data: po,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' }).select()
      if (error) throw error
      return res.json({ ok: true, po: data?.[0] })
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Missing id' })
      const { error } = await db.from('purchase_orders').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (err) {
    console.error('[POs API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
