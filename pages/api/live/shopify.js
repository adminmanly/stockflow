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

    // Step 1: Look up all 8 SKUs via variants API + get locations + start orders — all in parallel
    const skuLookups = Object.keys(SKU_MAP).map(sku =>
      fetch(`${BASE}/variants.json?sku=${encodeURIComponent(sku)}&limit=5`, { headers: HEADERS })
    )

    const [locRes, firstOrdersRes, ...variantResponses] = await Promise.all([
      fetch(`${BASE}/locations.json`, { headers: HEADERS }),
      fetch(`${BASE}/orders.json?status=any&financial_status=paid&created_at_min=${since30.toISOString()}&limit=250&fields=id,line_items,shipping_address`, { headers: HEADERS }),
      ...skuLookups
    ])

    if (!locRes.ok) throw new Error(`Shopify locations error: ${locRes.status}`)

    const locData = await locRes.json()
    const locations = locData.locations.filter(l => l.active)
    const auLocation = locations.find(l => l.name === '11/81 Cooper St, Campbellfield')

    // Build SKU -> inventory_item_id map from variant lookups
    const itemToSku = {}
    const skuToItemId = {}

    const variantData = await Promise.all(variantResponses.map(r => r.ok ? r.json() : { variants: [] }))
    for (const data of variantData) {
      for (const v of data.variants || []) {
        if (v.sku && v.inventory_item_id) {
          itemToSku[v.inventory_item_id] = v.sku
          skuToItemId[v.sku] = v.inventory_item_id
        }
      }
    }

    // Step 2: Get AU warehouse stock using exact inventory item IDs
    const auStockBySku = {}
    if (auLocation) {
      const trackedItemIds = Object.keys(SKU_MAP).map(sku => skuToItemId[sku]).filter(Boolean)
      if (trackedItemIds.length > 0) {
        const invRes = await fetch(
          `${BASE}/inventory_levels.json?location_id=${auLocation.id}&inventory_item_ids=${trackedItemIds.join(',')}&limit=250`,
          { headers: HEADERS }
        )
        if (invRes.ok) {
          const invData = await invRes.json()
          for (const level of invData.inventory_levels) {
            const sku = itemToSku[level.inventory_item_id]
            if (!sku) continue
            auStockBySku[sku] = Math.max(0, level.available || 0)
          }
        }
      }
    }

    // Step 3: Process orders with pagination
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

    // Step 4: Build response
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
      orders_analysed: totalOrders,
      period_days: 30,
      skus_found: Object.keys(skuToItemId).length,
    })

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
