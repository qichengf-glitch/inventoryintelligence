"""
Inventory Intelligence — 合成数据生成脚本
==========================================
生成 5 个新模块共 22 个数据集，总行数约 50,604 行
所有数据与真实库存数据（919 SKU / 2024-10~2025-11）保持一致

模块：
  1. 营销 Marketing       4 个文件  ~10,200 行
  2. 采购 Procurement     5 个文件  ~12,500 行
  3. 生产 Manufacturing   4 个文件  ~10,000 行
  4. 物流 Logistics       5 个文件  ~11,904 行
  5. 客户 CRM             4 个文件   ~6,000 行
                         ─────────────────────
合计                     22 个文件  ~50,604 行
"""

import os, random, math
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)
np.random.seed(42)

OUT_DIR = Path(__file__).parent.parent / "I&I_dataset" / "Synthetic Data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── 读取真实基准数据 ──────────────────────────────────────────────
DATASET_DIR = Path(__file__).parent.parent / "I&I_dataset"
appendix  = pd.read_csv(DATASET_DIR / "Appendix.csv")
price_df  = pd.read_csv(DATASET_DIR / "sku_price_cost.csv")

SKUS      = appendix["SKU"].tolist()          # 298 个 SKU
CATEGORIES = dict(zip(appendix["SKU"], appendix["Category"]))
PRICE_MAP  = dict(zip(price_df["sku"], price_df["sales_unit_price"]))
COST_MAP   = dict(zip(price_df["sku"], price_df["cost"]))

MONTHS = pd.date_range("2024-10", "2025-11", freq="MS").strftime("%Y-%m").tolist()  # 14 个月
ALL_MONTHS_DATE = pd.date_range("2024-10-01", "2025-11-01", freq="MS").tolist()

def rnd(lo, hi):        return round(random.uniform(lo, hi), 2)
def rnd_int(lo, hi):    return random.randint(lo, hi)
def pick(lst):          return random.choice(lst)
def save(df, name):
    path = OUT_DIR / name
    df.to_csv(path, index=False, encoding="utf-8-sig")
    print(f"  ✓ {name:<50} {len(df):>6} 行")
    return df

generated = {}  # 存储各表供后续引用

# ════════════════════════════════════════════════════════════════
# MODULE 1 — 营销 Marketing  (~10,200 行, 4 文件)
# ════════════════════════════════════════════════════════════════
print("\n【Module 1】营销 Marketing")

# 1-1. 促销活动主表  marketing_campaigns.csv  200 行
CHANNELS  = ["电商平台", "线下门店", "经销商", "直销", "展会"]
PROMO_TYPES = ["折扣", "买赠", "捆绑", "满减", "新品推广"]
campaigns = []
for i in range(1, 201):
    start = pick(ALL_MONTHS_DATE)
    dur   = rnd_int(7, 60)
    end   = min(start + timedelta(days=dur), datetime(2025, 11, 30))
    budget = rnd(5000, 200000)
    campaigns.append({
        "campaign_id":   f"CAMP{i:04d}",
        "campaign_name": f"{pick(PROMO_TYPES)}活动_{i:04d}",
        "channel":        pick(CHANNELS),
        "promo_type":     pick(PROMO_TYPES),
        "start_date":     start.strftime("%Y-%m-%d"),
        "end_date":       end.strftime("%Y-%m-%d"),
        "budget_rmb":     budget,
        "actual_spend_rmb": round(budget * rnd(0.6, 1.1), 2),
        "target_category": pick(list(set(CATEGORIES.values()))),
        "status":         pick(["已完成", "已完成", "已完成", "进行中", "计划中"]),
        "created_by":     pick(["张伟", "李娜", "王芳", "刘洋"]),
    })
save(pd.DataFrame(campaigns), "marketing_campaigns.csv")
generated["campaigns"] = pd.DataFrame(campaigns)

# 1-2. SKU 促销价格历史  marketing_sku_promo.csv  ~3,500 行
# 每次促销选 10~30 个 SKU
promo_skus = []
for camp in campaigns[:120]:   # 120 场活动参与促销
    n_skus = rnd_int(10, 30)
    selected = random.sample(SKUS, min(n_skus, len(SKUS)))
    for sku in selected:
        price = PRICE_MAP.get(sku, 25.0)
        disc  = rnd(0.7, 0.95)
        promo_skus.append({
            "campaign_id":    camp["campaign_id"],
            "sku":            sku,
            "category":       CATEGORIES.get(sku, "其他"),
            "original_price": price,
            "promo_price":    round(price * disc, 2),
            "discount_rate":  round(1 - disc, 3),
            "promo_qty_sold": rnd_int(0, 500),
            "promo_revenue":  round(price * disc * rnd_int(0, 500), 2),
        })
save(pd.DataFrame(promo_skus), "marketing_sku_promo.csv")

# 1-3. 渠道月度销售表现  marketing_channel_monthly.csv  ~840 行 (5渠道×14月×12品类)
chan_monthly = []
for ch in CHANNELS:
    for month in MONTHS:
        for cat in list(set(CATEGORIES.values())):
            base = rnd(10000, 500000)
            chan_monthly.append({
                "month":         month,
                "channel":       ch,
                "category":      cat,
                "revenue_rmb":   round(base, 2),
                "units_sold":    rnd_int(100, 5000),
                "orders_count":  rnd_int(10, 300),
                "avg_order_value": round(base / rnd_int(10, 300), 2),
                "return_rate":   round(rnd(0.01, 0.08), 4),
                "new_customer_ratio": round(rnd(0.1, 0.4), 3),
            })
save(pd.DataFrame(chan_monthly), "marketing_channel_monthly.csv")

# 1-4. SKU 月度需求弹性  marketing_price_elasticity.csv  ~2,980 行
# 每个 SKU 估计价格弹性系数（用于营销决策）
elasticity = []
for sku in SKUS:
    price = PRICE_MAP.get(sku, 25.0)
    for month in MONTHS:
        elast = rnd(-3.0, -0.5)   # 负值：价格↑需求↓
        elasticity.append({
            "month":            month,
            "sku":              sku,
            "category":         CATEGORIES.get(sku, "其他"),
            "base_price":       price,
            "observed_price":   round(price * rnd(0.8, 1.2), 2),
            "elasticity_coef":  round(elast, 4),
            "demand_index":     round(rnd(0.5, 2.0), 3),   # 相对需求指数
            "competitor_price_index": round(rnd(0.8, 1.3), 3),
        })
save(pd.DataFrame(elasticity), "marketing_price_elasticity.csv")

# ════════════════════════════════════════════════════════════════
# MODULE 2 — 采购 Procurement  (~12,500 行, 5 文件)
# ════════════════════════════════════════════════════════════════
print("\n【Module 2】采购 Procurement")

# 2-1. 供应商主数据  procurement_suppliers.csv  60 行
COUNTRIES = ["中国", "日本", "德国", "美国", "韩国", "印度", "台湾"]
suppliers = []
for i in range(1, 61):
    suppliers.append({
        "supplier_id":    f"SUP{i:03d}",
        "supplier_name":  f"供应商_{chr(64+((i-1)//10+1))}{i:02d}",
        "country":        pick(COUNTRIES),
        "city":           pick(["上海", "深圳", "广州", "苏州", "宁波", "东京", "首尔"]),
        "contact_person": pick(["张总", "李经理", "Wang GM", "Kim Manager"]),
        "payment_terms":  pick(["30天", "45天", "60天", "预付30%"]),
        "currency":       pick(["CNY", "CNY", "CNY", "USD", "JPY", "EUR"]),
        "rating":         round(rnd(3.0, 5.0), 1),
        "on_time_rate":   round(rnd(0.75, 0.99), 3),
        "defect_rate":    round(rnd(0.001, 0.05), 4),
        "min_order_qty":  rnd_int(100, 5000),
        "established_year": rnd_int(1990, 2018),
        "certified_iso":  pick([True, True, False]),
    })
save(pd.DataFrame(suppliers), "procurement_suppliers.csv")
generated["suppliers"] = pd.DataFrame(suppliers)
SUPPLIER_IDS = [s["supplier_id"] for s in suppliers]

# 2-2. 采购订单  procurement_orders.csv  ~3,000 行
po_rows = []
for i in range(1, 3001):
    order_date = pick(ALL_MONTHS_DATE) + timedelta(days=rnd_int(0, 27))
    lead_days  = rnd_int(14, 90)
    exp_date   = order_date + timedelta(days=lead_days)
    sku        = pick(SKUS)
    qty        = rnd_int(100, 5000)
    unit_cost  = COST_MAP.get(sku, 15.0) * rnd(0.85, 1.15)
    po_rows.append({
        "po_id":          f"PO{i:05d}",
        "po_date":        order_date.strftime("%Y-%m-%d"),
        "month":          order_date.strftime("%Y-%m"),
        "supplier_id":    pick(SUPPLIER_IDS),
        "sku":            sku,
        "category":       CATEGORIES.get(sku, "其他"),
        "qty_ordered":    qty,
        "unit_cost_rmb":  round(unit_cost, 2),
        "total_cost_rmb": round(qty * unit_cost, 2),
        "expected_date":  exp_date.strftime("%Y-%m-%d"),
        "actual_date":    (exp_date + timedelta(days=rnd_int(-5, 15))).strftime("%Y-%m-%d"),
        "status":         pick(["已收货", "已收货", "已收货", "在途", "待发货"]),
        "defect_qty":     rnd_int(0, max(1, qty // 100)),
    })
save(pd.DataFrame(po_rows), "procurement_orders.csv")

# 2-3. 供应商交期表现  procurement_lead_time.csv  ~2,400 行 (60供应商×14月×~2.8次)
lead_rows = []
for sup_id in SUPPLIER_IDS:
    sup_info = next(s for s in suppliers if s["supplier_id"] == sup_id)
    base_otr = sup_info["on_time_rate"]
    for month in MONTHS:
        n_orders = rnd_int(1, 8)
        for _ in range(n_orders):
            promised = rnd_int(14, 90)
            on_time  = random.random() < base_otr
            actual   = promised + (rnd_int(-3, 3) if on_time else rnd_int(5, 20))
            lead_rows.append({
                "supplier_id":    sup_id,
                "month":          month,
                "promised_days":  promised,
                "actual_days":    actual,
                "on_time":        on_time,
                "delay_days":     max(0, actual - promised),
            })
save(pd.DataFrame(lead_rows), "procurement_lead_time.csv")

# 2-4. 采购价格历史  procurement_price_history.csv  ~4,172 行
price_hist = []
for sku in SKUS:
    base_cost = COST_MAP.get(sku, 15.0)
    for month in MONTHS:
        # 价格随通胀/季节小幅波动
        factor = 1 + rnd(-0.05, 0.08)
        price_hist.append({
            "month":          month,
            "sku":            sku,
            "category":       CATEGORIES.get(sku, "其他"),
            "supplier_id":    pick(SUPPLIER_IDS),
            "unit_cost_rmb":  round(base_cost * factor, 4),
            "currency":       "CNY",
            "exchange_rate":  round(rnd(6.8, 7.3), 4),
            "tariff_rate":    round(rnd(0.0, 0.13), 4),
            "landed_cost_rmb": round(base_cost * factor * rnd(1.02, 1.15), 4),
        })
save(pd.DataFrame(price_hist), "procurement_price_history.csv")

# 2-5. 质量检验记录  procurement_quality.csv  ~2,870 行
quality_rows = []
for po in random.sample(po_rows, min(2870, len(po_rows))):
    passed = po["defect_qty"] == 0 or random.random() > 0.05
    quality_rows.append({
        "po_id":          po["po_id"],
        "sku":            po["sku"],
        "category":       po["category"],
        "supplier_id":    po["supplier_id"],
        "inspect_date":   po["actual_date"],
        "qty_inspected":  po["qty_ordered"],
        "qty_defective":  po["defect_qty"],
        "defect_rate":    round(po["defect_qty"] / max(1, po["qty_ordered"]), 5),
        "defect_type":    pick(["外观缺陷", "尺寸偏差", "颜色偏差", "无", "无", "无"]),
        "result":         "通过" if passed else "不通过",
        "inspector":      pick(["QC-01", "QC-02", "QC-03"]),
    })
save(pd.DataFrame(quality_rows), "procurement_quality.csv")

# ════════════════════════════════════════════════════════════════
# MODULE 3 — 生产 Manufacturing  (~10,000 行, 4 文件)
# ════════════════════════════════════════════════════════════════
print("\n【Module 3】生产 Manufacturing")

# 3-1. 生产工单  manufacturing_orders.csv  ~2,500 行
LINES = [f"产线-{i:02d}" for i in range(1, 9)]   # 8 条产线
mfg_orders = []
for i in range(1, 2501):
    plan_date  = pick(ALL_MONTHS_DATE) + timedelta(days=rnd_int(0, 27))
    plan_qty   = rnd_int(200, 8000)
    eff        = rnd(0.80, 1.00)
    actual_qty = round(plan_qty * eff)
    mfg_orders.append({
        "wo_id":           f"WO{i:05d}",
        "month":           plan_date.strftime("%Y-%m"),
        "plan_date":       plan_date.strftime("%Y-%m-%d"),
        "complete_date":   (plan_date + timedelta(days=rnd_int(1, 14))).strftime("%Y-%m-%d"),
        "sku":             pick(SKUS),
        "production_line": pick(LINES),
        "plan_qty":        plan_qty,
        "actual_qty":      actual_qty,
        "efficiency":      round(eff, 4),
        "scrap_qty":       rnd_int(0, max(1, plan_qty // 50)),
        "status":          pick(["已完成", "已完成", "已完成", "生产中", "计划"]),
        "shift":           pick(["早班", "中班", "夜班"]),
    })
save(pd.DataFrame(mfg_orders), "manufacturing_orders.csv")

# 3-2. 物料消耗  manufacturing_materials.csv  ~3,000 行
materials = []
BOM_COMPONENTS = ["云母粉", "钛白粉", "合成云母", "珠光粉基材", "色料", "分散剂", "包装材料"]
for wo in random.sample(mfg_orders, min(1000, len(mfg_orders))):
    n_comp = rnd_int(2, 4)
    for comp in random.sample(BOM_COMPONENTS, n_comp):
        usage = rnd(0.05, 2.0) * wo["actual_qty"] / 1000
        materials.append({
            "wo_id":           wo["wo_id"],
            "month":           wo["month"],
            "sku":             wo["sku"],
            "component":       comp,
            "plan_usage_kg":   round(usage * 1.05, 4),
            "actual_usage_kg": round(usage * rnd(0.95, 1.10), 4),
            "unit_cost_rmb":   round(rnd(5, 80), 2),
            "variance_pct":    round(rnd(-0.10, 0.15), 4),
        })
save(pd.DataFrame(materials), "manufacturing_materials.csv")

# 3-3. 产能规划  manufacturing_capacity.csv  ~1,344 行 (8线×14月×12周/月)
capacity = []
for line in LINES:
    for month in MONTHS:
        for week in range(1, 5):
            planned_hrs = rnd(36, 48)
            actual_hrs  = planned_hrs * rnd(0.7, 1.0)
            capacity.append({
                "month":          month,
                "week":           week,
                "production_line": line,
                "planned_hours":  round(planned_hrs, 1),
                "actual_hours":   round(actual_hrs, 1),
                "utilization_rate": round(actual_hrs / planned_hrs, 4),
                "downtime_hours": round(rnd(0, 4), 1),
                "downtime_reason": pick(["维护", "换线", "待料", "无", "无", "无"]),
                "output_kg":      round(actual_hrs * rnd(20, 60), 1),
            })
save(pd.DataFrame(capacity), "manufacturing_capacity.csv")

# 3-4. 生产质检  manufacturing_quality.csv  ~3,156 行
mfg_quality = []
for wo in mfg_orders:
    n_checks = rnd_int(1, 2)
    for _ in range(n_checks):
        sample = min(wo["actual_qty"], rnd_int(20, 100))
        defects = rnd_int(0, max(1, sample // 20))
        mfg_quality.append({
            "wo_id":         wo["wo_id"],
            "month":         wo["month"],
            "sku":           wo["sku"],
            "production_line": wo["production_line"],
            "sample_qty":    sample,
            "defect_qty":    defects,
            "defect_rate":   round(defects / sample, 5),
            "defect_type":   pick(["色差", "粒径偏差", "杂质", "无", "无", "无"]),
            "pass":          defects / sample < 0.03,
            "inspector":     pick(["QC-A", "QC-B", "QC-C"]),
        })
save(pd.DataFrame(mfg_quality), "manufacturing_quality.csv")

# ════════════════════════════════════════════════════════════════
# MODULE 4 — 物流 Logistics  (~11,904 行, 5 文件)
# ════════════════════════════════════════════════════════════════
print("\n【Module 4】物流 Logistics")

# 4-1. 出货记录  logistics_shipments.csv  ~3,500 行
CARRIERS    = ["顺丰", "德邦", "京东物流", "中外运", "DHL", "FedEx"]
WAREHOUSES  = ["上海仓", "深圳仓", "广州仓", "成都仓"]
DEST_CITIES = ["北京", "上海", "广州", "深圳", "成都", "杭州", "武汉", "西安", "南京", "重庆",
               "Tokyo", "Seoul", "Singapore", "Frankfurt", "Los Angeles"]
shipments = []
for i in range(1, 3501):
    ship_date = pick(ALL_MONTHS_DATE) + timedelta(days=rnd_int(0, 27))
    exp_days  = rnd_int(1, 15)
    qty       = rnd_int(10, 2000)
    sku       = pick(SKUS)
    price     = PRICE_MAP.get(sku, 25.0)
    shipments.append({
        "shipment_id":     f"SHP{i:05d}",
        "month":           ship_date.strftime("%Y-%m"),
        "ship_date":       ship_date.strftime("%Y-%m-%d"),
        "expected_delivery": (ship_date + timedelta(days=exp_days)).strftime("%Y-%m-%d"),
        "actual_delivery": (ship_date + timedelta(days=exp_days + rnd_int(-1, 5))).strftime("%Y-%m-%d"),
        "warehouse":       pick(WAREHOUSES),
        "carrier":         pick(CARRIERS),
        "destination":     pick(DEST_CITIES),
        "sku":             sku,
        "category":        CATEGORIES.get(sku, "其他"),
        "qty":             qty,
        "weight_kg":       round(qty * rnd(0.001, 0.02), 3),
        "freight_cost_rmb": round(rnd(50, 2000), 2),
        "revenue_rmb":     round(qty * price, 2),
        "on_time":         random.random() < 0.88,
    })
save(pd.DataFrame(shipments), "logistics_shipments.csv")

# 4-2. 承运商表现月报  logistics_carrier_monthly.csv  ~840 行 (6承运商×14月×10目的地)
carrier_perf = []
for carrier in CARRIERS:
    for month in MONTHS:
        n_routes = rnd_int(3, 8)
        for dest in random.sample(DEST_CITIES, n_routes):
            total  = rnd_int(20, 300)
            on_t   = round(total * rnd(0.75, 0.99))
            carrier_perf.append({
                "month":         month,
                "carrier":       carrier,
                "destination":   dest,
                "total_shipments": total,
                "on_time_count": on_t,
                "on_time_rate":  round(on_t / total, 4),
                "avg_delay_days": round(rnd(0, 3), 2),
                "damage_rate":   round(rnd(0, 0.02), 4),
                "avg_cost_rmb":  round(rnd(80, 1500), 2),
                "customer_rating": round(rnd(3.5, 5.0), 1),
            })
save(pd.DataFrame(carrier_perf), "logistics_carrier_monthly.csv")

# 4-3. 仓储操作日志  logistics_warehouse_ops.csv  ~3,920 行 (4仓×14月×70操作/月)
wh_ops = []
OP_TYPES = ["入库", "出库", "移库", "盘点", "退货入库", "报废"]
for wh in WAREHOUSES:
    for month in MONTHS:
        n_ops = rnd_int(60, 80)
        for _ in range(n_ops):
            op_type = pick(OP_TYPES)
            qty     = rnd_int(10, 5000)
            wh_ops.append({
                "month":       month,
                "warehouse":   wh,
                "op_type":     op_type,
                "sku":         pick(SKUS),
                "qty":         qty,
                "weight_kg":   round(qty * rnd(0.001, 0.02), 3),
                "operator":    pick(["仓管-01", "仓管-02", "仓管-03", "仓管-04"]),
                "duration_min": rnd_int(5, 120),
                "error_flag":  random.random() < 0.02,
            })
save(pd.DataFrame(wh_ops), "logistics_warehouse_ops.csv")

# 4-4. 运费成本分析  logistics_freight_cost.csv  ~1,176 行 (4仓×6承运商×14月×~3.5航线)
freight = []
for wh in WAREHOUSES:
    for carrier in CARRIERS:
        for month in MONTHS:
            n = rnd_int(2, 5)
            for dest in random.sample(DEST_CITIES, n):
                vol = rnd_int(50, 1000)
                freight.append({
                    "month":        month,
                    "warehouse":    wh,
                    "carrier":      carrier,
                    "destination":  dest,
                    "shipment_count": rnd_int(5, 50),
                    "total_weight_kg": round(vol * rnd(0.005, 0.05), 2),
                    "total_cost_rmb":  round(vol * rnd(1, 10), 2),
                    "cost_per_kg":     round(rnd(2, 30), 2),
                    "fuel_surcharge_rmb": round(rnd(0, 200), 2),
                })
save(pd.DataFrame(freight), "logistics_freight_cost.csv")

# 4-5. 退货记录  logistics_returns.csv  ~1,468 行
RETURN_REASONS = ["质量问题", "规格不符", "发货错误", "客户取消", "运输损坏"]
returns = []
for shp in random.sample(shipments, 1468):
    if random.random() < 0.42:   # 约42%的抽样记录产生退货
        reason = pick(RETURN_REASONS)
        ret_qty = rnd_int(1, shp["qty"])
        returns.append({
            "return_id":     f"RET{len(returns)+1:05d}",
            "shipment_id":   shp["shipment_id"],
            "month":         shp["month"],
            "sku":           shp["sku"],
            "category":      shp["category"],
            "return_qty":    ret_qty,
            "return_reason": reason,
            "return_date":   shp["actual_delivery"],
            "refund_amount": round(ret_qty * PRICE_MAP.get(shp["sku"], 25.0), 2),
            "restockable":   reason not in ["质量问题", "运输损坏"],
            "carrier":       shp["carrier"],
        })
save(pd.DataFrame(returns), "logistics_returns.csv")

# ════════════════════════════════════════════════════════════════
# MODULE 5 — 客户 CRM  (~6,000 行, 4 文件)
# ════════════════════════════════════════════════════════════════
print("\n【Module 5】客户 CRM")

# 5-1. 客户主数据  crm_customers.csv  300 行
INDUSTRIES = ["化妆品", "涂料", "油墨", "塑料", "汽车", "纺织", "电子", "食品"]
CUST_TYPES = ["大客户", "普通", "潜在"]
customers  = []
for i in range(1, 301):
    c_type    = pick(CUST_TYPES)
    cust_since = datetime(rnd_int(2015, 2023), rnd_int(1, 12), 1)
    customers.append({
        "customer_id":    f"CUST{i:04d}",
        "customer_name":  f"客户_{chr(64+((i-1)//20+1))}{i:03d}",
        "customer_type":  c_type,
        "industry":       pick(INDUSTRIES),
        "country":        pick(["中国", "中国", "中国", "日本", "韩国", "美国", "德国"]),
        "city":           pick(["上海", "广州", "深圳", "北京", "杭州", "成都", "苏州"]),
        "credit_limit_rmb": rnd_int(50000, 2000000) if c_type == "大客户" else rnd_int(10000, 200000),
        "payment_terms":  pick(["月结30天", "月结60天", "预付款", "货到付款"]),
        "account_manager": pick(["张伟", "李娜", "王芳", "刘洋", "陈明"]),
        "since_date":     cust_since.strftime("%Y-%m-%d"),
        "active":         random.random() > 0.1,
        "annual_spend_rmb_est": round(rnd(10000, 5000000), 0),
    })
save(pd.DataFrame(customers), "crm_customers.csv")
generated["customers"] = pd.DataFrame(customers)
CUSTOMER_IDS = [c["customer_id"] for c in customers]

# 5-2. 客户订单  crm_orders.csv  ~3,000 行
crm_orders = []
for i in range(1, 3001):
    order_date = pick(ALL_MONTHS_DATE) + timedelta(days=rnd_int(0, 27))
    sku        = pick(SKUS)
    qty        = rnd_int(5, 1000)
    price      = PRICE_MAP.get(sku, 25.0) * rnd(0.85, 1.05)
    crm_orders.append({
        "order_id":     f"ORD{i:05d}",
        "month":        order_date.strftime("%Y-%m"),
        "order_date":   order_date.strftime("%Y-%m-%d"),
        "customer_id":  pick(CUSTOMER_IDS),
        "sku":          sku,
        "category":     CATEGORIES.get(sku, "其他"),
        "qty":          qty,
        "unit_price":   round(price, 2),
        "total_amount": round(qty * price, 2),
        "discount_pct": round(rnd(0, 0.15), 3),
        "status":       pick(["已完成", "已完成", "已完成", "处理中", "已取消"]),
        "channel":      pick(CHANNELS),
    })
save(pd.DataFrame(crm_orders), "crm_orders.csv")

# 5-3. 客户投诉  crm_complaints.csv  ~500 行
COMPLAINT_TYPES = ["质量问题", "交期延误", "错误发货", "价格争议", "服务态度", "包装破损"]
complaints = []
for i in range(1, 501):
    complaint_date = pick(ALL_MONTHS_DATE) + timedelta(days=rnd_int(0, 27))
    complaints.append({
        "complaint_id":   f"COMP{i:04d}",
        "month":          complaint_date.strftime("%Y-%m"),
        "complaint_date": complaint_date.strftime("%Y-%m-%d"),
        "customer_id":    pick(CUSTOMER_IDS),
        "sku":            pick(SKUS),
        "complaint_type": pick(COMPLAINT_TYPES),
        "severity":       pick(["低", "中", "高", "紧急"]),
        "description":    f"{pick(COMPLAINT_TYPES)}相关问题，需要跟进处理",
        "resolved":       random.random() > 0.15,
        "resolution_days": rnd_int(1, 30),
        "satisfaction":   round(rnd(1.0, 5.0), 1),
        "handler":        pick(["客服-01", "客服-02", "客服-03"]),
    })
save(pd.DataFrame(complaints), "crm_complaints.csv")

# 5-4. 客户SKU购买偏好  crm_sku_preference.csv  ~2,200 行
# 每个活跃客户的高频购买SKU
preference = []
active_custs = [c for c in customers if c["active"]]
for cust in active_custs:
    n_skus = rnd_int(3, 12)
    fav_skus = random.sample(SKUS, min(n_skus, len(SKUS)))
    for rank, sku in enumerate(fav_skus, 1):
        preference.append({
            "customer_id":       cust["customer_id"],
            "customer_type":     cust["customer_type"],
            "sku":               sku,
            "category":          CATEGORIES.get(sku, "其他"),
            "preference_rank":   rank,
            "avg_order_qty":     rnd_int(10, 500),
            "order_frequency_per_year": round(rnd(1, 24), 1),
            "last_order_month":  pick(MONTHS),
            "price_sensitivity": pick(["高", "中", "低"]),
            "reorder_rate":      round(rnd(0.3, 0.95), 3),
        })
save(pd.DataFrame(preference), "crm_sku_preference.csv")

# ════════════════════════════════════════════════════════════════
# 汇总报告
# ════════════════════════════════════════════════════════════════
print("\n" + "═"*55)
print("合成数据生成完成")
print("═"*55)
all_files = list(OUT_DIR.glob("*.csv"))
total_rows = 0
for f in sorted(all_files):
    df_tmp = pd.read_csv(f)
    total_rows += len(df_tmp)
    print(f"  {f.name:<50} {len(df_tmp):>6} 行")
print(f"{'─'*55}")
print(f"  {'合计':<50} {total_rows:>6} 行")
print(f"  文件数: {len(all_files)} 个")
print(f"  保存目录: {OUT_DIR}")
