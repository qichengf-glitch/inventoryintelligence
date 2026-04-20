/**
 * GET /api/marketing/performance
 *
 * Computes product performance scores from existing Supabase inventory data.
 * Metrics per SKU:
 *   - sales_velocity   : average monthly_sales over available months (units/month)
 *   - margin_pct       : (price - cost) / price * 100
 *   - gross_profit_avg : avg monthly gross profit = sales_velocity * (price - cost)
 *   - turnover_ratio   : total_sales / avg_end_stock (annualised)
 *   - growth_pct       : recent 3M avg sales vs prior 3M avg sales
 *   - stock_health     : 0 = understocked | 1 = healthy | 2 = overstocked (vs safety_stock)
 *   - composite_score  : weighted sum (0-100)
 *
 * Query params:
 *   ?limit=100    — max SKUs returned (default 200)
 *   ?category=X   — filter by category
 *   ?sort=score|velocity|margin|turnover|growth  (default: score)
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";
import { excludeAllZeroRows } from "@/lib/inventory/zeroFilter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SkuMonth = {
  sku: string;
  month: string;
  month_sales: number;
  month_end_stock: number;
  category: string | null;
};

type PriceRow = {
  sku: string;
  sales_unit_price: number | null;
  cost: number | null;
};

type ThresholdRow = {
  sku: string;
  safety_stock: number | null;
  high_stock: number | null;
};

function getMarketingSupabase(): SupabaseClient {
  try {
    return createSupabaseAdminClient();
  } catch {
    return createSupabaseClient();
  }
}

function toErrMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Failed to compute performance";
  }
}

/** Align with /api/inventory/demand month parsing (YYYY-MM). */
function parseMonth(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 7);
  }
  if (typeof value === "number") {
    if (value >= 190001 && value <= 210012) {
      const s = String(Math.trunc(value));
      if (s.length === 6) return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
    }
    if (value >= 19000101 && value <= 21001231) {
      const s = String(Math.trunc(value));
      if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
    }
    if (value >= 30000 && value <= 80000) {
      const base = Date.UTC(1899, 11, 30);
      const d = new Date(base + value * 86400000);
      return d.toISOString().slice(0, 7);
    }
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/[年月]/g, "-").replace(/日/g, "").replace(/[./]/g, "-");
    const match = normalized.match(/(\d{4})-(\d{1,2})/);
    if (match) {
      return `${match[1]}-${match[2].padStart(2, "0")}`;
    }
    return null;
  }
  return null;
}

/** When views / inventory_sku_monthly are missing, use the same configured table as demand/forecast. */
async function loadMonthlyFromConfiguredInventory(
  supabase: SupabaseClient,
  categoryFilter: string
): Promise<SkuMonth[]> {
  const { schema, table, skuColumn, timeColumn, salesColumn, stockColumn } = getInventoryConfig();
  if (!timeColumn || !skuColumn) return [];

  const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
  const selectColumns = buildSelect([skuColumn, timeColumn, salesColumn, stockColumn]);

  const bucket = new Map<string, SkuMonth>();

  const pageSize = 2000;
  for (let offset = 0; offset < 500000; offset += pageSize) {
    const base = tableRef.select(selectColumns).range(offset, offset + pageSize - 1);
    const { data, error } = await excludeAllZeroRows(base, salesColumn, stockColumn);
    if (error) {
      console.warn("[api/marketing/performance] configured table read:", error.message);
      return [];
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const sku = String(row[skuColumn] ?? "").trim();
      if (!sku) continue;
      const month = parseMonth(row[timeColumn]);
      if (!month) continue;
      const cat: string | null = typeof row.category === "string" ? row.category : typeof row.Category === "string" ? (row.Category as string) : null;
      if (categoryFilter && (cat ?? "") !== categoryFilter) continue;

      const key = `${sku}::${month}`;
      const sales = Math.max(0, Number(row[salesColumn] ?? 0));
      const stock = Math.max(0, Number(row[stockColumn] ?? 0));
      const prev = bucket.get(key);
      if (!prev) {
        bucket.set(key, { sku, month, month_sales: sales, month_end_stock: stock, category: cat });
      } else {
        prev.month_sales += sales;
        prev.month_end_stock += stock;
        if (!prev.category && cat) prev.category = cat;
      }
    }

    if (rows.length < pageSize) break;
  }

  return Array.from(bucket.values());
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = Math.min(Number(searchParams.get("limit") || "200"), 500);
    const categoryFilter = searchParams.get("category") || "";
    const sortBy = searchParams.get("sort") || "score";

    const supabase = getMarketingSupabase();
    const { schema } = getInventoryConfig();

    function tableRef(name: string) {
      return schema ? supabase.schema(schema).from(name) : supabase.from(name);
    }

    let monthlyRows: SkuMonth[] = [];

    // 1) View with category (preferred)
    let monthlyQuery = tableRef("v_inventory_sku_monthly")
      .select("sku, month, month_sales, month_end_stock, category")
      .order("month", { ascending: true })
      .limit(20000);
    if (categoryFilter) {
      monthlyQuery = monthlyQuery.eq("category", categoryFilter);
    }
    const { data: monthlyRaw, error: monthlyErr } = await monthlyQuery;

    if (!monthlyErr && monthlyRaw) {
      monthlyRows = monthlyRaw as SkuMonth[];
    } else if (monthlyErr) {
      console.warn("[api/marketing/performance] v_inventory_sku_monthly:", monthlyErr.message);
      // 2) Base monthly table
      let fbQuery = tableRef("inventory_sku_monthly")
        .select("sku, month, month_sales, month_end_stock")
        .order("month", { ascending: true })
        .limit(20000);
      const { data: fallback, error: fbErr } = await fbQuery;
      if (!fbErr && fallback) {
        monthlyRows = (fallback as SkuMonth[]).map((r) => ({ ...r, category: null }));
      } else {
        if (fbErr) console.warn("[api/marketing/performance] inventory_sku_monthly:", fbErr.message);
        // 3) Same source as demand/forecast (inventory_batches / configured table)
        monthlyRows = await loadMonthlyFromConfiguredInventory(supabase, categoryFilter);
      }
    }

    // Optional enrichments (ignore failures — marketing still works without price/threshold tables)
    const { data: priceRaw, error: priceErr } = await tableRef("sku_price_cost")
      .select("sku, sales_unit_price, cost")
      .limit(5000);
    if (priceErr) console.warn("[api/marketing/performance] sku_price_cost:", priceErr.message);

    const { data: threshRaw, error: threshErr } = await tableRef("sku_thresholds")
      .select("sku, safety_stock, high_stock")
      .limit(5000);
    if (threshErr) console.warn("[api/marketing/performance] sku_thresholds:", threshErr.message);

    return computeAndRespond(
      monthlyRows,
      (priceRaw ?? []) as PriceRow[],
      (threshRaw ?? []) as ThresholdRow[],
      limitParam,
      sortBy
    );
  } catch (err) {
    console.error("[api/marketing/performance]", err);
    return NextResponse.json({ error: toErrMsg(err) }, { status: 500 });
  }
}

function computeAndRespond(
  monthly: SkuMonth[],
  prices: PriceRow[],
  thresholds: ThresholdRow[],
  limit: number,
  sortBy: string
) {
  // Build lookup maps
  const priceMap = new Map<string, PriceRow>(prices.map((r) => [r.sku, r]));
  const threshMap = new Map<string, ThresholdRow>(thresholds.map((r) => [r.sku, r]));

  // Group monthly rows by SKU
  const bySku = new Map<string, SkuMonth[]>();
  for (const row of monthly) {
    if (!bySku.has(row.sku)) bySku.set(row.sku, []);
    bySku.get(row.sku)!.push(row);
  }

  const results: SkuPerformance[] = [];

  for (const [sku, rows] of bySku) {
    // Sort chronologically
    rows.sort((a, b) => a.month.localeCompare(b.month));
    const n = rows.length;
    if (n < 2) continue;

    const totalSales = rows.reduce((s, r) => s + (r.month_sales ?? 0), 0);
    const salesVelocity = totalSales / n;
    const avgEndStock = rows.reduce((s, r) => s + (r.month_end_stock ?? 0), 0) / n;
    const latestStock = rows[n - 1].month_end_stock ?? 0;

    // Growth trend: recent 3M vs prior 3M
    const recent = rows.slice(-3).reduce((s, r) => s + (r.month_sales ?? 0), 0) / Math.min(3, n);
    const prior = n >= 6
      ? rows.slice(-6, -3).reduce((s, r) => s + (r.month_sales ?? 0), 0) / 3
      : rows.slice(0, Math.max(1, n - 3)).reduce((s, r) => s + (r.month_sales ?? 0), 0) / Math.max(1, n - 3);

    const growthPct = prior > 0 ? ((recent - prior) / prior) * 100 : 0;

    // Turnover ratio (annualised)
    const turnoverRatio = avgEndStock > 0 ? (salesVelocity * 12) / avgEndStock : 0;

    // Price / margin
    const priceData = priceMap.get(sku);
    const price = priceData?.sales_unit_price ?? null;
    const cost = priceData?.cost ?? null;
    const marginPct = price && cost && price > 0 ? ((price - cost) / price) * 100 : null;
    const grossProfitAvg = price && cost ? salesVelocity * (price - cost) : null;

    // Stock health
    const thresh = threshMap.get(sku);
    const safetyStock = thresh?.safety_stock ?? null;
    const highStock = thresh?.high_stock ?? null;
    let stockHealth: 0 | 1 | 2 = 1; // healthy default
    if (safetyStock !== null && latestStock < safetyStock) stockHealth = 0; // understocked
    else if (highStock !== null && latestStock > highStock) stockHealth = 2; // overstocked

    // Composite score (0-100)
    // Weights: velocity 30%, margin 25%, turnover 25%, growth 20%
    const velScore = Math.min(100, (salesVelocity / 500) * 100); // normalise to 500 units/month as top
    const marScore = marginPct !== null ? Math.min(100, marginPct) : 40; // default 40 if unknown
    const turnScore = Math.min(100, turnoverRatio * 10); // 10x annualised = perfect score
    const growScore = Math.min(100, Math.max(0, growthPct + 50)); // centre at 50, ±50% → 0-100
    const compositeScore = Math.round(
      velScore * 0.30 + marScore * 0.25 + turnScore * 0.25 + growScore * 0.20
    );

    // Promo opportunity: overstocked AND margin > 20%
    const promoOpportunity = stockHealth === 2 && (marginPct === null || marginPct > 20);

    results.push({
      sku,
      category: rows[n - 1].category ?? null,
      sample_months: n,
      sales_velocity: Math.round(salesVelocity * 10) / 10,
      avg_end_stock: Math.round(avgEndStock),
      latest_stock: latestStock,
      growth_pct: Math.round(growthPct * 10) / 10,
      turnover_ratio: Math.round(turnoverRatio * 100) / 100,
      margin_pct: marginPct !== null ? Math.round(marginPct * 10) / 10 : null,
      gross_profit_avg: grossProfitAvg !== null ? Math.round(grossProfitAvg) : null,
      price,
      cost,
      stock_health: stockHealth,
      safety_stock: safetyStock,
      high_stock: highStock,
      composite_score: compositeScore,
      promo_opportunity: promoOpportunity,
    });
  }

  // Sort
  const sortFns: Record<string, (a: SkuPerformance, b: SkuPerformance) => number> = {
    score: (a, b) => b.composite_score - a.composite_score,
    velocity: (a, b) => b.sales_velocity - a.sales_velocity,
    margin: (a, b) => (b.margin_pct ?? -1) - (a.margin_pct ?? -1),
    turnover: (a, b) => b.turnover_ratio - a.turnover_ratio,
    growth: (a, b) => b.growth_pct - a.growth_pct,
    promo: (a, b) => (b.promo_opportunity ? 1 : 0) - (a.promo_opportunity ? 1 : 0),
  };
  const fn = sortFns[sortBy] ?? sortFns.score;
  results.sort(fn);

  const topN = results.slice(0, limit);

  // Category summary
  const catMap = new Map<string, { count: number; totalScore: number; totalVelocity: number }>();
  for (const r of results) {
    const cat = r.category ?? "未分类";
    if (!catMap.has(cat)) catMap.set(cat, { count: 0, totalScore: 0, totalVelocity: 0 });
    const entry = catMap.get(cat)!;
    entry.count += 1;
    entry.totalScore += r.composite_score;
    entry.totalVelocity += r.sales_velocity;
  }
  const categoryStats = Array.from(catMap.entries())
    .map(([category, v]) => ({
      category,
      sku_count: v.count,
      avg_score: Math.round(v.totalScore / v.count),
      avg_velocity: Math.round(v.totalVelocity / v.count * 10) / 10,
    }))
    .sort((a, b) => b.avg_score - a.avg_score);

  const promoCount = results.filter((r) => r.promo_opportunity).length;

  return NextResponse.json({
    total_skus: results.length,
    promo_opportunities: promoCount,
    category_stats: categoryStats,
    skus: topN,
    computed_at: new Date().toISOString(),
  });
}

type SkuPerformance = {
  sku: string;
  category: string | null;
  sample_months: number;
  sales_velocity: number;
  avg_end_stock: number;
  latest_stock: number;
  growth_pct: number;
  turnover_ratio: number;
  margin_pct: number | null;
  gross_profit_avg: number | null;
  price: number | null;
  cost: number | null;
  stock_health: 0 | 1 | 2;
  safety_stock: number | null;
  high_stock: number | null;
  composite_score: number;
  promo_opportunity: boolean;
};
