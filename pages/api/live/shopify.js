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

  // Accept ?days=7|14|30 — default 30
  const days = parseInt(req.query?.days) || 30
  const validDays = [7, 14, 30].includes(days) ? days : 30

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

  const BUNDLE_COMPONENTS = {
    'BCKc&c':  ['BWc&c-MANLY','Dc&c-MANLY'],
    'SEC&C':   ['BWc&c-MANLY','Dc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
    'HCKc&c':  ['SHAc&c-MANLY','CONc&c-MANLY'],
    'STKc&c':  ['BWc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
    'BPc&c':   ['SSC&C','BB-MANLY'],
    'V2FREEGIFTS': ['BB-MANLY','SCALP-MANLY','CW-MANLY'],
    'SE':      ['BWc&c-MANLY','Dc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
    'SE2':     ['BWc&c-MANLY','Dc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
    'REPAIR':  ['SHAc&c-MANLY','CONc&c-MANLY'],
    'ACNEKIT': ['BWc&c-MANLY','Dc&c-MANLY'],
    'BACNE':   ['BWc&c-MANLY','Dc&c-MANLY'],
  }

  try {
    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - validDays)

    // Step 1: products, locations, first orders — all parallel
    const [prodRes, locRes, firstOrdersRes] = await Promise.all([
      fetch(`${BASE}/products.json?limit=250`, { headers: HEADERS }),
      fetch(`${BASE}/locations.json`, { headers: HEADERS }),
      fetch(`${BASE}/orders.json?status=any&financial_status=paid&created_at_min=${sinceDate.toISOString()}&limit=250&fields=id,total_price,line_items,shipping_address`, { headers: HEADERS })
    ])

    if (!prodRes.ok) throw new Error(`products ${prodRes.status}`)
    if (!locRes.ok) throw new Error(`locations ${locRes.status}`)

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
    const trackedItemIds = Object.keys(SKU_MAP).map(s => skuToItemId[s]).filter(Boolean)

    // Step 2: COGS + AU stock in parallel
    const [cogsRes, invRes] = await Promise.all([
      trackedItemIds.length > 0
        ? fetch(`${BASE}/inventory_items.json?ids=${trackedItemIds.join(',')}&limit=250`, { headers: HEADERS })
        : Promise.resolve(null),
      auLocation && trackedItemIds.length > 0
        ? fetch(`${BASE}/inventory_levels.json?location_id=${auLocation.id}&inventory_item_ids=${trackedItemIds.join(',')}&limit=250`, { headers: HEADERS })
        : Promise.resolve(null)
    ])

    const cogsBySku = {}
    if (cogsRes?.ok) {
      const d = await cogsRes.json()
      for (const item of d.inventory_items || []) {
        const sku = itemToSku[String(item.id)]
        if (sku && item.cost) cogsBySku[sku] = parseFloat(item.cost)
      }
    }

    const auStockBySku = {}
    if (invRes?.ok) {
      const d = await invRes.json()
      for (const level of d.inventory_levels || []) {
        if (String(level.location_id) !== String(auLocation.id)) continue
        const sku = itemToSku[String(level.inventory_item_id)]
        if (!sku) continue
        auStockBySku[sku] = Math.max(0, level.available || 0)
      }
    }

    // Step 3: Process all orders
    const soldBySkuUS = {}
    const soldBySkuAU = {}
    const revBySku = {}
    let totalRevenue = 0
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
        totalRevenue += parseFloat(order.total_price || 0)

        for (const item of order.line_items) {
          const price = parseFloat(item.price || 0)
          const qty = item.quantity || 1
          const sku = item.sku
          if (!sku || !price) continue

          if (TRACKED_SKUS.has(sku)) {
            if (isAU) soldBySkuAU[sku] = (soldBySkuAU[sku] || 0) + qty
            else soldBySkuUS[sku] = (soldBySkuUS[sku] || 0) + qty
            if (!revBySku[sku]) revBySku[sku] = { rev: 0, qty: 0 }
            revBySku[sku].rev += price * qty
            revBySku[sku].qty += qty
          }

          if (BUNDLE_COMPONENTS[sku]) {
            const comps = BUNDLE_COMPONENTS[sku]
            const revPerComp = (price * qty) / comps.length
            for (const compSku of comps) {
              if (!TRACKED_SKUS.has(compSku)) continue
              if (!revBySku[compSku]) revBySku[compSku] = { rev: 0, qty: 0 }
              revBySku[compSku].rev += revPerComp
              revBySku[compSku].qty += qty
            }
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
    const unitsSoldByProduct = {}
    const avgPriceByProduct = {}
    const cogsByProduct = {}

    for (const [sku, productName] of Object.entries(SKU_MAP)) {
      auStockByProduct[productName] = auStockBySku[sku] || 0
      velocityUSByProduct[productName] = +((soldBySkuUS[sku] || 0) / validDays).toFixed(1)
      velocityAUByProduct[productName] = +((soldBySkuAU[sku] || 0) / validDays).toFixed(1)
      unitsSoldByProduct[productName] = (soldBySkuUS[sku] || 0) + (soldBySkuAU[sku] || 0)
      const rv = revBySku[sku]
      avgPriceByProduct[productName] = rv?.qty > 0 ? +(rv.rev / rv.qty).toFixed(2) : 0
      cogsByProduct[productName] = cogsBySku[sku] || 0
    }

    return res.json({
      ok: true,
      source: 'shopify',
      period_days: validDays,
      au_stock: auStockByProduct,
      velocity_us: velocityUSByProduct,
      velocity_au: velocityAUByProduct,
      units_sold: unitsSoldByProduct,      // total units sold in period
      avg_price: avgPriceByProduct,         // real avg selling price incl bundle attribution
      cogs: cogsByProduct,                  // from Shopify cost fields
      total_revenue: +totalRevenue.toFixed(2),
      daily_revenue: +(totalRevenue / validDays).toFixed(2),
      au_location: auLocation?.name || 'not found',
      orders_analysed: totalOrders,
    })

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
