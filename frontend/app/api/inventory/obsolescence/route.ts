import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ObsolescenceItem = {
  sku: string;
  batch: string;
  current_stock: number;
  unit_cost: number | null;
  capital: number | null;
  inbound_year: number;
  inbound_month: number;
  age_months: number;
  risk_tier: "high" | "medium" | "watch" | "unknown";
};

export type ObsolescenceSummary = {
  high: { batches: number; total_stock: number; total_capital: number };
  medium: { batches: number; total_stock: number; total_capital: number };
  watch: { batches: number; total_stock: number; total_capital: number };
  unknown: { batches: number; total_stock: number; total_capital: number };
};

export type ObsolescenceResponse = {
  items: ObsolescenceItem[];
  summary: ObsolescenceSummary;
  as_of: string;
};

// Strip leading non-digits, take first 4 digits as YYMM
function parseBatchDate(batch: string): { year: number; month: number } | null {
  if (!batch) return null;
  const digits = batch.replace(/^[^0-9]+/, "").replace(/[^0-9]/g, "");
  if (digits.length < 4) return null;
  const yy = parseInt(digits.slice(0, 2), 10);
  const mm = parseInt(digits.slice(2, 4), 10);
  if (mm < 1 || mm > 12) return null;
  return { year: 2000 + yy, month: mm };
}

function getAgeMonths(year: number, month: number, today: Date): number {
  return (today.getFullYear() - year) * 12 + (today.getMonth() + 1 - month);
}

function getRiskTier(ageMonths: number): "high" | "medium" | "watch" {
  if (ageMonths >= 24) return "high";
  if (ageMonths >= 12) return "medium";
  return "watch";
}

export async function GET() {
  try {
    const { schema, table, skuColumn, timeColumn, stockColumn } = getInventoryConfig();
    const supabase = createSupabaseAdminClient();

    // Fetch SKU costs from sku_price_cost table
    const costMap = new Map<string, number>();
    const { data: costRows, error: costError } = await supabase
      .from("sku_price_cost")
      .select("sku, cost");
    if (costError) {
      console.warn("[obsolescence] Could not load sku_price_cost:", costError.message);
    } else {
      for (const row of costRows ?? []) {
        const sku = String(row.sku ?? "").trim();
        const cost = Number(row.cost);
        if (sku && Number.isFinite(cost)) costMap.set(sku, cost);
      }
    }

    // Fetch all inventory rows with batch
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
    const PAGE = 10000;
    const allRows: Array<Record<string, unknown>> = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await tableRef
        .select(`${skuColumn}, batch, ${timeColumn}, ${stockColumn}`)
        .not("batch", "is", null)
        .neq("batch", "")
        .range(from, from + PAGE - 1);

      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      allRows.push(...(data as Array<Record<string, unknown>>));
      if (data.length < PAGE) break;
    }

    // For each (sku, batch) keep only the latest time row
    const key = (sku: string, batch: string) => `${sku}||${batch}`;
    type BestRow = { sku: string; batch: string; time: string; stock: number };
    const best = new Map<string, BestRow>();

    for (const row of allRows) {
      const sku = String(row[skuColumn] ?? "").trim();
      const batch = String(row["batch"] ?? "").trim();
      if (!sku || !batch) continue;

      const stock = Number(row[stockColumn] ?? 0);
      const rawTime = row[timeColumn as string] ?? "";
      const time = String(rawTime).trim();

      const k = key(sku, batch);
      const prev = best.get(k);
      if (!prev || time > prev.time) {
        best.set(k, { sku, batch, time, stock });
      }
    }

    const today = new Date();
    const items: ObsolescenceItem[] = [];

    for (const { sku, batch, stock } of best.values()) {
      if (stock <= 0) continue;

      const unit_cost = costMap.get(sku) ?? null;
      const capital = unit_cost !== null ? stock * unit_cost : null;

      const parsed = parseBatchDate(batch);
      if (!parsed) {
        items.push({ sku, batch, current_stock: stock, unit_cost, capital, inbound_year: 0, inbound_month: 0, age_months: -1, risk_tier: "unknown" });
        continue;
      }

      const age = getAgeMonths(parsed.year, parsed.month, today);
      items.push({
        sku,
        batch,
        current_stock: stock,
        unit_cost,
        capital,
        inbound_year: parsed.year,
        inbound_month: parsed.month,
        age_months: age,
        risk_tier: age < 0 ? "unknown" : getRiskTier(age),
      });
    }

    // Sort: high first, then by capital desc (fall back to stock desc)
    const tierOrder = { high: 0, medium: 1, watch: 2, unknown: 3 };
    items.sort((a, b) => {
      const td = tierOrder[a.risk_tier] - tierOrder[b.risk_tier];
      if (td !== 0) return td;
      const ca = a.capital ?? a.current_stock;
      const cb = b.capital ?? b.current_stock;
      return cb - ca;
    });

    const summary: ObsolescenceSummary = {
      high: { batches: 0, total_stock: 0, total_capital: 0 },
      medium: { batches: 0, total_stock: 0, total_capital: 0 },
      watch: { batches: 0, total_stock: 0, total_capital: 0 },
      unknown: { batches: 0, total_stock: 0, total_capital: 0 },
    };
    for (const item of items) {
      summary[item.risk_tier].batches += 1;
      summary[item.risk_tier].total_stock += item.current_stock;
      summary[item.risk_tier].total_capital += item.capital ?? 0;
    }

    return NextResponse.json<ObsolescenceResponse>({ items, summary, as_of: today.toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
