/**
 * POST /api/forecast/backtest/run
 * Runs a full rolling backtest with parameter optimisation for all SKUs.
 * Called by the Vercel cron job and the manual "Run Now" button.
 *
 * Query params:
 *   ?triggered_by=cron|manual   (default: manual)
 *   ?max_skus=N                  (default: unlimited — cron cap 500)
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";
import { excludeAllZeroRows } from "@/lib/inventory/zeroFilter";
import { backtestSku } from "@/lib/forecast/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow up to 5 min for large datasets
export const maxDuration = 300;

async function getSupabase() {
  try {
    return createSupabaseAdminClient();
  } catch {
    return createSupabaseClient();
  }
}

function parseMonth(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 7);
  if (typeof value === "number") {
    if (value >= 190001 && value <= 210012) {
      const s = String(Math.trunc(value));
      return s.length === 6 ? `${s.slice(0, 4)}-${s.slice(4, 6)}` : null;
    }
    if (value >= 19000101 && value <= 21001231) {
      const s = String(Math.trunc(value));
      return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}` : null;
    }
    return null;
  }
  if (typeof value === "string") {
    const t = value.trim().replace(/[年月]/g, "-").replace(/日/g, "").replace(/[./]/g, "-");
    const m = t.match(/(\d{4})-(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const startMs = Date.now();
  const { searchParams } = new URL(req.url);
  const triggeredBy = searchParams.get("triggered_by") === "cron" ? "cron" : "manual";
  const maxSkus = parseInt(searchParams.get("max_skus") ?? "0", 10) || (triggeredBy === "cron" ? 500 : 0);

  const supabase = await getSupabase();
  const { schema, table, skuColumn, timeColumn, salesColumn } = getInventoryConfig();

  // Create a run log entry
  const runId = crypto.randomUUID();
  const runDate = new Date().toISOString().slice(0, 10);

  const runLogRef = schema
    ? supabase.schema(schema).from("forecast_backtest_runs")
    : supabase.from("forecast_backtest_runs");

  await runLogRef.insert({
    id: runId,
    run_date: runDate,
    triggered_by: triggeredBy,
    status: "running",
  });

  try {
    // Fetch all inventory history
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
    const selectCols = buildSelect([skuColumn, timeColumn, salesColumn]);

    const pageSize = 2000;
    const allRows: Record<string, unknown>[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await excludeAllZeroRows(
        tableRef
          .select(selectCols)
          .order(timeColumn!, { ascending: true })
          .range(offset, offset + pageSize - 1),
        salesColumn,
        undefined
      );
      if (error) throw new Error(`Data fetch failed: ${error.message}`);
      const chunk = (data ?? []) as Record<string, unknown>[];
      allRows.push(...chunk);
      if (chunk.length < pageSize) break;
      offset += pageSize;
    }

    // Group by SKU → sorted monthly series
    const skuMonthMap = new Map<string, Map<string, number>>();
    for (const row of allRows) {
      const sku = String(row[skuColumn] ?? "").trim();
      if (!sku) continue;
      const month = parseMonth(row[timeColumn!]);
      if (!month) continue;
      const sales = Math.max(0, Number(row[salesColumn] ?? 0));
      if (!skuMonthMap.has(sku)) skuMonthMap.set(sku, new Map());
      const existing = skuMonthMap.get(sku)!;
      existing.set(month, (existing.get(month) ?? 0) + sales);
    }

    let skuList = Array.from(skuMonthMap.keys());
    if (maxSkus > 0) skuList = skuList.slice(0, maxSkus);

    // Run backtest for each SKU
    const backtestRows: object[] = [];
    const recommendRows: object[] = [];

    for (const sku of skuList) {
      const monthMap = skuMonthMap.get(sku)!;
      const series = Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v);

      if (series.length < 4) continue; // not enough data

      const summary = backtestSku(sku, series);

      // Store one row per model
      for (const r of summary.all) {
        backtestRows.push({
          run_id: runId,
          run_date: runDate,
          sku,
          model: r.model,
          best_alpha: r.params.alpha ?? null,
          best_beta: r.params.beta ?? null,
          best_gamma: r.params.gamma ?? null,
          mape: r.mape,
          mae: r.mae,
          bias: r.bias,
          sample_months: r.sampleMonths,
        });
      }

      // Store the recommendation
      const { best, runnerUp } = summary;
      recommendRows.push({
        sku,
        recommended_model: best.model,
        best_alpha: best.params.alpha ?? null,
        best_beta: best.params.beta ?? null,
        best_gamma: best.params.gamma ?? null,
        mape_at_recommendation: best.mape,
        mae_at_recommendation: best.mae,
        bias_at_recommendation: best.bias,
        sample_months: best.sampleMonths,
        runner_up_model: runnerUp?.model ?? null,
        runner_up_mape: runnerUp?.mape ?? null,
        last_run_date: runDate,
        last_run_id: runId,
        updated_at: new Date().toISOString(),
      });
    }

    // Bulk upsert results
    const resultsRef = schema
      ? supabase.schema(schema).from("forecast_backtest_results")
      : supabase.from("forecast_backtest_results");
    const recsRef = schema
      ? supabase.schema(schema).from("forecast_model_recommendations")
      : supabase.from("forecast_model_recommendations");

    // Insert in chunks of 500
    for (let i = 0; i < backtestRows.length; i += 500) {
      const { error } = await resultsRef.insert(backtestRows.slice(i, i + 500));
      if (error) console.error("[backtest/run] insert results error:", error.message);
    }
    for (let i = 0; i < recommendRows.length; i += 500) {
      const { error } = await recsRef.upsert(
        recommendRows.slice(i, i + 500) as any[],
        { onConflict: "sku" }
      );
      if (error) console.error("[backtest/run] upsert recommendations error:", error.message);
    }

    const durationMs = Date.now() - startMs;

    // Update run log as done
    await runLogRef.update({
      status: "done",
      skus_evaluated: skuList.length,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);

    return NextResponse.json({
      ok: true,
      runId,
      skusEvaluated: skuList.length,
      modelsStored: backtestRows.length,
      durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backtest failed";
    console.error("[backtest/run] error:", message);

    await runLogRef.update({
      status: "error",
      error_message: message,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
