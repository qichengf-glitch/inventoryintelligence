/**
 * Rolling one-step-ahead backtest with parameter grid search.
 *
 * For each model, we do a walk-forward evaluation:
 *   - Train on series[0..t-1], predict series[t], compare to actual.
 *   - Repeat for t = minHistory .. n-1  (minimum 3 holdout periods).
 * We grid-search over alpha/beta/gamma to find the best parameters per SKU.
 */

import {
  type ModelKey,
  type ModelParams,
  ALL_MODEL_KEYS,
  runModel,
  modelMinHistory,
} from "@/lib/forecast/engine";

export type BacktestResult = {
  model: ModelKey;
  params: ModelParams;
  mape: number;  // 0-100 scale
  mae: number;
  bias: number;  // positive = over-forecast, negative = under-forecast
  sampleMonths: number;
};

export type SkuBacktestSummary = {
  sku: string;
  best: BacktestResult;
  runnerUp: BacktestResult | null;
  all: BacktestResult[];
};

// ---------- Metric helpers ----------

function calcMetrics(actuals: number[], preds: number[]): { mape: number; mae: number; bias: number } {
  const n = actuals.length;
  if (n === 0) return { mape: 999, mae: 0, bias: 0 };

  let sumAbsPct = 0;
  let sumAbsErr = 0;
  let sumErr = 0;
  let validPct = 0;

  for (let i = 0; i < n; i++) {
    const a = actuals[i];
    const p = preds[i];
    const err = p - a;
    sumAbsErr += Math.abs(err);
    sumErr += err;
    if (a > 0) {
      sumAbsPct += (Math.abs(err) / a) * 100;
      validPct++;
    }
  }

  return {
    mape: validPct > 0 ? sumAbsPct / validPct : 999,
    mae: sumAbsErr / n,
    bias: sumErr / n,
  };
}

// ---------- Parameter grids ----------

const ALPHA_GRID = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5];
const BETA_GRID  = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const GAMMA_GRID = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];

function paramGridFor(model: ModelKey): ModelParams[] {
  switch (model) {
    case "NAIVE":
    case "SNAIVE":
    case "SMA":
      return [{}]; // no tuneable parameters
    case "SES":
      return ALPHA_GRID.map((alpha) => ({ alpha }));
    case "HOLT":
      return ALPHA_GRID.flatMap((alpha) =>
        BETA_GRID.map((beta) => ({ alpha, beta }))
      );
    case "HW":
      // Reduced grid to keep runtime reasonable (3×3×4 = 36 combos)
      return [0.1, 0.2, 0.3].flatMap((alpha) =>
        [0.1, 0.2, 0.3].flatMap((beta) =>
          [0.1, 0.15, 0.2, 0.25].map((gamma) => ({ alpha, beta, gamma }))
        )
      );
  }
}

// ---------- Rolling evaluation for one model+params combo ----------

function rollingEval(
  series: number[],
  model: ModelKey,
  params: ModelParams,
  minHistory: number
): { actuals: number[]; preds: number[] } {
  const actuals: number[] = [];
  const preds: number[] = [];

  // Need at least minHistory training points + 1 holdout
  for (let t = minHistory; t < series.length; t++) {
    const trainSeries = series.slice(0, t);
    const pred = runModel(model, trainSeries, 1, params)[0] ?? 0;
    actuals.push(series[t]);
    preds.push(pred);
  }

  return { actuals, preds };
}

// ---------- Main backtest function for one SKU ----------

export function backtestSku(sku: string, series: number[]): SkuBacktestSummary {
  const allResults: BacktestResult[] = [];

  for (const model of ALL_MODEL_KEYS) {
    const minHistory = modelMinHistory(model);
    // Need at least 3 holdout periods to get meaningful metrics
    if (series.length < minHistory + 3) continue;

    const grid = paramGridFor(model);
    let bestForModel: BacktestResult | null = null;

    for (const params of grid) {
      const { actuals, preds } = rollingEval(series, model, params, minHistory);
      if (actuals.length < 3) continue;

      const { mape, mae, bias } = calcMetrics(actuals, preds);
      const result: BacktestResult = { model, params, mape, mae, bias, sampleMonths: actuals.length };

      if (!bestForModel || mape < bestForModel.mape) {
        bestForModel = result;
      }
    }

    if (bestForModel) {
      allResults.push(bestForModel);
    }
  }

  // Sort by MAPE ascending
  allResults.sort((a, b) => a.mape - b.mape);

  const best = allResults[0] ?? {
    model: "NAIVE" as ModelKey,
    params: {},
    mape: 999,
    mae: 0,
    bias: 0,
    sampleMonths: 0,
  };
  const runnerUp = allResults[1] ?? null;

  return { sku, best, runnerUp, all: allResults };
}
