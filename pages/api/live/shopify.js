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

  try {
    // 1. Get products to build inventory_item_id -> SKU map
    const prodRes = await fetch(`${BASE}/products.json?limit=250&status=active`, { headers: HEADERS })
    if (!prodRes.ok) throw new Error(`Shopify products error: ${prodRes.status}`)
    const prodData = await prodRes.json()

    const itemToSku = {}
    for (const product of prodData.products) {
      for (const variant of product.variants) {
        if (variant.sku && variant.inventory_item_id) {
          itemToSku[variant.inventory_item_id] = variant.sku
        }
      }
    }

    // 2. Get all locations
    const locRes = await fetch(`${BASE}/locations.json`, { headers: HEADERS })
    if (!locRes.ok) throw new Error(`Shopify locations error: ${locRes.status}`)
    const locData = await locRes.json()
    const locations = locData.locations.filter(l => l.active)

    // 3. Get inventory levels per location and sum globally
    const stockBySku = {}
    for (const loc of locations) {
      const invRes = await fetch(`${BASE}/inventory_levels.json?location_id=${loc.id}&limit=250`, { headers: HEADERS })
      if (!invRes.ok) continue
      const invData = await invRes.json()
      for (const level of invData.inventory_levels) {
        const sku = itemToSku[level.inventory_item_id]
        if (!sku || level.available === null) continue
        stockBySku[sku] = (stockBySku[sku] || 0) + Math.max(0, level.available)
      }
    }

    // 4. Get 30-day sales velocity
    const since = new Date()
    since.setDate(since.getDate() - 30)
    const ordersRes = await fetch(
      `${BASE}/orders.json?status=any&created_at_min=${since.toISOString()}&limit=250&fields=line_items,created_at`,
      { headers: HEADERS }
    )
    const ordersData = ordersRes.ok ? await ordersRes.json() : { orders: [] }

    const soldBySku = {}
    for (const order of ordersData.orders || []) {
      for (const item of order.line_items) {
        if (!item.sku) continue
        soldBySku[item.sku] = (soldBySku[item.sku] || 0) + item.quantity
      }
    }

    // 5. Build response by product name
    const stockByProduct = {}
    const velocityByProduct = {}
    for (const [sku, productName] of Object.entries(SKU_MAP)) {
      stockByProduct[productName] = stockBySku[sku] || 0
      velocityByProduct[productName] = +(( soldBySku[sku] || 0) / 30).toFixed(1)
    }

    return res.json({
      ok: true,
      source: 'shopify',
      stock: stockByProduct,
      velocity: velocityByProduct,
      locations: locations.map(l => l.name),
      orders_analysed: (ordersData.orders || []).length,
    })

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
