// pages/api/live/shiphero.js
// ShipHero GraphQL API — authenticates with email/password to get token

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')

  const email = process.env.SHIPHERO_EMAIL
  const password = process.env.SHIPHERO_PASSWORD
  const SHIPHERO_URL = 'https://public-api.shiphero.com/graphql'

  if (!email || !password) {
    return res.status(500).json({ error: 'ShipHero email/password not configured. Add SHIPHERO_EMAIL and SHIPHERO_PASSWORD to Vercel env vars.' })
  }

  try {
    // Step 1: Get auth token using email + password
    const authRes = await fetch(SHIPHERO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `
          mutation Login($email: String!, $password: String!) {
            login(email: $email, password: $password) {
              complexity
              token
              refresh_token
            }
          }
        `,
        variables: { email, password }
      })
    })

    const authData = await authRes.json()
    if (authData.errors) throw new Error('ShipHero auth failed: ' + authData.errors[0].message)
    
    const token = authData.data?.login?.token
    if (!token) throw new Error('No token returned from ShipHero')

    // Step 2: Fetch inventory with the token
    const invRes = await fetch(SHIPHERO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `
          query {
            inventory(first: 200) {
              edges {
                node {
                  sku
                  on_hand
                  available
                  allocated
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `
      })
    })

    const invData = await invRes.json()
    if (invData.errors) throw new Error('ShipHero inventory error: ' + invData.errors[0].message)

    // Build SKU -> stock map
    const inventory = {}
    for (const edge of (invData.data?.inventory?.edges || [])) {
      const node = edge.node
      if (!node.sku) continue
      inventory[node.sku] = {
        on_hand: node.on_hand || 0,
        available: node.available || 0,
        allocated: node.allocated || 0,
      }
    }

    // Map your SKUs to product names
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
    for (const [sku, productName] of Object.entries(SKU_MAP)) {
      const inv = inventory[sku]
      stockByProduct[productName] = {
        available: inv?.available ?? 0,
        on_hand: inv?.on_hand ?? 0,
        sku,
      }
    }

    return res.json({
      ok: true,
      source: 'shiphero',
      stock: stockByProduct,
      raw_skus: Object.keys(inventory).length,
    })

  } catch (err) {
    console.error('[ShipHero]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
