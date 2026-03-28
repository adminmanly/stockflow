// pages/api/live/shiphero.js
// Called by the frontend to get live Tidal Wave stock from ShipHero
// Token stays server-side — never exposed to the browser

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  // Allow CORS from your own domain
  res.setHeader('Access-Control-Allow-Origin', '*')

  const token = process.env.SHIPHERO_API_TOKEN
  if (!token) {
    return res.status(500).json({ error: 'ShipHero token not configured' })
  }

  try {
    // First get an auth token using email/password if needed
    // ShipHero GraphQL endpoint
    const SHIPHERO_URL = 'https://public-api.shiphero.com/graphql'

    // Step 1: Get auth token
    const authRes = await fetch(SHIPHERO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `
          query {
            inventory(first: 100) {
              edges {
                node {
                  sku
                  on_hand
                  available
                  allocated
                  warehouse_products {
                    edges {
                      node {
                        on_hand
                        available
                        allocated
                        warehouse {
                          id
                          name
                        }
                      }
                    }
                  }
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

    if (!authRes.ok) {
      throw new Error(`ShipHero API error: ${authRes.status}`)
    }

    const data = await authRes.json()

    if (data.errors) {
      throw new Error(data.errors[0].message)
    }

    // Map SKUs to stock counts
    const inventory = {}
    const warehouseId = process.env.SHIPHERO_TIDAL_WAVE_WAREHOUSE_ID

    for (const edge of (data.data?.inventory?.edges || [])) {
      const node = edge.node
      if (!node.sku) continue

      let onHand = node.on_hand || 0
      let available = node.available || 0

      // If warehouse ID specified, get per-warehouse numbers
      if (warehouseId && node.warehouse_products?.edges?.length) {
        const whNode = node.warehouse_products.edges.find(
          e => e.node.warehouse?.id === warehouseId
        )
        if (whNode) {
          onHand = whNode.node.on_hand || 0
          available = whNode.node.available || 0
        }
      }

      inventory[node.sku] = {
        sku: node.sku,
        on_hand: onHand,
        available: available,
        allocated: node.allocated || 0,
      }
    }

    // Map SKUs to your product names
    // These match your Shopify CSV SKUs
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

    // Build response keyed by product name
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
      warehouse: warehouseId || 'default',
      stock: stockByProduct,
      raw_count: Object.keys(inventory).length,
    })

  } catch (err) {
    console.error('[ShipHero API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
