import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";

async function getSupabase() {
  try {
    return createSupabaseAdminClient();
  } catch {
    return createSupabaseClient();
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku") || "";
    if (!sku) {
      return NextResponse.json({ error: "sku is required" }, { status: 400 });
    }

    const supabase = await getSupabase();
    const { schema, table, skuColumn } = getInventoryConfig();

    // Primary source: sku_thresholds table (set via the thresholds management UI)
    const threshRef = schema
      ? supabase.schema(schema).from("sku_thresholds")
      : supabase.from("sku_thresholds");

    const { data: threshData, error: threshError } = await threshRef
      .select("sku, safety_stock")
      .eq("sku", sku)
      .limit(1);

    if (!threshError && threshData && threshData.length > 0) {
      const val = (threshData[0] as any)?.safety_stock;
      if (val != null) {
        const ss = Number(val);
        if (Number.isFinite(ss) && ss >= 0) {
          return NextResponse.json({ sku, safetyStock: ss, source: "sku_thresholds" });
        }
      }
    }

    // Fallback: read safety_stock column from the main inventory table
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
    const { data, error } = await tableRef
      .select(buildSelect([skuColumn, "safety_stock"]))
      .eq(skuColumn, sku)
      .not("safety_stock", "is", null)
      .order("safety_stock", { ascending: false })
      .limit(1);

    if (error) {
      console.error("[api/safetyStock] inventory table error", { schema, table, message: error.message });
      return NextResponse.json({ sku, safetyStock: 0 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ sku, safetyStock: 0 });
    }

    const safetyStock = Number((data[0] as any)?.safety_stock ?? 0);
    return NextResponse.json({
      sku,
      safetyStock: Number.isFinite(safetyStock) ? safetyStock : 0,
      source: "inventory_table",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
