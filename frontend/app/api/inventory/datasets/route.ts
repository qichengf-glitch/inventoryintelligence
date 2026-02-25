import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export async function GET() {
  try {
    const supabase = createSupabaseClient();
    const { schema, table, timeColumn } = getInventoryConfig();
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

    // 获取所有数据
    const { data, error } = await tableRef
      .select(timeColumn || "Time")
      .order(timeColumn || "Time", { ascending: false });

    if (error) {
      console.error("[api/inventory/datasets] supabase error", { message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 按月份分组统计
    const monthMap = new Map<string, number>();
    (data || []).forEach((row: any) => {
      const month = parseMonth(row[timeColumn || "Time"]);
      if (month) {
        const monthStr = String(month).slice(0, 7); // YYYY-MM
        monthMap.set(monthStr, (monthMap.get(monthStr) || 0) + 1);
      }
    });

    // 转换为数据集格式
    const datasets = Array.from(monthMap.entries())
      .map(([month, count]) => ({
        fileName: `${month}-inventory-data`,
        uploadDate: `${month}-01 00:00:00`,
        rowCount: count,
        size: `${Math.round(count * 0.5)} KB`, // 估算大小
        month,
      }))
      .sort((a, b) => b.month.localeCompare(a.month));

    return NextResponse.json({ datasets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[api/inventory/datasets] error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
