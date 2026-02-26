export type InventoryConfig = {
  schema?: string;
  table: string;
  skuColumn: string;
  monthColumn?: string;
  timeColumn?: string;
  salesColumn: string;
  stockColumn: string;
};

const normalize = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export function getInventoryConfig(): InventoryConfig {
  const rawTable = normalize(process.env.INVENTORY_TABLE);
  const resolvedTable =
    !rawTable || rawTable.toLowerCase() === "summary"
      ? "inventory_monthly"
      : rawTable;

  const rawSkuColumn = normalize(process.env.INVENTORY_SKU_COLUMN);
  const rawTimeColumn = normalize(process.env.INVENTORY_TIME_COLUMN);
  const rawMonthColumn = normalize(process.env.INVENTORY_MONTH_COLUMN);
  const rawSalesColumn = normalize(process.env.INVENTORY_SALES_COLUMN);
  const rawStockColumn = normalize(process.env.INVENTORY_STOCK_COLUMN);

  const monthlyMode = resolvedTable.toLowerCase() === "inventory_monthly";
  const skuColumn =
    monthlyMode && (!rawSkuColumn || rawSkuColumn.toLowerCase() === "sku")
      ? "sku"
      : rawSkuColumn ?? "sku";
  const timeColumn =
    monthlyMode &&
    (!rawTimeColumn ||
      rawTimeColumn.toLowerCase() === "time" ||
      rawTimeColumn.toLowerCase() === "month")
      ? "month"
      : rawTimeColumn ?? rawMonthColumn ?? "month";

  return {
    schema: normalize(process.env.INVENTORY_SCHEMA),
    table: resolvedTable,
    skuColumn,
    monthColumn: rawMonthColumn ?? timeColumn,
    timeColumn,
    salesColumn: rawSalesColumn ?? "month_sales",
    stockColumn: rawStockColumn ?? "month_end_stock",
  };
}

export function buildSelect(columns: Array<string | undefined>) {
  return columns.filter(Boolean).join(", ");
}
