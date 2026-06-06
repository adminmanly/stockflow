// pages/api/chat.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { message, context, history = [] } = req.body
  if (!message) return res.status(400).json({ error: 'No message' })

  const systemPrompt = `You are Stockflow AI — an inventory assistant for Manly, a personal care brand.
You have access to live inventory data and can answer questions and perform actions.

CURRENT DATA:
${JSON.stringify(context, null, 2)}

PRODUCTS:
- Core: Body Wash (BWc&c-MANLY), Deodorant (Dc&c-MANLY), Shampoo (SHAc&c-MANLY), Conditioner (CONc&c-MANLY), Ball Deodorant (SSC&C)
- Gifts: Body Buffer (BB-MANLY), Scalp Scrubber (SCALP-MANLY), Cooling Wipes (CW-MANLY)

FULFILMENT CENTRES:
- Tidal Wave (tw) — US warehouse via ShipHero
- Internal WH (vi) — Victoria AU (Cooper St, Campbellfield)

PURCHASE ORDER STATUSES (in order):
Draft → Submitted → Confirmed → In Production → Shipped → In Transit → Customs → At FC → Received

PAYMENT MILESTONE TYPES (in order):
Deposit → On Shipping → At Port → On Receipt → Other

ACTIONS YOU CAN PERFORM:
When the user asks you to create or modify data, include an "action" in your response using this exact JSON format at the end of your message:

To create a PO:
<action>{"type":"CREATE_PO","data":{"id":"PO-XXX","supId":"s1","fc":"tw","status":"Draft","exp":"2026-06-01","notes":"","lines":[{"p":"Body Wash","sku":"BWc&c-MANLY","o":30000,"r":0,"cost":2.03}],"payments":[{"id":"p1","type":"Deposit","pct":30,"amount":9000,"invNum":"","invDate":"","dueDate":"","paidDate":"","status":"Unpaid"}]}}</action>

To update PO status:
<action>{"type":"UPDATE_PO_STATUS","poId":"PO-001","status":"Shipped"}</action>

To mark payment paid:
<action>{"type":"MARK_PAYMENT_PAID","poId":"PO-001","paymentType":"Deposit"}</action>

To update payment details:
<action>{"type":"UPDATE_PAYMENT","poId":"PO-001","paymentType":"Deposit","data":{"invNum":"INV-2026-001","dueDate":"2026-05-15","amount":9000}}</action>

RESPONSE STYLE:
- Be concise and direct — this is a business tool not a chatbot
- Use numbers and specifics from the data
- When creating POs, confirm all details back to the user before including the action
- For stock questions, always include days-left and daily velocity
- Currency is AUD for AU suppliers, USD for US suppliers`

  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
  ]

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel env vars' })
    if (!apiKey.startsWith('sk-ant-')) return res.status(500).json({ error: 'ANTHROPIC_API_KEY looks wrong — should start with sk-ant-. Current value starts with: ' + apiKey.slice(0,8) })

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages
      })
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Claude API error: ${response.status} ${err}`)
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''

    // Extract action if present
    const actionMatch = text.match(/<action>([\s\S]*?)<\/action>/)
    let action = null
    let displayText = text

    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1])
        displayText = text.replace(/<action>[\s\S]*?<\/action>/, '').trim()
      } catch (e) {
        console.error('Action parse error:', e.message)
      }
    }

    return res.json({ ok: true, text: displayText, action })

  } catch (err) {
    console.error('[Chat API]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
