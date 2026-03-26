// POST /api/shiphero/sync
// Pulls live stock from ShipHero for Tidal Wave, stores snapshot in Supabase

import { getShipHeroInventory } from '../../../lib/shiphero'
import { supabaseAdmin } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const secret = req.headers['x-cron-secret']
  if (secret !== process.env.NEXTAUTH_SECRET && !req.headers.authorization) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const orgId = req.body?.org_id || req.query?.org_id
  if (!orgId) return res.status(400).json({ error: 'org_id required' })

  try {
    console.log('[ShipHero Sync] Pulling Tidal Wave inventory...')
    const items = await getShipHeroInventory()
    console.log(`[ShipHero Sync] ${items.length} SKUs found`)

    const snapshots = items
      .filter(i => i.sku && i.on_hand !== null)
      .map(i => ({
        org_id: orgId,
        fc_id: 'tw',  // Tidal Wave
        product_sku: i.sku,
        on_hand: i.on_hand,
        available: i.available,
        allocated: i.allocated,
        source: 'shiphero',
        snapped_at: new Date().toISOString(),
      }))

    if (snapshots.length > 0) {
      const { error } = await supabaseAdmin.from('stock_snapshots').insert(snapshots)
      if (error) throw error
    }

    console.log(`[ShipHero Sync] Done. ${snapshots.length} snapshots written.`)
    res.json({ ok: true, items: items.length, snapshots: snapshots.length })
  } catch (err) {
    console.error('[ShipHero Sync] Error:', err)
    res.status(500).json({ error: err.message })
  }
}
