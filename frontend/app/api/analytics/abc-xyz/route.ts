import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getInventoryConfig } from "@/lib/inventoryConfig";
import { excludeAllZeroRows } from "@/lib/inventory/zeroFilter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AbcClass = "A" | "B" | "C";
export type XyzClass = "X" | "Y" | "Z";

export type SkuClassification = {
  sku: string;
  total_sales: number;
  cumulative_pct: number;
  abc: AbcClass;
  cov: number;
  xyz: XyzClass;
  month_count: number;
  avg_monthly_sales: number;
};

export type AbcXyzResponse = {
  classifications: SkuClassification[];
  matrix: Record<AbcClass, Record<XyzClass, number>>;
  total_skus: number;
  computed_at: string;
};

function classifyAbc(cumulativePct: number): AbcClass {
  if (cumulativePct <= 80) return "A";
  if (cumulativePct <= 95) return "B";
  return "C";
}

function classifyXyz(cov: number): XyzClass {
  if (cov < 0.5) return "X";
  if (cov < 1.0) return "Y";
  return "Z";
}

function stdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export async function GET() {
  try {
    const { schema, table, skuColumn, salesColumn, stockColumn, timeColumn } = getInventoryConfig();
    const supabase = createSupabaseAdminClient();

    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);

    const PAGE = 5000;
    let offset = 0;
    const allRows: Array<Record<string, unknown>> = [];

    while (true) {
      const { data, error } = await excludeAllZeroRows(
        tableRef
          .select([skuColumn, salesColumn, timeColumn ?? "month"].join(", "))
          .range(offset, offset + PAGE - 1),
        salesColumn,
        stockColumn
      );
      if (error) throw new Error(error.message);
      const chunk = (data ?? []) as unknown as Array<Record<string, unknown>>;
      allRows.push(...chunk);
      if (chunk.length < PAGE) break;
      offset += PAGE;
    }

    // Group by SKU: collect monthly sales values
    const skuSalesMap = new Map<string, number[]>();
    for (const row of allRows) {
      const sku = String(row[skuColumn] ?? "").trim();
      if (!sku) continue;
      const sales = Math.max(0, Number(row[salesColumn] ?? 0));
      if (!Number.isFinite(sales)) continue;
      if (!skuSalesMap.has(sku)) skuSalesMap.set(sku, []);
      skuSalesMap.get(sku)!.push(sales);
    }

    if (skuSalesMap.size === 0) {
      return NextResponse.json({
        classifications: [],
        matrix: { A: { X: 0, Y: 0, Z: 0 }, B: { X: 0, Y: 0, Z: 0 }, C: { X: 0, Y: 0, Z: 0 } },
        total_skus: 0,
        computed_at: new Date().toISOString(),
      } satisfies AbcXyzResponse);
    }

    // Compute totals and CoV per SKU
    const skuStats = Array.from(skuSalesMap.entries()).map(([sku, monthlySales]) => {
      const total = monthlySales.reduce((s, v) => s + v, 0);
      const mean = total / monthlySales.length;
      const sd = stdDev(monthlySales, mean);
      const cov = mean > 0 ? sd / mean : 0;
      return { sku, total_sales: total, month_count: monthlySales.length, avg_monthly_sales: mean, cov };
    });

    // ABC: sort by total_sales descending, compute cumulative %
    skuStats.sort((a, b) => b.total_sales - a.total_sales);
    const grandTotal = skuStats.reduce((s, x) => s + x.total_sales, 0);
    let cumulative = 0;

    const matrix: Record<AbcClass, Record<XyzClass, number>> = {
      A: { X: 0, Y: 0, Z: 0 },
      B: { X: 0, Y: 0, Z: 0 },
      C: { X: 0, Y: 0, Z: 0 },
    };

    const classifications: SkuClassification[] = skuStats.map((s) => {
      cumulative += grandTotal > 0 ? (s.total_sales / grandTotal) * 100 : 0;
      const abc = classifyAbc(Math.min(cumulative, 100));
      const xyz = classifyXyz(s.cov);
      matrix[abc][xyz]++;
      return {
        sku: s.sku,
        total_sales: Math.round(s.total_sales),
        cumulative_pct: Math.round(cumulative * 10) / 10,
        abc,
        cov: Math.round(s.cov * 1000) / 1000,
        xyz,
        month_count: s.month_count,
        avg_monthly_sales: Math.round(s.avg_monthly_sales * 10) / 10,
      };
    });

    return NextResponse.json({
      classifications,
      matrix,
      total_skus: classifications.length,
      computed_at: new Date().toISOString(),
    } satisfies AbcXyzResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compute ABC/XYZ" },
      { status: 500 }
    );
  }
}
