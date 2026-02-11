import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rows, fileName } = body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No data to save" }, { status: 400 });
    }

    const supabase = createSupabaseClient();
    const { schema, table, skuColumn, timeColumn, salesColumn, stockColumn } = getInventoryConfig();
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);

    // 从文件名提取月份（如果可能）
    const extractMonthFromFileName = (name: string): string | null => {
      const match = name.match(/(\d{4})[_-]?(\d{1,2})/);
      if (match) {
        const year = match[1];
        const month = match[2].padStart(2, "0");
        return `${year}-${month}`;
      }
      return null;
    };

    const defaultTime = extractMonthFromFileName(fileName || "") || new Date().toISOString().slice(0, 7);

    // 辅助函数：清理数字值
    const cleanNumber = (val: any): number => {
      if (val == null || val === "" || val === "-") return 0;
      const num = typeof val === "string" ? parseFloat(val.replace(/,/g, "")) : Number(val);
      return Number.isFinite(num) ? num : 0;
    };

    // 辅助函数：清理 bigint 值（batch）
    const cleanBigInt = (val: any): number | null => {
      if (val == null || val === "" || val === "-") return null;
      const str = String(val).trim();
      if (!str || str === "-") return null;
      const num = parseInt(str.replace(/,/g, ""), 10);
      return Number.isFinite(num) ? num : null;
    };

    // 转换数据格式：从前端格式转换为数据库格式
    const dbRows = rows.map((item: any) => {
      const dbRow: any = {
        [skuColumn]: item.model || item.SKU || "",
        batch: cleanBigInt(item.batch),
        Last_Month_Stock: cleanNumber(item.lastBalance),
        month_in: cleanNumber(item.inbound),
        month_out: cleanNumber(item.outbound),
        [salesColumn]: cleanNumber(item.sales),
        [stockColumn]: cleanNumber(item.currentBalance),
        Note_value: item.noteValue !== undefined ? cleanNumber(item.noteValue) : cleanNumber(item.currentBalance),
        safety_stock: item.safetyStock != null && item.safetyStock !== "" && item.safetyStock !== "-" ? cleanNumber(item.safetyStock) : null,
        Location: item.location && item.location !== "-" ? String(item.location).trim() : null,
        month_end_inventory: item.monthEndInventory !== undefined ? cleanNumber(item.monthEndInventory) : cleanNumber(item.currentBalance),
        inventory_diff: cleanNumber(item.inventoryDiff),
        Remark: item.remark && item.remark !== "-" ? String(item.remark).trim() : null,
        [timeColumn]: item.time || defaultTime,
      };
      return dbRow;
    });

    // 批量插入
    const { data, error } = await tableRef.insert(dbRows).select();

    if (error) {
      console.error("[api/inventory/upload] supabase error", { schema, table, message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      inserted: data?.length || dbRows.length,
      total: dbRows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[api/inventory/upload] error", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
