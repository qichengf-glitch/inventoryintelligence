import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";
import { normalizeSku } from "@/lib/inventory/status";
import type { AlertItem, AlertsResponse, AlertStatus } from "@/lib/alerts/types";

export const DEFAULT_SAFETY_STOCK = 10;
export const DEFAULT_HIGH_STOCK = 200;

type InventoryAlertConfig = {
  schema?: string;
  inventoryTableName: string;
  skuCol: string;
  onHandCol: string;
  monthCol?: string;
};

type ResolvedMonthTarget = {
  month: string;
  filterValue: string | number;
};

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
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return null;
}

function getMonthStartAndNext(month: string) {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const mon = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(mon) || mon < 1 || mon > 12) return null;
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const next = new Date(Date.UTC(year, mon, 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    nextMonthDate: next.toISOString().slice(0, 10),
  };
}

function toInteger(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function classifyAlertStatus(onHand: number, safetyStock: number, highStock: number): AlertStatus | null {
  if (onHand <= 0) return "OOS";
  if (onHand > 0 && onHand <= safetyStock) return "LOW";
  if (onHand >= highStock) return "HIGH";
  return null;
}

function suggestedAction(status: AlertStatus) {
  if (status === "OOS") return "Replenish immediately to safety stock";
  if (status === "LOW") return "Replenish to safety stock";
  return "Hold replenishment / consider inventory reduction";
}

function sortForView(status: AlertStatus, items: AlertItem[]) {
  if (status === "HIGH") {
    return items.sort((a, b) => b.on_hand - a.on_hand || a.sku.localeCompare(b.sku));
  }
  return items.sort((a, b) => a.on_hand - b.on_hand || a.sku.localeCompare(b.sku));
}

function buildEmptyResponse(asOf: string): AlertsResponse {
  const now = new Date().toISOString();
  return {
    as_of: asOf,
    updated_at: now,
    counts: { oos: 0, low: 0, high: 0 },
    top10: { oos: [], low: [], high: [] },
    views: { oos: [], low: [], high: [] },
  };
}

async function resolveTargetMonth(
  supabase: any,
  config: InventoryAlertConfig,
  requestedMonth: string
): Promise<ResolvedMonthTarget | null> {
  if (!config.monthCol) return null;

  const tableRef = config.schema
    ? supabase.schema(config.schema).from(config.inventoryTableName)
    : supabase.from(config.inventoryTableName);

  if (requestedMonth !== "latest") {
    const parsed = parseMonth(requestedMonth);
    if (!parsed) return null;
    return { month: parsed, filterValue: requestedMonth };
  }

  const latestMonthRes = await tableRef
    .select(config.monthCol)
    .not(config.monthCol, "is", null)
    .order(config.monthCol, { ascending: false })
    .limit(100);

  if (latestMonthRes.error) {
    throw new Error(`Failed to resolve latest month: ${latestMonthRes.error.message}`);
  }

  const rows = (latestMonthRes.data || []) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const raw = row?.[config.monthCol];
    const parsed = parseMonth(raw);
    const filterValue = toMonthFilterValue(raw);
    if (!parsed || filterValue == null) continue;
    return { month: parsed, filterValue };
  }

  return null;
}

async function fetchInventoryRows(
  supabase: any,
  config: InventoryAlertConfig,
  month: string,
  filterValue: string | number
) {
  const tableRef = config.schema
    ? supabase.schema(config.schema).from(config.inventoryTableName)
    : supabase.from(config.inventoryTableName);

  const baseSelect = buildSelect([config.skuCol, config.onHandCol, config.monthCol]);
  let queryRes = await tableRef.select(baseSelect).eq(config.monthCol as string, filterValue);

  if (!queryRes.error && ((queryRes.data as Array<Record<string, unknown>> | null) ?? []).length === 0) {
    const bounds = getMonthStartAndNext(month);
    if (bounds) {
      queryRes = await tableRef
        .select(baseSelect)
        .gte(config.monthCol as string, bounds.startDate)
        .lt(config.monthCol as string, bounds.nextMonthDate);
    }
  }

  if (queryRes.error) {
    throw new Error(`Failed to read inventory rows: ${queryRes.error.message}`);
  }

  return (queryRes.data || []) as Array<Record<string, unknown>>;
}

function filterRowsByParsedMonth(
  rows: Array<Record<string, unknown>>,
  monthCol: string,
  targetMonth: string
) {
  return rows.filter((row) => parseMonth(row?.[monthCol]) === targetMonth);
}

function toSafeThresholdValue(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function isMissingThresholdTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
}

export function resolveInventoryAlertConfig(): InventoryAlertConfig {
  const inventory = getInventoryConfig();
  return {
    schema: inventory.schema,
    inventoryTableName: inventory.table,
    skuCol: inventory.skuColumn,
    onHandCol: inventory.stockColumn,
    monthCol: inventory.timeColumn ?? inventory.monthColumn,
  };
}

export async function computeAlertsSnapshot(
  supabase: any,
  options?: {
    month?: string;
    config?: InventoryAlertConfig;
  }
): Promise<AlertsResponse> {
  const config = options?.config ?? resolveInventoryAlertConfig();
  const month = (options?.month || "latest").trim() || "latest";
  const asOf = month === "latest" ? "latest" : month;

  if (!config.monthCol) {
    throw new Error("Alerts requires a month/time column and must be scoped to the latest month.");
  }

  const thresholdsRef = config.schema
    ? supabase.schema(config.schema).from("sku_thresholds")
    : supabase.from("sku_thresholds");

  const monthTarget = await resolveTargetMonth(supabase, config, month);

  if (!monthTarget) {
    return buildEmptyResponse(asOf);
  }

  let inventoryRows = await fetchInventoryRows(
    supabase,
    config,
    monthTarget.month,
    monthTarget.filterValue
  );
  inventoryRows = filterRowsByParsedMonth(inventoryRows, config.monthCol, monthTarget.month);

  if (!inventoryRows.length) {
    return buildEmptyResponse(monthTarget.month);
  }

  const thresholdsRes = await thresholdsRef.select("sku,safety_stock,high_stock");
  if (thresholdsRes.error && !isMissingThresholdTableError(thresholdsRes.error)) {
    throw new Error(`Failed to read sku thresholds: ${thresholdsRes.error.message}`);
  }

  const thresholdMap = new Map<
    string,
    { safety_stock: number; high_stock: number }
  >();
  if (thresholdsRes.error && isMissingThresholdTableError(thresholdsRes.error)) {
    console.warn("[alerts] sku_thresholds table is missing; using default thresholds.");
  }

  for (const row of ((thresholdsRes.data || []) as Array<Record<string, unknown>>)) {
    const rawSku = String(row.sku ?? "").trim();
    if (!rawSku) continue;
    const key = normalizeSku(rawSku);
    thresholdMap.set(key, {
      safety_stock: toSafeThresholdValue(row.safety_stock, DEFAULT_SAFETY_STOCK),
      high_stock: toSafeThresholdValue(row.high_stock, DEFAULT_HIGH_STOCK),
    });
  }

  const stockBySku = new Map<string, { sku: string; on_hand: number }>();
  for (const row of inventoryRows) {
    const skuRaw = String(row?.[config.skuCol] ?? "").trim();
    if (!skuRaw) continue;
    const skuKey = normalizeSku(skuRaw);
    const onHand = toInteger(row?.[config.onHandCol], 0);
    const existing = stockBySku.get(skuKey);
    if (!existing) {
      stockBySku.set(skuKey, { sku: skuRaw, on_hand: onHand });
      continue;
    }
    existing.on_hand += onHand;
  }

  const oos: AlertItem[] = [];
  const low: AlertItem[] = [];
  const high: AlertItem[] = [];

  for (const [skuKey, stock] of stockBySku.entries()) {
    const thresholds = thresholdMap.get(skuKey);
    const safetyStock = thresholds?.safety_stock ?? DEFAULT_SAFETY_STOCK;
    const highStock = thresholds?.high_stock ?? DEFAULT_HIGH_STOCK;
    const status = classifyAlertStatus(stock.on_hand, safetyStock, highStock);
    if (!status) continue;

    const item: AlertItem = {
      sku: stock.sku,
      on_hand: stock.on_hand,
      safety_stock: safetyStock,
      high_stock: highStock,
      status,
      suggested_action: suggestedAction(status),
      suggested_replenish_qty: Math.max(0, safetyStock - stock.on_hand),
    };

    if (status === "OOS") oos.push(item);
    else if (status === "LOW") low.push(item);
    else high.push(item);
  }

  const sortedOos = sortForView("OOS", oos);
  const sortedLow = sortForView("LOW", low);
  const sortedHigh = sortForView("HIGH", high);

  return {
    as_of: monthTarget.month || asOf,
    updated_at: new Date().toISOString(),
    counts: {
      oos: sortedOos.length,
      low: sortedLow.length,
      high: sortedHigh.length,
    },
    top10: {
      oos: sortedOos.slice(0, 10),
      low: sortedLow.slice(0, 10),
      high: sortedHigh.slice(0, 10),
    },
    views: {
      oos: sortedOos,
      low: sortedLow,
      high: sortedHigh,
    },
  };
}
