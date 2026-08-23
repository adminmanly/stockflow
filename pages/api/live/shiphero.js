// pages/api/live/shiphero.js

let _token = null
let _tokenExpiry = 0

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
  // Use direct API token if available
  if (process.env.SHIPHERO_API_TOKEN) {
    return process.env.SHIPHERO_API_TOKEN
  }

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
  try {
    return JSON.parse(text)
  } catch(e) {
    throw new Error(`GraphQL parse error: ${text.slice(0, 200)}`)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const token = await getToken()

    // Minimal test query first
    const testQuery = `{ products { request_id data(first: 5) { edges { node { sku name } } } } }`
    const testResult = await gql(token, testQuery)

    if (testResult.errors) {
      throw new Error('GraphQL errors: ' + JSON.stringify(testResult.errors).slice(0, 300))
    }

    // If test works, fetch with warehouse_products
    const stockBySku = {}
    let cursor = null
    let pages = 0

    while (pages < 15) {
      const q = `{
        products {
          request_id
          data(first: 200${cursor ? `, after: "${cursor}"` : ''}) {
            edges {
              node {
                sku
                name
                warehouse_products { on_hand available }
              }
            }
            pageInfo { has_next_page cursor }
          }
        }
      }`

      const d = await gql(token, q)
      if (d.errors) throw new Error(JSON.stringify(d.errors).slice(0, 300))

      const data = d?.data?.products?.data
      if (!data) break

      for (const edge of data.edges || []) {
        const sku = edge.node.sku?.trim()
        if (!sku || !SKU_TO_PRODUCT[sku]) continue
        let available = 0, on_hand = 0
        for (const wp of edge.node.warehouse_products || []) {
          available += wp.available || 0
          on_hand += wp.on_hand || 0
        }
        stockBySku[sku] = { available, on_hand }
      }

      if (!data.pageInfo?.has_next_page) break
      cursor = data.pageInfo.cursor
      pages++
    }

    const stock = {}
    for (const [sku, name] of Object.entries(SKU_TO_PRODUCT)) {
      const s = stockBySku[sku] || { available: 0, on_hand: 0 }
      stock[name] = { available: s.available, on_hand: s.on_hand }
    }

    return res.json({
      ok: true,
      stock,
      skus_found: Object.keys(stockBySku),
      skus_missing: Object.keys(SKU_TO_PRODUCT).filter(s => !stockBySku[s]),
    })

  } catch (err) {
    console.error('[ShipHero]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
