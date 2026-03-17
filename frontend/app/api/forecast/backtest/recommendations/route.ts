/**
 * GET /api/forecast/backtest/recommendations
 *   ?sku=FWD100          → single SKU recommendation
 *   (no params)          → all recommendations
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getSupabase() {
  try {
    return createSupabaseAdminClient();
  } catch {
    return createSupabaseClient();
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku")?.trim() ?? "";

    const supabase = await getSupabase();
    const { schema } = getInventoryConfig();

    const tableRef = schema
      ? supabase.schema(schema).from("forecast_model_recommendations")
      : supabase.from("forecast_model_recommendations");

    let query = tableRef.select(
      "sku, recommended_model, best_alpha, best_beta, best_gamma, " +
      "mape_at_recommendation, mae_at_recommendation, bias_at_recommendation, " +
      "sample_months, runner_up_model, runner_up_mape, last_run_date, updated_at"
    );

    if (sku) {
      query = query.eq("sku", sku).limit(1);
    } else {
      query = query.order("updated_at", { ascending: false }).limit(2000);
    }

    const { data, error } = await query;
    if (error) {
      // Table may not exist yet (before first run)
      if (error.code === "42P01" || error.message.includes("does not exist")) {
        return NextResponse.json({ recommendations: [], noTableYet: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (sku) {
      return NextResponse.json({ recommendation: data?.[0] ?? null });
    }
    return NextResponse.json({ recommendations: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
