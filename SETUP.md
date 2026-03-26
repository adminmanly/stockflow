# Stockflow — Deploy Guide
### From zero to live in ~45 minutes. Step by step.

---

## What you'll set up
1. GitHub (stores your code)
2. Supabase (database + user logins) — free
3. Vercel (hosts the app, auto-deploys) — free
4. Shopify API token
5. ShipHero API token
6. Resend (email alerts) — free
7. Slack webhook (optional)

---

## STEP 1 — Get the code on GitHub

1. Go to https://github.com and create a free account if you don't have one
2. Click **New repository** → name it `stockflow` → **Create repository**
3. Download GitHub Desktop from https://desktop.github.com
4. Open GitHub Desktop → **Clone a repository** → paste your new repo URL
5. Copy all the files from the `stockflow` folder I gave you into the cloned folder
6. In GitHub Desktop: type commit message "Initial setup" → **Commit to main** → **Push origin**

---

## STEP 2 — Set up Supabase (database + logins)

1. Go to https://supabase.com → **Start your project** → sign up
2. **New project** → name it `stockflow` → pick a region close to you → set a database password (save it!)
3. Wait ~2 min for it to provision
4. Go to **SQL Editor** → **New query**
5. Open the file `supabase/schema.sql` from your code folder
6. Copy the entire contents → paste into SQL Editor → click **Run**
7. You should see "Success. No rows returned"

Now get your API keys:
8. Go to **Settings** (gear icon) → **API**
9. Copy these 3 values — you'll need them in Step 4:
   - **Project URL** → this is your `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → this is your `SUPABASE_SERVICE_ROLE_KEY` ⚠️ keep this secret

---

## STEP 3 — Set up Shopify API access

1. In your Shopify Admin → go to **Settings** → **Apps and sales channels**
2. Scroll to bottom → **Develop apps** → **Allow custom app development**
3. **Create an app** → name it `Stockflow`
4. Click **Configure Admin API scopes** and enable:
   - `read_products`
   - `read_inventory`
   - `read_orders`
   - `read_locations`
5. **Save** → **Install app** → **Install**
6. Copy the **Admin API access token** (starts with `shpat_`)
   ⚠️ You only see this once — copy it now
7. Your store domain is: `your-store-name.myshopify.com`

---

## STEP 4 — Set up ShipHero API (for Tidal Wave stock)

1. Log into ShipHero at https://app.shiphero.com
2. Go to **Account** (top right) → **API**
3. Click **Generate Token** (or copy existing)
4. Also note your **Warehouse ID** from **Settings** → **Warehouses**

---

## STEP 5 — Set up Resend (email alerts)

1. Go to https://resend.com → **Get Started** (free)
2. **API Keys** → **Create API Key** → name it `Stockflow alerts`
3. Copy the key (starts with `re_`)
4. **Domains** → add your domain and verify it (or use the free `@resend.dev` for testing)

---

## STEP 6 — Set up Slack alerts (optional but recommended)

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name it `Stockflow` → pick your workspace
3. **Incoming Webhooks** → toggle on → **Add New Webhook to Workspace**
4. Pick a channel (e.g. `#stock-alerts`) → **Allow**
5. Copy the webhook URL (starts with `https://hooks.slack.com/services/...`)

---

## STEP 7 — Deploy to Vercel

1. Go to https://vercel.com → **Sign up with GitHub**
2. **Add New Project** → select your `stockflow` repository → **Import**
3. **Before clicking Deploy**, click **Environment Variables** and add each one:

```
NEXT_PUBLIC_SUPABASE_URL         = (from Step 2)
NEXT_PUBLIC_SUPABASE_ANON_KEY    = (from Step 2)
SUPABASE_SERVICE_ROLE_KEY        = (from Step 2)

SHOPIFY_STORE_DOMAIN             = your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN       = shpat_xxxx (from Step 3)

SHIPHERO_API_TOKEN               = (from Step 4)
SHIPHERO_TIDAL_WAVE_WAREHOUSE_ID = (from Step 4)

RESEND_API_KEY                   = re_xxxx (from Step 5)
ALERT_FROM_EMAIL                 = alerts@yourdomain.com
ALERT_TO_EMAILS                  = you@email.com,teammate@email.com

SLACK_WEBHOOK_URL                = https://hooks.slack.com/... (from Step 6)

ALERT_CRITICAL_DAYS              = 7
ALERT_WARNING_DAYS               = 14

NEXTAUTH_SECRET                  = (generate at: https://generate-secret.vercel.app/32)
NEXT_PUBLIC_APP_URL              = https://stockflow.vercel.app
```

4. Click **Deploy** → wait ~2 minutes

---

## STEP 8 — Create your first user + organisation

1. Go to your live app URL (e.g. `https://stockflow.vercel.app`)
2. Click **Sign up** → create your account with your email + password
3. Go to Supabase → **Table Editor** → `organisations` → **Insert row**
   - name: your company name
   - Click **Save**
4. Copy the `id` (UUID) of that row
5. Go to `profiles` table → find your user → click **Edit**
   - Set `org_id` to the UUID you just copied
   - Set `role` to `admin`
   - Click **Save**
6. Invite your team: they sign up on the app, then you set their `org_id` + `role` in Supabase the same way

---

## STEP 9 — Map your Shopify locations to FCs

Open `pages/api/shopify/sync.js` and find `LOCATION_MAP`.
Update it with your exact Shopify location names:

```js
const LOCATION_MAP = {
  'Your Shopify Location Name': 'vi',  // → Internal WH (Victoria)
  // Tidal Wave uses ShipHero, not Shopify inventory
}
```

To find your location names: Shopify Admin → Settings → Locations

---

## STEP 10 — First manual sync

Once deployed, run a manual sync to populate stock data:

1. Go to your Vercel dashboard → your project → **Functions** tab
2. Or just make a POST request to:
   `https://your-app.vercel.app/api/shopify/sync?org_id=YOUR_ORG_ID`
   `https://your-app.vercel.app/api/shiphero/sync?org_id=YOUR_ORG_ID`

After this, syncs happen automatically every 6 hours via the Vercel cron job.

---

## You're live! 🎉

- App URL: `https://stockflow.vercel.app`
- Auto-deploys: every time you push to GitHub
- Stock syncs: every 6 hours (Shopify + ShipHero)
- Alerts: every 6 hours, email + Slack if stock is critical

---

## Invite your team

1. Share the app URL with them
2. They sign up themselves
3. You set their `org_id` and `role` in Supabase → `profiles` table

Roles:
- `admin` — full access, can approve POs
- `member` — can create/edit POs, view everything
- `viewer` — read-only

---

## Need changes?

Come back to Claude and ask. Just say what you want updated and I'll modify the code. Then push to GitHub — Vercel auto-deploys within 2 minutes.
