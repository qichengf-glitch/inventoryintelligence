import path from "path";
import { access, readFile, rm } from "fs/promises";

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

const TEMP_DIR = "/tmp/inventory-preprocess";
const DEFAULT_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "inventory-files";

export const runtime = "nodejs";

type CommitUploadBody = {
  tempFileId?: string;
  month?: string; // YYYY-MM
  originalFileName?: string;
  uploadedBy?: string;
};

type CleanedRow = {
  sku: string;
  batch: string;
  last_month_stock: number;
  month_in: number;
  month_out: number;
  month_sales: number;
  month_end_stock: number;
  note_value: number;
  remark: string;
};

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTempId(tempId: string) {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(tempId)) {
    throw new Error("Invalid temp file identifier");
  }
  return tempId;
}

function normalizeMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Invalid month format. Expected YYYY-MM");
  }
  return `${month}-01`;
}

async function assertNoSupabaseError(
  result: { error: { message: string } | null },
  context: string
) {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
}

function parseCleanedRows(csvBuffer: Buffer): CleanedRow[] {
  const workbook = XLSX.read(csvBuffer.toString("utf-8"), { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  return rows
    .map((row) => ({
      sku: String(row.sku ?? "").trim(),
      batch: String(row.batch ?? "").trim(),
      last_month_stock: toNumber(row.last_month_stock),
      month_in: toNumber(row.month_in),
      month_out: toNumber(row.month_out),
      month_sales: toNumber(row.month_sales),
      month_end_stock: toNumber(row.month_end_stock),
      note_value: toNumber(row.note_value),
      remark: String(row.remark ?? "").trim(),
    }))
    .filter((row) => row.sku.length > 0);
}

function chunk<T>(items: T[], size = 500) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CommitUploadBody;
    if (!body.tempFileId || !body.month) {
      return NextResponse.json({ error: "tempFileId and month are required" }, { status: 400 });
    }

    const tempFileId = normalizeTempId(body.tempFileId);
    const monthDate = normalizeMonth(body.month);

    const cleanedPath = path.join(TEMP_DIR, `${tempFileId}.cleaned.csv`);
    const rawPath = path.join(TEMP_DIR, `${tempFileId}.raw.csv`);

    await access(cleanedPath);
    const cleanedBuffer = await readFile(cleanedPath);
    const rows = parseCleanedRows(cleanedBuffer);

    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid cleaned rows found" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();

    const storagePath = `monthly/${body.month}.csv`;
    const uploadRes = await supabase.storage
      .from(DEFAULT_BUCKET)
      .upload(storagePath, cleanedBuffer, {
        contentType: "text/csv",
        upsert: true,
      });
    await assertNoSupabaseError(uploadRes, "Storage upload failed");

    // Option B: keep one dataset row per month.
    // Delete datasets first so FK cascade removes related inventory_monthly rows.
    const deleteDataset = await supabase.from("datasets").delete().eq("month", monthDate);
    await assertNoSupabaseError(deleteDataset, "Failed to delete previous datasets row");

    // Defensive cleanup in case legacy rows exist without proper cascade lineage.
    const deleteLegacyMonthly = await supabase
      .from("inventory_monthly")
      .delete()
      .eq("month", monthDate);
    await assertNoSupabaseError(deleteLegacyMonthly, "Failed to delete previous inventory_monthly rows");

    const datasetInsert = await supabase
      .from("datasets")
      .insert({
        month: monthDate,
        original_filename: body.originalFileName || `${tempFileId}.raw.csv`,
        cleaned_filename: `${body.month}.csv`,
        storage_path: storagePath,
        row_count: rows.length,
        uploaded_by: body.uploadedBy || null,
      })
      .select("id")
      .single();
    await assertNoSupabaseError(datasetInsert, "Failed to insert datasets row");
    if (!datasetInsert.data) {
      throw new Error("Failed to insert datasets row: missing inserted id");
    }

    const datasetId = datasetInsert.data.id;

    const monthlyRows = rows.map((row) => ({
      dataset_id: datasetId,
      month: monthDate,
      sku: row.sku,
      batch: row.batch,
      last_month_stock: row.last_month_stock,
      month_in: row.month_in,
      month_out: row.month_out,
      month_sales: row.month_sales,
      month_end_stock: row.month_end_stock,
      note_value: row.note_value,
      remark: row.remark || null,
    }));

    for (const part of chunk(monthlyRows, 500)) {
      const insertMonthly = await supabase.from("inventory_monthly").insert(part);
      await assertNoSupabaseError(insertMonthly, "Failed to insert inventory_monthly");
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

    for (const row of rows) {
      const key = `${monthDate}::${row.sku}`;
      const existing = summaryMap.get(key);

      if (!existing) {
        summaryMap.set(key, {
          month: monthDate,
          sku: row.sku,
          total_month_end_stock: row.month_end_stock,
          total_month_in: row.month_in,
          total_month_out: row.month_out,
          total_month_sales: row.month_sales,
          batch_count: row.batch ? 1 : 0,
          dataset_id: datasetId,
        });
      } else {
        existing.total_month_end_stock += row.month_end_stock;
        existing.total_month_in += row.month_in;
        existing.total_month_out += row.month_out;
        existing.total_month_sales += row.month_sales;
        existing.batch_count += row.batch ? 1 : 0;
      }
    }

    const deleteMonthSummary = await supabase
      .from("inventory_summary")
      .delete()
      .eq("month", monthDate);
    await assertNoSupabaseError(deleteMonthSummary, "Failed to delete previous inventory_summary rows");

    const summaryRows = Array.from(summaryMap.values());
    if (summaryRows.length > 0) {
      const upsertSummary = await supabase.from("inventory_summary").upsert(summaryRows, {
        onConflict: "month,sku",
      });
      await assertNoSupabaseError(upsertSummary, "Failed to upsert inventory_summary");
    }

    // Best-effort dashboard monthly aggregate for Home KPI/cards.
    let totalStock = 0;
    let outOfStockCount = 0;
    let normalStockCount = 0;

    for (const row of summaryRows) {
      const stock = toNumber(row.total_month_end_stock);
      totalStock += stock;
      if (stock <= 0) outOfStockCount += 1;
      else normalStockCount += 1;
    }

    const dashboardSummary = await supabase.from("dashboard_monthly_summary").upsert(
      {
        month: monthDate,
        sku_count: summaryRows.length,
        total_stock: Math.round(totalStock * 10000) / 10000,
        risk_sku_count: outOfStockCount,
        low_stock_count: 0,
        out_of_stock_count: outOfStockCount,
        over_stock_count: 0,
        normal_stock_count: normalStockCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "month" }
    );
    if (dashboardSummary.error) {
      if (dashboardSummary.error.code === "42P01" || dashboardSummary.error.code === "PGRST205") {
        console.warn("[api/commit-upload] dashboard_monthly_summary table missing; skipped");
      } else {
        console.warn("[api/commit-upload] dashboard_monthly_summary upsert warning:", dashboardSummary.error.message);
      }
    }

    await Promise.allSettled([rm(cleanedPath), rm(rawPath)]);

    return NextResponse.json({
      ok: true,
      month: body.month,
      storagePath,
      datasetId,
      rowCount: rows.length,
      summaryCount: summaryRows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Commit upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
