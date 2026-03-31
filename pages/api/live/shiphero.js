export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')

  const email = process.env.SHIPHERO_EMAIL
  const password = process.env.SHIPHERO_PASSWORD

  if (!email || !password) {
    return res.status(500).json({ error: 'SHIPHERO_EMAIL and SHIPHERO_PASSWORD not configured' })
  }

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

  const GRAPHQL = 'https://public-api.shiphero.com/graphql'

  try {
    // Step 1: Get auth token
    const authRes = await fetch('https://public-api.shiphero.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password })
    })
    if (!authRes.ok) throw new Error(`ShipHero auth failed: ${authRes.status}`)
    const authData = await authRes.json()
    const token = authData.access_token || authData.token
    if (!token) throw new Error('No token returned from ShipHero')

    // Step 2: Fetch all products with pagination
    const inventory = {}
    let cursor = null
    let hasNextPage = true
    let pageCount = 0

    while (hasNextPage && pageCount < 10) {
      const afterClause = cursor ? `, after: "${cursor}"` : ''
      const invRes = await fetch(GRAPHQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          query: `query {
            products {
              data(first: 200${afterClause}) {
                edges {
                  node {
                    sku
                    warehouse_products {
                      warehouse_id
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
        })
      })

      const invData = await invRes.json()
      if (invData.errors) throw new Error('ShipHero GraphQL error: ' + invData.errors[0].message)

      const edges = invData.data?.products?.data?.edges || []
      const pageInfo = invData.data?.products?.data?.pageInfo

      for (const edge of edges) {
        const node = edge.node
        if (!node.sku) continue
        const wh = node.warehouse_products?.[0]
        inventory[node.sku] = {
          available: wh?.available || 0,
          on_hand: wh?.on_hand || 0,
        }
      }

      hasNextPage = pageInfo?.hasNextPage || false
      cursor = pageInfo?.endCursor || null
      pageCount++
    }

    // Map to product names
    const stockByProduct = {}
    for (const [sku, productName] of Object.entries(SKU_MAP)) {
      stockByProduct[productName] = {
        available: inventory[sku]?.available ?? 0,
        on_hand: inventory[sku]?.on_hand ?? 0,
        sku,
      }
    }

    return res.json({
      ok: true,
      source: 'shiphero',
      stock: stockByProduct,
      raw_skus: Object.keys(inventory).length,
      pages_fetched: pageCount,
    })

  } catch (err) {
    console.error('[ShipHero]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
