import { NextRequest, NextResponse } from "next/server";

import { createSupabaseClient } from "@/lib/supabaseClient";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getInventoryConfig } from "@/lib/inventoryConfig";
import { excludeAllZeroRows } from "@/lib/inventory/zeroFilter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const EXCLUDED_COLUMNS = new Set(["id", "dataset_id", "created_at"]);

function parseMonth(value: unknown): string | null {
  if (value == null) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 7);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed
      .replace(/[年月]/g, "-")
      .replace(/日/g, "")
      .replace(/[./]/g, "-");
    const match = normalized.match(/(\d{4})-(\d{1,2})/);
    if (!match) return null;
    return `${match[1]}-${match[2].padStart(2, "0")}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const s = String(Math.trunc(value));
    if (s.length === 6) return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
    if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
  }

  return null;
}

function monthToDateStart(month: string) {
  return `${month}-01`;
}

async function getSupabaseForPreview() {
  try {
    return { supabase: createSupabaseAdminClient(), source: "admin" as const };
  } catch {
    return { supabase: createSupabaseClient(), source: "anon" as const };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = String(searchParams.get("sku") ?? "").trim();
    const monthFilter = String(searchParams.get("month") ?? "").trim();
    const batchFilter = String(searchParams.get("batch") ?? "").trim();
    const limitRaw = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);

    if (!sku) {
      return NextResponse.json({ error: "sku is required" }, { status: 400 });
    }

    const parsedMonth = monthFilter ? parseMonth(monthFilter) : null;
    const limit = Number.isFinite(limitRaw)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limitRaw)))
      : DEFAULT_LIMIT;

    const { schema, salesColumn, stockColumn } = getInventoryConfig();
    const { supabase, source } = await getSupabaseForPreview();
    const tableRef = schema
      ? supabase.schema(schema).from("inventory_batches")
      : supabase.from("inventory_batches");

    let query = excludeAllZeroRows(
      tableRef
        .select("*")
        .ilike("sku", sku)
        .order("month", { ascending: false })
        .order("sku", { ascending: true })
        .limit(limit),
      salesColumn,
      stockColumn
    );

    if (parsedMonth) {
      query = query.eq("month", monthToDateStart(parsedMonth));
    }

    if (batchFilter) {
      query = query.ilike("batch", `%${batchFilter}%`);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const sanitizedRows = ((data || []) as Array<Record<string, unknown>>).map((row) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (EXCLUDED_COLUMNS.has(key)) continue;
        out[key] = value;
      }
      return out;
    });

    const columns = Array.from(
      sanitizedRows.reduce((set, row) => {
        Object.keys(row).forEach((key) => set.add(key));
        return set;
      }, new Set<string>())
    );

    return NextResponse.json({
      source,
      table: `${schema || "public"}.inventory_batches`,
      sku,
      monthFilter: parsedMonth,
      batchFilter: batchFilter || null,
      limit,
      columns,
      rows: sanitizedRows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[api/inventory/preview] error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
