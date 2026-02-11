"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

/** =========================
 * Types
 * ========================= */
export type TSPoint = { date: string; y: number };

type ModelKey = "SMA" | "SES" | "HOLT";

export type SKUAnalyticsInput = {
  sku: string;
  demand: TSPoint[]; // YYYY-MM-DD + demand
  currentStock: number;
  safetyStock: number;
  leadTimeDays: number;
};

/** =========================
 * Forecast utils (Integrated)
 * ========================= */
type ForecastResult = {
  fitted: TSPoint[];
  forecast: TSPoint[];
};

function clamp(x: number) {
  return Number.isFinite(x) ? x : 0;
}

function addDaysISO(isoDate: string, days: number) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function smaForecast(series: TSPoint[], window: number, horizon: number): ForecastResult {
  const n = series.length;
  if (n === 0) return { fitted: [], forecast: [] };
  const w = Math.max(1, Math.floor(window));

  const fitted: TSPoint[] = series.map((p, i) => {
    const start = Math.max(0, i - w + 1);
    const slice = series.slice(start, i + 1).map((s) => s.y);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    return { date: p.date, y: clamp(avg) };
  });

  const values = series.map((p) => p.y);
  const forecast: TSPoint[] = [];
  for (let k = 1; k <= horizon; k++) {
    const start = Math.max(0, values.length - w);
    const slice = values.slice(start);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    values.push(avg);
    forecast.push({ date: addDaysISO(series[n - 1].date, k), y: clamp(avg) });
  }

  return { fitted, forecast };
}

function sesForecast(series: TSPoint[], alpha: number, horizon: number): ForecastResult {
  const n = series.length;
  if (n === 0) return { fitted: [], forecast: [] };

  const a = Math.min(1, Math.max(0.01, alpha));
  let level = series[0].y;

  const fitted: TSPoint[] = series.map((p, i) => {
    const yhat = i === 0 ? series[0].y : level;
    level = a * p.y + (1 - a) * level;
    return { date: p.date, y: clamp(yhat) };
  });

  const forecast: TSPoint[] = [];
  for (let k = 1; k <= horizon; k++) {
    forecast.push({ date: addDaysISO(series[n - 1].date, k), y: clamp(level) });
  }

  return { fitted, forecast };
}

function holtForecast(series: TSPoint[], alpha: number, beta: number, horizon: number): ForecastResult {
  const n = series.length;
  if (n === 0) return { fitted: [], forecast: [] };

  const a = Math.min(1, Math.max(0.01, alpha));
  const b = Math.min(1, Math.max(0.01, beta));

  let level = series[0].y;
  let trend = n >= 2 ? series[1].y - series[0].y : 0;

  const fitted: TSPoint[] = series.map((p, i) => {
    const yhat = i === 0 ? p.y : level + trend;
    const prevLevel = level;
    level = a * p.y + (1 - a) * (level + trend);
    trend = b * (level - prevLevel) + (1 - b) * trend;
    return { date: p.date, y: clamp(yhat) };
  });

  const forecast: TSPoint[] = [];
  for (let k = 1; k <= horizon; k++) {
    forecast.push({ date: addDaysISO(series[n - 1].date, k), y: clamp(level + k * trend) });
  }

  return { fitted, forecast };
}

function mape(actual: number[], predicted: number[]) {
  const n = Math.min(actual.length, predicted.length);
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const a = actual[i];
    const p = predicted[i];
    if (a === 0) continue;
    sum += Math.abs((a - p) / a);
    cnt++;
  }
  return cnt === 0 ? 0 : (sum / cnt) * 100;
}

function biasMetric(actual: number[], predicted: number[]) {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += predicted[i] - actual[i];
  return sum / n; // >0 over-forecast
}

/** =========================
 * Component
 * ========================= */
export function AnalyticsPanel({ data }: { data: SKUAnalyticsInput }) {
  const [model, setModel] = useState<ModelKey>("HOLT");
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);

  // You can expose these as sliders later
  const alpha = 0.35;
  const beta = 0.2;
  const smaWindow = 7;

  const result = useMemo(() => {
    if (model === "SMA") return smaForecast(data.demand, smaWindow, horizon);
    if (model === "SES") return sesForecast(data.demand, alpha, horizon);
    return holtForecast(data.demand, alpha, beta, horizon);
  }, [model, horizon, data.demand]);

  const chartData = useMemo(() => {
    const actual = data.demand.map((p) => ({ date: p.date, actual: p.y }));
    const fitted = result.fitted.map((p) => ({ date: p.date, fitted: p.y }));
    const forecast = result.forecast.map((p) => ({ date: p.date, forecast: p.y }));

    const map = new Map<string, any>();
    for (const a of actual) map.set(a.date, { ...a });
    for (const f of fitted) map.set(f.date, { ...(map.get(f.date) ?? { date: f.date }), ...f });
    for (const fc of forecast) map.set(fc.date, { ...(map.get(fc.date) ?? { date: fc.date }), ...fc });

    return Array.from(map.values()).sort((x, y) => x.date.localeCompare(y.date));
  }, [data.demand, result.fitted, result.forecast]);

  const accuracy = useMemo(() => {
    const actual = data.demand.map((p) => p.y);
    const fitted = result.fitted.map((p) => p.y);
    const m = mape(actual, fitted);
    const b = biasMetric(actual, fitted);
    const label = m <= 15 ? "Reliable" : m <= 30 ? "Moderate" : "Volatile";
    return { mape: m, bias: b, label };
  }, [data.demand, result.fitted]);

  const snapshot = useMemo(() => {
    const lt = Math.max(1, Math.min(data.leadTimeDays, result.forecast.length));
    const demandLT = result.forecast.slice(0, lt).reduce((s, p) => s + p.y, 0);

    const reorderQty = Math.max(0, Math.ceil(demandLT + data.safetyStock - data.currentStock));

    let cum = 0;
    let stockoutDate: string | null = null;
    for (const p of result.forecast) {
      cum += p.y;
      if (cum >= data.currentStock) {
        stockoutDate = p.date;
        break;
      }
    }

    const risk =
      data.currentStock <= data.safetyStock ? "HIGH" : stockoutDate ? "MED" : "LOW";

    return {
      demandLT: Math.round(demandLT),
      reorderQty,
      stockoutDate,
      risk,
    };
  }, [data, result.forecast]);

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 p-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Forecast & Reorder</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            SKU: <span className="font-medium text-slate-800 dark:text-slate-100">{data.sku}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-xs text-slate-800 dark:text-slate-100"
            value={model}
            onChange={(e) => setModel(e.target.value as ModelKey)}
          >
            <option value="SMA">SMA</option>
            <option value="SES">SES</option>
            <option value="HOLT">Holt</option>
          </select>

          <select
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-xs text-slate-800 dark:text-slate-100"
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value) as 30 | 60 | 90)}
          >
            <option value={30}>30d</option>
            <option value={60}>60d</option>
            <option value={90}>90d</option>
          </select>
        </div>
      </div>

      {/* Snapshot */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatCard title="Lead Time Forecast" value={`${snapshot.demandLT}`} sub="units" />
        <StatCard title="Reorder Qty" value={`${snapshot.reorderQty}`} sub="suggested" />
        <StatCard title="Projected Stockout" value={snapshot.stockoutDate ?? "—"} sub="date" />
        <StatCard title="Risk" value={snapshot.risk} sub={accuracy.label} />
      </div>

      {/* Chart */}
      <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
        <div className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-200">Demand Forecast</div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" hide />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="actual" dot={false} strokeWidth={2} stroke="#3b82f6" />
              <Line type="monotone" dataKey="fitted" dot={false} strokeWidth={2} stroke="#10b981" />
              <Line type="monotone" dataKey="forecast" dot={false} strokeWidth={2} stroke="#f59e0b" strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Model: {model}. Forecast supports replenishment decisions.
        </div>
      </div>

      {/* Accuracy */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="MAPE" value={`${accuracy.mape.toFixed(1)}%`} />
        <MiniStat label="Bias" value={accuracy.bias.toFixed(2)} />
        <MiniStat label="Confidence" value={accuracy.label} />
      </div>

      {/* Formula note */}
      <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
        Reorder Qty = Forecast demand (lead time) + Safety stock − Current inventory.
      </div>
    </div>
  );
}

function StatCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{title}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{value}</div>
      {sub ? <div className="text-[11px] text-slate-500 dark:text-slate-400">{sub}</div> : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{value}</div>
    </div>
  );
}
