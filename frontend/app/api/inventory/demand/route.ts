import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku") || "";
    if (!sku) {
      return NextResponse.json({ error: "sku is required" }, { status: 400 });
    }

    const parseMonth = (value: unknown): string | null => {
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
        const normalized = trimmed
          .replace(/[年月]/g, "-")
          .replace(/日/g, "")
          .replace(/[./]/g, "-");
        const match = normalized.match(/(\d{4})-(\d{1,2})/);
        if (match) {
          const yyyy = match[1];
          const mm = match[2].padStart(2, "0");
          return `${yyyy}-${mm}`;
        }
        return null;
      }
      return null;
    };

    const supabase = createSupabaseClient();
    const { schema, table, skuColumn, timeColumn, salesColumn } = getInventoryConfig();
    if (!timeColumn) {
      return NextResponse.json({ error: "Time column is not configured" }, { status: 500 });
    }
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
    const selectColumns = buildSelect([timeColumn, salesColumn, skuColumn]);
    console.log("[api/demand] querying:", { sku, columns: selectColumns, table });
    const { data, error } = await tableRef.select(selectColumns).eq(skuColumn, sku);

    if (error) {
      console.error("[api/demand] supabase error", { schema, table, message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[api/demand] raw rows count:", (data || []).length);
    if (data && data.length > 0) {
      console.log("[api/demand] sample row:", { 
        Time: (data[0] as any)?.[timeColumn], 
        Sales: (data[0] as any)?.[salesColumn],
        SKU: (data[0] as any)?.[skuColumn]
      });
    }

    const acc = new Map<string, number>();
    const debugAccum: Array<{ month: string; sales: number; t: string; rawTime: unknown }> = [];
    
    (data || []).forEach((row) => {
      const month = parseMonth((row as any)?.[timeColumn]) ?? "";
      if (!month) {
        console.warn("[api/demand] failed to parse month from:", (row as any)?.[timeColumn]);
        return;
      }
      const t = `${month}-01`;
      const y = Number((row as any)?.[salesColumn] ?? 0);
      const before = acc.get(t) ?? 0;
      const after = before + (Number.isFinite(y) ? y : 0);
      acc.set(t, after);
      debugAccum.push({ month, sales: y, t, rawTime: (row as any)?.[timeColumn] });
    });

    // 按月份分组显示详细信息
    const byMonth = new Map<string, Array<{ sales: number; rawTime: unknown }>>();
    debugAccum.forEach(({ t, sales, rawTime }) => {
      if (!byMonth.has(t)) byMonth.set(t, []);
      byMonth.get(t)!.push({ sales, rawTime });
    });

    console.log("[api/demand] accumulation summary:", {
      querySKU: sku,
      totalRows: (data || []).length,
      uniqueMonths: acc.size,
      monthTotals: Object.fromEntries(acc),
      detailedByMonth: Object.fromEntries(Array.from(byMonth.entries()).map(([month, items]) => [
        month,
        { count: items.length, items, total: items.reduce((sum, x) => sum + x.sales, 0) }
      ]))
    });

    const series = Array.from(acc.entries())
      .map(([t, y]) => ({ t, y }))
      .sort((a, b) => (a.t < b.t ? -1 : 1));

    return NextResponse.json({ sku, series });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
