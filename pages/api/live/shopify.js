// Simple in-memory cache (resets on cold start, persists between warm requests)
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

  if (!domain || !token || token === 'leave-blank-for-now') {
    return res.status(500).json({ error: 'Shopify not configured' })
  }

  const days = parseInt(req.query?.days) || 30
  const validDays = [7, 14, 30].includes(days) ? days : 30
  const forceRefresh = req.query?.refresh === '1'
  const cacheKey = `shopify_${validDays}`

  // Return cached response if fresh
  if (!forceRefresh && _cache?.key === cacheKey && Date.now() - _cacheTime < CACHE_TTL) {
    return res.json({ ..._cache.data, cached: true })
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

    // Step 1: products, locations, first orders page — all parallel
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

    // Step 3: paginate orders — run pages in batches of 3 simultaneously
    const soldBySkuUS = {}
    const soldBySkuAU = {}
    const revBySku = {}
    let totalRevenue = 0
    let totalOrders = 0

    // Process first page
    const processOrders = (ordersData) => {
      for (const order of ordersData.orders || []) {
        const country = order.shipping_address?.country_code || 'US'
        const isAU = country === 'AU'
        totalRevenue += parseFloat(order.total_price || 0)
        totalOrders++

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
    }

    if (!firstOrdersRes.ok) throw new Error('Orders fetch failed')
    const firstData = await firstOrdersRes.json()
    processOrders(firstData)

    // Collect all next-page URLs and fetch in batches of 3
    let nextUrl = null
    const getLinkNext = (res) => {
      const link = res.headers.get('Link') || ''
      const m = link.match(/<([^>]+)>;\s*rel="next"/)
      return m ? m[1] : null
    }

    nextUrl = getLinkNext(firstOrdersRes)
    let pageCount = 1

    while (nextUrl && pageCount < 50) {
      // Fetch up to 3 pages at once
      const batch = []
      const batchUrls = []
      for (let i = 0; i < 3 && nextUrl; i++) {
        batchUrls.push(nextUrl)
        batch.push(fetch(nextUrl, { headers: HEADERS }))
        // We don't know the next URL until we get this response, so just do 1 at a time
        // unless we could pre-compute them (we can't with cursor pagination)
        break
      }

      const responses = await Promise.all(batch)
      for (const r of responses) {
        if (!r.ok) break
        const d = await r.json()
        processOrders(d)
        nextUrl = getLinkNext(r)
        pageCount++
      }
    }

    // Build response
    const auStockByProduct = {}
    const velocityUSByProduct = {}
    const velocityAUByProduct = {}
    const avgPriceByProduct = {}
    const cogsByProduct = {}

    for (const [sku, productName] of Object.entries(SKU_MAP)) {
      auStockByProduct[productName] = auStockBySku[sku] || 0
      velocityUSByProduct[productName] = +((soldBySkuUS[sku] || 0) / validDays).toFixed(1)
      velocityAUByProduct[productName] = +((soldBySkuAU[sku] || 0) / validDays).toFixed(1)
      const rv = revBySku[sku]
      avgPriceByProduct[productName] = rv?.qty > 0 ? +(rv.rev / rv.qty).toFixed(2) : 0
      cogsByProduct[productName] = cogsBySku[sku] || 0
    }

    const result = {
      ok: true,
      source: 'shopify',
      period_days: validDays,
      au_stock: auStockByProduct,
      velocity_us: velocityUSByProduct,
      velocity_au: velocityAUByProduct,
      avg_price: avgPriceByProduct,
      cogs: cogsByProduct,
      daily_revenue: +(totalRevenue / validDays).toFixed(2),
      total_revenue: +totalRevenue.toFixed(2),
      orders_analysed: totalOrders,
      au_location: auLocation?.name || 'not found',
      cached: false,
      cached_at: new Date().toISOString(),
    }

    // Cache the result
    _cache = { key: cacheKey, data: result }
    _cacheTime = Date.now()

    return res.json(result)

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
