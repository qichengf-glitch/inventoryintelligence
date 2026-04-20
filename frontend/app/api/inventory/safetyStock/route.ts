import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";
import { normalizeSku } from "@/lib/inventory/status";

async function getSupabase() {
  try {
    return createSupabaseAdminClient();
  } catch {
    return createSupabaseClient();
  }
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku") || "";
    if (!sku) {
      return NextResponse.json({ error: "sku is required" }, { status: 400 });
    }

    const supabase = await getSupabase();
    const { schema } = getInventoryConfig();

    const ref = (tableName: string) =>
      schema ? supabase.schema(schema).from(tableName) : supabase.from(tableName);

    // 1. Primary source: sku_thresholds table (set via the thresholds management UI)
    const { data: threshData, error: threshError } = await ref("sku_thresholds")
      .select("sku, safety_stock")
      .eq("sku", sku)
      .limit(1);

    if (!threshError && threshData && threshData.length > 0) {
      const val = toFiniteNumber((threshData[0] as any)?.safety_stock);
      if (val != null) {
        return NextResponse.json({ sku, safetyStock: val, source: "sku_thresholds" });
      }
    }

    // 2. Fallback: read from the dedicated safety_stock table
    //    Columns: sku, safety_stock_value  (alt: safety_stock)
    const skuKey = normalizeSku(sku);

    const ssPreferred = await ref("sku_safety_stock")
      .select("sku, safety_stock_value")
      .limit(20000);

    if (!ssPreferred.error) {
      const rows = (ssPreferred.data || []) as Array<Record<string, unknown>>;
      for (const row of rows) {
        const rowKey = normalizeSku(String(row.sku ?? "").trim());
        if (rowKey !== skuKey) continue;
        const val = toFiniteNumber(row.safety_stock_value);
        if (val != null) {
          return NextResponse.json({ sku, safetyStock: val, source: "safety_stock_table" });
        }
      }
    } else {
      // safety_stock_value column might not exist — try wildcard
      const ssFallback = await ref("sku_safety_stock").select("*").limit(20000);
      if (!ssFallback.error) {
        const rows = (ssFallback.data || []) as Array<Record<string, unknown>>;
        for (const row of rows) {
          const rowKey = normalizeSku(String(row.sku ?? "").trim());
          if (rowKey !== skuKey) continue;
          // Accept whichever column carries the numeric value
          const val =
            toFiniteNumber(row.safety_stock_value) ??
            toFiniteNumber(row.safety_stock) ??
            toFiniteNumber(row.value);
          if (val != null) {
            return NextResponse.json({ sku, safetyStock: val, source: "safety_stock_table" });
          }
        }
      } else if (
        ssFallback.error.code !== "42P01" &&
        ssFallback.error.code !== "PGRST205"
      ) {
        console.warn("[api/safetyStock] safety_stock table query warning:", ssFallback.error.message);
      }
    }

    // 3. Not found anywhere — return 0 (no alert threshold set)
    return NextResponse.json({ sku, safetyStock: 0, source: "default" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
