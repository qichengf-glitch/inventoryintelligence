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

    const supabase = createSupabaseClient();
    const { schema, table, skuColumn } = getInventoryConfig();
    
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
    const { data, error } = await tableRef
      .select(buildSelect([skuColumn, "safety_stock"]))
      .eq(skuColumn, sku)
      .not("safety_stock", "is", null)
      .order("safety_stock", { ascending: false })
      .limit(1);

    if (error) {
      console.error("[api/safetyStock] supabase error", { schema, table, message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ sku, safetyStock: 0 });
    }

    const safetyStock = Number((data[0] as any)?.safety_stock ?? 0);
    return NextResponse.json({ sku, safetyStock: Number.isFinite(safetyStock) ? safetyStock : 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
