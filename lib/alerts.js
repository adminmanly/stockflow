// ─────────────────────────────────────────────────────────────────────────────
// Stockflow Alerts Engine
// Checks stock levels and fires email + Slack when below thresholds
// Called by: /api/alerts/check (Vercel cron, runs every 6 hours)
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from 'resend'
import { supabaseAdmin } from './supabase'

const resend = new Resend(process.env.RESEND_API_KEY)

const CRITICAL_DAYS = parseInt(process.env.ALERT_CRITICAL_DAYS || '7')
const WARNING_DAYS  = parseInt(process.env.ALERT_WARNING_DAYS  || '14')

const FC_NAMES = {
  tw: 'Tidal Wave (US)',
  vi: 'Internal WH (Victoria)',
}

// ── Main check function ───────────────────────────────────────────────────────
export async function checkStockAlerts(orgId) {
  // Get latest stock snapshot
  const { data: stock, error } = await supabaseAdmin
    .from('stock_current')
    .select('*')
    .eq('org_id', orgId)

  if (error) throw error

  // Get sales velocity from snapshots (stored daily by sync job)
  // In production, this comes from Shopify 30d velocity API
  // For now we'll use a simple days_remaining column if available

  const criticals = []
  const warnings  = []

  for (const row of stock) {
    // Calculate days remaining (requires daily_velocity to be stored)
    if (!row.daily_velocity || row.daily_velocity <= 0) continue
    const daysLeft = Math.floor(row.available / row.daily_velocity)

    if (daysLeft <= CRITICAL_DAYS) {
      criticals.push({ ...row, daysLeft })
    } else if (daysLeft <= WARNING_DAYS) {
      warnings.push({ ...row, daysLeft })
    }
  }

  if (criticals.length === 0 && warnings.length === 0) {
    return { sent: false, reason: 'All stock levels healthy' }
  }

  // Check if we already alerted in the last 24h to avoid spam
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString()
  const { data: recentAlerts } = await supabaseAdmin
    .from('alert_log')
    .select('product_sku, fc_id, alert_type')
    .eq('org_id', orgId)
    .gte('sent_at', oneDayAgo)

  const alreadySent = new Set(recentAlerts?.map(a => `${a.fc_id}-${a.product_sku}-${a.alert_type}`) || [])

  const newCriticals = criticals.filter(r => !alreadySent.has(`${r.fc_id}-${r.product_sku}-critical`))
  const newWarnings  = warnings.filter(r  => !alreadySent.has(`${r.fc_id}-${r.product_sku}-warning`))

  if (newCriticals.length === 0 && newWarnings.length === 0) {
    return { sent: false, reason: 'Alerts already sent in last 24h' }
  }

  // Fire alerts
  await Promise.all([
    sendEmailAlert(orgId, newCriticals, newWarnings),
    sendSlackAlert(newCriticals, newWarnings),
  ])

  // Log to DB
  const logs = [
    ...newCriticals.map(r => ({ org_id: orgId, fc_id: r.fc_id, product_sku: r.product_sku, product_title: r.product_title, days_remaining: r.daysLeft, alert_type: 'critical', channel: 'email+slack' })),
    ...newWarnings.map(r  => ({ org_id: orgId, fc_id: r.fc_id, product_sku: r.product_sku, product_title: r.product_title, days_remaining: r.daysLeft, alert_type: 'warning',  channel: 'email+slack' })),
  ]
  await supabaseAdmin.from('alert_log').insert(logs)

  return { sent: true, criticals: newCriticals.length, warnings: newWarnings.length }
}

// ── Email via Resend ──────────────────────────────────────────────────────────
async function sendEmailAlert(orgId, criticals, warnings) {
  if (!process.env.RESEND_API_KEY) return

  const toEmails = (process.env.ALERT_TO_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)
  if (!toEmails.length) return

  const rows = (items, type) => items.map(r => `
    <tr style="background:${type==='critical'?'#fef2f2':'#fffbeb'}">
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:500">${r.product_title}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${FC_NAMES[r.fc_id]||r.fc_id}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${r.available} units</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:600;color:${type==='critical'?'#dc2626':'#d97706'}">${r.daysLeft} days</td>
    </tr>
  `).join('')

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">
      <div style="background:#111;padding:24px 32px;border-radius:8px 8px 0 0">
        <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-.01em">STOCKFLOW</div>
        <div style="color:#aaa;font-size:13px;margin-top:2px">Stock alert — ${new Date().toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'})}</div>
      </div>
      <div style="padding:24px 32px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
        ${criticals.length ? `
          <div style="margin-bottom:20px">
            <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#dc2626;margin-bottom:10px">🚨 Critical — ${criticals.length} product${criticals.length>1?'s':''} under ${CRITICAL_DAYS} days</div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr style="background:#f9f9f9"><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e0e0e0">Product</th><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e0e0e0">Location</th><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e0e0e0">Available</th><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e0e0e0">Days left</th></tr></thead>
              <tbody>${rows(criticals,'critical')}</tbody>
            </table>
          </div>` : ''}
        ${warnings.length ? `
          <div style="margin-bottom:20px">
            <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#d97706;margin-bottom:10px">⚠️ Warning — ${warnings.length} product${warnings.length>1?'s':''} under ${WARNING_DAYS} days</div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr style="background:#f9f9f9"><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e0e0e0">Product</th><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e0e0e0">Location</th><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e0e0e0">Available</th><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e0e0e0">Days left</th></tr></thead>
              <tbody>${rows(warnings,'warning')}</tbody>
            </table>
          </div>` : ''}
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #f0f0f0;font-size:12px;color:#999">
          Sent by Stockflow · <a href="${process.env.NEXT_PUBLIC_APP_URL}" style="color:#185fa5">Open dashboard</a> · Alerts fire every 6 hours
        </div>
      </div>
    </div>`

  await resend.emails.send({
    from: process.env.ALERT_FROM_EMAIL,
    to: toEmails,
    subject: `🚨 Stockflow: ${criticals.length} critical + ${warnings.length} warning stock alerts`,
    html,
  })
}

// ── Slack via webhook ─────────────────────────────────────────────────────────
async function sendSlackAlert(criticals, warnings) {
  if (!process.env.SLACK_WEBHOOK_URL) return

  const lines = [
    ...criticals.map(r => `🚨 *${r.product_title}* @ ${FC_NAMES[r.fc_id]||r.fc_id} — *${r.daysLeft}d* left (${r.available} units)`),
    ...warnings.map(r  => `⚠️  *${r.product_title}* @ ${FC_NAMES[r.fc_id]||r.fc_id} — *${r.daysLeft}d* left (${r.available} units)`),
  ]

  const payload = {
    text: `*Stockflow Stock Alert*\n${lines.join('\n')}\n<${process.env.NEXT_PUBLIC_APP_URL}|Open dashboard →>`,
    username: 'Stockflow',
    icon_emoji: ':package:',
  }

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
