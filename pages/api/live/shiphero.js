export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')

  const email = process.env.SHIPHERO_EMAIL
  const password = process.env.SHIPHERO_PASSWORD

  if (!email || !password) {
    return res.status(500).json({ error: 'SHIPHERO_EMAIL and SHIPHERO_PASSWORD not set in env vars' })
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

  try {
    // Step 1: Get token via REST auth endpoint
    const authRes = await fetch('https://public-api.shiphero.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password })
    })

    if (!authRes.ok) throw new Error(`ShipHero auth failed: ${authRes.status}`)
    const authData = await authRes.json()
    const token = authData.access_token || authData.token
    if (!token) throw new Error('No token returned: ' + JSON.stringify(authData))

    // Step 2: Fetch inventory via GraphQL
    const invRes = await fetch('https://public-api.shiphero.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `query {
          inventory(first: 200) {
            edges {
              node {
                sku
                on_hand
                available
                allocated
              }
            }
          }
        }`
      })
    })

    const invData = await invRes.json()
    if (invData.errors) throw new Error('GraphQL error: ' + invData.errors[0].message)

    // Build stock by SKU
    const inventory = {}
    for (const edge of (invData.data?.inventory?.edges || [])) {
      const node = edge.node
      if (node.sku) inventory[node.sku] = { available: node.available || 0, on_hand: node.on_hand || 0 }
    }

    // Map to product names
    const stockByProduct = {}
    for (const [sku, productName] of Object.entries(SKU_MAP)) {
      stockByProduct[productName] = { available: inventory[sku]?.available ?? 0, on_hand: inventory[sku]?.on_hand ?? 0, sku }
    }

    return res.json({ ok: true, source: 'shiphero', stock: stockByProduct, raw_skus: Object.keys(inventory).length })

  } catch (err) {
    console.error('[ShipHero]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
