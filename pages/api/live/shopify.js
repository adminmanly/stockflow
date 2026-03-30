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
    // 1. Get products -> inventory_item_id map
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

    // 2. Get AU warehouse location (Cooper St)
    const locRes = await fetch(`${BASE}/locations.json`, { headers: HEADERS })
    if (!locRes.ok) throw new Error(`Shopify locations error: ${locRes.status}`)
    const locData = await locRes.json()
    const locations = locData.locations.filter(l => l.active)
    const auLocation = locations.find(l => l.name === '11/81 Cooper St, Campbellfield')

    // 3. Get AU warehouse stock levels
    const auStockBySku = {}
let debugLevels = []
if (auLocation) {
  const invRes = await fetch(`${BASE}/inventory_levels.json?location_id=${auLocation.id}&limit=250`, { headers: HEADERS })
  if (invRes.ok) {
    const invData = await invRes.json()
    debugLevels = invData.inventory_levels.slice(0, 5).map(l => ({
      inventory_item_id: l.inventory_item_id,
      available: l.available,
      sku: itemToSku[l.inventory_item_id] || 'unknown'
    }))
    for (const level of invData.inventory_levels) {
      const sku = itemToSku[level.inventory_item_id]
      if (!sku || level.available === null) continue
      auStockBySku[sku] = Math.max(0, level.available)
    }
  }
}

    // 4. Get last 7 days orders split by shipping country
const since30 = new Date()
since30.setDate(since30.getDate() - 30)

const soldBySkuUS = {}
const soldBySkuAU = {}
let ordersUrl = `${BASE}/orders.json?status=any&financial_status=paid&created_at_min=${since30.toISOString()}&limit=250&fields=id,line_items,shipping_address`
    let totalOrders = 0
let pageCount = 0

while (ordersUrl && pageCount < 50) {

    while (ordersUrl && pageCount < 10) {
      const ordersRes = await fetch(ordersUrl, { headers: HEADERS })
      if (!ordersRes.ok) break
      const ordersData = await ordersRes.json()
      totalOrders += (ordersData.orders || []).length
      pageCount++

      for (const order of ordersData.orders || []) {
        if (pageCount === 1 && totalOrders <= 5) {
  console.log('SAMPLE LINE ITEMS:', JSON.stringify(order.line_items.slice(0,3)))
}
        const country = order.shipping_address?.country_code || 'US'
        const isAU = country === 'AU'

        for (const item of order.line_items) {
if (!item.sku || !TRACKED_SKUS.has(item.sku)) continue
if (parseFloat(item.price) === 0) continue  // skip $0 bundle component additions
          if (isAU) {
            soldBySkuAU[item.sku] = (soldBySkuAU[item.sku] || 0) + item.quantity
          } else {
            soldBySkuUS[item.sku] = (soldBySkuUS[item.sku] || 0) + item.quantity
          }
        }
      }

      const linkHeader = ordersRes.headers.get('Link') || ''
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      ordersUrl = nextMatch ? nextMatch[1] : null
    }

    // 5. Build response — divide by 7 for daily velocity per country
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
