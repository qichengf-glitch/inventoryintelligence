export type InventoryAnalysisStatus =
  | "UNMAINTAINED"
  | "OUT"
  | "LOW"
  | "NORMAL"
  | "HIGH"
  | "OVERSTOCK";

export type InventoryStatusRuleConfig = {
  overstockMultiplier?: number;
  includeHighStatus?: boolean;
  highMultiplier?: number;
};

const DEFAULT_OVERSTOCK_MULTIPLIER = 3;
const DEFAULT_HIGH_MULTIPLIER = 2;

export function normalizeSku(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function computeInventoryStatus(
  currentStockRaw: unknown,
  safetyStockRaw: unknown,
  config?: InventoryStatusRuleConfig
): InventoryAnalysisStatus {
  const currentStock = Number(currentStockRaw);
  const safetyStock = Number(safetyStockRaw);
  const overstockMultiplier =
    config?.overstockMultiplier && Number.isFinite(config.overstockMultiplier)
      ? config.overstockMultiplier
      : DEFAULT_OVERSTOCK_MULTIPLIER;
  const includeHighStatus = Boolean(config?.includeHighStatus);
  const highMultiplier =
    config?.highMultiplier && Number.isFinite(config.highMultiplier)
      ? config.highMultiplier
      : DEFAULT_HIGH_MULTIPLIER;

  if (!Number.isFinite(safetyStock) || safetyStock <= 0) return "UNMAINTAINED";
  if (!Number.isFinite(currentStock) || currentStock <= 0) return "OUT";
  if (currentStock < safetyStock) return "LOW";
  if (currentStock > safetyStock * overstockMultiplier) return "OVERSTOCK";
  if (includeHighStatus && currentStock > safetyStock * highMultiplier) return "HIGH";
  return "NORMAL";
}

