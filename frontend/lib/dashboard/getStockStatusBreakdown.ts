import { evaluateInventoryStatus } from "@/lib/inventoryStatus";

export type StockStatusKey =
  | "low_stock"
  | "out_of_stock"
  | "over_stock"
  | "normal_stock";

export type DashboardSkuSnapshot = {
  sku: string;
  currentStock: number;
  reorderPoint: number | null;
  safetyStock: number | null;
  maxStock: number | null;
  targetLevel: number | null;
  sales: number;
  inbound: number;
  outbound: number;
  month: string | null;
};

export type StockStatusBreakdown = {
  basis: "% of SKUs";
  totalSkus: number;
  counts: Record<StockStatusKey, number>;
  percentages: Record<StockStatusKey, number>;
};

const STATUS_KEYS: StockStatusKey[] = [
  "low_stock",
  "out_of_stock",
  "over_stock",
  "normal_stock",
];

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function createEmptyRecord(): Record<StockStatusKey, number> {
  return {
    low_stock: 0,
    out_of_stock: 0,
    over_stock: 0,
    normal_stock: 0,
  };
}

function normalizeThreshold(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

export function classifyStockStatus(snapshot: DashboardSkuSnapshot): StockStatusKey {
  const currentStock = Number.isFinite(snapshot.currentStock) ? snapshot.currentStock : 0;
  const safetyThreshold =
    normalizeThreshold(snapshot.reorderPoint) ?? normalizeThreshold(snapshot.safetyStock) ?? 0;
  const status = evaluateInventoryStatus(currentStock, safetyThreshold);

  if (status === "Out") return "out_of_stock";
  if (status === "Low") return "low_stock";
  if (status === "Normal") return "normal_stock";
  return "over_stock";
}

export function getStockStatusBreakdown(
  snapshots: DashboardSkuSnapshot[]
): StockStatusBreakdown {
  const counts = createEmptyRecord();

  for (const snapshot of snapshots) {
    const key = classifyStockStatus(snapshot);
    counts[key] += 1;
  }

  const totalSkus = snapshots.length;
  const percentages = createEmptyRecord();

  for (const key of STATUS_KEYS) {
    percentages[key] = totalSkus
      ? roundToOneDecimal((counts[key] / totalSkus) * 100)
      : 0;
  }

  return {
    basis: "% of SKUs",
    totalSkus,
    counts,
    percentages,
  };
}
