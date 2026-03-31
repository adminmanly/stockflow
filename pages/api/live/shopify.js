export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

  if (!domain || !token || token === 'leave-blank-for-now') {
    return res.status(500).json({ error: 'Shopify not configured' })
  }

  const BASE = `https://${domain}/admin/api/2024-04`
  const HEADERS = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }

  const SKU_MAP = {
    'BWc&c-MANLY': 'Body Wash',
    'Dc&c-MANLY': 'Deodorant',
    'SHAc&c-MANLY': 'Shampoo',
    'CONc&c-MANLY': 'Conditioner',
    'SSC&C': 'Ball Deodorant',
    'BB-MANLY': 'Body Buffer',
    'SCALP-MANLY': 'Scalp Scrubber',
    'CW-MANLY': 'Cooling Wipes',
  }

  const TRACKED_SKUS = new Set(Object.keys(SKU_MAP))

  try {
    const since30 = new Date()
    since30.setDate(since30.getDate() - 30)

    const [prodRes, locRes, firstOrdersRes] = await Promise.all([
      fetch(`${BASE}/products.json?limit=250`, { headers: HEADERS }),
      fetch(`${BASE}/locations.json`, { headers: HEADERS }),
      fetch(`${BASE}/orders.json?status=any&financial_status=paid&created_at_min=${since30.toISOString()}&limit=250&fields=id,line_items,shipping_address`, { headers: HEADERS })
    ])

    if (!prodRes.ok) throw new Error(`Shopify products error: ${prodRes.status}`)
    if (!locRes.ok) throw new Error(`Shopify locations error: ${locRes.status}`)

    const [prodData, locData] = await Promise.all([prodRes.json(), locRes.json()])

    const itemToSku = {}
    const skuToItemId = {}
    for (const p of prodData.products) {
      for (const v of p.variants) {
        if (v.sku && v.inventory_item_id) {
          itemToSku[String(v.inventory_item_id)] = v.sku
          skuToItemId[v.sku] = String(v.inventory_item_id)
        }
      }
    }

    const locations = locData.locations.filter(l => l.active)
    const auLocation = locations.find(l => l.name === '11/81 Cooper St, Campbellfield')

    // Try fetching inventory using item IDs directly (not location filter)
    // Use the 4 known working item IDs first as a test
    const allItemIds = Object.keys(SKU_MAP).map(s => skuToItemId[s]).filter(Boolean)
    
    let invStatus = 'not attempted'
    let invBody = null
    const auStockBySku = {}

    if (auLocation && allItemIds.length > 0) {
      // Try with inventory_item_ids filter
      const invUrl = `${BASE}/inventory_levels.json?location_id=${auLocation.id}&inventory_item_ids=${allItemIds.join(',')}&limit=250`
      const invRes = await fetch(invUrl, { headers: HEADERS })
      invStatus = invRes.status
      
      if (invRes.ok) {
        const invData = await invRes.json()
        invBody = invData.inventory_levels?.length
        for (const level of invData.inventory_levels || []) {
          const sku = itemToSku[String(level.inventory_item_id)]
          if (!sku) continue
          auStockBySku[sku] = Math.max(0, level.available || 0)
        }
      } else {
        // Try without location filter — just by item IDs
        const invRes2 = await fetch(`${BASE}/inventory_levels.json?inventory_item_ids=${allItemIds.join(',')}&limit=250`, { headers: HEADERS })
        if (invRes2.ok) {
          const invData2 = await invRes2.json()
          // Find the AU location's levels
          for (const level of invData2.inventory_levels || []) {
            if (String(level.location_id) !== String(auLocation.id)) continue
            const sku = itemToSku[String(level.inventory_item_id)]
            if (!sku) continue
            auStockBySku[sku] = Math.max(0, level.available || 0)
          }
        }
      }
    }

    // Process orders
    const soldBySkuUS = {}
    const soldBySkuAU = {}
    let totalOrders = 0
    let pageCount = 0
    let currentRes = firstOrdersRes

    while (currentRes && pageCount < 50) {
      if (!currentRes.ok) break
      const ordersData = await currentRes.json()
      totalOrders += (ordersData.orders || []).length
      pageCount++

      for (const order of ordersData.orders || []) {
        const country = order.shipping_address?.country_code || 'US'
        const isAU = country === 'AU'
        for (const item of order.line_items) {
          if (!item.sku || !TRACKED_SKUS.has(item.sku)) continue
          if (!parseFloat(item.price)) continue
          if (isAU) {
            soldBySkuAU[item.sku] = (soldBySkuAU[item.sku] || 0) + item.quantity
          } else {
            soldBySkuUS[item.sku] = (soldBySkuUS[item.sku] || 0) + item.quantity
          }
        }
      }

      const linkHeader = currentRes.headers.get('Link') || ''
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      currentRes = nextMatch ? await fetch(nextMatch[1], { headers: HEADERS }) : null
    }

    const auStockByProduct = {}
    const velocityUSByProduct = {}
    const velocityAUByProduct = {}

    for (const [sku, productName] of Object.entries(SKU_MAP)) {
      auStockByProduct[productName] = auStockBySku[sku] || 0
      velocityUSByProduct[productName] = +((soldBySkuUS[sku] || 0) / 30).toFixed(1)
      velocityAUByProduct[productName] = +((soldBySkuAU[sku] || 0) / 30).toFixed(1)
    }

    return res.json({
      ok: true,
      source: 'shopify',
      au_stock: auStockByProduct,
      velocity_us: velocityUSByProduct,
      velocity_au: velocityAUByProduct,
      au_location: auLocation?.name || 'not found',
      au_location_id: auLocation?.id,
      orders_analysed: totalOrders,
      period_days: 30,
      debug: {
        skus_mapped: Object.keys(skuToItemId).length,
        item_ids: allItemIds,
        inv_api_status: invStatus,
        inv_levels_count: invBody,
        au_stock_found: Object.keys(auStockBySku).length
      }
    })

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
