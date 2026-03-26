// ─────────────────────────────────────────────────────────────────────────────
// Shopify Admin API integration
// Pulls: products, inventory levels per location
// ─────────────────────────────────────────────────────────────────────────────

const SHOPIFY_BASE = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-04`
const HEADERS = {
  'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
  'Content-Type': 'application/json',
}

async function shopifyFetch(endpoint) {
  const res = await fetch(`${SHOPIFY_BASE}${endpoint}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`Shopify API error: ${res.status} ${endpoint}`)
  return res.json()
}

// ── Get all active products with variants ────────────────────────────────────
export async function getShopifyProducts() {
  const products = []
  let pageInfo = null

  do {
    const qs = pageInfo ? `?page_info=${pageInfo}&limit=250` : '?limit=250&status=active'
    const data = await shopifyFetch(`/products.json${qs}`)
    products.push(...data.products)

    // Shopify pagination via Link header
    const link = data._headers?.link || ''
    const next = link.match(/<[^>]+page_info=([^&>]+)[^>]*>; rel="next"/)
    pageInfo = next ? next[1] : null
  } while (pageInfo)

  // Filter out shipping/insurance products, format cleanly
  const EXCLUDED_TYPES = ['UpCart - Shipping Protection', 'Insurance']
  return products
    .filter(p => !EXCLUDED_TYPES.includes(p.product_type))
    .map(p => ({
      id: p.id,
      title: p.title,
      type: p.product_type || 'individual',
      status: p.status,
      variants: p.variants.map(v => ({
        id: v.id,
        sku: v.sku,
        price: parseFloat(v.price),
        inventory_item_id: v.inventory_item_id,
        inventory_quantity: v.inventory_quantity,
      })),
      // First variant as primary for simple products
      sku: p.variants[0]?.sku,
      price: parseFloat(p.variants[0]?.price || 0),
    }))
    .filter(p => p.price > 0)
}

// ── Get Shopify locations (maps to your FCs) ─────────────────────────────────
export async function getShopifyLocations() {
  const data = await shopifyFetch('/locations.json')
  return data.locations.map(l => ({
    id: l.id,
    name: l.name,
    active: l.active,
    address: `${l.city}, ${l.country}`,
  }))
}

// ── Get inventory levels for all items at all locations ───────────────────────
export async function getShopifyInventory(locationId) {
  const items = []
  let pageInfo = null

  do {
    const base = `/inventory_levels.json?location_ids=${locationId}&limit=250`
    const qs = pageInfo ? `${base}&page_info=${pageInfo}` : base
    const data = await shopifyFetch(qs)
    items.push(...data.inventory_levels)
    const link = data._headers?.link || ''
    const next = link.match(/<[^>]+page_info=([^&>]+)[^>]*>; rel="next"/)
    pageInfo = next ? next[1] : null
  } while (pageInfo)

  return items.map(i => ({
    inventory_item_id: i.inventory_item_id,
    location_id: i.location_id,
    available: i.available,
  }))
}

// ── Get 30-day sales velocity per SKU from recent orders ─────────────────────
export async function getShopifySalesVelocity() {
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString()

  const orders = []
  let pageInfo = null

  do {
    const base = `/orders.json?status=any&created_at_min=${sinceStr}&limit=250&fields=line_items,created_at`
    const qs = pageInfo ? `/orders.json?page_info=${pageInfo}&limit=250` : base
    const data = await shopifyFetch(qs)
    orders.push(...data.orders)
    const link = data._headers?.link || ''
    const next = link.match(/<[^>]+page_info=([^&>]+)[^>]*>; rel="next"/)
    pageInfo = next ? next[1] : null
  } while (pageInfo)

  // Count qty sold per SKU over last 30 days
  const velocity = {}
  for (const order of orders) {
    for (const item of order.line_items) {
      if (!item.sku) continue
      velocity[item.sku] = (velocity[item.sku] || 0) + item.quantity
    }
  }

  // Convert to daily rate
  return Object.fromEntries(
    Object.entries(velocity).map(([sku, total]) => [sku, +(total / 30).toFixed(2)])
  )
}
