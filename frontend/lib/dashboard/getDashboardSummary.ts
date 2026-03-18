import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";
import { excludeAllZeroRows } from "@/lib/inventory/zeroFilter";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  loadSkuReferenceData,
  normalizeSkuCode,
} from "@/lib/server/skuReferenceData";
import {
  getStockStatusBreakdown,
  type DashboardSkuSnapshot,
  type StockStatusKey,
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
type SupabaseLikeClient = any;
type DashboardMonthlySummaryRow = {
  month: string | Date;
  sku_count: number;
  total_stock: number;
  risk_sku_count: number;
  low_stock_count: number;
  out_of_stock_count: number;
  over_stock_count: number;
  normal_stock_count: number;
  updated_at?: string;
};

type StrictLatestMonthKpiTotals = {
  latestMonth: string | null;
  latestMonthRaw?: string | number | null;
  previousMonth: string | null;
  previousMonthRaw?: string | number | null;
  currentInventoryTotal: number;
  previousInventoryTotal: number | null;
  monthlySalesTotal: number;
  previousMonthlySalesTotal: number | null;
  currentInventoryDeltaPercent: number | null;
  monthlySalesDeltaPercent: number | null;
  sampledRows: number;
};

const STOCK_VALUE_FALLBACK_COLUMNS = [
  "month_end_stock",
  "month_end_inventory",
  "month_end_balance",
  "month_balance",
  "ending_inventory",
  "ending_stock",
  "current_balance",
  "本月结存",
];

const SALES_VALUE_FALLBACK_COLUMNS = [
  "month_sales",
  "total_month_sales",
  "monthly_sales",
  "sales",
  "本月销售",
];

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

function buildColumnCandidates(primaryColumn: string | undefined, fallbackColumns: string[]) {
  const candidates = [primaryColumn, ...fallbackColumns].filter(
    (value): value is string => Boolean(value && String(value).trim())
  );
  return Array.from(new Set(candidates));
}

function extractMissingColumnName(message: string) {
  if (!message) return null;
  const normalized = message.trim();
  const quotedMatch = normalized.match(/column\s+["`\[]?([a-zA-Z0-9_]+)["`\]]?\s+does not exist/i);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const qualifiedMatch = normalized.match(/column\s+[a-zA-Z0-9_]+\.(["`\[]?)([a-zA-Z0-9_]+)\1\s+does not exist/i);
  if (qualifiedMatch?.[2]) return qualifiedMatch[2];
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

function getMonthStartAndNext(latestMonth: string) {
  const [yearRaw, monthRaw] = latestMonth.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  const startDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const nextMonthDate =
    month === 12
      ? `${String(year + 1).padStart(4, "0")}-01-01`
      : `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;

  return {
    startDate,
    nextMonthDate,
  };
}

function resolveMonthTarget(rows: RawInventoryRow[]) {
  for (const row of rows) {
    const raw = row?.month;
    const parsed = parseMonth(raw);
    const filterValue = toMonthFilterValue(raw);
    if (!parsed || filterValue == null) continue;
    return {
      raw,
      month: parsed,
      filterValue,
    };
  }
  return null;
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
  salesColumn: string,
  safetyStockBySku: Map<string, number>
): DashboardSkuSnapshot | null {
  const sku = readSku(row, skuColumn);
  if (!sku) return null;

  const month = parseMonth(row[timeColumn] ?? row.Time ?? row.time ?? row.month ?? row.Month);
  if (!month) return null;

  const mappedSafetyStock = safetyStockBySku.get(normalizeSkuCode(sku));
  const rowSafetyStock = readNullableNumber(row, ["safety_stock", "safetyStock"]);
  const resolvedSafetyStock =
    mappedSafetyStock != null && Number.isFinite(mappedSafetyStock)
      ? mappedSafetyStock
      : rowSafetyStock;

  return {
    sku,
    month,
    currentStock: readNumber(row, [stockColumn, "month_end_stock", "month_end_inventory"]),
    reorderPoint: resolvedSafetyStock,
    safetyStock: resolvedSafetyStock,
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

function toFiniteNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildBreakdownFromRow(row: DashboardMonthlySummaryRow): StockStatusBreakdown {
  const counts: Record<StockStatusKey, number> = {
    low_stock: Math.max(0, Math.round(toFiniteNumber(row.low_stock_count))),
    out_of_stock: Math.max(0, Math.round(toFiniteNumber(row.out_of_stock_count))),
    over_stock: Math.max(0, Math.round(toFiniteNumber(row.over_stock_count))),
    normal_stock: Math.max(0, Math.round(toFiniteNumber(row.normal_stock_count))),
  };
  const totalSkus = Math.max(0, Math.round(toFiniteNumber(row.sku_count)));
  const toPct = (count: number) => (totalSkus > 0 ? Math.round(((count / totalSkus) * 100) * 10) / 10 : 0);
  return {
    basis: "% of SKUs",
    totalSkus,
    counts,
    percentages: {
      low_stock: toPct(counts.low_stock),
      out_of_stock: toPct(counts.out_of_stock),
      over_stock: toPct(counts.over_stock),
      normal_stock: toPct(counts.normal_stock),
    },
  };
}

function buildKpisFromSummaryRows(
  latestRow: DashboardMonthlySummaryRow,
  previousRow: DashboardMonthlySummaryRow | null,
  latestMonth: string,
  previousMonth: string | null
): DashboardKpi[] {
  const previousSkuCount = previousRow ? toFiniteNumber(previousRow.sku_count) : 0;
  const previousRiskCount = previousRow ? toFiniteNumber(previousRow.risk_sku_count) : 0;
  const previousStock = previousRow ? toFiniteNumber(previousRow.total_stock) : 0;
  const previousSales = previousRow ? toFiniteNumber((previousRow as any).total_sales ?? 0) : 0;
  const latestSales = toFiniteNumber((latestRow as any).total_sales ?? 0);

  return [
    {
      id: "kpi_1",
      title: "Total SKUs",
      value: toFiniteNumber(latestRow.sku_count),
      delta: calcPercentDelta(toFiniteNumber(latestRow.sku_count), previousSkuCount),
      deltaType: "percent",
      subtext: `Latest month ${latestMonth}`,
    },
    {
      id: "kpi_2",
      title: "At Risk SKUs",
      value: toFiniteNumber(latestRow.risk_sku_count),
      delta: calcNumberDelta(toFiniteNumber(latestRow.risk_sku_count), previousRiskCount),
      deltaType: "number",
      subtext: "Low + Out of stock",
    },
    {
      id: "kpi_3",
      title: "Current Stock Units",
      value: toFiniteNumber(latestRow.total_stock),
      delta: calcPercentDelta(toFiniteNumber(latestRow.total_stock), previousStock),
      deltaType: "percent",
      subtext: previousMonth ? `vs ${previousMonth}` : "Latest snapshot",
    },
    {
      id: "kpi_4",
      title: "Monthly Sales",
      value: latestSales,
      delta: calcPercentDelta(latestSales, previousSales),
      deltaType: "percent",
      subtext: `In ${latestMonth}`,
    },
  ];
}

async function tryReadSalesByMonthFromInventorySummary(
  supabase: SupabaseLikeClient,
  schema: string | undefined,
  months: string[]
) {
  const monthDates = months
    .filter(Boolean)
    .map((month) => `${month}-01`);
  if (monthDates.length === 0) {
    return new Map<string, number>();
  }

  const tableRef = schema
    ? supabase.schema(schema).from("inventory_summary")
    : supabase.from("inventory_summary");
  const { data, error } = await tableRef
    .select("month,total_month_sales")
    .in("month", monthDates);

  if (error) {
    console.warn("[dashboard/summary] failed to read inventory_summary sales:", error.message);
    return new Map<string, number>();
  }

  const salesByMonth = new Map<string, number>();
  for (const row of (data || []) as RawInventoryRow[]) {
    const month = parseMonth(row.month);
    if (!month) continue;
    const previous = salesByMonth.get(month) ?? 0;
    salesByMonth.set(month, previous + toFiniteNumber(row.total_month_sales));
  }

  return salesByMonth;
}

async function getSupabaseForDashboard() {
  try {
    const admin = createSupabaseAdminClient();
    return { supabase: admin, source: "admin" as const };
  } catch {
    return { supabase: createSupabaseClient(), source: "anon" as const };
  }
}

function buildEmptyStrictLatestMonthKpiTotals(): StrictLatestMonthKpiTotals {
  return {
    latestMonth: null,
    latestMonthRaw: null,
    previousMonth: null,
    previousMonthRaw: null,
    currentInventoryTotal: 0,
    previousInventoryTotal: null,
    monthlySalesTotal: 0,
    previousMonthlySalesTotal: null,
    currentInventoryDeltaPercent: null,
    monthlySalesDeltaPercent: null,
    sampledRows: 0,
  };
}

async function readStrictLatestMonthKpiTotals(
  supabase: SupabaseLikeClient,
  schema: string | undefined
): Promise<StrictLatestMonthKpiTotals> {
  const fallback = buildEmptyStrictLatestMonthKpiTotals();
  const { stockColumn, salesColumn } = getInventoryConfig();
  const stockCandidates = buildColumnCandidates(stockColumn, STOCK_VALUE_FALLBACK_COLUMNS);
  const salesCandidates = buildColumnCandidates(salesColumn, SALES_VALUE_FALLBACK_COLUMNS);
  const monthlyTableRef = () =>
    schema ? supabase.schema(schema).from("inventory_monthly") : supabase.from("inventory_monthly");

  const readMonthTotals = async (month: string, filterValue: string | number) => {
    const localStockCandidates = [...stockCandidates];
    const localSalesCandidates = [...salesCandidates];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const selectColumns = buildSelect([
        "month",
        ...localStockCandidates,
        ...localSalesCandidates,
      ]);
      let queryRes = await monthlyTableRef()
        .select(selectColumns)
        .eq("month", filterValue);

      // Fallback for month fields stored as timestamp/text where strict equality may miss same-month rows.
      if (!queryRes.error && ((queryRes.data as RawInventoryRow[] | null) ?? []).length === 0) {
        const bounds = getMonthStartAndNext(month);
        if (bounds) {
          queryRes = await monthlyTableRef()
            .select(selectColumns)
            .gte("month", bounds.startDate)
            .lt("month", bounds.nextMonthDate);
        }
      }

      if (queryRes.error) {
        const missing = extractMissingColumnName(queryRes.error.message);
        if (missing) {
          const stockIndex = localStockCandidates.indexOf(missing);
          if (stockIndex >= 0 && localStockCandidates.length > 1) {
            localStockCandidates.splice(stockIndex, 1);
            continue;
          }
          const salesIndex = localSalesCandidates.indexOf(missing);
          if (salesIndex >= 0 && localSalesCandidates.length > 1) {
            localSalesCandidates.splice(salesIndex, 1);
            continue;
          }
        }
        return { error: queryRes.error.message, rows: [] as RawInventoryRow[], stock: 0, sales: 0 };
      }

      const rows = (queryRes.data || []) as RawInventoryRow[];
      let stock = 0;
      let sales = 0;
      for (const row of rows) {
        stock += readNumber(row, localStockCandidates);
        sales += readNumber(row, localSalesCandidates);
      }
      return { error: null, rows, stock, sales };
    }

    // Final fallback: SELECT * and compute sums client-side so the KPIs are
    // never zeroed out just because explicit column names were not found.
    let fallbackRes = await monthlyTableRef().select("*").eq("month", filterValue);
    if (!fallbackRes.error && ((fallbackRes.data as RawInventoryRow[] | null) ?? []).length === 0) {
      const bounds = getMonthStartAndNext(month);
      if (bounds) {
        fallbackRes = await monthlyTableRef()
          .select("*")
          .gte("month", bounds.startDate)
          .lt("month", bounds.nextMonthDate);
      }
    }
    if (!fallbackRes.error) {
      const rows = (fallbackRes.data || []) as RawInventoryRow[];
      let stock = 0;
      let sales = 0;
      for (const row of rows) {
        stock += readNumber(row, stockCandidates);
        sales += readNumber(row, salesCandidates);
      }
      return { error: null, rows, stock, sales };
    }

    return { error: "Failed to query month totals after retrying missing columns", rows: [] as RawInventoryRow[], stock: 0, sales: 0 };
  };

  const latestMonthRes = await monthlyTableRef()
    .select("month")
    .not("month", "is", null)
    .order("month", { ascending: false })
    .limit(50);

  if (latestMonthRes.error) {
    if (latestMonthRes.error.code !== "42P01" && latestMonthRes.error.code !== "PGRST205") {
      console.warn(
        "[dashboard/summary] failed to read latest month from inventory_monthly:",
        latestMonthRes.error.message
      );
    }
    return fallback;
  }

  const latestMonthRows = (latestMonthRes.data || []) as RawInventoryRow[];
  if (latestMonthRows.length === 0) {
    return fallback;
  }

  const latestMonthTarget = resolveMonthTarget(latestMonthRows);
  if (!latestMonthTarget) {
    return fallback;
  }
  const latestMonth = latestMonthTarget.month;
  const latestMonthRaw = latestMonthTarget.raw;
  const monthFilterValue = latestMonthTarget.filterValue;

  const latestTotals = await readMonthTotals(latestMonth, monthFilterValue);
  if (latestTotals.error) {
    console.warn(
      "[dashboard/summary] failed to read latest-month rows from inventory_monthly:",
      latestTotals.error
    );
    return {
      ...fallback,
      latestMonth,
      latestMonthRaw: monthFilterValue,
    };
  }

  const rows = latestTotals.rows;
  const currentInventoryTotal = latestTotals.stock;
  const monthlySalesTotal = latestTotals.sales;

  let previousMonth: string | null = null;
  let previousMonthRaw: string | number | null = null;
  let previousInventoryTotal: number | null = null;
  let previousMonthlySalesTotal: number | null = null;

  const previousMonthRes = await monthlyTableRef()
    .select("month")
    .not("month", "is", null)
    .lt("month", monthFilterValue as any)
    .order("month", { ascending: false })
    .limit(50);

  if (previousMonthRes.error) {
    console.warn(
      "[dashboard/summary] failed to read previous month from inventory_monthly:",
      previousMonthRes.error.message
    );
  } else {
    const previousMonthRows = (previousMonthRes.data || []) as RawInventoryRow[];
    const previousMonthTarget = resolveMonthTarget(previousMonthRows);
    if (previousMonthTarget) {
      previousMonth = previousMonthTarget.month;
      previousMonthRaw = toMonthFilterValue(previousMonthTarget.raw);
      const previousTotals = await readMonthTotals(previousMonthTarget.month, previousMonthTarget.filterValue);
      if (previousTotals.error) {
        console.warn(
          "[dashboard/summary] failed to read previous-month rows from inventory_monthly:",
          previousTotals.error
        );
      } else {
        previousInventoryTotal = previousTotals.stock;
        previousMonthlySalesTotal = previousTotals.sales;
      }
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[dashboard/summary] strict latest-month totals month=${latestMonth} rows=${rows.length} current_inventory_total=${currentInventoryTotal} monthly_sales_total=${monthlySalesTotal}`
    );
  }

  return {
    latestMonth,
    latestMonthRaw: toMonthFilterValue(latestMonthRaw),
    previousMonth,
    previousMonthRaw,
    currentInventoryTotal,
    previousInventoryTotal,
    monthlySalesTotal,
    previousMonthlySalesTotal,
    currentInventoryDeltaPercent:
      previousInventoryTotal == null
        ? null
        : calcPercentDelta(currentInventoryTotal, previousInventoryTotal),
    monthlySalesDeltaPercent:
      previousMonthlySalesTotal == null
        ? null
        : calcPercentDelta(monthlySalesTotal, previousMonthlySalesTotal),
    sampledRows: rows.length,
  };
}

function applyStrictLatestMonthKpiTotals(
  summary: DashboardSummary,
  strictTotals: StrictLatestMonthKpiTotals
): DashboardSummary {
  // If strict latest-month query can't read usable rows, keep existing summary values
  // instead of overriding KPI values to 0.
  if (!strictTotals.latestMonth || strictTotals.sampledRows <= 0) {
    return {
      ...summary,
      latestMonth: strictTotals.latestMonth ?? summary.latestMonth,
    };
  }

  const kpis = summary.kpis.map((item) => {
    if (item.id === "kpi_3") {
      return {
        ...item,
        value: strictTotals.currentInventoryTotal,
        delta: strictTotals.currentInventoryDeltaPercent,
        subtext: strictTotals.previousMonth ? `vs ${strictTotals.previousMonth}` : item.subtext,
      };
    }
    if (item.id === "kpi_4") {
      return {
        ...item,
        value: strictTotals.monthlySalesTotal,
        delta: strictTotals.monthlySalesDeltaPercent,
        subtext: strictTotals.latestMonth ? `In ${strictTotals.latestMonth}` : item.subtext,
      };
    }
    return item;
  });

  return {
    ...summary,
    latestMonth: strictTotals.latestMonth ?? summary.latestMonth,
    kpis,
  };
}

async function tryReadPrecomputedDashboardSummary(
  supabase: SupabaseLikeClient,
  schema?: string
): Promise<DashboardSummary | null> {
  const tableRef = schema
    ? supabase.schema(schema).from("dashboard_monthly_summary")
    : supabase.from("dashboard_monthly_summary");
  const { data, error } = await tableRef
    .select("*")
    .order("month", { ascending: false })
    .limit(2);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      console.info("[dashboard/summary] dashboard_monthly_summary not found; fallback to live rows");
      return null;
    }
    console.warn("[dashboard/summary] failed to read dashboard_monthly_summary:", error.message);
    return null;
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.info("[dashboard/summary] dashboard_monthly_summary empty; fallback to live rows");
    return null;
  }

  const latestRow = data[0] as DashboardMonthlySummaryRow;
  const previousRow = (data[1] as DashboardMonthlySummaryRow | undefined) ?? null;
  const latestMonth = parseMonth(latestRow.month);
  const previousMonth = previousRow ? parseMonth(previousRow.month) : null;
  if (!latestMonth) return null;

  const latestBreakdown = buildBreakdownFromRow(latestRow);
  const kpis = buildKpisFromSummaryRows(
    latestRow,
    previousRow,
    latestMonth,
    previousMonth
  );

  const salesByMonth = await tryReadSalesByMonthFromInventorySummary(
    supabase,
    schema,
    [latestMonth, previousMonth ?? ""]
  );
  const latestSales = salesByMonth.get(latestMonth);
  if (typeof latestSales === "number") {
    const previousSales = previousMonth ? salesByMonth.get(previousMonth) ?? 0 : 0;
    const salesKpiIndex = kpis.findIndex((item) => item.id === "kpi_4");
    if (salesKpiIndex >= 0) {
      kpis[salesKpiIndex] = {
        ...kpis[salesKpiIndex],
        value: latestSales,
        delta: calcPercentDelta(latestSales, previousSales),
      };
    }
  }

  return {
    generatedAt: latestRow.updated_at ? String(latestRow.updated_at) : new Date().toISOString(),
    latestMonth,
    previousMonth,
    kpis,
    stockStatus: latestBreakdown,
    meta: {
      sampledRows: 0,
      truncated: false,
    },
  };
}

async function fetchRowsFromTable(
  tableRef: any,
  timeKey: string,
  salesCol: string = "month_sales",
  stockCol: string = "month_end_stock"
): Promise<RawInventoryRow[]> {
  const rows: RawInventoryRow[] = [];
  let offset = 0;

  while (rows.length < MAX_ROWS) {
    const { data, error } = await excludeAllZeroRows(
      tableRef
        .select(buildSelect(["*"]))
        .order(timeKey, { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
      salesCol,
      stockCol
    );

    if (error) {
      throw new Error(error.message);
    }

    const chunk = (data || []) as unknown as RawInventoryRow[];
    rows.push(...chunk);

    if (chunk.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

type DataSourceCandidate = {
  label: string;
  schema?: string;
  table: string;
  skuColumn: string;
  timeColumn: string;
  stockColumn: string;
  salesColumn: string;
};

type ResolvedDashboardRows = {
  rows: RawInventoryRow[];
  source: DataSourceCandidate;
  monthBuckets: Map<string, Map<string, DashboardSkuSnapshot>>;
};

function resolveSchemaAndTable(schema: string | undefined, table: string) {
  const rawTable = (table || "").trim();
  if (!rawTable.includes(".")) {
    return { schema, table: rawTable };
  }

  const parts = rawTable.split(".").filter(Boolean);
  if (parts.length < 2) {
    return { schema, table: rawTable };
  }

  return {
    schema: parts[0] || schema,
    table: parts[parts.length - 1] || rawTable,
  };
}

function buildSourceCandidates(): DataSourceCandidate[] {
  const { schema, table, skuColumn, timeColumn, stockColumn, salesColumn } = getInventoryConfig();
  const resolvedConfigured = resolveSchemaAndTable(schema, table);

  const candidates: DataSourceCandidate[] = [
    {
      label: "inventory_summary",
      schema,
      table: "inventory_summary",
      skuColumn: "sku",
      timeColumn: "month",
      stockColumn: "total_month_end_stock",
      salesColumn: "total_month_sales",
    },
    {
      label: "inventory_monthly",
      schema,
      table: "inventory_monthly",
      skuColumn: "sku",
      timeColumn: "month",
      stockColumn: "month_end_stock",
      salesColumn: "month_sales",
    },
    {
      label: "configured",
      schema: resolvedConfigured.schema,
      table: resolvedConfigured.table,
      skuColumn,
      timeColumn: timeColumn || "month",
      stockColumn,
      salesColumn,
    },
  ];

  const seen = new Set<string>();
  const deduped: DataSourceCandidate[] = [];
  for (const item of candidates) {
    const key = `${item.schema || "public"}::${item.table}::${item.timeColumn}::${item.stockColumn}::${item.salesColumn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

async function tryResolveRowsFromCandidates(
  supabase: SupabaseLikeClient,
  safetyStockBySku: Map<string, number>
): Promise<ResolvedDashboardRows | null> {
  const candidates = buildSourceCandidates();

  for (const candidate of candidates) {
    try {
      const tableRef = candidate.schema
        ? supabase.schema(candidate.schema).from(candidate.table)
        : supabase.from(candidate.table);
      const rows = await fetchRowsFromTable(tableRef, candidate.timeColumn, candidate.salesColumn, candidate.stockColumn);

      if (rows.length === 0) {
        console.info(
          `[dashboard/summary] ${candidate.label} source has zero rows: ${candidate.schema || "public"}.${candidate.table}`
        );
        continue;
      }

      const monthBuckets = buildMonthBuckets(
        rows,
        candidate.skuColumn,
        candidate.timeColumn,
        candidate.stockColumn,
        candidate.salesColumn,
        safetyStockBySku
      );

      if (monthBuckets.size === 0) {
        console.info(
          `[dashboard/summary] source rows found but no valid month buckets: ${candidate.schema || "public"}.${candidate.table}`
        );
        continue;
      }

      return { rows, source: candidate, monthBuckets };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[dashboard/summary] failed source ${candidate.schema || "public"}.${candidate.table}: ${message}`
      );
    }
  }

  return null;
}

function buildMonthBuckets(
  rows: RawInventoryRow[],
  skuColumn: string,
  timeKey: string,
  stockColumn: string,
  salesColumn: string,
  safetyStockBySku: Map<string, number>
) {
  const monthBuckets = new Map<string, Map<string, DashboardSkuSnapshot>>();

  for (const row of rows) {
    const snapshot = toSnapshot(
      row,
      skuColumn,
      timeKey,
      stockColumn,
      salesColumn,
      safetyStockBySku
    );
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

  return monthBuckets;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const fallback = buildEmptySummary();

  try {
    const { schema } = getInventoryConfig();
    const { supabase, source: clientSource } = await getSupabaseForDashboard();
    const strictTotals = await readStrictLatestMonthKpiTotals(supabase, schema);
    const skuRef = await loadSkuReferenceData();
    const safetyStockBySku = new Map<string, number>(
      Object.entries(skuRef.safetyStockBySku)
    );

    const resolved = await tryResolveRowsFromCandidates(supabase, safetyStockBySku);
    if (!resolved) {
      const precomputed = await tryReadPrecomputedDashboardSummary(supabase, schema);
      if (precomputed) {
        console.log(
          `[dashboard/summary] source=dashboard_monthly_summary(fallback) client=${clientSource} latest=${precomputed.latestMonth ?? "n/a"}`
        );
        return applyStrictLatestMonthKpiTotals(precomputed, strictTotals);
      }
      console.warn("[dashboard/summary] no valid data source found; returning empty summary");
      return applyStrictLatestMonthKpiTotals(fallback, strictTotals);
    }

    const { rows, source, monthBuckets } = resolved;

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

    console.log(
      `[dashboard/summary] source=${source.label}:${source.schema || "public"}.${source.table} client=${clientSource} rows=${rows.length} latest=${latestMonth ?? "n/a"}`
    );

    const summary: DashboardSummary = {
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
    return applyStrictLatestMonthKpiTotals(summary, strictTotals);
  } catch (error) {
    console.error("[dashboard/summary] failed:", error);
    return fallback;
  }
}
