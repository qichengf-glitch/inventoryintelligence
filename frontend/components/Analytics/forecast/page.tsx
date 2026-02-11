"use client";

import { useEffect, useMemo, useState } from "react";
import SafetyStockUploader from "@/components/SafetyStockUploader";
import { loadSafetyStockMap, type SafetyStockRow } from "@/lib/SafetyStockStore";
import { useLanguage, type Lang } from "@/components/LanguageProvider";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  CartesianGrid,
} from "recharts";

// -------------------- i18n --------------------
type LangString = { zh: string; en: string };
function t(s: LangString, lang?: Lang) {
  return s[(lang || "zh") as "zh" | "en"];
}

const TEXT = {
  title: { zh: "预测 & 补货", en: "Forecast & Replenish" },
  subtitle: {
    zh: "预测需求、对比安全库存（普通/大客户）、生成建议补货量与缺货风险。",
    en: "Forecast demand, compare safety stock (Regular/Key Account), and generate reorder & risk signals.",
  },
  core: { zh: "核心", en: "Core" },

  sku: { zh: "SKU", en: "SKU" },
  customerType: { zh: "客户类型", en: "Customer Type" },
  regular: { zh: "普通", en: "Regular" },
  keyAccount: { zh: "大客户", en: "Key Account" },

  model: { zh: "主模型", en: "Primary Model" },
  horizonLead: { zh: "预测窗口 / 交期", en: "Horizon / Lead Time" },

  kpi_current: { zh: "当前库存", en: "Current Stock" },
  kpi_safety: { zh: "安全库存", en: "Safety Stock" },
  kpi_gap: { zh: "低于安全库存", en: "Below Safety Stock" },
  kpi_reorder: { zh: "建议补货量", en: "Suggested Reorder" },

  units: { zh: "units", en: "units" },
  suggested: { zh: "建议", en: "suggested" },
  gap: { zh: "差额", en: "gap" },

  demandForecast: { zh: "需求预测", en: "Demand Forecast" },
  projectedStockout: { zh: "预计缺货日", en: "Projected Stockout" },

  historyLast: { zh: "历史（最近 10 条）", en: "History (last 10)" },
  forecastNext: { zh: "预测（未来 10 条）", en: "Forecast (next 10)" },

  explainTitle: { zh: "解释 / 补货逻辑", en: "Explanation / Reorder Logic" },
  explainLine1: {
    zh: "建议补货量 = 安全库存 + 交期内预测需求 − 当前库存（最小为 0）。",
    en: "Suggested reorder = Safety stock + Lead-time demand − Current stock (min 0).",
  },
  explainLine2_prefix: { zh: "交期内预测需求 = 未来 ", en: "Lead-time demand = next " },
  explainLine2_suffix: { zh: " 天预测值之和 = ", en: " days forecast sum = " },

  riskTitle: { zh: "风险", en: "Risk" },
  riskLow: { zh: "低", en: "LOW" },
  riskMed: { zh: "中", en: "MED" },
  riskHigh: { zh: "高", en: "HIGH" },
  riskHealthy: { zh: "健康", en: "Healthy" },
  riskWatch: { zh: "观察", en: "Watch" },
  riskAtRisk: { zh: "有风险", en: "At Risk" },
  riskRule: {
    zh: "如果当前库存低于所选客户类型的安全库存，则风险升高。",
    en: "Risk increases if current stock is below safety stock for the selected customer type.",
  },

  ssSection: { zh: "安全库存表（普通 / 大客户）- 上传/更新", en: "Safety Stock (Regular / Key Account) - Upload/Update" },
  ssHint: {
    zh: "建议格式（长表）：型号 / 客户类型(普通/大客户) / 安全库存",
    en: "Recommended (long format): SKU / CustomerType(普通/大客户) / SafetyStock",
  },
  ssRefresh: { zh: "刷新安全库存配置", en: "Reload Safety Stock Config" },
  ssLoaded: { zh: "当前已加载配置条目：", en: "Loaded config entries: " },

  dateCol: { zh: "日期", en: "Date" },
  unitsCol: { zh: "数量", en: "Units" },

  tables: { zh: "表格（History / Forecast）", en: "Tables (History / Forecast)" },
  chartHint: { zh: "点击图例可隐藏/显示模型", en: "Click legend to show/hide series" },
  actual: { zh: "历史", en: "Actual" },
};

// -------------------- Types --------------------
type CustomerType = "普通" | "大客户";
type ModelKey = "SMA" | "SES" | "HOLT";
type DemandPoint = { t: string; y: number };

// -------------------- Helpers (deterministic) --------------------
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function fmtInt(n: number) {
  return Math.round(n).toLocaleString();
}
function buildTimeline(n: number) {
  const base = new Date("2025-01-01T00:00:00Z");
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
function addDaysISO(iso: string, days: number) {
  const base = new Date(`${iso}T00:00:00Z`);
  const d = new Date(base);
  d.setUTCDate(base.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// -------------------- Forecast Models --------------------
function smaForecast(series: number[], horizon: number, window = 7) {
  const w = clamp(window, 2, Math.max(2, series.length));
  const tail = series.slice(-w);
  const avg = tail.reduce((a, b) => a + b, 0) / Math.max(1, tail.length);
  return Array.from({ length: horizon }, () => avg);
}
function sesForecast(series: number[], horizon: number, alpha = 0.3) {
  const a = clamp(alpha, 0.05, 0.95);
  let level = series[0] ?? 0;
  for (let i = 1; i < series.length; i++) level = a * series[i] + (1 - a) * level;
  return Array.from({ length: horizon }, () => level);
}
function holtForecast(series: number[], horizon: number, alpha = 0.3, beta = 0.2) {
  const a = clamp(alpha, 0.05, 0.95);
  const b = clamp(beta, 0.05, 0.95);
  let level = series[0] ?? 0;
  let trend = (series[1] ?? level) - level;

  for (let i = 1; i < series.length; i++) {
    const y = series[i];
    const prevLevel = level;
    level = a * y + (1 - a) * (level + trend);
    trend = b * (level - prevLevel) + (1 - b) * trend;
  }

  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) out.push(level + h * trend);
  return out;
}
function forecastByModel(model: ModelKey, series: number[], horizon: number) {
  if (series.length < 3) return smaForecast(series, horizon, 2);
  if (model === "SMA") return smaForecast(series, horizon, 7);
  if (model === "SES") return sesForecast(series, horizon, 0.3);
  return holtForecast(series, horizon, 0.3, 0.2);
}

// -------------------- Mock data (replace later) --------------------
const MOCK_SKUS = ["FWD100", "FWD101", "FWD103", "FWD111", "FWD121", "FWD123"] as const;
const MOCK_CURRENT_STOCK: Record<string, number> = {
  FWD100: 3200,
  FWD101: 600,
  FWD103: 980,
  FWD111: 260,
  FWD121: 180,
  FWD123: 520,
};

function buildMockDemand(sku: string) {
  const dates = buildTimeline(40);
  const base = sku === "FWD100" ? 55 : sku === "FWD101" ? 18 : sku === "FWD111" ? 12 : 22;
  const seed = sku.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return dates.map((t0, i) => {
    const wave = Math.sin((i + seed) / 3) * 6 + Math.cos((i + seed) / 7) * 4;
    const y = clamp(base + wave + (i % 9 === 0 ? 10 : 0) - (i % 13 === 0 ? 8 : 0), 1, 120);
    return { t: t0, y: Math.round(y) };
  });
}

// -------------------- Chart data builder --------------------
type ChartRow = { t: string; actual?: number; HOLT?: number; SES?: number; SMA?: number };

function buildMultiModelChartData(history: DemandPoint[], horizonDays: number) {
  const series = history.map((d) => d.y);
  const horizon = clamp(horizonDays, 7, 90);

  const lastHistDate = history.at(-1)?.t ?? "2025-01-01";
  const forecastStartDate = addDaysISO(lastHistDate, 1);

  const holt = forecastByModel("HOLT", series, horizon).map((x) => Math.max(0, x));
  const ses = forecastByModel("SES", series, horizon).map((x) => Math.max(0, x));
  const sma = forecastByModel("SMA", series, horizon).map((x) => Math.max(0, x));

  const rows: ChartRow[] = history.map((p) => ({ t: p.t, actual: p.y }));
  for (let i = 0; i < horizon; i++) {
    const t = addDaysISO(lastHistDate, i + 1);
    rows.push({
      t,
      HOLT: Math.round(holt[i] ?? 0),
      SES: Math.round(ses[i] ?? 0),
      SMA: Math.round(sma[i] ?? 0),
    });
  }

  return { rows, forecastStartDate };
}

// -------------------- Page --------------------
export default function ForecastPage() {
  const { lang } = useLanguage();
  const companyKey = "default";

  const [sku, setSku] = useState<string>(MOCK_SKUS[0]);
  const [customerType, setCustomerType] = useState<CustomerType>("普通");
  const [model, setModel] = useState<ModelKey>("HOLT");
  const [horizonDays, setHorizonDays] = useState<number>(30);
  const [leadTimeDays, setLeadTimeDays] = useState<number>(14);

  // Safety stock map from localStorage
  const [ssMap, setSsMap] = useState<Record<string, SafetyStockRow>>({});

  useEffect(() => {
    setSsMap(loadSafetyStockMap(companyKey));
  }, [companyKey]);

  const demandHistory: DemandPoint[] = useMemo(() => buildMockDemand(sku), [sku]);
  const series = useMemo(() => demandHistory.map((d) => d.y), [demandHistory]);

  const currentStock = useMemo(() => toNum(MOCK_CURRENT_STOCK[sku], 0), [sku]);

  // safety stock lookup
  const safetyStock = useMemo(() => {
    const k2 = `${sku}|${customerType}`;
    const row2 = (ssMap as any)[k2] as SafetyStockRow | undefined;
    if (row2?.safetyStock != null) return toNum(row2.safetyStock, 0);

    const row1 = ssMap[sku];
    return row1 ? toNum(row1.safetyStock, 0) : 0;
  }, [ssMap, sku, customerType]);

  // primary model forecast (for KPI/reorder)
  const forecast = useMemo(() => {
    const h = clamp(horizonDays, 7, 90);
    const pred = forecastByModel(model, series, h).map((x) => Math.max(0, x));

    const lastDate = demandHistory[demandHistory.length - 1]?.t ?? "2025-01-01";
    const base = new Date(`${lastDate}T00:00:00Z`);

    const future: DemandPoint[] = [];
    for (let i = 1; i <= pred.length; i++) {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() + i);
      future.push({ t: d.toISOString().slice(0, 10), y: Math.round(pred[i - 1]) });
    }
    return future;
  }, [model, series, horizonDays, demandHistory]);

  const leadDemand = useMemo(() => {
    const lt = clamp(leadTimeDays, 1, 90);
    return forecast.slice(0, lt).reduce((a, b) => a + b.y, 0);
  }, [forecast, leadTimeDays]);

  const reorderQty = useMemo(() => {
    const qty = safetyStock + leadDemand - currentStock;
    return Math.max(0, Math.round(qty));
  }, [safetyStock, leadDemand, currentStock]);

  const projectedStockoutDate = useMemo(() => {
    const tail = series.slice(-14);
    const avgDaily = tail.reduce((a, b) => a + b, 0) / Math.max(1, tail.length);
    if (avgDaily <= 0) return null;

    const daysLeft = Math.floor(currentStock / avgDaily);
    const last = demandHistory[demandHistory.length - 1]?.t ?? "2025-01-01";
    const base = new Date(`${last}T00:00:00Z`);
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + daysLeft);
    return d.toISOString().slice(0, 10);
  }, [series, currentStock, demandHistory]);

  const risk = useMemo(() => {
    const gap = safetyStock - currentStock;
    if (gap <= 0) return { label: t(TEXT.riskLow, lang), desc: t(TEXT.riskHealthy, lang) };
    if (gap <= safetyStock * 0.3) return { label: t(TEXT.riskMed, lang), desc: t(TEXT.riskWatch, lang) };
    return { label: t(TEXT.riskHigh, lang), desc: t(TEXT.riskAtRisk, lang) };
  }, [safetyStock, currentStock, lang]);

  const gap = useMemo(() => Math.max(0, safetyStock - currentStock), [safetyStock, currentStock]);

  const customerTypeDisplay = useMemo(() => {
    if (customerType === "普通") return t(TEXT.regular, lang);
    return t(TEXT.keyAccount, lang);
  }, [customerType, lang]);

  // Multi-model chart rows (independent from primary model)
  const { rows: chartRows, forecastStartDate } = useMemo(
    () => buildMultiModelChartData(demandHistory, horizonDays),
    [demandHistory, horizonDays]
  );

  // model visibility toggles for chart
  const [visible, setVisible] = useState({ actual: true, HOLT: true, SES: false, SMA: false });

  // legend click toggles
  const onLegendClick = (e: any) => {
    const key = e?.dataKey as keyof typeof visible;
    if (!key) return;
    setVisible((v) => ({ ...v, [key]: !v[key] }));
  };

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t(TEXT.title, lang)}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t(TEXT.subtitle, lang)}</p>
        </div>

        <span className="inline-flex items-center rounded-full bg-blue-600 text-white px-3 py-1 text-xs font-bold">
          {t(TEXT.core, lang)}
        </span>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">{t(TEXT.sku, lang)}</div>
          <select
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            {MOCK_SKUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">{t(TEXT.customerType, lang)}</div>
          <div className="grid grid-cols-2 gap-2">
            {(["普通", "大客户"] as CustomerType[]).map((ct) => {
              const label = ct === "普通" ? t(TEXT.regular, lang) : t(TEXT.keyAccount, lang);
              return (
                <button
                  key={ct}
                  onClick={() => setCustomerType(ct)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold border transition-colors ${
                    customerType === ct
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white dark:bg-slate-900/30 text-slate-900 dark:text-white border-slate-200 dark:border-slate-700"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">{t(TEXT.model, lang)}</div>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelKey)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            <option value="HOLT">Holt</option>
            <option value="SES">SES</option>
            <option value="SMA">SMA</option>
          </select>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">{t(TEXT.horizonLead, lang)}</div>
          <div className="flex gap-2">
            <select
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 px-3 py-2 text-sm text-slate-900 dark:text-white"
            >
              {[14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d}d
                </option>
              ))}
            </select>

            <select
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(Number(e.target.value))}
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 px-3 py-2 text-sm text-slate-900 dark:text-white"
            >
              {[7, 14, 21, 30].map((d) => (
                <option key={d} value={d}>
                  LT {d}d
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KPI title={t(TEXT.kpi_current, lang)} value={fmtInt(currentStock)} sub={t(TEXT.units, lang)} />
        <KPI
          title={t(TEXT.kpi_safety, lang)}
          value={fmtInt(safetyStock)}
          sub={customerTypeDisplay}
          highlight={safetyStock > 0 ? "blue" : "warn"}
        />
        <KPI title={t(TEXT.kpi_gap, lang)} value={fmtInt(gap)} sub={t(TEXT.gap, lang)} highlight={gap > 0 ? "warn" : "ok"} />
        <KPI title={t(TEXT.kpi_reorder, lang)} value={fmtInt(reorderQty)} sub={t(TEXT.suggested, lang)} highlight={reorderQty > 0 ? "warn" : "ok"} />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        {/* Left */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">{t(TEXT.demandForecast, lang)}</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">
                Primary: <span className="font-semibold">{model}</span> · Horizon: <span className="font-semibold">{horizonDays}d</span> · Lead Time:{" "}
                <span className="font-semibold">{leadTimeDays}d</span>
                <span className="ml-2 text-[11px] opacity-80">· {t(TEXT.chartHint, lang)}</span>
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs text-slate-600 dark:text-slate-300">{t(TEXT.projectedStockout, lang)}</div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">{projectedStockoutDate ?? "-"}</div>
            </div>
          </div>

          {/* ✅ Main Chart */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t(TEXT.actual, lang)} + Holt / SES / SMA
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Forecast starts at <span className="font-mono">{forecastStartDate}</span>
              </div>
            </div>

            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend onClick={onLegendClick} />

                  <ReferenceLine x={forecastStartDate} strokeDasharray="4 4" />

                  {visible.actual && (
                    <Line type="monotone" dataKey="actual" name="Actual" strokeWidth={2.6} dot={false} connectNulls={false} />
                  )}
                  {visible.HOLT && <Line type="monotone" dataKey="HOLT" name="Holt" strokeWidth={2} dot={false} strokeDasharray="6 4" />}
                  {visible.SES && <Line type="monotone" dataKey="SES" name="SES" strokeWidth={2} dot={false} strokeDasharray="6 4" />}
                  {visible.SMA && <Line type="monotone" dataKey="SMA" name="SMA" strokeWidth={2} dot={false} strokeDasharray="6 4" />}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {(["actual", "HOLT", "SES", "SMA"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setVisible((v) => ({ ...v, [k]: !v[k] }))}
                  className={`rounded-full border px-3 py-1 font-semibold transition-colors ${
                    visible[k]
                      ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white"
                      : "bg-transparent text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                  }`}
                >
                  {k === "actual" ? "Actual" : k}
                </button>
              ))}
            </div>
          </div>

          {/* ✅ Tables collapsed */}
          <details className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <summary className="cursor-pointer px-3 py-2 text-xs font-bold bg-slate-50 dark:bg-slate-900/40 text-slate-900 dark:text-white">
              {t(TEXT.tables, lang)}
            </summary>
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <MiniTable lang={lang} title={t(TEXT.historyLast, lang)} data={demandHistory.slice(-10)} />
              <MiniTable lang={lang} title={t(TEXT.forecastNext, lang)} data={forecast.slice(0, 10)} />
            </div>
          </details>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t(TEXT.explainTitle, lang)}</div>
            <div className="mt-1 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
              {t(TEXT.explainLine1, lang)}
              <br />
              {t(TEXT.explainLine2_prefix, lang)}
              <span className="font-semibold">{leadTimeDays}</span>
              {t(TEXT.explainLine2_suffix, lang)}
              <span className="font-semibold">{fmtInt(leadDemand)}</span>.
            </div>
          </div>
        </div>

        {/* Right */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <div className="text-sm font-bold text-slate-900 dark:text-white">{t(TEXT.riskTitle, lang)}</div>
            <div className="mt-2 flex items-end justify-between">
              <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{risk.label}</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">{risk.desc}</div>
            </div>
            <div className="mt-3 text-xs text-slate-600 dark:text-slate-300">{t(TEXT.riskRule, lang)}</div>
          </div>

          <details className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-900 dark:text-white">
              {t(TEXT.ssSection, lang)}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="text-xs text-slate-600 dark:text-slate-300">{t(TEXT.ssHint, lang)}</div>

              <SafetyStockUploader companyKey={companyKey} />

              <button
                onClick={() => setSsMap(loadSafetyStockMap(companyKey))}
                className="w-full rounded-lg bg-blue-600 text-white text-xs font-bold py-2 hover:bg-blue-700"
              >
                {t(TEXT.ssRefresh, lang)}
              </button>

              <div className="text-xs text-slate-600 dark:text-slate-300">
                {t(TEXT.ssLoaded, lang)}
                <span className="font-semibold">{Object.keys(ssMap).length}</span>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

// -------------------- Components --------------------
function KPI({
  title,
  value,
  sub,
  highlight,
}: {
  title: string;
  value: string;
  sub?: string;
  highlight?: "ok" | "warn" | "blue";
}) {
  const badge =
    highlight === "warn"
      ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
      : highlight === "ok"
      ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
      : "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{title}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{value}</div>
        {sub && <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${badge}`}>{sub}</span>}
      </div>
    </div>
  );
}

function MiniTable({
  title,
  data,
  lang,
}: {
  title: string;
  data: { t: string; y: number }[];
  lang: Lang;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-3 py-2 text-xs font-bold bg-slate-50 dark:bg-slate-900/40 text-slate-900 dark:text-white">
        {title}
      </div>
      <table className="w-full text-xs">
        <thead className="text-slate-600 dark:text-slate-300">
          <tr className="border-t border-slate-100 dark:border-slate-700">
            <th className="text-left p-2 font-semibold">{t(TEXT.dateCol, lang)}</th>
            <th className="text-right p-2 font-semibold">{t(TEXT.unitsCol, lang)}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.t} className="border-t border-slate-100 dark:border-slate-700">
              <td className="p-2 font-mono text-slate-700 dark:text-slate-200">{d.t}</td>
              <td className="p-2 text-right text-slate-900 dark:text-white">{d.y}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
