// GET /api/alerts/check
// Vercel cron calls this every 6 hours
// Also calls Shopify + ShipHero sync first, then checks levels

import { checkStockAlerts } from '../../../lib/alerts'
import { supabaseAdmin } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  // Verify this is a legitimate cron call
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.NEXTAUTH_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Get all orgs
    const { data: orgs, error } = await supabaseAdmin.from('organisations').select('id, name')
    if (error) throw error

    const results = []
    for (const org of orgs) {
      try {
        // 1. Sync Shopify inventory first
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/shopify/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.NEXTAUTH_SECRET },
          body: JSON.stringify({ org_id: org.id }),
        })

        // 2. Sync ShipHero inventory
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/shiphero/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.NEXTAUTH_SECRET },
          body: JSON.stringify({ org_id: org.id }),
        })

        // 3. Check alerts
        const result = await checkStockAlerts(org.id)
        results.push({ org: org.name, ...result })
      } catch (orgErr) {
        results.push({ org: org.name, error: orgErr.message })
      }
    }

    res.json({ ok: true, checked: results.length, results })
  } catch (err) {
    console.error('[Alerts Cron] Error:', err)
    res.status(500).json({ error: err.message })
  }
}
