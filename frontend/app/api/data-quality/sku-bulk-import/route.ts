/**
 * POST /api/data-quality/sku-bulk-import
 *
 * Bulk-import SKU data from a CSV payload.
 *
 * Expected CSV columns (case-insensitive, flexible order):
 *   sku, category, cost, price   (or sales_unit_price)
 *
 * Request body (JSON):
 *   { csv: string }   — raw CSV text
 *
 * Behaviour:
 *  - Parses the CSV in-memory (no file upload needed)
 *  - Updates `category` on ALL matching rows in the inventory table
 *  - Upserts cost/price into `sku_price_cost`
 *  - Returns per-row results so the UI can show what succeeded / failed
 *
 * Returns:
 *   { ok: true, processed: number, succeeded: number, failed: RowError[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function getSupabase() {
  try { return createSupabaseAdminClient(); } catch { return createSupabaseClient(); }
}

// ─── CSV parsing ─────────────────────────────────────────────────────────────

type ParsedRow = {
  sku: string;
  category?: string | null;
  cost?: number | null;
  price?: number | null;
};

type RowError = { sku: string; row: number; error: string };

function parseCSV(raw: string): { rows: ParsedRow[]; errors: RowError[] } {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return { rows: [], errors: [{ sku: "", row: 0, error: "CSV has no data rows" }] };

  // Parse header
  const headerLine = lines[0].trim();
  const headers = headerLine.split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));

  const skuIdx   = headers.findIndex((h) => h === "sku");
  const catIdx   = headers.findIndex((h) => h === "category" || h === "品类" || h === "类别");
  const costIdx  = headers.findIndex((h) => h === "cost" || h === "成本");
  const priceIdx = headers.findIndex((h) =>
    h === "price" || h === "sales_unit_price" || h === "unit_price" || h === "销售单价" || h === "价格"
  );

  if (skuIdx === -1) {
    return { rows: [], errors: [{ sku: "", row: 0, error: "CSV must have a 'sku' column" }] };
  }

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV split (handles quoted fields)
    const cells = splitCSVLine(line);

    const sku = (cells[skuIdx] ?? "").replace(/['"]/g, "").trim();
    if (!sku) {
      errors.push({ sku: "", row: i + 1, error: "Empty SKU — row skipped" });
      continue;
    }

    const row: ParsedRow = { sku };

    if (catIdx !== -1) {
      const raw = (cells[catIdx] ?? "").replace(/['"]/g, "").trim();
      row.category = raw || null;
    }

    if (costIdx !== -1) {
      const raw = (cells[costIdx] ?? "").replace(/['"]/g, "").trim();
      if (raw === "" || raw === "-" || raw.toLowerCase() === "null") {
        row.cost = null;
      } else {
        const n = parseFloat(raw.replace(/,/g, ""));
        if (isNaN(n)) {
          errors.push({ sku, row: i + 1, error: `Invalid cost value: "${raw}"` });
          continue;
        }
        row.cost = n;
      }
    }

    if (priceIdx !== -1) {
      const raw = (cells[priceIdx] ?? "").replace(/['"]/g, "").trim();
      if (raw === "" || raw === "-" || raw.toLowerCase() === "null") {
        row.price = null;
      } else {
        const n = parseFloat(raw.replace(/,/g, ""));
        if (isNaN(n)) {
          errors.push({ sku, row: i + 1, error: `Invalid price value: "${raw}"` });
          continue;
        }
        row.price = n;
      }
    }

    rows.push(row);
  }

  return { rows, errors };
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const csvText: string = body?.csv;

    if (!csvText || typeof csvText !== "string" || !csvText.trim()) {
      return NextResponse.json({ error: "csv field is required" }, { status: 400 });
    }

    const { rows, errors: parseErrors } = parseCSV(csvText);

    if (rows.length === 0) {
      return NextResponse.json({
        ok: false,
        processed: 0,
        succeeded: 0,
        failed: parseErrors,
        message: "No valid rows found in CSV",
      });
    }

    const config   = getInventoryConfig();
    const supabase = getSupabase();
    const rowErrors: RowError[] = [...parseErrors];
    let succeeded = 0;

    // ── Batch updates ──────────────────────────────────────────────────────
    // Process in chunks of 50 to avoid overwhelming the DB
    const CHUNK = 50;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);

      await Promise.all(
        chunk.map(async (row, idx) => {
          const rowNum = i + idx + 2; // 1-based, +1 for header
          try {
            // 1. Update category in inventory table
            if (row.category !== undefined) {
              const { error: catErr } = await supabase
                .from(config.table)
                .update({ category: row.category })
                .eq(config.skuColumn, row.sku);

              if (catErr) throw new Error(`category update failed: ${catErr.message}`);
            }

            // 2. Upsert price/cost
            if (row.cost !== undefined || row.price !== undefined) {
              const upsertPayload: Record<string, unknown> = { sku: row.sku };
              if (row.cost  !== undefined) upsertPayload.cost              = row.cost;
              if (row.price !== undefined) upsertPayload.sales_unit_price  = row.price;

              const { error: upsertErr } = await supabase
                .from("sku_price_cost")
                .upsert(upsertPayload, { onConflict: "sku" });

              if (upsertErr) throw new Error(`price/cost upsert failed: ${upsertErr.message}`);
            }

            succeeded++;
          } catch (err) {
            rowErrors.push({
              sku: row.sku,
              row: rowNum,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })
      );
    }

    return NextResponse.json({
      ok: true,
      processed: rows.length,
      succeeded,
      failed: rowErrors.length > 0 ? rowErrors : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
