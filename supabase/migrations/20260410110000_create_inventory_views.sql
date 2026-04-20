-- ================================================================
-- 库存数据视图
-- sku_categories 列名："SKU"（大写）、"Category"（大写C）
-- inventory_batches / inventory_sku_monthly 列名：sku（小写）
-- ================================================================

drop view if exists v_inventory_batches;
drop view if exists v_inventory_sku_monthly;
drop view if exists v_inventory_latest;
drop view if exists v_sku_master;

-- 1. 批次级库存 + 品类
create or replace view v_inventory_batches as
select b.*, c."Category" as category
from inventory_batches b
left join sku_categories c on b.sku = c."SKU";

-- 2. SKU月度汇总 + 品类
create or replace view v_inventory_sku_monthly as
select s.*, c."Category" as category
from inventory_sku_monthly s
left join sku_categories c on s.sku = c."SKU";

-- 3. 最新月份库存快照（每个SKU只取最新一个月）
create or replace view v_inventory_latest as
select distinct on (s.sku) s.*, c."Category" as category
from inventory_sku_monthly s
left join sku_categories c on s.sku = c."SKU"
order by s.sku, s."Time" desc;

-- 4. SKU主数据宽表
create or replace view v_sku_master as
select
  c."SKU"               as sku,
  c."Category"          as category,
  p.price,
  p.cost,
  ss.safety_stock_value as safety_stock,
  th.safety_stock       as threshold_safety_stock,
  th.high_stock         as threshold_high_stock
from sku_categories c
left join sku_price_cost   p  on c."SKU" = p."SKU"
left join sku_safety_stock ss on c."SKU" = ss.sku
left join sku_thresholds   th on c."SKU" = th.sku;
