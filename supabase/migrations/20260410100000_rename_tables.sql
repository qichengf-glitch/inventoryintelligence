-- ================================================================
-- 表重命名迁移
-- 目的：让表名更清晰地反映实际存储内容
-- ================================================================
-- 执行前请确保没有正在运行的事务

-- 1. datasets → upload_records
--    原：月度上传元数据（含义模糊）
--    新：明确表达"上传记录"
ALTER TABLE IF EXISTS datasets RENAME TO upload_records;

-- 2. inventory_monthly → inventory_batches
--    原：批次级月度库存数据，名称未体现"批次"粒度
--    新：强调这是批次(batch)维度的原始数据
ALTER TABLE IF EXISTS inventory_monthly RENAME TO inventory_batches;

-- 3. inventory_summary → inventory_sku_monthly
--    原：SKU级月度汇总，与 inventory_monthly 名称过于相似
--    新：明确是 SKU 粒度的月度聚合
ALTER TABLE IF EXISTS inventory_summary RENAME TO inventory_sku_monthly;

-- 4. safety_stock → sku_safety_stock
--    原：安全库存配置，与其他 sku_ 前缀表命名不一致
--    新：统一 sku_ 前缀命名风格
ALTER TABLE IF EXISTS safety_stock RENAME TO sku_safety_stock;

-- 验证（执行后可以运行这段 SELECT 确认）
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
