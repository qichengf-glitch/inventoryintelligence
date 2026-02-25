export type InventoryStatus =
  | "Normal"
  | "Low"
  | "Out"
  | "High"
  | "HighNearCritical"
  | "Overstock";

export function evaluateInventoryStatus(stockRaw: number, safetyStockRaw: number): InventoryStatus {
  const stock = Number.isFinite(stockRaw) ? Number(stockRaw) : 0;
  const safetyStock = Number.isFinite(safetyStockRaw) ? Number(safetyStockRaw) : 0;

  if (stock <= 0) return "Out";
  if (safetyStock <= 0) return "Normal";
  if (stock < safetyStock) return "Low";
  if (stock >= safetyStock * 3) return "Overstock";
  if (stock >= safetyStock * 2.75) return "HighNearCritical";
  if (stock > safetyStock * 1.1) return "High";
  return "Normal";
}
