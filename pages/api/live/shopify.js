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

    // Step 1: Fetch products p1, locations, first orders page — all parallel
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
    for (const product of prodData.products) {
      for (const variant of product.variants) {
        if (variant.sku && variant.inventory_item_id) {
          itemToSku[variant.inventory_item_id] = variant.sku
          skuToItemId[variant.sku] = variant.inventory_item_id
        }
      }
    }

    const locations = locData.locations.filter(l => l.active)
    const auLocation = locations.find(l => l.name === '11/81 Cooper St, Campbellfield')
    const lastProductId = prodData.products[prodData.products.length - 1]?.id

    // Step 2: Fetch products page 2 AND inventory levels for page-1 SKUs — parallel
    const page1ItemIds = Object.keys(SKU_MAP).map(s => skuToItemId[s]).filter(Boolean)

    const parallelFetches = []
    if (prodData.products.length === 250 && lastProductId) {
      parallelFetches.push(fetch(`${BASE}/products.json?limit=250&since_id=${lastProductId}`, { headers: HEADERS }))
    } else {
      parallelFetches.push(Promise.resolve(null))
    }
    if (auLocation && page1ItemIds.length > 0) {
      parallelFetches.push(fetch(`${BASE}/inventory_levels.json?location_id=${auLocation.id}&inventory_item_ids=${page1ItemIds.join(',')}&limit=250`, { headers: HEADERS }))
    } else {
      parallelFetches.push(Promise.resolve(null))
    }

    const [prod2Res, invRes] = await Promise.all(parallelFetches)

    // Process page 2 products
    if (prod2Res?.ok) {
      const prod2Data = await prod2Res.json()
      for (const product of prod2Data.products) {
        for (const variant of product.variants) {
          if (variant.sku && variant.inventory_item_id) {
            itemToSku[variant.inventory_item_id] = variant.sku
            skuToItemId[variant.sku] = variant.inventory_item_id
          }
        }
      }
    }

    // Process inventory levels from page 1 SKUs
    const auStockBySku = {}
    if (invRes?.ok) {
      const invData = await invRes.json()
      for (const level of invData.inventory_levels) {
        const sku = itemToSku[level.inventory_item_id]
        if (!sku) continue
        auStockBySku[sku] = Math.max(0, level.available || 0)
      }
    }

    // Step 3: Fetch inventory for any SKUs found only on page 2
    const missingInvSKUs = Object.keys(SKU_MAP).filter(s => skuToItemId[s] && !auStockBySku[s])
    if (missingInvSKUs.length > 0 && auLocation) {
      const missingItemIds = missingInvSKUs.map(s => skuToItemId[s]).filter(Boolean)
      if (missingItemIds.length > 0) {
        const inv2Res = await fetch(
          `${BASE}/inventory_levels.json?location_id=${auLocation.id}&inventory_item_ids=${missingItemIds.join(',')}&limit=250`,
          { headers: HEADERS }
        )
        if (inv2Res.ok) {
          const inv2Data = await inv2Res.json()
          for (const level of inv2Data.inventory_levels) {
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
