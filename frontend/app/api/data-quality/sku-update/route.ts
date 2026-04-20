/**
 * PATCH /api/data-quality/sku-update
 *
 * Inline-edit a single SKU's category, cost, and/or price.
 *
 * Request body:
 *   { sku: string, category?: string, cost?: number | null, price?: number | null }
 *
 * - Updates `category` on ALL rows of the inventory table that match the SKU
 *   (so every historical batch row reflects the corrected category).
 * - Upserts `cost` / `sales_unit_price` into `sku_price_cost`.
 *
 * Returns: { ok: true, sku: string, updated: { category?, cost?, price? } }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getSupabase() {
  try { return createSupabaseAdminClient(); } catch { return createSupabaseClient(); }
}

type UpdateBody = {
  sku: string;
  category?: string | null;
  cost?: number | null;
  price?: number | null;
};

export async function PATCH(req: NextRequest) {
  try {
    const body: UpdateBody = await req.json();
    const { sku, category, cost, price } = body;

    if (!sku || typeof sku !== "string" || !sku.trim()) {
      return NextResponse.json({ error: "sku is required" }, { status: 400 });
    }

    const cleanSku = sku.trim();
    const config = getInventoryConfig();
    const supabase = getSupabase();
    const updated: Record<string, unknown> = {};

    // ── 1. Update category in inventory table ───────────────────────────────
    if (category !== undefined) {
      const newCat = typeof category === "string" && category.trim() ? category.trim() : null;

      const { error: catErr } = await supabase
        .from(config.table)
        .update({ category: newCat })
        .eq(config.skuColumn, cleanSku);

      if (catErr) {
        return NextResponse.json(
          { error: `Failed to update category: ${catErr.message}` },
          { status: 500 }
        );
      }
      updated.category = newCat;
    }

    // ── 2. Upsert cost / price into sku_price_cost ──────────────────────────
    if (cost !== undefined || price !== undefined) {
      // First, fetch the current row (if any) so we preserve unchanged fields
      const { data: existingRows } = await supabase
        .from("sku_price_cost")
        .select("sku, cost, sales_unit_price")
        .eq("sku", cleanSku)
        .limit(1);

      const existing = existingRows?.[0];

      const upsertPayload: Record<string, unknown> = { sku: cleanSku };

      // cost
      if (cost !== undefined) {
        upsertPayload.cost = cost != null ? Number(cost) : null;
        updated.cost = upsertPayload.cost;
      } else if (existing) {
        upsertPayload.cost = existing.cost;
      }

      // price
      if (price !== undefined) {
        upsertPayload.sales_unit_price = price != null ? Number(price) : null;
        updated.price = upsertPayload.sales_unit_price;
      } else if (existing) {
        upsertPayload.sales_unit_price = existing.sales_unit_price;
      }

      const { error: upsertErr } = await supabase
        .from("sku_price_cost")
        .upsert(upsertPayload, { onConflict: "sku" });

      if (upsertErr) {
        return NextResponse.json(
          { error: `Failed to update price/cost: ${upsertErr.message}` },
          { status: 500 }
        );
      }
    }

    if (Object.keys(updated).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, sku: cleanSku, updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
