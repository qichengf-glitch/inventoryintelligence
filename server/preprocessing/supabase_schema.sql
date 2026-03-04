-- Run in Supabase SQL editor
create extension if not exists pgcrypto;

create table if not exists datasets (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  original_filename text not null,
  cleaned_filename text not null,
  storage_path text not null,
  row_count integer not null check (row_count >= 0),
  uploaded_by text,
  created_at timestamptz not null default now()
);

create table if not exists inventory_monthly (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  month date not null,
  sku text not null,
  batch text,
  last_month_stock numeric(18, 4) not null default 0,
  month_in numeric(18, 4) not null default 0,
  month_out numeric(18, 4) not null default 0,
  month_sales numeric(18, 4) not null default 0,
  month_end_stock numeric(18, 4) not null default 0,
  note_value numeric(18, 4) not null default 0,
  remark text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_monthly_month_sku
  on inventory_monthly(month, sku);

create table if not exists inventory_summary (
  month date not null,
  sku text not null,
  total_month_end_stock numeric(18, 4) not null default 0,
  total_month_in numeric(18, 4) not null default 0,
  total_month_out numeric(18, 4) not null default 0,
  total_month_sales numeric(18, 4) not null default 0,
  batch_count integer not null default 0,
  dataset_id uuid references datasets(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (month, sku)
);

create index if not exists idx_inventory_summary_dataset_id
  on inventory_summary(dataset_id);
