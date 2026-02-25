import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";
import { evaluateInventoryStatus } from "@/lib/inventoryStatus";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month");

    if (!month) {
      return NextResponse.json({ error: "month parameter is required" }, { status: 400 });
    }

    const supabase = createSupabaseClient();
    const { schema, table, skuColumn, timeColumn, stockColumn, salesColumn } = getInventoryConfig();
    const timeKey = timeColumn || "Time";
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);

    // 解析月份字段
    const parseMonth = (value: unknown): string | null => {
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
        if (match) {
          const yyyy = match[1];
          const mm = match[2].padStart(2, "0");
          return `${yyyy}-${mm}`;
        }
        return null;
      }
      return null;
    };

    // 查询指定月份的所有数据
    const { data, error } = await tableRef
      .select(buildSelect(["*"]))
      .order(skuColumn, { ascending: true });

    if (error) {
      console.error("[api/inventory/dataset-detail] supabase error", { message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 过滤并转换数据格式
    const items = (data || [])
      .filter((row: any) => {
        const rowMonth = parseMonth(row[timeKey]);
        return rowMonth && String(rowMonth).startsWith(month);
      })
      .map((row: any) => {
        const stock = Number(row[stockColumn] ?? row.month_end_stock ?? row.month_end_inventory ?? 0);
        const safetyStock = Number(row.safety_stock ?? 0);
        const itemStatus = evaluateInventoryStatus(stock, safetyStock);

        return {
          id: `${row[skuColumn] || row.SKU}-${row.batch || ""}-${row[timeKey] || row.Time || ""}`,
          model: String(row[skuColumn] || row.SKU || ""),
          batch: row.batch != null ? String(row.batch) : "",
          category: row.category != null ? String(row.category) : "",
          lastBalance: Number(row.Last_Month_Stock ?? row.last_month_stock ?? 0),
          inbound: Number(row.month_in ?? 0),
          outbound: Number(row.month_out ?? 0),
          sales: Number(row[salesColumn] ?? row.month_sales ?? 0),
          currentBalance: stock,
          noteValue: row.Note_value != null ? Number(row.Note_value) : undefined,
          safetyStock: safetyStock,
          location: row.Location ?? row.location ?? null,
          monthEndCount: row.month_end_count != null ? Number(row.month_end_count) : undefined,
          monthEndInventory: row.month_end_inventory != null ? Number(row.month_end_inventory) : undefined,
          inventoryDiff: row.inventory_diff != null ? Number(row.inventory_diff) : undefined,
          remark: row.Remark ?? row.remark ?? null,
          time: row[timeKey] ?? null,
          status: itemStatus,
        };
      });

    return NextResponse.json({
      month,
      items,
      count: items.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[api/inventory/dataset-detail] error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
