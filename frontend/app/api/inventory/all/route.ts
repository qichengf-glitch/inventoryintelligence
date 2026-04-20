import { NextRequest, NextResponse } from "next/server";

import { createSupabaseClient } from "@/lib/supabaseClient";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getInventoryConfig } from "@/lib/inventoryConfig";
import {
  computeInventoryStatus,
  normalizeSku,
} from "@/lib/inventory/status";
import { excludeAllZeroRows } from "@/lib/inventory/zeroFilter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 1000;
const MAX_ROWS = 50000;

function parseMonth(value: unknown): string | null {
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
    if (!match) return null;

    return `${match[1]}-${match[2].padStart(2, "0")}`;
  }

  return null;
}

function toMonthFilterValue(value: unknown): string | number | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeHeaderKey(value: string) {
  return value
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function pickMappedValue(row: Record<string, unknown>, keyCandidates: string[]) {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    map.set(normalizeHeaderKey(key), value);
  }
  for (const candidate of keyCandidates) {
    const value = map.get(normalizeHeaderKey(candidate));
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    return value;
  }
  return null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

async function getSupabaseForInventoryAll() {
  try {
    return { supabase: createSupabaseAdminClient(), source: "admin" as const };
  } catch {
    return { supabase: createSupabaseClient(), source: "anon" as const };
  }
}

async function loadSafetyStockMap(supabase: any, schema?: string) {
  const tableRef = schema
    ? supabase.schema(schema).from("sku_safety_stock")
    : supabase.from("sku_safety_stock");

  let data: Array<Record<string, unknown>> = [];

  const preferred = await tableRef.select("sku,safety_stock_value").limit(20000);
  if (!preferred.error) {
    data = (preferred.data || []) as Array<Record<string, unknown>>;
  } else {
    const fallback = await tableRef.select("*").limit(20000);
    if (fallback.error) {
      if (fallback.error.code === "42P01" || fallback.error.code === "PGRST205") {
        console.warn("[api/inventory/all] safety_stock table missing");
        return new Map<string, number>();
      }
      console.warn("[api/inventory/all] safety_stock query warning:", fallback.error.message);
      return new Map<string, number>();
    }
    data = (fallback.data || []) as Array<Record<string, unknown>>;
  }

  const safetyBySku = new Map<string, number>();
  for (const row of data) {
    const skuRaw = row.sku ?? pickMappedValue(row, ["sku", "model", "型号", "SKU"]);
    const valueRaw =
      row.safety_stock_value ??
      row.safety_stock ??
      pickMappedValue(row, ["safety_stock_value", "safety_stock", "Safety_Stock", "安全库存"]);

    const skuKey = normalizeSku(skuRaw);
    const value = toNumberOrNull(valueRaw);
    if (!skuKey || value == null || value < 0) continue;

    const previous = safetyBySku.get(skuKey);
    safetyBySku.set(skuKey, previous == null ? value : Math.max(previous, value));
  }

  return safetyBySku;
}

async function loadCategoryMap(supabase: any, schema?: string) {
  const tableRef = schema
    ? supabase.schema(schema).from("sku_categories")
    : supabase.from("sku_categories");

  let data: Array<Record<string, unknown>> = [];

  const preferred = await tableRef.select("sku,category").limit(20000);
  if (!preferred.error) {
    data = (preferred.data || []) as Array<Record<string, unknown>>;
  } else {
    const fallback = await tableRef.select("*").limit(20000);
    if (fallback.error) {
      if (fallback.error.code === "42P01" || fallback.error.code === "PGRST205") {
        console.warn("[api/inventory/all] sku_categories table missing");
        return new Map<string, string>();
      }
      console.warn("[api/inventory/all] sku_categories query warning:", fallback.error.message);
      return new Map<string, string>();
    }
    data = (fallback.data || []) as Array<Record<string, unknown>>;
  }

  const categoryBySku = new Map<string, string>();
  for (const row of data) {
    const skuRaw = row.sku ?? pickMappedValue(row, ["sku", "model", "型号", "SKU"]);
    const categoryRaw =
      row.category ?? pickMappedValue(row, ["category", "Category", "类别"]);
    const skuKey = normalizeSku(skuRaw);
    const category = String(categoryRaw ?? "").trim();
    if (!skuKey || !category) continue;
    if (!categoryBySku.has(skuKey)) {
      categoryBySku.set(skuKey, category);
    }
  }

  return categoryBySku;
}

async function fetchLatestMonthFromInventoryMonthly(supabase: any, schema?: string) {
  const monthlyRef = schema
    ? supabase.schema(schema).from("inventory_batches")
    : supabase.from("inventory_batches");

  const latestMonthRes = await monthlyRef
    .select("month")
    .order("month", { ascending: false })
    .limit(1);

  if (latestMonthRes.error) {
    throw new Error(`Failed to resolve latest month from inventory_monthly: ${latestMonthRes.error.message}`);
  }

  const latestMonthRows = (latestMonthRes.data || []) as Array<Record<string, unknown>>;
  if (latestMonthRows.length === 0) {
    return { latestMonth: null, monthFilterValue: null };
  }

  const latestMonthRaw = latestMonthRows[0].month;
  return {
    latestMonth: parseMonth(latestMonthRaw),
  };
}

async function fetchMonthlyRowsAll(
  supabase: any,
  schema: string | undefined
) {
  const monthlyRef = schema
    ? supabase.schema(schema).from("inventory_batches")
    : supabase.from("inventory_batches");

  const { salesColumn, stockColumn } = getInventoryConfig();
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;

  while (rows.length < MAX_ROWS) {
    const { data, error } = await excludeAllZeroRows(
      monthlyRef
        .select("*")
        .order("month", { ascending: false })
        .order("sku", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1),
      salesColumn,
      stockColumn
    );

    if (error) {
      throw new Error(`Failed to read inventory_monthly rows: ${error.message}`);
    }

    const chunk = (data || []) as Array<Record<string, unknown>>;
    rows.push(...chunk);

    if (chunk.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

function buildSkuBatchRowsFromMonthly(monthlyRows: Array<Record<string, unknown>>) {
  const bySkuBatch = new Map<
    string,
    {
      month: unknown;
      sku: string;
      batch: string;
      total_month_end_stock: number;
      total_month_in: number;
      total_month_out: number;
      total_month_sales: number;
      dataset_id: string | null;
      updated_at: string | null;
    }
  >();

  for (const row of monthlyRows) {
    const parsedMonth = parseMonth(row.month);
    if (!parsedMonth) continue;

    const sku = String(row.sku ?? "").trim();
    if (!sku) continue;

    const batchText = String(row.batch ?? "").trim() || "-";
    const key = `${parsedMonth}::${normalizeSku(sku)}::${batchText}`;
    const stock = Number(row.month_end_stock ?? row.month_end_inventory ?? 0) || 0;
    const inbound = Number(row.month_in ?? 0) || 0;
    const outbound = Number(row.month_out ?? 0) || 0;
    const sales = Number(row.month_sales ?? 0) || 0;

    const existing = bySkuBatch.get(key);
    if (!existing) {
      bySkuBatch.set(key, {
        month: parsedMonth,
        sku,
        batch: batchText,
        total_month_end_stock: stock,
        total_month_in: inbound,
        total_month_out: outbound,
        total_month_sales: sales,
        dataset_id: row.dataset_id != null ? String(row.dataset_id) : null,
        updated_at: row.updated_at != null ? String(row.updated_at) : null,
      });
      continue;
    }

    existing.total_month_end_stock += stock;
    existing.total_month_in += inbound;
    existing.total_month_out += outbound;
    existing.total_month_sales += sales;
  }

  return Array.from(bySkuBatch.values()).sort((a, b) => {
    const monthA = parseMonth(a.month) ?? "";
    const monthB = parseMonth(b.month) ?? "";
    if (monthA !== monthB) {
      return monthB.localeCompare(monthA);
    }
    const skuCmp = a.sku.localeCompare(b.sku);
    if (skuCmp !== 0) return skuCmp;
    return a.batch.localeCompare(b.batch);
  });
}

export async function GET(_req: NextRequest) {
  try {
    const { schema } = getInventoryConfig();
    const { supabase, source } = await getSupabaseForInventoryAll();

    const [safetyBySku, categoryBySku] = await Promise.all([
      loadSafetyStockMap(supabase, schema),
      loadCategoryMap(supabase, schema),
    ]);

    const { latestMonth } = await fetchLatestMonthFromInventoryMonthly(
      supabase,
      schema
    );

    if (!latestMonth) {
      return NextResponse.json({
        items: [],
        latestMonthUsed: null,
        dataScope: "ALL_MONTHS",
      });
    }

    const monthlyRows = await fetchMonthlyRowsAll(supabase, schema);

    const sourceRows = buildSkuBatchRowsFromMonthly(monthlyRows);

    const items = sourceRows.map((row) => {
      const model = String(row.sku ?? "").trim();
      const skuKey = normalizeSku(model);

      const stock = Number(row.total_month_end_stock ?? 0);
      const inbound = Number(row.total_month_in ?? 0);
      const outbound = Number(row.total_month_out ?? 0);
      const sales = Number(row.total_month_sales ?? 0);

      const resolvedSafetyStock =
        safetyBySku.has(skuKey) ? safetyBySku.get(skuKey)! : null;
      const resolvedCategory = categoryBySku.get(skuKey) ?? "-";
      const resolvedBatch = String(row.batch ?? "").trim() || "-";

      const status = computeInventoryStatus(stock, resolvedSafetyStock);
      const timeVal = row.month;

      return {
        id: `${model}-${resolvedBatch}-${timeVal || ""}`,
        month: parseMonth(timeVal),
        sku: model,
        total_month_end_stock: stock,
        total_month_in: inbound,
        total_month_out: outbound,
        total_month_sales: sales,
        dataset_id: row.dataset_id ?? null,
        updated_at: row.updated_at ?? null,
        model,
        batch: resolvedBatch,
        category: resolvedCategory,
        inbound,
        outbound,
        sales,
        currentBalance: stock,
        safetyStock: resolvedSafetyStock,
        time: timeVal ?? null,
        status,
      };
    });

    console.log("[api/inventory/all] loaded all-month rows", {
      source,
      schema: schema || "public",
      latestMonth,
      itemCount: items.length,
      monthlyRowCount: monthlyRows.length,
      safetyMappedSkuCount: safetyBySku.size,
      categoryMappedSkuCount: categoryBySku.size,
      dataSource: "inventory_monthly(all-month sku+batch)",
    });

    return NextResponse.json({
      items,
      latestMonthUsed: latestMonth,
      dataScope: "ALL_MONTHS",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[api/inventory/all] error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
