/**
 * GET /api/forecast/ml?sku=FWD100&version=lgbm-v1
 *
 * 返回 LightGBM 全局模型对指定 SKU 的月度预测结果及回测误差指标。
 * 数据来源：ml_forecast_results 表（由 scripts/ml_forecast/train.py 写入）
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku     = searchParams.get("sku")?.trim() ?? "";
    const version = searchParams.get("version")?.trim() || null; // null = 最新版本

    if (!sku) {
      return NextResponse.json({ error: "sku is required" }, { status: 400 });
    }

    const supabase = createSupabaseClient();

    // 若未指定版本，先查最新版本号
    let targetVersion = version;
    if (!targetVersion) {
      const { data: versionRow, error: vErr } = await supabase
        .from("ml_forecast_results")
        .select("model_version, trained_at")
        .eq("sku", sku)
        .order("trained_at", { ascending: false })
        .limit(1)
        .single();

      if (vErr || !versionRow) {
        // 表可能还没数据（训练脚本未运行）
        return NextResponse.json({
          sku,
          predictions: [],
          metrics: null,
          model_version: null,
          trained_at: null,
          message: "暂无 ML 预测数据，请先运行 scripts/ml_forecast/train.py",
        });
      }
      targetVersion = versionRow.model_version;
    }

    // 读取该 SKU 在目标版本的所有预测行
    const { data, error } = await supabase
      .from("ml_forecast_results")
      .select("target_month, predicted_qty, mae, rmse, mape, model_version, trained_at")
      .eq("sku", sku)
      .eq("model_version", targetVersion)
      .order("target_month", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({
        sku,
        predictions: [],
        metrics: null,
        model_version: targetVersion,
        trained_at: null,
        message: "该 SKU 暂无预测记录",
      });
    }

    // 格式化预测序列（与 /api/inventory/demand 的 series 格式保持一致）
    const predictions = data.map((row) => ({
      t: `${row.target_month}-01`,       // '2025-12-01'
      y: Number(row.predicted_qty ?? 0),
    }));

    // 误差指标取第一行（同 SKU+版本 的 mae/rmse/mape 相同）
    const first = data[0];
    const metrics = {
      mae:  first.mae  != null ? Number(first.mae)  : null,
      rmse: first.rmse != null ? Number(first.rmse) : null,
      mape: first.mape != null ? Number(first.mape) : null, // 0.12 = 12%
    };

    return NextResponse.json({
      sku,
      predictions,
      metrics,
      model_version: first.model_version,
      trained_at:    first.trained_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
