// pages/api/live/shiphero.js

let _token = null
let _tokenExpiry = 0

const SKU_TO_PRODUCT = {
  // Core tracked SKUs
  'BWc&c-MANLY': 'Body Wash',
  'Dc&c-MANLY':  'Deodorant',
  'SHAc&c-MANLY':'Shampoo',
  'CONc&c-MANLY':'Conditioner',
  'SSC&C':       'Ball Deodorant',
  'BB-MANLY':    'Body Buffer',
  'SCALP-MANLY': 'Scalp Scrubber',
  'CW-MANLY':    'Cooling Wipes',
  // Natural scent variants
  'BWC+B':  'Natural Body Wash · Citrus Breeze',
  'BWC+C':  'Natural Body Wash · Coconut Coast',
  'BWF+F':  'Natural Body Wash · Fresh Forest',
  'BWM+O':  'Natural Body Wash · Midnight Oak',
  'CONC+B': 'Natural Conditioner',
  'DC+B':   'Natural Deodorant · Citrus Breeze',
  'DC+C':   'Natural Deodorant · Coconut Coast',
  'DF+F':   'Natural Deodorant · Fresh Forest',
  'DM+O':   'Natural Deodorant · Midnight Oak',
  'SHC+B':  'Natural Shampoo',
}

async function getToken() {
  const directToken = process.env.SHIPHERO_API_TOKEN || process.env.SHIPHERO_TOKEN
  if (directToken) return directToken

  if (_token && Date.now() < _tokenExpiry) return _token

  const email = process.env.SHIPHERO_EMAIL
  const password = process.env.SHIPHERO_PASSWORD
  if (!email) throw new Error('SHIPHERO_EMAIL not set')
  if (!password) throw new Error('SHIPHERO_PASSWORD not set')

  const r = await fetch('https://public-api.shiphero.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: email, password })
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

async function gql(token, query) {
  const r = await fetch('https://public-api.shiphero.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ query })
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`GraphQL ${r.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const token = await getToken()
    const stockBySku = {}
    let after = null
    let pages = 0

    while (pages < 15) {
      const afterClause = after ? `, after: "${after}"` : ''
      const query = `{
        products {
          request_id
          data(first: 200${afterClause}) {
            edges {
              node {
                sku
                name
                warehouse_products {
                  on_hand
                  available
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }`

      const d = await gql(token, query)

      if (d.errors) {
        throw new Error('GraphQL errors: ' + JSON.stringify(d.errors).slice(0, 300))
      }

      const data = d?.data?.products?.data
      if (!data) {
        console.error('[ShipHero] No data in response:', JSON.stringify(d).slice(0, 200))
        break
      }

      for (const edge of data.edges || []) {
        const sku = edge.node.sku?.trim()
        if (!sku) continue
        // Log scent variant SKUs to check formatting
        if (sku.includes('+') || sku.includes('BWC') || sku.includes('DC+') || sku.includes('DF+') || sku.includes('DM+') || sku.includes('CON') || sku.includes('SHC')) {
          console.log('[ShipHero] Found variant SKU:', sku)
        }
        if (!SKU_TO_PRODUCT[sku]) continue
        let available = 0, on_hand = 0
        for (const wp of edge.node.warehouse_products || []) {
          available += wp.available || 0
          on_hand += wp.on_hand || 0
        }
        stockBySku[sku] = { available, on_hand }
      }

      if (!data.pageInfo?.hasNextPage) break
      after = data.pageInfo.endCursor
      pages++
    }

    const stock = {}
    for (const [sku, name] of Object.entries(SKU_TO_PRODUCT)) {
      const s = stockBySku[sku] || { available: 0, on_hand: 0 }
      stock[name] = { available: s.available, on_hand: s.on_hand }
    }

    // Log all SKUs found for debugging
    console.log('[ShipHero] All SKUs found:', Object.keys(stockBySku))
    console.log('[ShipHero] Missing SKUs:', Object.keys(SKU_TO_PRODUCT).filter(s => !stockBySku[s]))

    return res.json({
      ok: true,
      stock,
      stock_by_sku: Object.fromEntries(
        Object.entries(stockBySku).map(([sku, s]) => [sku, s.available || 0])
      ),
      skus_found: Object.keys(stockBySku),
      skus_missing: Object.keys(SKU_TO_PRODUCT).filter(s => !stockBySku[s]),
    })

  } catch (err) {
    console.error('[ShipHero]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
