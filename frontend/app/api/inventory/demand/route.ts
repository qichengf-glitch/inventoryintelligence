import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";
import { excludeAllZeroRows } from "@/lib/inventory/zeroFilter";

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
    const { schema, table, skuColumn, timeColumn, salesColumn, stockColumn } = getInventoryConfig();
    if (!timeColumn) {
      return NextResponse.json({ error: "Time column is not configured" }, { status: 500 });
    }
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
    const selectColumns = buildSelect([timeColumn, salesColumn, skuColumn]);
    const { data, error } = await excludeAllZeroRows(
      tableRef.select(selectColumns).eq(skuColumn, sku),
      salesColumn,
      stockColumn
    );

    if (error) {
      console.error("[api/demand] supabase error", { schema, table, message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const acc = new Map<string, number>();

    (data || []).forEach((row: any) => {
      const month = parseMonth((row as any)?.[timeColumn]) ?? "";
      if (!month) return;
      const t = `${month}-01`;
      const y = Number((row as any)?.[salesColumn] ?? 0);
      acc.set(t, (acc.get(t) ?? 0) + (Number.isFinite(y) ? y : 0));
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
