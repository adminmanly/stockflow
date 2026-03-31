// pages/api/live/packaging.js
// Returns raw order line items for packaging projection calculations

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

  const days = parseInt(req.query?.days) || 7
  const validDays = [7, 14, 30].includes(days) ? days : 7

  try {
    const since = new Date()
    since.setDate(since.getDate() - validDays)

    const orders = []
    let ordersUrl = `${BASE}/orders.json?status=any&financial_status=paid&created_at_min=${since.toISOString()}&limit=250&fields=id,order_number,line_items`
    let pageCount = 0

    while (ordersUrl && pageCount < 20) {
      const r = await fetch(ordersUrl, { headers: HEADERS })
      if (!r.ok) break
      const d = await r.json()
      pageCount++

      for (const order of d.orders || []) {
        // Only include line items with tracked SKUs (filter out $0 bundle components)
        const lineItems = order.line_items
          .filter(item => item.sku && parseFloat(item.price) > 0)
          .map(item => ({ sku: item.sku, quantity: item.quantity, price: item.price }))

        if (lineItems.length > 0) {
          orders.push({
            order_id: order.id,
            order_number: order.order_number,
            line_items: lineItems,
          })
        }
      }

      const linkHeader = r.headers.get('Link') || ''
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      ordersUrl = nextMatch ? nextMatch[1] : null
    }

    return res.json({
      ok: true,
      orders,
      period_days: validDays,
      order_count: orders.length,
    })

  } catch (err) {
    console.error('[Packaging API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
