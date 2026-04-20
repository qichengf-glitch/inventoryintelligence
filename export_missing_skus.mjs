/**
 * export_missing_skus.mjs
 *
 * 从 Supabase 查出所有缺品类 / 成本 / 单价的 SKU，
 * 生成 missing_skus.csv 文件，直接发给公司让他们填写。
 *
 * 用法（在项目根目录执行）：
 *   node export_missing_skus.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// ── 读取 .env.local ────────────────────────────────────────────────────────────
const env = {};
try {
  readFileSync("./frontend/.env.local", "utf-8")
    .split("\n")
    .forEach((line) => {
      const [k, ...v] = line.split("=");
      if (k && v.length) env[k.trim()] = v.join("=").trim();
    });
} catch {
  console.error("❌  找不到 frontend/.env.local，请在项目根目录运行此脚本");
  process.exit(1);
}

const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
const TABLE        = env.INVENTORY_TABLE || "inventory_batches";
const SKU_COL      = env.INVENTORY_SKU_COLUMN || "sku";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  env 中未找到 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── 1. 拉取所有 SKU（主库存表）──────────────────────────────────────────────
console.log("⏳  正在查询库存表...");
const skuCat = {};
let offset = 0;
while (true) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(`${SKU_COL}`)
    .range(offset, offset + 999);

  if (error) { console.error("DB error:", error.message); process.exit(1); }
  if (!data || data.length === 0) break;

  for (const row of data) {
    const sku = row[SKU_COL];
    if (!sku) continue;
    if (!skuCat[sku]) {
      skuCat[sku] = { category: "" };
    }
  }
  if (data.length < 1000) break;
  offset += 1000;
}
console.log(`   库存 SKU 唯一数：${Object.keys(skuCat).length}`);

// ── 1.1 拉取 SKU 分类表（如存在），回填 category ─────────────────────────────
console.log("⏳  正在查询 SKU 分类表...");
offset = 0;
let categoryLoaded = false;
while (true) {
  // 兼容不同库中的列命名（"SKU"/"Category" 或 sku/category）
  let data, error;
  ({ data, error } = await supabase
    .from("sku_categories")
    .select('"SKU","Category"')
    .range(offset, offset + 999));
  if (error) {
    ({ data, error } = await supabase
      .from("sku_categories")
      .select("sku,category")
      .range(offset, offset + 999));
  }

  if (error) {
    console.warn(`   ⚠️  分类表读取失败（将继续生成，仅品类可能为空）：${error.message}`);
    break;
  }
  if (!data || data.length === 0) break;

  categoryLoaded = true;
  for (const row of data) {
    const sku = (row.SKU ?? row.sku ?? "").toString().trim();
    const cat = (row.Category ?? row.category ?? "").toString().trim();
    if (!sku || !cat) continue;
    if (skuCat[sku] && !skuCat[sku].category) {
      skuCat[sku].category = cat;
    }
  }
  if (data.length < 1000) break;
  offset += 1000;
}
if (categoryLoaded) {
  const catFilled = Object.values(skuCat).filter((x) => x.category).length;
  console.log(`   分类已匹配 SKU：${catFilled}`);
}

// ── 2. 拉取成本价格表 ─────────────────────────────────────────────────────────
console.log("⏳  正在查询成本价格表...");
const costMap = {};
offset = 0;
while (true) {
  const { data, error } = await supabase
    .from("sku_price_cost")
    .select("sku, cost, sales_unit_price")
    .range(offset, offset + 999);

  if (error) { console.error("DB error:", error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  for (const row of data) costMap[row.sku] = row;
  if (data.length < 1000) break;
  offset += 1000;
}
console.log(`   成本价格记录数：${Object.keys(costMap).length}`);

// ── 3. 筛选有缺失的 SKU ────────────────────────────────────────────────────────
const rows = [];
for (const [sku, { category }] of Object.entries(skuCat).sort()) {
  const cp           = costMap[sku] || {};
  const cost         = cp.cost          ?? null;
  const price        = cp.sales_unit_price ?? null;
  const missingCat   = !category;
  const missingCost  = cost  === null || cost  === "";
  const missingPrice = price === null || price === "";

  if (!missingCat && !missingCost && !missingPrice) continue;

  const missing = [];
  if (missingCat)   missing.push("缺品类");
  if (missingCost)  missing.push("缺成本");
  if (missingPrice) missing.push("缺销售单价");

  rows.push({
    sku,
    "当前品类":   category || "",
    "【填写品类】": "",
    "成本(¥)":    missingCost  ? "" : cost,
    "【填写成本】": "",
    "销售单价(¥)": missingPrice ? "" : price,
    "【填写销售单价】": "",
    "缺失项":     missing.join(" / "),
  });
}

// ── 4. 统计 ────────────────────────────────────────────────────────────────────
const totalSku    = Object.keys(skuCat).length;
const missingCnt  = rows.length;
const catMissing  = rows.filter(r => r["缺失项"].includes("缺品类")).length;
const costMissing = rows.filter(r => r["缺失项"].includes("缺成本")).length;
const priceMissing= rows.filter(r => r["缺失项"].includes("缺销售单价")).length;

console.log("\n📊  缺失情况汇总");
console.log(`   SKU 总数：       ${totalSku}`);
console.log(`   有缺失 SKU：     ${missingCnt}`);
console.log(`   缺品类：         ${catMissing}`);
console.log(`   缺成本：         ${costMissing}`);
console.log(`   缺销售单价：     ${priceMissing}`);

// ── 5. 写 CSV（UTF-8 BOM，Excel 直接打开中文正常显示）──────────────────────────
const FIELDS = ["sku","当前品类","【填写品类】","成本(¥)","【填写成本】","销售单价(¥)","【填写销售单价】","缺失项"];

function escapeCsv(v) {
  const s = v == null ? "" : String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

const lines = [FIELDS.join(",")];
for (const r of rows) lines.push(FIELDS.map(f => escapeCsv(r[f])).join(","));

const csv = "\uFEFF" + lines.join("\r\n");   // BOM for Excel
const outPath = "./missing_skus.csv";
writeFileSync(outPath, csv, "utf-8");

console.log(`\n✅  已生成：${outPath}  （${rows.length} 行）`);
console.log("   直接发给公司，让财务 / 产品团队填写【填写品类】【填写成本】【填写销售单价】三列");
console.log('   填完后回传，通过系统的"批量导入 CSV"功能一键导入即可\n');
