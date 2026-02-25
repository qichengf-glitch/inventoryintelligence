import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";
import { createSupabaseClient } from "@/lib/supabaseClient";
import {
  getStockStatusBreakdown,
  type DashboardSkuSnapshot,
  type StockStatusBreakdown,
} from "@/lib/dashboard/getStockStatusBreakdown";

const PAGE_SIZE = 1000;
const MAX_ROWS = 12000;

export type DashboardKpi = {
  id: "kpi_1" | "kpi_2" | "kpi_3" | "kpi_4";
  title: string;
  value: number;
  delta: number | null;
  deltaType: "percent" | "number";
  subtext?: string;
};

export type DashboardSummary = {
  generatedAt: string;
  latestMonth: string | null;
  previousMonth: string | null;
  kpis: DashboardKpi[];
  stockStatus: StockStatusBreakdown;
  meta: {
    sampledRows: number;
    truncated: boolean;
  };
};

type RawInventoryRow = Record<string, unknown>;

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

function readNumber(row: RawInventoryRow, columns: string[]) {
  for (const column of columns) {
    if (!column) continue;
    const candidate = row[column];
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function readNullableNumber(row: RawInventoryRow, columns: string[]) {
  for (const column of columns) {
    if (!column) continue;
    const candidate = row[column];
    if (candidate == null || candidate === "") continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function readSku(row: RawInventoryRow, skuColumn: string) {
  const candidates = [skuColumn, "SKU", "sku", "Model", "model"];
  for (const key of candidates) {
    const value = row[key];
    if (value == null) continue;
    const sku = String(value).trim();
    if (sku) return sku;
  }
  return "";
}

function toSnapshot(
  row: RawInventoryRow,
  skuColumn: string,
  timeColumn: string,
  stockColumn: string,
  salesColumn: string
): DashboardSkuSnapshot | null {
  const sku = readSku(row, skuColumn);
  if (!sku) return null;

  const month = parseMonth(row[timeColumn] ?? row.Time ?? row.time ?? row.month ?? row.Month);
  if (!month) return null;

  return {
    sku,
    month,
    currentStock: readNumber(row, [stockColumn, "month_end_stock", "month_end_inventory"]),
    reorderPoint: readNullableNumber(row, ["reorder_point", "reorderPoint"]),
    safetyStock: readNullableNumber(row, ["safety_stock", "safetyStock"]),
    maxStock: readNullableNumber(row, ["max_stock", "maxStock"]),
    targetLevel: readNullableNumber(row, ["target_level", "target_stock", "targetLevel", "targetStock"]),
    sales: readNumber(row, [salesColumn, "month_sales"]),
    inbound: readNumber(row, ["month_in", "inbound"]),
    outbound: readNumber(row, ["month_out", "outbound"]),
  };
}

function calcPercentDelta(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  return Math.round(delta * 10) / 10;
}

function calcNumberDelta(current: number, previous: number) {
  return current - previous;
}

function sumBy(snapshots: DashboardSkuSnapshot[], key: keyof DashboardSkuSnapshot) {
  return snapshots.reduce((total, item) => {
    const value = item[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return total;
    }
    return total + value;
  }, 0);
}

function buildEmptySummary(): DashboardSummary {
  const emptyStatus = getStockStatusBreakdown([]);
  return {
    generatedAt: new Date().toISOString(),
    latestMonth: null,
    previousMonth: null,
    kpis: [
      {
        id: "kpi_1",
        title: "Total SKUs",
        value: 0,
        delta: null,
        deltaType: "percent",
        subtext: "Latest month",
      },
      {
        id: "kpi_2",
        title: "At Risk SKUs",
        value: 0,
        delta: null,
        deltaType: "number",
        subtext: "Low + Out of stock",
      },
      {
        id: "kpi_3",
        title: "Current Stock Units",
        value: 0,
        delta: null,
        deltaType: "percent",
        subtext: "Sum of latest stock",
      },
      {
        id: "kpi_4",
        title: "Monthly Sales",
        value: 0,
        delta: null,
        deltaType: "percent",
        subtext: "Sum of latest sales",
      },
    ],
    stockStatus: emptyStatus,
    meta: {
      sampledRows: 0,
      truncated: false,
    },
  };
}

function buildKpis(
  latestMonth: string | null,
  previousMonth: string | null,
  latestSnapshots: DashboardSkuSnapshot[],
  previousSnapshots: DashboardSkuSnapshot[],
  latestBreakdown: StockStatusBreakdown,
  previousBreakdown: StockStatusBreakdown
): DashboardKpi[] {
  const latestSkuCount = latestSnapshots.length;
  const previousSkuCount = previousSnapshots.length;

  const latestRiskCount =
    latestBreakdown.counts.low_stock + latestBreakdown.counts.out_of_stock;
  const previousRiskCount =
    previousBreakdown.counts.low_stock + previousBreakdown.counts.out_of_stock;

  const latestStock = sumBy(latestSnapshots, "currentStock");
  const previousStock = sumBy(previousSnapshots, "currentStock");

  const latestSales = sumBy(latestSnapshots, "sales");
  const previousSales = sumBy(previousSnapshots, "sales");

  return [
    {
      id: "kpi_1",
      title: "Total SKUs",
      value: latestSkuCount,
      delta: calcPercentDelta(latestSkuCount, previousSkuCount),
      deltaType: "percent",
      subtext: latestMonth ? `Latest month ${latestMonth}` : "Latest month",
    },
    {
      id: "kpi_2",
      title: "At Risk SKUs",
      value: latestRiskCount,
      delta: calcNumberDelta(latestRiskCount, previousRiskCount),
      deltaType: "number",
      subtext: "Low + Out of stock",
    },
    {
      id: "kpi_3",
      title: "Current Stock Units",
      value: latestStock,
      delta: calcPercentDelta(latestStock, previousStock),
      deltaType: "percent",
      subtext: previousMonth ? `vs ${previousMonth}` : "Latest snapshot",
    },
    {
      id: "kpi_4",
      title: "Monthly Sales",
      value: latestSales,
      delta: calcPercentDelta(latestSales, previousSales),
      deltaType: "percent",
      subtext: latestMonth ? `In ${latestMonth}` : "Latest month",
    },
  ];
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const fallback = buildEmptySummary();

  try {
    const supabase = createSupabaseClient();
    const { schema, table, skuColumn, timeColumn, stockColumn, salesColumn } =
      getInventoryConfig();
    const timeKey = timeColumn || "Time";
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);

    const rows: RawInventoryRow[] = [];
    let offset = 0;

    while (rows.length < MAX_ROWS) {
      const { data, error } = await tableRef
        .select(buildSelect(["*"]))
        .order(timeKey, { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw new Error(error.message);
      }

      const chunk = (data || []) as unknown as RawInventoryRow[];
      rows.push(...chunk);

      if (chunk.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (rows.length === 0) {
      return {
        ...fallback,
        meta: {
          sampledRows: 0,
          truncated: false,
        },
      };
    }

    const monthBuckets = new Map<string, Map<string, DashboardSkuSnapshot>>();

    for (const row of rows) {
      const snapshot = toSnapshot(row, skuColumn, timeKey, stockColumn, salesColumn);
      if (!snapshot || !snapshot.month) continue;

      if (!monthBuckets.has(snapshot.month)) {
        monthBuckets.set(snapshot.month, new Map<string, DashboardSkuSnapshot>());
      }

      const monthMap = monthBuckets.get(snapshot.month);
      if (!monthMap) continue;

      if (!monthMap.has(snapshot.sku)) {
        monthMap.set(snapshot.sku, snapshot);
      }
    }

    const months = Array.from(monthBuckets.keys()).sort((a, b) => a.localeCompare(b));
    const latestMonth = months.length ? months[months.length - 1] : null;
    const previousMonth = months.length > 1 ? months[months.length - 2] : null;

    const latestSnapshots = latestMonth
      ? Array.from(monthBuckets.get(latestMonth)?.values() || [])
      : [];
    const previousSnapshots = previousMonth
      ? Array.from(monthBuckets.get(previousMonth)?.values() || [])
      : [];

    const latestBreakdown = getStockStatusBreakdown(latestSnapshots);
    const previousBreakdown = getStockStatusBreakdown(previousSnapshots);

    return {
      generatedAt: new Date().toISOString(),
      latestMonth,
      previousMonth,
      kpis: buildKpis(
        latestMonth,
        previousMonth,
        latestSnapshots,
        previousSnapshots,
        latestBreakdown,
        previousBreakdown
      ),
      stockStatus: latestBreakdown,
      meta: {
        sampledRows: rows.length,
        truncated: rows.length >= MAX_ROWS,
      },
    };
  } catch {
    return fallback;
  }
}
