import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getInventoryConfig } from "@/lib/inventoryConfig";

type UploadRow = Record<string, unknown>;

type MonthlyRow = {
  month: string;
  sku: string;
  batch: string | null;
  last_month_stock: number;
  month_in: number;
  month_out: number;
  month_sales: number;
  month_end_stock: number;
  note_value: number;
  remark: string | null;
};

function normalizeMonth(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text
    .replace(/[年月]/g, "-")
    .replace(/日/g, "")
    .replace(/[./]/g, "-");
  const match = normalized.match(/(\d{4})-(\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}`;
}

function extractMonthFromFileName(name: string): string | null {
  const normalizedName = String(name ?? "").trim();
  if (!normalizedName) return null;
  const match = normalizedName.match(/(\d{4})\D{0,6}(\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}`;
}

function toMonthDate(month: string): string {
  return `${month}-01`;
}

function toNumber(value: unknown): number {
  if (value == null || value === "" || value === "-") return 0;
  const n = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text === "-") return null;
  return text;
}

function chunk<T>(items: T[], size = 500) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function hasUsableSku(sku: string): boolean {
  if (!sku) return false;
  const normalized = sku.trim();
  if (!normalized) return false;
  const hasAlnum = /[A-Za-z0-9]/.test(normalized);
  const hasChinese = /[\u4e00-\u9fff]/.test(normalized);
  if (hasChinese && !hasAlnum) return false;
  if (normalized === "型号" || normalized === "型" || normalized === "sku" || normalized === "SKU") {
    return false;
  }
  if (normalized.includes("合计") || normalized.toLowerCase().includes("total")) return false;
  return true;
}

async function deleteByFileName(
  getTable: (tableName: string) => any,
  originalFileName: string
): Promise<void> {
  const existing = await getTable("datasets")
    .select("id")
    .eq("original_filename", originalFileName);

  if (existing.error) {
    throw new Error(`Failed to query existing datasets by file name: ${existing.error.message}`);
  }

  const datasetIds = (existing.data || [])
    .map((row: { id?: string }) => row.id)
    .filter((id: string | undefined): id is string => Boolean(id));

  if (datasetIds.length === 0) return;

  // inventory_summary uses ON DELETE SET NULL; remove old summary rows explicitly for exact overwrite semantics.
  const summaryDelete = await getTable("inventory_summary").delete().in("dataset_id", datasetIds);
  if (summaryDelete.error) {
    throw new Error(`Failed to delete previous inventory_summary rows by file name: ${summaryDelete.error.message}`);
  }

  const monthlyDelete = await getTable("inventory_monthly").delete().in("dataset_id", datasetIds);
  if (monthlyDelete.error) {
    throw new Error(`Failed to delete previous inventory_monthly rows by file name: ${monthlyDelete.error.message}`);
  }

  const datasetDelete = await getTable("datasets").delete().in("id", datasetIds);
  if (datasetDelete.error) {
    throw new Error(`Failed to delete previous datasets rows by file name: ${datasetDelete.error.message}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rows, fileName } = body as { rows?: UploadRow[]; fileName?: string };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No data to save" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const { schema } = getInventoryConfig();
    const getTable = (tableName: string) =>
      schema ? supabase.schema(schema).from(tableName) : supabase.from(tableName);

    const normalizedFileName = String(fileName || "manual_upload.xlsx").trim() || "manual_upload.xlsx";

    // Same file name => hard overwrite old data before inserting the new version.
    await deleteByFileName(getTable, normalizedFileName);

    const defaultMonth =
      extractMonthFromFileName(normalizedFileName) || new Date().toISOString().slice(0, 7);

    const normalizedRows: MonthlyRow[] = rows
      .map((item) => {
        const sku = String(item.model ?? item.SKU ?? "").trim();
        const month = normalizeMonth(item.time) || defaultMonth;
        return {
          month: toMonthDate(month),
          sku,
          batch: toNullableText(item.batch),
          last_month_stock: toNumber(item.lastBalance),
          month_in: toNumber(item.inbound),
          month_out: toNumber(item.outbound),
          month_sales: toNumber(item.sales),
          month_end_stock: toNumber(item.currentBalance),
          note_value:
            item.noteValue !== undefined
              ? toNumber(item.noteValue)
              : toNumber(item.currentBalance),
          remark: toNullableText(item.remark),
        };
      })
      .filter((row) => hasUsableSku(row.sku));

    if (normalizedRows.length === 0) {
      return NextResponse.json({ error: "No valid rows to save after normalization" }, { status: 400 });
    }

    const rowsByMonth = new Map<string, MonthlyRow[]>();
    for (const row of normalizedRows) {
      const group = rowsByMonth.get(row.month) ?? [];
      group.push(row);
      rowsByMonth.set(row.month, group);
    }

    let insertedTotal = 0;
    for (const [monthDate, monthRows] of rowsByMonth.entries()) {
      console.log("[api/inventory/upload] saving month", monthDate, "rows", monthRows.length);

      const deleteDatasetRes = await getTable("datasets").delete().eq("month", monthDate);
      if (deleteDatasetRes.error) {
        throw new Error(`Failed to delete previous datasets row: ${deleteDatasetRes.error.message}`);
      }

      const deleteLegacyMonthlyRes = await getTable("inventory_monthly").delete().eq("month", monthDate);
      if (deleteLegacyMonthlyRes.error) {
        throw new Error(
          `Failed to delete previous inventory_monthly rows: ${deleteLegacyMonthlyRes.error.message}`
        );
      }

      const datasetInsertRes = await getTable("datasets")
        .insert({
          month: monthDate,
          original_filename: normalizedFileName,
          cleaned_filename: `${monthDate.slice(0, 7)}.manual.csv`,
          storage_path: `manual/${monthDate.slice(0, 7)}.manual.csv`,
          row_count: monthRows.length,
          uploaded_by: "inventory-page",
        })
        .select("id")
        .single();

      if (datasetInsertRes.error || !datasetInsertRes.data) {
        throw new Error(
          `Failed to insert datasets row: ${
            datasetInsertRes.error?.message ?? "missing inserted dataset id"
          }`
        );
      }

      const datasetId = datasetInsertRes.data.id as string;
      const monthlyInsertRows = monthRows.map((row) => ({
        dataset_id: datasetId,
        month: row.month,
        sku: row.sku,
        batch: row.batch,
        last_month_stock: row.last_month_stock,
        month_in: row.month_in,
        month_out: row.month_out,
        month_sales: row.month_sales,
        month_end_stock: row.month_end_stock,
        note_value: row.note_value,
        remark: row.remark,
      }));

      for (const part of chunk(monthlyInsertRows, 500)) {
        const insertMonthlyRes = await getTable("inventory_monthly").insert(part);
        if (insertMonthlyRes.error) {
          throw new Error(`Failed to insert inventory_monthly: ${insertMonthlyRes.error.message}`);
        }
      }

      const summaryMap = new Map<
        string,
        {
          month: string;
          sku: string;
          total_month_end_stock: number;
          total_month_in: number;
          total_month_out: number;
          total_month_sales: number;
          batch_count: number;
          dataset_id: string;
        }
      >();

      for (const row of monthRows) {
        const key = `${row.month}::${row.sku}`;
        const current = summaryMap.get(key);
        if (!current) {
          summaryMap.set(key, {
            month: row.month,
            sku: row.sku,
            total_month_end_stock: row.month_end_stock,
            total_month_in: row.month_in,
            total_month_out: row.month_out,
            total_month_sales: row.month_sales,
            batch_count: row.batch ? 1 : 0,
            dataset_id: datasetId,
          });
        } else {
          current.total_month_end_stock += row.month_end_stock;
          current.total_month_in += row.month_in;
          current.total_month_out += row.month_out;
          current.total_month_sales += row.month_sales;
          current.batch_count += row.batch ? 1 : 0;
        }
      }

      const deleteSummaryRes = await getTable("inventory_summary").delete().eq("month", monthDate);
      if (deleteSummaryRes.error) {
        throw new Error(`Failed to delete previous inventory_summary rows: ${deleteSummaryRes.error.message}`);
      }

      const summaryRows = Array.from(summaryMap.values());
      if (summaryRows.length > 0) {
        const upsertSummaryRes = await getTable("inventory_summary").upsert(summaryRows, {
          onConflict: "month,sku",
        });
        if (upsertSummaryRes.error) {
          throw new Error(`Failed to upsert inventory_summary: ${upsertSummaryRes.error.message}`);
        }
      }

      insertedTotal += monthRows.length;
    }

    return NextResponse.json({
      success: true,
      inserted: insertedTotal,
      total: normalizedRows.length,
      months: rowsByMonth.size,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[api/inventory/upload] error", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
