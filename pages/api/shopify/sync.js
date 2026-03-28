// POST /api/shopify/sync
// Pulls live products + inventory from Shopify, stores snapshot in Supabase
// Called by: cron job every 6 hours, or manually from dashboard

import { getShopifyProducts, getShopifyInventory, getShopifyLocations, getShopifySalesVelocity } from '../../../lib/shopify'
import { supabaseAdmin } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Simple cron secret check
  const secret = req.headers['x-cron-secret']
  if (secret !== process.env.NEXTAUTH_SECRET && !req.headers.authorization) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const orgId = req.body?.org_id || req.query?.org_id
  if (!orgId) return res.status(400).json({ error: 'org_id required' })

  try {
    console.log('[Shopify Sync] Starting...')

    // 1. Get locations — find which Shopify location maps to each FC
    const locations = await getShopifyLocations()
    console.log('[Shopify Sync] Locations:', locations.map(l => l.name))

    // Map Shopify locations to your FC IDs
    // UPDATE THESE to match your actual Shopify location names
    const LOCATION_MAP = {
      '11/81 Cooper St, Campbellfield': 'vi',
      'Internal Warehouse': 'vi',
      // Tidal Wave uses ShipHero, not Shopify inventory
    }

    // 2. Get all active products
    const products = await getShopifyProducts()
    console.log(`[Shopify Sync] ${products.length} products found`)

    // 3. Get 30-day sales velocity
    const velocity = await getShopifySalesVelocity()

    // 4. Build inventory item → product map
    const itemToProduct = {}
    for (const p of products) {
      for (const v of p.variants) {
        if (v.inventory_item_id) {
          itemToProduct[v.inventory_item_id] = { title: p.title, sku: v.sku }
        }
      }
    }

    // 5. Fetch inventory per mapped location
    const snapshots = []
    for (const loc of locations) {
      const fcId = LOCATION_MAP[loc.name]
      if (!fcId || !loc.active) continue

      const invLevels = await getShopifyInventory(loc.id)
      for (const inv of invLevels) {
        const prod = itemToProduct[inv.inventory_item_id]
        if (!prod || inv.available === null) continue
        const dailyVelocity = prod.sku ? (velocity[prod.sku] || 0) : 0
        snapshots.push({
          org_id: orgId,
          fc_id: fcId,
          product_sku: prod.sku || `shopify-${inv.inventory_item_id}`,
          product_title: prod.title,
          on_hand: inv.available,
          available: inv.available,
          allocated: 0,
          daily_velocity: dailyVelocity,
          source: 'shopify',
          snapped_at: new Date().toISOString(),
        })
      }
    }

    // 6. Insert snapshots (upsert not needed — we keep history)
    if (snapshots.length > 0) {
      const { error } = await supabaseAdmin.from('stock_snapshots').insert(snapshots)
      if (error) throw error
    }

    console.log(`[Shopify Sync] Done. ${snapshots.length} snapshots written.`)
    res.json({ ok: true, products: products.length, snapshots: snapshots.length })
  } catch (err) {
    console.error('[Shopify Sync] Error:', err)
    res.status(500).json({ error: err.message })
  }
}
