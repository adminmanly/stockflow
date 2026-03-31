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
    const cogsBySku = {}  // cost per item from Shopify variant

    for (const p of prodData.products) {
      for (const v of p.variants) {
        if (v.sku && v.inventory_item_id) {
          itemToSku[String(v.inventory_item_id)] = v.sku
          skuToItemId[v.sku] = String(v.inventory_item_id)
        }
      }
    }

    // Fetch COGS from inventory items API (has cost data)
    const trackedItemIdsList = Object.keys(SKU_MAP).map(s => skuToItemId[s]).filter(Boolean)
    if (trackedItemIdsList.length > 0) {
      const cogsRes = await fetch(
        `${BASE}/inventory_items.json?ids=${trackedItemIdsList.join(',')}&limit=250`,
        { headers: HEADERS }
      )
      if (cogsRes.ok) {
        const cogsData = await cogsRes.json()
        for (const item of cogsData.inventory_items || []) {
          const sku = itemToSku[String(item.id)]
          if (sku && item.cost) cogsBySku[sku] = parseFloat(item.cost)
        }
      }
    }

    const locations = locData.locations.filter(l => l.active)
    const auLocation = locations.find(l => l.name === '11/81 Cooper St, Campbellfield')

    const auStockBySku = {}
    if (auLocation && trackedItemIdsList.length > 0) {
      const invRes = await fetch(
        `${BASE}/inventory_levels.json?location_id=${auLocation.id}&inventory_item_ids=${trackedItemIdsList.join(',')}&limit=250`,
        { headers: HEADERS }
      )
      if (invRes.ok) {
        const invData = await invRes.json()
        for (const level of invData.inventory_levels || []) {
          if (String(level.location_id) !== String(auLocation.id)) continue
          const sku = itemToSku[String(level.inventory_item_id)]
          if (!sku) continue
          auStockBySku[sku] = Math.max(0, level.available || 0)
        }
      }
    }

    // Process orders — track velocity, country split, AND revenue per SKU for avg price
    const soldBySkuUS = {}
    const soldBySkuAU = {}
    const revBySku = {}   // total revenue per SKU (non-$0 lines only)
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
          const price = parseFloat(item.price)
          if (!price) continue  // skip $0 bundle additions

          if (isAU) {
            soldBySkuAU[item.sku] = (soldBySkuAU[item.sku] || 0) + item.quantity
          } else {
            soldBySkuUS[item.sku] = (soldBySkuUS[item.sku] || 0) + item.quantity
          }

          // Track revenue for avg price calculation (both regions)
          if (!revBySku[item.sku]) revBySku[item.sku] = { rev: 0, qty: 0 }
          revBySku[item.sku].rev += price * item.quantity
          revBySku[item.sku].qty += item.quantity
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
    const avgPriceByProduct = {}
    const cogsByProduct = {}

    for (const [sku, productName] of Object.entries(SKU_MAP)) {
      auStockByProduct[productName] = auStockBySku[sku] || 0
      velocityUSByProduct[productName] = +((soldBySkuUS[sku] || 0) / 30).toFixed(1)
      velocityAUByProduct[productName] = +((soldBySkuAU[sku] || 0) / 30).toFixed(1)

      // Avg selling price from actual orders
      const rv = revBySku[sku]
      avgPriceByProduct[productName] = rv?.qty > 0 ? +(rv.rev / rv.qty).toFixed(2) : 0

      // COGS from Shopify inventory items
      cogsByProduct[productName] = cogsBySku[sku] || 0
    }

    return res.json({
      ok: true,
      source: 'shopify',
      au_stock: auStockByProduct,
      velocity_us: velocityUSByProduct,
      velocity_au: velocityAUByProduct,
      avg_price: avgPriceByProduct,    // real avg selling price per SKU from orders
      cogs: cogsByProduct,             // cost per unit from Shopify
      au_location: auLocation?.name || 'not found',
      orders_analysed: totalOrders,
      period_days: 30,
    })

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
