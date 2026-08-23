let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

// These are the SKUs we track for inventory/velocity
// The API will also auto-discover all SKUs from Shopify and return them
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

const BUNDLE_COMPONENTS = {
  'BCKc&c':      ['BWc&c-MANLY','Dc&c-MANLY'],
  'SEC&C':       ['BWc&c-MANLY','Dc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
  'HCKc&c':      ['SHAc&c-MANLY','CONc&c-MANLY'],
  'STKc&c':      ['BWc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
  'BPc&c':       ['SSC&C','BB-MANLY'],
  'V2FREEGIFTS': ['BB-MANLY','SCALP-MANLY','CW-MANLY'],
  'SE':          ['BWc&c-MANLY','Dc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
  'SE2':         ['BWc&c-MANLY','Dc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
  'REPAIR':      ['SHAc&c-MANLY','CONc&c-MANLY'],
  'ACNEKIT':     ['BWc&c-MANLY','Dc&c-MANLY'],
  'BACNE':       ['BWc&c-MANLY','Dc&c-MANLY'],
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

  if (!domain || !token) return res.status(500).json({ error: 'Shopify not configured' })

  const BASE = `https://${domain}/admin/api/2024-04`
  const HEADERS = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }

  const forceRefresh = req.query?.refresh === '1'
  let sinceDate, untilDate, validDays, cacheKey

  if (req.query?.from && req.query?.to) {
    const from = new Date(req.query.from)
    const to = new Date(req.query.to)
    to.setHours(23, 59, 59, 999)
    sinceDate = from
    untilDate = to
    validDays = Math.max(1, Math.round((to - from) / 864e5))
    cacheKey = `shopify_${req.query.from}_${req.query.to}`
  } else {
    const days = parseInt(req.query?.days) || 30
    validDays = (days >= 1 && days <= 90) ? days : 30
    sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - validDays)
    untilDate = null
    cacheKey = `shopify_${validDays}`
  }

  if (!forceRefresh && _cache?.key === cacheKey && Date.now() - _cacheTime < CACHE_TTL) {
    return res.json({ ..._cache.data, cached: true })
  }

  try {
    // Fetch ALL product pages (handle pagination)
    const allProducts = []
    let productUrl = `${BASE}/products.json?limit=250&fields=id,title,variants`
    while (productUrl) {
      const r = await fetch(productUrl, { headers: HEADERS })
      if (!r.ok) throw new Error(`products ${r.status}`)
      const d = await r.json()
      allProducts.push(...(d.products || []))
      const link = r.headers.get('Link') || ''
      const next = link.match(/<([^>]+)>;\s*rel="next"/)
      productUrl = next ? next[1] : null
    }

    const [locRes] = await Promise.all([
      fetch(`${BASE}/locations.json`, { headers: HEADERS })
    ])
    if (!locRes.ok) throw new Error(`locations ${locRes.status}`)
    const locData = await locRes.json()

    // Build full SKU → inventory_item_id map from ALL products/variants
    const itemToSku = {}
    const skuToItemId = {}
    const skuToProduct = {} // sku → product title
    const allDiscoveredSkus = {} // sku → { title, productTitle, price }

    for (const p of allProducts) {
      for (const v of p.variants) {
        if (!v.sku) continue
        const sku = v.sku.trim()
        if (v.inventory_item_id) {
          itemToSku[String(v.inventory_item_id)] = sku
          skuToItemId[sku] = String(v.inventory_item_id)
        }
        skuToProduct[sku] = p.title
        allDiscoveredSkus[sku] = {
          productTitle: p.title,
          variantTitle: v.title !== 'Default Title' ? v.title : '',
          price: parseFloat(v.price || 0),
          inventoryItemId: v.inventory_item_id,
        }
      }
    }

    const TRACKED_SKUS = new Set(Object.keys(SKU_MAP))
    const trackedItemIds = Object.keys(SKU_MAP).map(s => skuToItemId[s]).filter(Boolean)

    // AU location
    const locations = locData.locations.filter(l => l.active)
    const auLocation = locations.find(l =>
      l.name === '11/81 Cooper St, Campbellfield' ||
      l.name?.toLowerCase().includes('campbellfield') ||
      l.name?.toLowerCase().includes('cooper st')
    )

    // Fetch COGS and AU stock in parallel
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
        if (String(level.location_id) !== String(auLocation?.id)) continue
        const sku = itemToSku[String(level.inventory_item_id)]
        if (!sku) continue
        auStockBySku[sku] = Math.max(0, level.available || 0)
      }
    }

    // Paginate orders
    const soldBySkuUS = {}
    const soldBySkuAU = {}
    const revBySku = {}
    let totalRevenue = 0
    let totalOrders = 0
    let pageCount = 0

    const orderMaxParam = untilDate
      ? `&created_at_max=${untilDate.toISOString()}`
      : ''

    let orderUrl = `${BASE}/orders.json?status=any&financial_status=paid&created_at_min=${sinceDate.toISOString()}${orderMaxParam}&limit=250&fields=id,total_price,line_items,shipping_address`

    while (orderUrl && pageCount < 50) {
      const r = await fetch(orderUrl, { headers: HEADERS })
      if (!r.ok) break
      const d = await r.json()
      totalOrders += (d.orders || []).length
      pageCount++

      for (const order of d.orders || []) {
        const country = order.shipping_address?.country_code || 'US'
        const isAU = country === 'AU'
        totalRevenue += parseFloat(order.total_price || 0)

        for (const item of order.line_items) {
          const price = parseFloat(item.price || 0)
          const qty = item.quantity || 1
          const sku = item.sku?.trim()
          if (!sku || !price) continue

          // Track velocity for known SKUs
          if (TRACKED_SKUS.has(sku)) {
            if (isAU) soldBySkuAU[sku] = (soldBySkuAU[sku] || 0) + qty
            else soldBySkuUS[sku] = (soldBySkuUS[sku] || 0) + qty
            if (!revBySku[sku]) revBySku[sku] = { rev: 0, qty: 0 }
            revBySku[sku].rev += price * qty
            revBySku[sku].qty += qty
          }

          // Distribute bundle revenue to components
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

      const link = r.headers.get('Link') || ''
      const next = link.match(/<([^>]+)>;\s*rel="next"/)
      orderUrl = next ? next[1] : null
    }

    // Build tracked product results
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
      // Full product catalogue discovered from Shopify
      all_skus: allDiscoveredSkus,
      sku_to_product: skuToProduct,
      cached: false,
      cached_at: new Date().toISOString(),
    }

    _cache = { key: cacheKey, data: result }
    _cacheTime = Date.now()

    return res.json(result)

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
