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
    const { schema, table, skuColumn, timeColumn, stockColumn } = getInventoryConfig();
    if (!timeColumn) {
      return NextResponse.json({ error: "Time column is not configured" }, { status: 500 });
    }

    // 拉取该 SKU 的所有行，找到最新月份
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
    const selectColumns = buildSelect([timeColumn, stockColumn, skuColumn]);
    const { data, error } = await tableRef.select(selectColumns).eq(skuColumn, sku);

    if (error) {
      console.error("[api/currentStock] supabase error", { schema, table, message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || [])
      .map((row) => {
        const month = parseMonth((row as any)?.[timeColumn]) ?? "";
        const stock = Number((row as any)?.[stockColumn] ?? 0);
        return { month, stock: Number.isFinite(stock) ? stock : 0 };
      })
      .filter((r) => r.month);

    if (!rows.length) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const latestMonth = rows.map((r) => r.month).sort().at(-1)!;
    const currentStock = rows
      .filter((r) => r.month === latestMonth)
      .reduce((sum, r) => sum + r.stock, 0);

    return NextResponse.json({ sku, month: latestMonth, currentStock });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
