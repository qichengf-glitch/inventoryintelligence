-- Stores per-SKU per-model rolling backtest results from each run
create table if not exists public.forecast_backtest_results (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null,                  -- groups all rows from one cron run
  run_date      date not null,
  sku           text not null,
  model         text not null,                  -- NAIVE | SNAIVE | SMA | SES | HOLT | HW
  best_alpha    numeric(4,2) null,              -- optimised α (SES/HOLT/HW)
  best_beta     numeric(4,2) null,              -- optimised β (HOLT/HW)
  best_gamma    numeric(4,2) null,              -- optimised γ (HW)
  mape          numeric(8,4) null,              -- mean absolute % error (0-100 scale)
  mae           numeric(12,2) null,             -- mean absolute error (units)
  bias          numeric(12,2) null,             -- mean signed error (+over, -under forecast)
  sample_months integer not null default 0,     -- number of holdout periods evaluated
  created_at    timestamptz not null default now()
);

create index if not exists idx_fbr_sku_run_date
  on public.forecast_backtest_results (sku, run_date desc);

create index if not exists idx_fbr_run_id
  on public.forecast_backtest_results (run_id);

create index if not exists idx_fbr_model
  on public.forecast_backtest_results (model);

-- Best model recommendation per SKU (updated after each backtest run)
create table if not exists public.forecast_model_recommendations (
  sku                    text primary key,
  recommended_model      text not null,         -- winning model key
  best_alpha             numeric(4,2) null,
  best_beta              numeric(4,2) null,
  best_gamma             numeric(4,2) null,
  mape_at_recommendation numeric(8,4) null,
  mae_at_recommendation  numeric(12,2) null,
  bias_at_recommendation numeric(12,2) null,
  sample_months          integer null,
  runner_up_model        text null,             -- 2nd best model (for transparency)
  runner_up_mape         numeric(8,4) null,
  last_run_date          date not null,
  last_run_id            uuid not null,
  updated_at             timestamptz not null default now()
);

create index if not exists idx_fmr_updated_at
  on public.forecast_model_recommendations (updated_at desc);

-- Backtest run log (one row per cron execution)
create table if not exists public.forecast_backtest_runs (
  id             uuid primary key default gen_random_uuid(),
  run_date       date not null,
  triggered_by   text not null default 'cron',  -- 'cron' | 'manual'
  status         text not null default 'running', -- 'running' | 'done' | 'error'
  skus_evaluated integer null,
  duration_ms    integer null,
  ai_summary     text null,                      -- AI-generated narrative of this run
  error_message  text null,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz null
);
