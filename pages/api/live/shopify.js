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

  const TRACKED_SKUS = new Set([
    'BWc&c-MANLY', 'Dc&c-MANLY', 'SHAc&c-MANLY', 'CONc&c-MANLY',
    'SSC&C', 'BB-MANLY', 'SCALP-MANLY', 'CW-MANLY'
  ])

  try {
    const since30 = new Date()
    since30.setDate(since30.getDate() - 30)

    // Step 1: Fetch products and locations in parallel
const locRes = await fetch(`${BASE}/locations.json`, { headers: HEADERS })
if (!locRes.ok) throw new Error(`Shopify locations error: ${locRes.status}`)
const locData = await locRes.json()

// Paginate through ALL products to build complete inventory_item_id -> SKU map
const itemToSku = {}
let prodUrl = `${BASE}/products.json?limit=250&status=active`
while (prodUrl) {
  const prodRes = await fetch(prodUrl, { headers: HEADERS })
  if (!prodRes.ok) throw new Error(`Shopify products error: ${prodRes.status}`)
  const prodData = await prodRes.json()
  for (const product of prodData.products) {
    for (const variant of product.variants) {
      if (variant.sku && variant.inventory_item_id) {
        itemToSku[variant.inventory_item_id] = variant.sku
      }
    }
  }
  const linkHeader = prodRes.headers.get('Link') || ''
  const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  prodUrl = nextMatch ? nextMatch[1] : null
}

    const locations = locData.locations.filter(l => l.active)
    const auLocation = locations.find(l => l.name === '11/81 Cooper St, Campbellfield')

    // Step 2: Fetch inventory levels and first orders page in parallel
    const firstOrdersUrl = `${BASE}/orders.json?status=any&financial_status=paid&created_at_min=${since30.toISOString()}&limit=250&fields=id,line_items,shipping_address`

    const [invRes, firstOrdersRes] = await Promise.all([
      auLocation
        ? fetch(`${BASE}/inventory_levels.json?location_id=${auLocation.id}&limit=250`, { headers: HEADERS })
        : Promise.resolve(null),
      fetch(firstOrdersUrl, { headers: HEADERS })
    ])

    // Process AU inventory levels
    const auStockBySku = {}
    if (invRes?.ok) {
      const invData = await invRes.json()
      for (const level of invData.inventory_levels) {
        const sku = itemToSku[level.inventory_item_id]
        if (!sku) continue
        auStockBySku[sku] = Math.max(0, level.available || 0)
      }
    }

    // Step 3: Process orders (first page already fetched, paginate the rest)
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
          if (!parseFloat(item.price)) continue // skip $0 bundle component additions
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
    })

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
