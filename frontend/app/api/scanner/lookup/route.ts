import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scanner/lookup?barcode=<value>
 *
 * Resolves a barcode/SKU to inventory info.
 * Resolution order:
 *  1. barcode_registry table (barcode → sku mapping) — if the table exists
 *  2. Direct SKU match in the inventory table
 *  3. Partial / case-insensitive SKU match
 *
 * Returns:
 *  { found: true,  sku, label, currentStock, recentMovements[] }
 *  { found: false, barcode }
 */
export async function GET(req: NextRequest) {
  const barcode = req.nextUrl.searchParams.get("barcode")?.trim();
  if (!barcode) {
    return NextResponse.json({ error: "barcode param is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { schema, table, skuColumn, stockColumn } = getInventoryConfig();

  // ── 1. Check barcode_registry ──────────────────────────────────────────────
  let resolvedSku: string | null = null;
  let label: string | null = null;

  try {
    const { data: regRow } = await supabase
      .from("barcode_registry")
      .select("sku, label")
      .eq("barcode", barcode)
      .maybeSingle();

    if (regRow) {
      resolvedSku = regRow.sku as string;
      label = regRow.label as string | null;
    }
  } catch {
    // table doesn't exist yet — fall through to direct SKU lookup
  }

  // ── 2. Direct SKU match in inventory table ─────────────────────────────────
  if (!resolvedSku) {
    try {
      const tableRef = schema
        ? supabase.schema(schema).from(table)
        : supabase.from(table);

      const { data: rows } = await tableRef
        .select(skuColumn)
        .ilike(skuColumn, barcode)
        .limit(1);

      if (rows && rows.length > 0) {
        resolvedSku = String((rows[0] as Record<string, unknown>)[skuColumn] ?? "").trim();
      }
    } catch {
      // inventory table not available
    }
  }

  if (!resolvedSku) {
    return NextResponse.json({ found: false, barcode });
  }

  // ── 3. Fetch latest stock for this SKU ─────────────────────────────────────
  let currentStock: number | null = null;
  let productLabel = label;

  try {
    const tableRef = schema
      ? supabase.schema(schema).from(table)
      : supabase.from(table);

    const { data: stockRows } = await tableRef
      .select(`${skuColumn}, ${stockColumn}`)
      .ilike(skuColumn, resolvedSku)
      .order("month", { ascending: false })
      .limit(1);

    if (stockRows && stockRows.length > 0) {
      const row = stockRows[0] as Record<string, unknown>;
      const rawStock = row[stockColumn];
      currentStock = rawStock != null ? Number(rawStock) : null;
      if (!productLabel) {
        productLabel = String(row[skuColumn] ?? resolvedSku);
      }
    }
  } catch {
    // inventory table not available
  }

  // ── 4. Fetch recent movements ──────────────────────────────────────────────
  let recentMovements: unknown[] = [];
  try {
    const { data: movements } = await supabase
      .from("stock_movements")
      .select("id, movement_type, qty, movement_date, reference_no, notes, created_at")
      .ilike("sku", resolvedSku)
      .order("created_at", { ascending: false })
      .limit(5);

    recentMovements = movements ?? [];
  } catch {
    // stock_movements table not available yet
  }

  return NextResponse.json({
    found: true,
    barcode,
    sku: resolvedSku,
    label: productLabel ?? resolvedSku,
    currentStock,
    recentMovements,
  });
}
