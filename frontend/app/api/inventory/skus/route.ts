import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export async function GET() {
  try {
    const supabase = createSupabaseClient();
    const { schema, table, skuColumn } = getInventoryConfig();
    console.log(">>> API /skus querying table:", table);
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
    const pageSize = 1000;
    const allRows: any[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await tableRef
        .select(skuColumn)
        .order(skuColumn)
        .range(from, from + pageSize - 1);
      if (error) {
        console.error("[api/skus] supabase error", { schema, table, message: error.message });
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < pageSize) break;
    }
    const skus = Array.from(
      new Set(
        allRows
          .map((r) => (r as any)[skuColumn])
          .map((v) => (v == null ? "" : String(v).trim()))
          .filter((v) => v.length > 0)
      )
    ).sort();
    return NextResponse.json({ skus });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
