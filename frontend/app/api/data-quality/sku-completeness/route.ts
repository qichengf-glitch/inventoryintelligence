/**
 * GET /api/data-quality/sku-completeness
 *
 * Returns every unique SKU with its completeness status:
 *  - category   (from inventory_batches.category)
 *  - cost       (from sku_price_cost.cost)
 *  - price      (from sku_price_cost.sales_unit_price)
 *
 * Query params:
 *  ?filter=all|missing_category|missing_cost|missing_both|complete
 *  ?q=<search term>   (SKU prefix/contains search)
 *  ?page=1&limit=50
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getSupabase() {
  try { return createSupabaseAdminClient(); } catch { return createSupabaseClient(); }
}

export type SkuRecord = {
  sku: string;
  category: string | null;
  cost: number | null;
  price: number | null;
  /** derived completeness flags */
  missing_category: boolean;
  missing_cost: boolean;
  missing_price: boolean;
  status: "complete" | "missing_category" | "missing_cost" | "missing_both";
};

export type CompletenessResponse = {
  items: SkuRecord[];
  total: number;
  page: number;
  limit: number;
  summary: {
    total_skus: number;
    missing_category: number;
    missing_cost: number;
    missing_price: number;
    missing_both: number;
    complete: number;
    category_pct: number;
    cost_pct: number;
  };
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const filter  = url.searchParams.get("filter")  ?? "all";
    const q       = url.searchParams.get("q")?.trim() ?? "";
    const page    = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1", 10));
    const limit   = Math.min(200, Math.max(10, parseInt(url.searchParams.get("limit") ?? "50", 10)));

    const config  = getInventoryConfig();
    const supabase = getSupabase();

    // ── 1. All unique SKUs + their category from inventory table ────────────
    // We group by SKU and take any non-null category. Use a broad select to
    // avoid column-not-found errors across different schemas.
    const { data: invRows, error: invErr } = await supabase
      .from(config.table)
      .select(`${config.skuColumn}, category`)
      .order(config.skuColumn, { ascending: true })
      .limit(20000);

    if (invErr) {
      return NextResponse.json({ error: `Failed to load inventory: ${invErr.message}` }, { status: 500 });
    }

    // Deduplicate: keep one record per SKU, preferring a non-null category
    const skuMap = new Map<string, { category: string | null }>();
    for (const row of ((invRows ?? []) as unknown as Array<Record<string, unknown>>)) {
      const sku = String(row[config.skuColumn] ?? "").trim();
      if (!sku) continue;
      const rawCategory = row.category;
      const cat = typeof rawCategory === "string" && rawCategory.trim()
        ? rawCategory.trim()
        : null;
      if (!skuMap.has(sku)) {
        skuMap.set(sku, { category: cat });
      } else if (cat && !skuMap.get(sku)!.category) {
        skuMap.get(sku)!.category = cat;
      }
    }

    // ── 2. Load price/cost data ─────────────────────────────────────────────
    const { data: priceRows, error: priceErr } = await supabase
      .from("sku_price_cost")
      .select("sku, cost, sales_unit_price")
      .limit(10000);

    if (priceErr) {
      console.warn("[sku-completeness] sku_price_cost load failed:", priceErr.message);
    }

    const priceMap = new Map<string, { cost: number | null; price: number | null }>();
    for (const row of priceRows ?? []) {
      const sku = String(row.sku ?? "").trim();
      if (!sku) continue;
      priceMap.set(sku, {
        cost:  row.cost  != null ? Number(row.cost)  : null,
        price: row.sales_unit_price != null ? Number(row.sales_unit_price) : null,
      });
    }

    // ── 3. Build merged records ─────────────────────────────────────────────
    const allRecords: SkuRecord[] = [];
    for (const [sku, inv] of skuMap) {
      const pc = priceMap.get(sku) ?? { cost: null, price: null };
      const missing_category = !inv.category;
      const missing_cost     = pc.cost  == null;
      const missing_price    = pc.price == null;

      let status: SkuRecord["status"];
      if (!missing_category && !missing_cost && !missing_price) status = "complete";
      else if (missing_category && (missing_cost || missing_price))   status = "missing_both";
      else if (missing_category) status = "missing_category";
      else status = "missing_cost";

      allRecords.push({
        sku,
        category: inv.category,
        cost:  pc.cost,
        price: pc.price,
        missing_category,
        missing_cost,
        missing_price,
        status,
      });
    }

    // ── 4. Summary stats (over all records, before filter) ──────────────────
    const totalSkus        = allRecords.length;
    const missingCatCount  = allRecords.filter(r => r.missing_category).length;
    const missingCostCount = allRecords.filter(r => r.missing_cost).length;
    const missingPriceCount = allRecords.filter(r => r.missing_price).length;
    const missingBothCount = allRecords.filter(r => r.status === "missing_both").length;
    const completeCount    = allRecords.filter(r => r.status === "complete").length;

    // ── 5. Apply filter + search ────────────────────────────────────────────
    let filtered = allRecords;
    if (filter === "missing_category") filtered = filtered.filter(r => r.missing_category);
    else if (filter === "missing_cost")     filtered = filtered.filter(r => r.missing_cost || r.missing_price);
    else if (filter === "missing_both")     filtered = filtered.filter(r => r.status === "missing_both");
    else if (filter === "complete")         filtered = filtered.filter(r => r.status === "complete");

    if (q) {
      const lower = q.toLowerCase();
      filtered = filtered.filter(r => r.sku.toLowerCase().includes(lower));
    }

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const items  = filtered.slice(offset, offset + limit);

    const response: CompletenessResponse = {
      items,
      total,
      page,
      limit,
      summary: {
        total_skus:       totalSkus,
        missing_category: missingCatCount,
        missing_cost:     missingCostCount,
        missing_price:    missingPriceCount,
        missing_both:     missingBothCount,
        complete:         completeCount,
        category_pct: totalSkus ? Math.round(((totalSkus - missingCatCount) / totalSkus) * 100) : 0,
        cost_pct:     totalSkus ? Math.round(((totalSkus - missingCostCount) / totalSkus) * 100) : 0,
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
