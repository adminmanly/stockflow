// pages/api/live/shiphero.js

let _token = null;
let _tokenExpiry = 0;

const SKU_TO_PRODUCT = {
  'BWc&c-MANLY': 'Body Wash',
  'Dc&c-MANLY':  'Deodorant',
  'SHAc&c-MANLY':'Shampoo',
  'CONc&c-MANLY':'Conditioner',
  'SSC&C':       'Ball Deodorant',
  'BB-MANLY':    'Body Buffer',
  'SCALP-MANLY': 'Scalp Scrubber',
  'CW-MANLY':    'Cooling Wipes',
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token

  const email = process.env.SHIPHERO_EMAIL
  const password = process.env.SHIPHERO_PASSWORD

  if (!email || !password) throw new Error('SHIPHERO_EMAIL / SHIPHERO_PASSWORD not set')

  const r = await fetch('https://public-api.shiphero.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })

  if (!r.ok) {
    const t = await r.text()
    throw new Error(`ShipHero auth failed ${r.status}: ${t.slice(0, 200)}`)
  }

  const d = await r.json()
  _token = d.access_token
  _tokenExpiry = Date.now() + (d.expires_in || 3600) * 1000 - 60000
  return _token
}

async function gql(token, query, variables = {}) {
  const r = await fetch('https://public-api.shiphero.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables })
  })
  if (!r.ok) throw new Error(`ShipHero GraphQL ${r.status}`)
  return r.json()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const token = await getToken()

    // Query products by SKU for each tracked SKU
    const SKUS = Object.keys(SKU_TO_PRODUCT)
    
    // Fetch all products with pagination, matching our SKUs
    const query = `
      query GetProducts($after: String) {
        products(after: $after) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              sku
              name
              warehouse_products {
                on_hand
                available
                allocated
                warehouse { identifier }
              }
            }
          }
        }
      }
    `

    const stockBySku = {}
    let after = null
    let pages = 0

    while (pages < 15) {
      const d = await gql(token, query, { after })
      const products = d?.data?.products
      if (!products) {
        console.error('[ShipHero] Unexpected response:', JSON.stringify(d).slice(0, 300))
        break
      }

      for (const edge of products.edges || []) {
        const node = edge.node
        const sku = node.sku?.trim()
        if (!sku || !SKU_TO_PRODUCT[sku]) continue

        // Sum across all warehouses (ShipHero only manages US/Tidal Wave)
        let available = 0, on_hand = 0
        for (const wp of node.warehouse_products || []) {
          available += wp.available || 0
          on_hand += wp.on_hand || 0
        }

        stockBySku[sku] = { available, on_hand, name: node.name }
      }

      if (!products.pageInfo?.hasNextPage) break
      after = products.pageInfo.endCursor
      pages++
    }

    // Build response keyed by product display name (for frontend compatibility)
    const stock = {}
    const stockBySkuOut = {}

    for (const [sku, productName] of Object.entries(SKU_TO_PRODUCT)) {
      const s = stockBySku[sku] || { available: 0, on_hand: 0 }
      stock[productName] = { available: s.available, on_hand: s.on_hand }
      stockBySkuOut[sku] = s
    }

    return res.json({
      ok: true,
      stock,           // keyed by product name (Body Wash, etc.)
      stock_by_sku: stockBySkuOut,  // keyed by SKU for debugging
      pages_fetched: pages,
      skus_found: Object.keys(stockBySku),
      skus_missing: SKUS.filter(s => !stockBySku[s]),
    })

  } catch (err) {
    console.error('[ShipHero]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
