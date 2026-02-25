import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";
import { evaluateInventoryStatus } from "@/lib/inventoryStatus";

export async function GET(_req: NextRequest) {
  try {
    const supabase = createSupabaseClient();
    const { schema, table, skuColumn, timeColumn, stockColumn, salesColumn } = getInventoryConfig();
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);

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

    const { data, error } = await tableRef
      .select(buildSelect(["*"]))
      .order(timeColumn || "Time", { ascending: false })
      .order(skuColumn, { ascending: true });

    if (error) {
      console.error("[api/inventory/all] supabase error", { message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = (data || []).map((row: any) => {
      const stock = Number(row[stockColumn] ?? row.month_end_stock ?? row.month_end_inventory ?? 0);
      const safetyStock = Number(row.safety_stock ?? 0);
      const itemStatus = evaluateInventoryStatus(stock, safetyStock);

      const timeVal = row[timeColumn || "Time"];
      return {
        id: `${row[skuColumn] || row.SKU}-${row.batch || ""}-${timeVal || ""}`,
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
        time: timeVal ?? null,
        month: parseMonth(timeVal),
        status: itemStatus,
        raw: row,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[api/inventory/all] error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
