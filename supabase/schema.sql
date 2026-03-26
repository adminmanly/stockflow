-- ─────────────────────────────────────────────────────────────────────────────
-- STOCKFLOW — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable Row Level Security everywhere
-- Users can only see data for their organisation

-- ── Organisations ────────────────────────────────────────────────────────────
create table organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz default now()
);

-- ── Profiles (extends Supabase auth.users) ───────────────────────────────────
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid references organisations(id),
  full_name   text,
  role        text default 'member' check (role in ('admin','member','viewer')),
  created_at  timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ── Purchase Orders ───────────────────────────────────────────────────────────
create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references organisations(id),
  po_number     text not null,
  supplier_name text not null,
  supplier_addr text,
  supplier_email text,
  fc_id         text not null,  -- 'tw' | 'vi'
  status        text not null default 'Draft',
  expected_date date,
  notes         text,
  approved      boolean default false,
  approved_by   uuid references profiles(id),
  approved_at   timestamptz,
  created_by    uuid references profiles(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ── PO Line Items ─────────────────────────────────────────────────────────────
create table po_lines (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid references purchase_orders(id) on delete cascade,
  product_title text not null,
  product_sku   text,
  qty_ordered   int not null default 0,
  qty_received  int not null default 0,
  unit_cost     numeric(10,2),
  created_at    timestamptz default now()
);

-- ── Stock snapshots (written by cron, read by dashboard) ─────────────────────
create table stock_snapshots (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organisations(id),
  fc_id       text not null,
  product_sku text not null,
  product_title text,
  on_hand     int default 0,
  available   int default 0,
  allocated   int default 0,
  source      text default 'manual',  -- 'shopify' | 'shiphero' | 'manual'
  snapped_at  timestamptz default now()
);

-- Latest snapshot view (most recent per FC + SKU)
create or replace view stock_current as
select distinct on (org_id, fc_id, product_sku)
  *
from stock_snapshots
order by org_id, fc_id, product_sku, snapped_at desc;

-- ── Alert log ────────────────────────────────────────────────────────────────
create table alert_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organisations(id),
  fc_id       text,
  product_sku text,
  product_title text,
  days_remaining int,
  alert_type  text,  -- 'critical' | 'warning'
  channel     text,  -- 'email' | 'slack'
  sent_at     timestamptz default now()
);

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table organisations       enable row level security;
alter table profiles            enable row level security;
alter table purchase_orders     enable row level security;
alter table po_lines            enable row level security;
alter table stock_snapshots     enable row level security;
alter table alert_log           enable row level security;

-- Profiles: users see only their own
create policy "own profile" on profiles
  for all using (auth.uid() = id);

-- POs: users in same org
create policy "org purchase_orders" on purchase_orders
  for all using (
    org_id = (select org_id from profiles where id = auth.uid())
  );

create policy "org po_lines" on po_lines
  for all using (
    po_id in (
      select id from purchase_orders
      where org_id = (select org_id from profiles where id = auth.uid())
    )
  );

create policy "org stock_snapshots" on stock_snapshots
  for all using (
    org_id = (select org_id from profiles where id = auth.uid())
  );

create policy "org alert_log" on alert_log
  for all using (
    org_id = (select org_id from profiles where id = auth.uid())
  );

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index on purchase_orders(org_id, status);
create index on purchase_orders(org_id, expected_date);
create index on po_lines(po_id);
create index on stock_snapshots(org_id, fc_id, product_sku, snapped_at desc);
