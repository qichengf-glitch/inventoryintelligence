import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getInventoryConfig } from "@/lib/inventoryConfig";
import { excludeAllZeroRows } from "@/lib/inventory/zeroFilter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SlowMover = {
  sku: string;
  current_stock: number;
  months_without_movement: number;
  last_out_month: string | null;
  avg_monthly_out: number;
};

function parseMonth(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const m = value.trim().match(/(\d{4})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    if (value >= 190001 && value <= 210012) {
      const s = String(Math.trunc(value));
      if (s.length === 6) return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
    }
  }
  return null;
}

export async function GET() {
  try {
    const { schema, table, skuColumn, stockColumn, salesColumn, timeColumn } = getInventoryConfig();
    const supabase = createSupabaseAdminClient();
    const monthCol = timeColumn ?? "month";
    const outCol = "month_out";

    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);

    // Fetch last 6 months of data to detect slow movers
    const { data: allData, error } = await excludeAllZeroRows(
      tableRef
        .select([skuColumn, monthCol, stockColumn, outCol].join(", "))
        .order(monthCol, { ascending: false })
        .limit(50000),
      salesColumn,
      stockColumn
    );

    if (error) throw new Error(error.message);

    const rows = (allData ?? []) as unknown as Array<Record<string, unknown>>;

    // Group rows by SKU, then by month
    const skuMonthData = new Map<string, Map<string, { stock: number; out: number }>>();

    for (const row of rows) {
      const sku = String(row[skuColumn] ?? "").trim();
      if (!sku) continue;
      const month = parseMonth(row[monthCol]);
      if (!month) continue;
      const stock = Number(row[stockColumn] ?? 0);
      const out = Number(row[outCol] ?? 0);

      if (!skuMonthData.has(sku)) skuMonthData.set(sku, new Map());
      const monthMap = skuMonthData.get(sku)!;
      const existing = monthMap.get(month) ?? { stock: 0, out: 0 };
      existing.stock += stock;
      existing.out += out;
      monthMap.set(month, existing);
    }

    // Find the global latest month
    const allMonths = new Set<string>();
    for (const monthMap of skuMonthData.values()) {
      for (const m of monthMap.keys()) allMonths.add(m);
    }
    const sortedMonths = Array.from(allMonths).sort();
    const latestMonth = sortedMonths[sortedMonths.length - 1];
    if (!latestMonth) {
      return NextResponse.json({ slow_movers: [], latest_month: null, computed_at: new Date().toISOString() });
    }

    const LOOKBACK = 3; // months to check for zero outbound
    const recentMonths = sortedMonths.slice(-LOOKBACK);

    const slowMovers: SlowMover[] = [];

    for (const [sku, monthMap] of skuMonthData.entries()) {
      const latestData = monthMap.get(latestMonth);
      if (!latestData || latestData.stock <= 0) continue; // skip if no stock

      // Count consecutive months from latest backwards with zero outbound
      let consecutiveZeroOut = 0;
      let lastOutMonth: string | null = null;
      const totalOut = Array.from(monthMap.values()).reduce((s, d) => s + d.out, 0);
      const monthCount = monthMap.size;

      for (let i = recentMonths.length - 1; i >= 0; i--) {
        const m = recentMonths[i];
        const d = monthMap.get(m);
        if (!d || d.out <= 0) {
          consecutiveZeroOut++;
        } else {
          lastOutMonth = m;
          break;
        }
      }

      if (consecutiveZeroOut >= 2) {
        slowMovers.push({
          sku,
          current_stock: latestData.stock,
          months_without_movement: consecutiveZeroOut,
          last_out_month: lastOutMonth,
          avg_monthly_out: monthCount > 0 ? Math.round((totalOut / monthCount) * 10) / 10 : 0,
        });
      }
    }

    // Sort by stock descending (highest idle stock first)
    slowMovers.sort((a, b) => b.current_stock - a.current_stock);

    return NextResponse.json({
      slow_movers: slowMovers,
      latest_month: latestMonth,
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compute slow movers" },
      { status: 500 }
    );
  }
}
