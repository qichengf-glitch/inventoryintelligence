create table if not exists public.sku_thresholds (
  sku text primary key,
  safety_stock integer null,
  high_stock integer null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_sku_thresholds_updated_at
  on public.sku_thresholds (updated_at desc);
