let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

// These are the SKUs we track for inventory/velocity
// The API will also auto-discover all SKUs from Shopify and return them
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

const BUNDLE_COMPONENTS = {
  'BCKc&c':      ['BWc&c-MANLY','Dc&c-MANLY'],
  'SEC&C':       ['BWc&c-MANLY','Dc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
  'HCKc&c':      ['SHAc&c-MANLY','CONc&c-MANLY'],
  'STKc&c':      ['BWc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
  'BPc&c':       ['SSC&C','BB-MANLY'],
  'V2FREEGIFTS': ['BB-MANLY','SCALP-MANLY','CW-MANLY'],
  'SE':          ['BWc&c-MANLY','Dc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
  'SE2':         ['BWc&c-MANLY','Dc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY'],
  'REPAIR':      ['SHAc&c-MANLY','CONc&c-MANLY'],
  'ACNEKIT':     ['BWc&c-MANLY','Dc&c-MANLY'],
  'BACNE':       ['BWc&c-MANLY','Dc&c-MANLY'],
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

  if (!domain || !token) return res.status(500).json({ error: 'Shopify not configured' })

  const BASE = `https://${domain}/admin/api/2024-04`
  const HEADERS = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }

  const forceRefresh = req.query?.refresh === '1'
  let sinceDate, untilDate, validDays, cacheKey

  if (req.query?.from && req.query?.to) {
    const from = new Date(req.query.from)
    const to = new Date(req.query.to)
    to.setHours(23, 59, 59, 999)
    sinceDate = from
    untilDate = to
    validDays = Math.max(1, Math.round((to - from) / 864e5))
    cacheKey = `shopify_${req.query.from}_${req.query.to}`
  } else {
    const days = parseInt(req.query?.days) || 30
    validDays = (days >= 1 && days <= 90) ? days : 30
    sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - validDays)
    untilDate = null
    cacheKey = `shopify_${validDays}`
  }

  if (!forceRefresh && _cache?.key === cacheKey && Date.now() - _cacheTime < CACHE_TTL) {
    return res.json({ ..._cache.data, cached: true })
  }

  try {
    // Fetch ALL product pages (handle pagination)
    const allProducts = []
    let productUrl = `${BASE}/products.json?limit=250&fields=id,title,variants`
    while (productUrl) {
      const r = await fetch(productUrl, { headers: HEADERS })
      if (!r.ok) throw new Error(`products ${r.status}`)
      const d = await r.json()
      allProducts.push(...(d.products || []))
      const link = r.headers.get('Link') || ''
      const next = link.match(/<([^>]+)>;\s*rel="next"/)
      productUrl = next ? next[1] : null
    }

    const [locRes] = await Promise.all([
      fetch(`${BASE}/locations.json`, { headers: HEADERS })
    ])
    if (!locRes.ok) throw new Error(`locations ${locRes.status}`)
    const locData = await locRes.json()

    // Build full SKU → inventory_item_id map from ALL products/variants
    const itemToSku = {}
    const skuToItemId = {}
    const skuToProduct = {} // sku → product title
    const allDiscoveredSkus = {} // sku → { title, productTitle, price }

    for (const p of allProducts) {
      for (const v of p.variants) {
        // Debug specific SKU
        if (v.sku && v.sku.trim() === 'CONC+B') {
          console.log('[DEBUG CONC+B] Found in product:', p.title, '| variant:', v.title)
        }
        if (!v.sku) continue
        const sku = v.sku.trim()
        if (!sku || sku.length === 0) continue // skip blank SKUs
        if (sku.startsWith('ROUTEINS')) continue // skip Route insurance
        if (sku === 'FREEGIFTS' || sku === 'V2FREEGIFTS') continue // skip gift bundles

        // Skip all bundle/kit SKUs — these are multi-product bundles not individual items
        const BUNDLE_SKUS = new Set([
          // Kits & bundles
          'BCKc&c','SEC&C','HCKc&c','STKc&c','BPc&c',
          'SE','SE2','BE','WPC&C','OLDSE','SRO',
          'ACNEKIT','BACNE','REPAIR','SKINDEFENCE','RESTOREHYDRATE',
          'SC+B+CC+B',
          // DUO products
          'DSCB+B-DUO','DSMO+B-DUO','DSFF+B-DUO','DSCC+B-DUO',
          // Old/discontinued — removed, show in inventory
          // 2-packs
          'Dc&c-MANLY-2PK','BWc&c-MANLY-2PK',
          // Loyalty variants
          'CW-MANLY-LOYAL',
          // Non-physical / digital
          'OEBT','TEBT','TS','ACNESCRUB',
        ])
        if (BUNDLE_SKUS.has(sku)) continue

        // Skip SKU patterns for bundles (suffix-based)
        if (sku.endsWith('-MOM2')) continue   // Momentum bundles
        if (sku.endsWith('-YR6')) continue    // Year One bundles
        if (sku.endsWith('-GRAD')) continue   // Graduation bundles
        if (sku.endsWith('-DUO')) continue    // Duo sets

        // These SKUs always show regardless of title matching
        const ALWAYS_SHOW = new Set([
          // Core scent variants - conditioner, body wash, deodorant, shampoo scents
          'CONC+B','CONC+C','CONF+F','CONM+O',
          'BWC+B','BWC+C','BWF+F','BWM+O',
          'DC+B','DC+C','DF+F','DM+O',
          'SHC+B','SHC+C','SHF+F','SHM+O',
          // Old/discontinued products
          'BW-OLD','D-OLD',
          // Main tracked SKUs
          'BWc&c-MANLY','Dc&c-MANLY','SHAc&c-MANLY','CONc&c-MANLY',
          'SSC&C','BB-MANLY','SCALP-MANLY','CW-MANLY',
        ])
        if (ALWAYS_SHOW.has(sku)) {
          // Don't filter — fall through to allDiscoveredSkus
        } else {

        // Skip product titles that are bundle/kit products
        const SKIP_TITLE_PATTERNS = [
          'momentum bundle','year one bundle','graduation bundle',
          'duo set','2 pack','kills teen odor new','loyalty',
          'ebook','health guide','texture spray','acne scrub',
        ]
        const titleLower = (p.title || '').toLowerCase()
        if (SKIP_TITLE_PATTERNS.some(pat => titleLower.includes(pat))) continue
        } // end else (not in ALWAYS_SHOW)

        // Skip variant suffixes — consolidate by product title instead
        // e.g. BWC+B, BWC+B2, BWC+B3, BWC+B4 all become 1 row grouped by productTitle
        if (v.inventory_item_id) {
          itemToSku[String(v.inventory_item_id)] = sku
          skuToItemId[sku] = String(v.inventory_item_id)
        }
        skuToProduct[sku] = p.title
        allDiscoveredSkus[sku] = {
          productTitle: p.title,
          variantTitle: v.title !== 'Default Title' ? v.title : '',
          price: parseFloat(v.price || 0),
          inventoryItemId: v.inventory_item_id,
        }
      }
    }

    const TRACKED_SKUS = new Set(Object.keys(SKU_MAP))
    const trackedItemIds = Object.keys(SKU_MAP).map(s => skuToItemId[s]).filter(Boolean)

    // AU location — try multiple name patterns
    const locations = locData.locations.filter(l => l.active)
    const auLocation = locations.find(l =>
      l.name === '11/81 Cooper St, Campbellfield' ||
      l.name?.toLowerCase().includes('campbellfield') ||
      l.name?.toLowerCase().includes('cooper st') ||
      l.name?.toLowerCase().includes('internal wh') ||
      l.name?.toLowerCase().includes('australia') ||
      l.name?.toLowerCase().includes('victoria') ||
      (l.country_code === 'AU' && locations.length > 1)
    )
    // Log all locations for debugging
    console.log('[Shopify] All locations:', locations.map(l => `${l.id}: ${l.name} (${l.country_code})`))
    console.log('[Shopify] AU location matched:', auLocation?.name || 'NONE FOUND')

    // Fetch COGS and AU stock in parallel
    // Get ALL inventory item IDs for AU stock lookup
    const allItemIds = Object.values(skuToItemId).filter(Boolean)
    const chunked = (arr, size) => Array.from({length: Math.ceil(arr.length/size)}, (_,i) => arr.slice(i*size,(i+1)*size))
    const allItemChunks = chunked(allItemIds, 100) // Shopify limit per request

    const [cogsRes] = await Promise.all([
      trackedItemIds.length > 0
        ? fetch(`${BASE}/inventory_items.json?ids=${trackedItemIds.join(',')}&limit=250`, { headers: HEADERS })
        : Promise.resolve(null),
    ])

    // Fetch AU stock for ALL items (paginated by chunk)
    const allInvLevels = []
    if (auLocation && allItemChunks.length > 0) {
      for (const chunk of allItemChunks) {
        const r = await fetch(`${BASE}/inventory_levels.json?location_id=${auLocation.id}&inventory_item_ids=${chunk.join(',')}&limit=250`, { headers: HEADERS })
        if (r.ok) {
          const d = await r.json()
          allInvLevels.push(...(d.inventory_levels || []))
        }
      }
    }
    const invRes = null // handled above

    const cogsBySku = {}
    if (cogsRes?.ok) {
      const d = await cogsRes.json()
      for (const item of d.inventory_items || []) {
        const sku = itemToSku[String(item.id)]
        if (sku && item.cost) cogsBySku[sku] = parseFloat(item.cost)
      }
    }

    const auStockBySku = {}
    for (const level of allInvLevels) {
      const sku = itemToSku[String(level.inventory_item_id)]
      if (!sku) continue
      auStockBySku[sku] = Math.max(0, level.available || 0)
    }

    // Paginate orders
    const soldBySkuUS = {}
    const soldBySkuAU = {}
    const revBySku = {}
    let totalRevenue = 0
    let totalOrders = 0
    let pageCount = 0

    const orderMaxParam = untilDate
      ? `&created_at_max=${untilDate.toISOString()}`
      : ''

    let orderUrl = `${BASE}/orders.json?status=any&financial_status=paid&created_at_min=${sinceDate.toISOString()}${orderMaxParam}&limit=250&fields=id,total_price,line_items,shipping_address`

    while (orderUrl && pageCount < 50) {
      const r = await fetch(orderUrl, { headers: HEADERS })
      if (!r.ok) break
      const d = await r.json()
      totalOrders += (d.orders || []).length
      pageCount++

      for (const order of d.orders || []) {
        const country = order.shipping_address?.country_code || 'US'
        const isAU = country === 'AU'
        totalRevenue += parseFloat(order.total_price || 0)

        for (const item of order.line_items) {
          const price = parseFloat(item.price || 0)
          const qty = item.quantity || 1
          const sku = item.sku?.trim()
          if (!sku || !price) continue

          // Track velocity for ALL SKUs
          if (isAU) soldBySkuAU[sku] = (soldBySkuAU[sku] || 0) + qty
          else soldBySkuUS[sku] = (soldBySkuUS[sku] || 0) + qty
          if (!revBySku[sku]) revBySku[sku] = { rev: 0, qty: 0 }
          revBySku[sku].rev += price * qty
          revBySku[sku].qty += qty

          // Distribute bundle revenue to components
          if (BUNDLE_COMPONENTS[sku]) {
            const comps = BUNDLE_COMPONENTS[sku]
            const revPerComp = (price * qty) / comps.length
            for (const compSku of comps) {
              if (!revBySku[compSku]) revBySku[compSku] = { rev: 0, qty: 0 }
              revBySku[compSku].rev += revPerComp
              revBySku[compSku].qty += qty
            }
          }
        }
      }

      const link = r.headers.get('Link') || ''
      const next = link.match(/<([^>]+)>;\s*rel="next"/)
      orderUrl = next ? next[1] : null
    }

    // Build tracked product results (legacy 8 SKUs by display name)
    const auStockByProduct = {}
    const velocityUSByProduct = {}
    const velocityAUByProduct = {}
    const avgPriceByProduct = {}
    const cogsByProduct = {}

    for (const [sku, productName] of Object.entries(SKU_MAP)) {
      auStockByProduct[productName] = auStockBySku[sku] || 0
      velocityUSByProduct[productName] = +((soldBySkuUS[sku] || 0) / validDays).toFixed(1)
      velocityAUByProduct[productName] = +((soldBySkuAU[sku] || 0) / validDays).toFixed(1)
      const rv = revBySku[sku]
      avgPriceByProduct[productName] = rv?.qty > 0 ? +(rv.rev / rv.qty).toFixed(2) : 0
      cogsByProduct[productName] = cogsBySku[sku] || 0
    }

    // Build full SKU catalogue with stock + velocity for ALL discovered SKUs
    const allSkusData = {}
    for (const [sku, info] of Object.entries(allDiscoveredSkus)) {
      const rv = revBySku[sku]
      allSkusData[sku] = {
        ...info,
        au_stock: auStockBySku[sku] || 0,
        velocity_us: +((soldBySkuUS[sku] || 0) / validDays).toFixed(1),
        velocity_au: +((soldBySkuAU[sku] || 0) / validDays).toFixed(1),
        avg_price: rv?.qty > 0 ? +(rv.rev / rv.qty).toFixed(2) : info.price || 0,
        cogs: cogsBySku[sku] || 0,
        is_tracked: !!SKU_MAP[sku],
        display_name: SKU_MAP[sku] || null,
      }
    }

    const result = {
      ok: true,
      source: 'shopify',
      period_days: validDays,
      au_stock: auStockByProduct,
      velocity_us: velocityUSByProduct,
      velocity_au: velocityAUByProduct,
      avg_price: avgPriceByProduct,
      cogs: cogsByProduct,
      daily_revenue: +(totalRevenue / validDays).toFixed(2),
      total_revenue: +totalRevenue.toFixed(2),
      orders_analysed: totalOrders,
      au_location: auLocation?.name || 'not found',
      all_locations: locations.map(l => ({ id: l.id, name: l.name, country: l.country_code, active: l.active })),
      // Full SKU catalogue with stock + velocity
      all_skus: allSkusData,
      sku_to_product: skuToProduct,
      cached: false,
      cached_at: new Date().toISOString(),
    }

    _cache = { key: cacheKey, data: result }
    _cacheTime = Date.now()

    return res.json(result)

  } catch (err) {
    console.error('[Shopify API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
