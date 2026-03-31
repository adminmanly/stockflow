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

    // Step 1: Fetch first products page, locations, first orders page in parallel
    const [prodRes, locRes, firstOrdersRes] = await Promise.all([
      fetch(`${BASE}/products.json?limit=250`, { headers: HEADERS }),
      fetch(`${BASE}/locations.json`, { headers: HEADERS }),
      fetch(`${BASE}/orders.json?status=any&financial_status=paid&created_at_min=${since30.toISOString()}&limit=250&fields=id,line_items,shipping_address`, { headers: HEADERS })
    ])

    if (!prodRes.ok) throw new Error(`Shopify products error: ${prodRes.status}`)
    if (!locRes.ok) throw new Error(`Shopify locations error: ${locRes.status}`)

    const [prodData, locData] = await Promise.all([prodRes.json(), locRes.json()])

    // Build SKU map from page 1
    const itemToSku = {}
    const skuToItemId = {}
    const processProducts = (products) => {
      for (const p of products) {
        for (const v of p.variants) {
          if (v.sku && v.inventory_item_id) {
            itemToSku[v.inventory_item_id] = v.sku
            skuToItemId[v.sku] = v.inventory_item_id
          }
        }
      }
    }
    processProducts(prodData.products)

    const locations = locData.locations.filter(l => l.active)
    const auLocation = locations.find(l => l.name === '11/81 Cooper St, Campbellfield')

    // Step 2: Fetch products pages 2 & 3 in parallel (to find all 8 SKUs)
    const lastId1 = prodData.products[prodData.products.length - 1]?.id
    if (lastId1 && prodData.products.length === 250) {
      const prod2Res = await fetch(`${BASE}/products.json?limit=250&since_id=${lastId1}`, { headers: HEADERS })
      if (prod2Res.ok) {
        const prod2Data = await prod2Res.json()
        processProducts(prod2Data.products)

        // Fetch page 3 if needed
        if (prod2Data.products.length === 250) {
          const lastId2 = prod2Data.products[prod2Data.products.length - 1]?.id
          if (lastId2) {
            const prod3Res = await fetch(`${BASE}/products.json?limit=250&since_id=${lastId2}`, { headers: HEADERS })
            if (prod3Res.ok) {
              const prod3Data = await prod3Res.json()
              processProducts(prod3Data.products)
            }
          }
        }
      }
    }

    // Step 3: Get AU warehouse stock for all found SKUs
    const auStockBySku = {}
    if (auLocation) {
      const trackedItemIds = Object.keys(SKU_MAP).map(s => skuToItemId[s]).filter(Boolean)
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

    // Step 4: Process orders with pagination
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

    // Build response
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
      skus_mapped: Object.keys(skuToItemId).length,
    })

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
