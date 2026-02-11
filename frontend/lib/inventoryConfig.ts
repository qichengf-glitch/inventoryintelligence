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
  return {
    schema: normalize(process.env.INVENTORY_SCHEMA),
    table: normalize(process.env.INVENTORY_TABLE) ?? "summary",
    skuColumn: normalize(process.env.INVENTORY_SKU_COLUMN) ?? "SKU",
    monthColumn: normalize(process.env.INVENTORY_MONTH_COLUMN),
    timeColumn: normalize(process.env.INVENTORY_TIME_COLUMN) ?? "Time",
    salesColumn: normalize(process.env.INVENTORY_SALES_COLUMN) ?? "month_sales",
    stockColumn: normalize(process.env.INVENTORY_STOCK_COLUMN) ?? "month_end_stock",
  };
}

export function buildSelect(columns: Array<string | undefined>) {
  return columns.filter(Boolean).join(", ");
}
