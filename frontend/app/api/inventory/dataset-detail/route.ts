import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month");

    if (!month) {
      return NextResponse.json({ error: "month parameter is required" }, { status: 400 });
    }

    const supabase = createSupabaseClient();
    const { schema, table, skuColumn, timeColumn, stockColumn } = getInventoryConfig();
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
        const rowMonth = parseMonth(row[timeColumn || "Time"]);
        return rowMonth && String(rowMonth).startsWith(month);
      })
      .map((row: any) => {
        const stock = Number(row[stockColumn] || row.month_end_stock || 0);
        const safetyStock = Number(row.safety_stock || 0);
        
        let itemStatus: "Normal" | "Low" | "Out" = "Normal";
        if (stock <= 0) {
          itemStatus = "Out";
        } else if (safetyStock > 0 && stock < safetyStock) {
          itemStatus = "Low";
        }

        return {
          id: `${row[skuColumn] || row.SKU}-${row.batch || ""}-${row[timeColumn] || row.Time || ""}`,
          model: String(row[skuColumn] || row.SKU || ""),
          batch: String(row.batch || ""),
          category: String(row.category || ""),
          currentBalance: stock,
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
