-- ================================================================
-- ML Forecast Results Table
-- 存储 LightGBM 全局模型的 SKU 月度预测结果及回测误差指标
-- ================================================================

create table if not exists ml_forecast_results (
  id            uuid        default gen_random_uuid() primary key,
  sku           text        not null,
  target_month  text        not null,          -- 格式：'YYYY-MM'，如 '2025-12'
  predicted_qty numeric(14, 4) not null,       -- 预测出库量
  mae           numeric(14, 4),                -- walk-forward 回测 MAE
  rmse          numeric(14, 4),                -- walk-forward 回测 RMSE
  mape          numeric(10, 6),                -- walk-forward 回测 MAPE（0.1 = 10%）
  model_version text        not null default 'lgbm-v1',
  trained_at    timestamptz not null default now()
);

-- 唯一约束：同一版本里每个 SKU+月份只保留一条
create unique index if not exists ml_forecast_results_sku_month_version_idx
  on ml_forecast_results (sku, target_month, model_version);

-- 常用查询索引
create index if not exists ml_forecast_results_sku_idx
  on ml_forecast_results (sku);

create index if not exists ml_forecast_results_trained_at_idx
  on ml_forecast_results (trained_at desc);

-- Row Level Security（与其他表保持一致）
alter table ml_forecast_results enable row level security;

create policy "allow read ml_forecast_results"
  on ml_forecast_results for select
  using (true);

create policy "allow insert ml_forecast_results"
  on ml_forecast_results for insert
  with check (true);

create policy "allow delete ml_forecast_results"
  on ml_forecast_results for delete
  using (true);

comment on table ml_forecast_results is
  'LightGBM 全局模型的月度预测结果。由 scripts/ml_forecast/train.py 写入，'
  '每次训练先删除同版本旧数据再批量插入。';
