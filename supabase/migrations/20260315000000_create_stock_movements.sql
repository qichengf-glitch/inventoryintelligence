create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  batch text,
  movement_type text not null,
  qty integer not null,
  reference_no text,
  notes text,
  movement_date date not null default current_date,
  created_by text,
  created_at timestamptz not null default now(),
  constraint stock_movements_type_check check (
    movement_type in ('IN_PURCHASE', 'IN_RETURN', 'OUT_SALES', 'OUT_DAMAGED', 'ADJUSTMENT')
  )
);

create index if not exists idx_stock_movements_sku
  on public.stock_movements (sku);

create index if not exists idx_stock_movements_date
  on public.stock_movements (movement_date desc);

create index if not exists idx_stock_movements_type
  on public.stock_movements (movement_type);
