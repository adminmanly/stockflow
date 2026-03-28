// pages/api/live/shopify.js
// Fetches global inventory totals + 30-day sales velocity from Shopify
// Returns: total stock per SKU across ALL locations, and daily sell rate

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  res.setHeader('Access-Control-Allow-Origin', '*')

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

  if (!domain || !token || token === 'leave-blank-for-now') {
    return res.status(500).json({ error: 'Shopify not configured' })
  }

  const BASE = `https://${domain}/admin/api/2024-04`
  const HEADERS = {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
  }

  try {
    // 1. Get all active products with variants
    const prodRes = await fetch(`${BASE}/products.json?limit=250&status=active`, { headers: HEADERS })
    if (!prodRes.ok) throw new Error(`Shopify products error: ${prodRes.status}`)
    const prodData = await prodRes.json()

    // Build inventory_item_id -> SKU map
    const itemToSku = {}
    const skuToTitle = {}
    for (const product of prodData.products) {
      for (const variant of product.variants) {
        if (variant.sku && variant.inventory_item_id) {
          itemToSku[variant.inventory_item_id] = variant.sku
          skuToTitle[variant.sku] = product.title
        }
      }
    }

    // 2. Get inventory levels across ALL locations
    const invRes = await fetch(`${BASE}/inventory_levels.json?limit=250`, { headers: HEADERS })
    if (!invRes.ok) throw new Error(`Shopify inventory error: ${invRes.status}`)
    const invData = await invRes.json()

    // Sum up available stock per SKU across all locations
    const stockBySku = {}
    for (const level of invData.inventory_levels) {
      const sku = itemToSku[level.inventory_item_id]
      if (!sku || level.available === null) continue
      stockBySku[sku] = (stockBySku[sku] || 0) + Math.max(0, level.available)
    }

    // 3. Get 30-day sales velocity from recent orders
    const since = new Date()
    since.setDate(since.getDate() - 30)
    const sinceStr = since.toISOString()

    const ordersRes = await fetch(
      `${BASE}/orders.json?status=any&created_at_min=${sinceStr}&limit=250&fields=line_items,created_at`,
      { headers: HEADERS }
    )
    if (!ordersRes.ok) throw new Error(`Shopify orders error: ${ordersRes.status}`)
    const ordersData = await ordersRes.json()

    // Count qty sold per SKU over 30 days
    const soldBySku = {}
    for (const order of ordersData.orders) {
      for (const item of order.line_items) {
        if (!item.sku) continue
        soldBySku[item.sku] = (soldBySku[item.sku] || 0) + item.quantity
      }
    }

    // Convert to daily velocity (rounded to 1dp)
    const velocityBySku = {}
    for (const [sku, total] of Object.entries(soldBySku)) {
      velocityBySku[sku] = +(total / 30).toFixed(1)
    }

    // 4. Map to your product names
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

    const stockByProduct = {}
    const velocityByProduct = {}

    for (const [sku, productName] of Object.entries(SKU_MAP)) {
      stockByProduct[productName] = stockBySku[sku] || 0
      velocityByProduct[productName] = velocityBySku[sku] || 0
    }

    return res.json({
      ok: true,
      source: 'shopify',
      stock: stockByProduct,      // Global total across ALL locations
      velocity: velocityByProduct, // Daily sell rate per product
      orders_analysed: ordersData.orders.length,
      period_days: 30,
    })

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
