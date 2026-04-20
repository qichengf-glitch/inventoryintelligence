/**
 * GET /api/analysis/deadstock
 *
 * Predicts dead-stock risk for every SKU based on:
 *   - Recent sales velocity (last 3 months)
 *   - Velocity trend (recent 3M vs prior 3M)
 *   - Current stock level
 *   - Projected months-to-zero
 *
 * Risk tiers:
 *   critical  — velocity → 0 or months_to_zero < 3  AND declining trend
 *   high      — months_to_zero 3–6  OR velocity declining > 50%
 *   medium    — months_to_zero 6–12 OR velocity declining 20–50%
 *   low       — months_to_zero > 12, stable velocity
 *   healthy   — growing or stable, adequate stock
 */

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSupabase() {
  try { return createSupabaseAdminClient(); } catch { return createSupabaseClient(); }
}

function parseMonth(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 7);
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
      const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      return d.toISOString().slice(0, 7);
    }
    return null;
  }
  if (typeof value === "string") {
    const n = value.trim().replace(/[年月]/g, "-").replace(/日/g, "").replace(/[./]/g, "-");
    const m = n.match(/(\d{4})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

export type DeadstockItem = {
  sku: string;
  category: string | null;
  current_stock: number;
  velocity_recent: number;    // avg monthly sales last 3 months
  velocity_prior: number;     // avg monthly sales prior 3 months
  velocity_trend_pct: number; // (recent - prior) / prior * 100 — negative = declining
  months_to_zero: number | null; // current_stock / velocity_recent
  risk_tier: "critical" | "high" | "medium" | "low" | "healthy";
  risk_score: number;         // 0-100, higher = more risky
  last_sale_month: string | null;
};

export type DeadstockResponse = {
  total_skus: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  healthy: number;
  items: DeadstockItem[];
  computed_at: string;
};

export async function GET() {
  try {
    const supabase = getSupabase();
    const { schema, table, skuColumn, timeColumn, salesColumn, stockColumn } = getInventoryConfig();
    if (!timeColumn) {
      return NextResponse.json({ error: "Time column not configured" }, { status: 500 });
    }

    // Try view first, fall back to configured table
    let rows: any[] = [];
    const { data: viewData } = await supabase
      .from("v_inventory_sku_monthly")
      .select("sku, category, month, month_sales, month_end_stock")
      .limit(20000);

    if (viewData?.length) {
      rows = viewData.map((r: any) => ({
        sku: r.sku,
        category: r.category ?? null,
        month: parseMonth(r.month),
        sales: Number(r.month_sales ?? 0),
        stock: Number(r.month_end_stock ?? 0),
      }));
    } else {
      // Fall back to configured table
      const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
      const { data: tableData } = await tableRef
        .select(`${skuColumn}, ${timeColumn}, ${salesColumn}, ${stockColumn}`)
        .limit(20000);

      if (tableData?.length) {
        rows = tableData.map((r: any) => ({
          sku: String(r[skuColumn] ?? ""),
          category: null,
          month: parseMonth(r[timeColumn]),
          sales: Number(r[salesColumn] ?? 0),
          stock: Number(r[stockColumn] ?? 0),
        }));
      }
    }

    if (!rows.length) {
      return NextResponse.json({ error: "No inventory data found" }, { status: 404 });
    }

    // Group by SKU
    const skuMap = new Map<string, {
      category: string | null;
      months: { month: string; sales: number; stock: number }[];
    }>();

    for (const r of rows) {
      if (!r.sku || !r.month) continue;
      if (!skuMap.has(r.sku)) skuMap.set(r.sku, { category: r.category, months: [] });
      skuMap.get(r.sku)!.months.push({ month: r.month, sales: r.sales, stock: r.stock });
    }

    // Find latest month across all data
    let latestMonth = "0000-00";
    for (const { months } of skuMap.values()) {
      for (const m of months) {
        if (m.month > latestMonth) latestMonth = m.month;
      }
    }

    // Compute dead stock risk per SKU
    const items: DeadstockItem[] = [];

    for (const [sku, { category, months }] of skuMap.entries()) {
      if (!months.length) continue;

      // Sort months ascending
      months.sort((a, b) => (a.month < b.month ? -1 : 1));

      // Get all months sorted desc relative to latest
      const sorted = [...months].sort((a, b) => (a.month > b.month ? -1 : 1));

      // latest stock = most recent month_end_stock
      const current_stock = sorted[0]?.stock ?? 0;
      const last_sale_month = sorted.find(m => m.sales > 0)?.month ?? null;

      // recent 3M avg
      const recent3 = sorted.slice(0, 3).map(m => m.sales);
      const velocity_recent = recent3.length > 0
        ? recent3.reduce((a, b) => a + b, 0) / recent3.length
        : 0;

      // prior 3M avg
      const prior3 = sorted.slice(3, 6).map(m => m.sales);
      const velocity_prior = prior3.length > 0
        ? prior3.reduce((a, b) => a + b, 0) / prior3.length
        : 0;

      // velocity trend %
      const velocity_trend_pct = velocity_prior > 0
        ? ((velocity_recent - velocity_prior) / velocity_prior) * 100
        : velocity_recent > 0 ? 0 : -100; // if no prior data and no recent sales = -100%

      // months to zero
      const months_to_zero = velocity_recent > 0
        ? current_stock / velocity_recent
        : current_stock > 0 ? Infinity : 0;

      // Risk tier logic
      let risk_tier: DeadstockItem["risk_tier"];
      let risk_score: number;

      const isZeroVelocity = velocity_recent <= 0;
      const isDeclining = velocity_trend_pct < -20;
      const isRapidlyDeclining = velocity_trend_pct < -50;
      const mtz = months_to_zero === Infinity ? 999 : (months_to_zero ?? 0);

      if (isZeroVelocity && current_stock > 0) {
        // No recent sales but stock sitting
        risk_tier = "critical";
        risk_score = 95;
      } else if (isZeroVelocity && current_stock <= 0) {
        // No stock, no sales — skip (already cleared / irrelevant)
        continue;
      } else if (mtz < 1 || (isRapidlyDeclining && mtz < 6)) {
        risk_tier = "critical";
        risk_score = Math.min(95, 80 + Math.round((1 - mtz / 6) * 15));
      } else if (mtz < 6 || (isDeclining && mtz < 12)) {
        risk_tier = "high";
        risk_score = Math.round(60 + Math.max(0, Math.min(20, (6 - mtz) * 3)));
      } else if (mtz < 12 || (velocity_trend_pct < -20 && mtz < 18)) {
        risk_tier = "medium";
        risk_score = Math.round(35 + Math.max(0, Math.min(25, (12 - mtz) * 2)));
      } else if (velocity_trend_pct > 10) {
        risk_tier = "healthy";
        risk_score = Math.max(0, Math.round(10 - velocity_trend_pct / 5));
      } else {
        risk_tier = "low";
        risk_score = Math.round(15 + Math.max(0, 15 - mtz));
      }

      items.push({
        sku,
        category: category ?? null,
        current_stock: Math.round(current_stock),
        velocity_recent: Math.round(velocity_recent * 10) / 10,
        velocity_prior: Math.round(velocity_prior * 10) / 10,
        velocity_trend_pct: Math.round(velocity_trend_pct * 10) / 10,
        months_to_zero: months_to_zero === Infinity ? null : Math.round(months_to_zero * 10) / 10,
        risk_tier,
        risk_score: Math.max(0, Math.min(100, risk_score)),
        last_sale_month,
      });
    }

    // Sort by risk_score desc
    items.sort((a, b) => b.risk_score - a.risk_score);

    const counts = {
      critical: items.filter(i => i.risk_tier === "critical").length,
      high: items.filter(i => i.risk_tier === "high").length,
      medium: items.filter(i => i.risk_tier === "medium").length,
      low: items.filter(i => i.risk_tier === "low").length,
      healthy: items.filter(i => i.risk_tier === "healthy").length,
    };

    const response: DeadstockResponse = {
      total_skus: items.length,
      ...counts,
      items,
      computed_at: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/analysis/deadstock]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
