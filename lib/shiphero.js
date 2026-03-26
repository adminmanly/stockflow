// ─────────────────────────────────────────────────────────────────────────────
// ShipHero GraphQL API integration
// Used for: Tidal Wave (US) live stock counts
// Docs: https://developer.shiphero.com/getting-started/
// ─────────────────────────────────────────────────────────────────────────────

const SHIPHERO_URL = 'https://public-api.shiphero.com/graphql'

async function shipheroQuery(query, variables = {}) {
  const res = await fetch(SHIPHERO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SHIPHERO_API_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) throw new Error(`ShipHero API error: ${res.status}`)
  const json = await res.json()
  if (json.errors) throw new Error(`ShipHero GraphQL: ${json.errors[0].message}`)
  return json.data
}

// ── Pull all inventory for your warehouse ────────────────────────────────────
// Returns: array of { sku, on_hand, available, allocated }
export async function getShipHeroInventory() {
  const warehouseId = process.env.SHIPHERO_TIDAL_WAVE_WAREHOUSE_ID

  const query = `
    query GetInventory($warehouseId: String, $after: String) {
      inventory(warehouse_id: $warehouseId, first: 200, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            sku
            on_hand
            available
            allocated
            warehouse_products {
              edges {
                node {
                  warehouse_id
                  on_hand
                  available
                  allocated
                }
              }
            }
          }
        }
      }
    }
  `

  const items = []
  let after = null
  let hasMore = true

  while (hasMore) {
    const data = await shipheroQuery(query, { warehouseId, after })
    const inv = data.inventory

    for (const edge of inv.edges) {
      const node = edge.node
      // If warehouse ID specified, pull per-warehouse numbers
      const whEdge = node.warehouse_products?.edges?.find(
        e => e.node.warehouse_id === warehouseId
      )
      items.push({
        sku: node.sku,
        on_hand: whEdge ? whEdge.node.on_hand : node.on_hand,
        available: whEdge ? whEdge.node.available : node.available,
        allocated: whEdge ? whEdge.node.allocated : node.allocated,
      })
    }

    hasMore = inv.pageInfo.hasNextPage
    after = inv.pageInfo.endCursor
  }

  return items
}

// ── Get a single SKU's inventory ─────────────────────────────────────────────
export async function getShipHeroSkuInventory(sku) {
  const query = `
    query GetSkuInventory($sku: String!) {
      inventory(sku: $sku) {
        edges {
          node {
            sku
            on_hand
            available
            allocated
          }
        }
      }
    }
  `
  const data = await shipheroQuery(query, { sku })
  return data.inventory.edges[0]?.node || null
}
