"use client";

import { useEffect, useMemo, useState } from "react";
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

/**
 * ============================================================
 * ✅ Monthly Demand Series Store (LocalStorage)
 *
 * Key: ii:demandSeries:<companyKey>:monthly
 * Value:
 * {
 *   "FWD100": [{"t":"2025-01-01","y":12}, ...],
 *   "FWD101": [...]
 * }
 * ============================================================
 */

type DemandPoint = { t: string; y: number };
type CustomerType = "普通" | "大客户";

type ModelKey = "NAIVE" | "SNAIVE" | "SMA" | "SES" | "HOLT" | "HW";
type RangeKey = "6M" | "12M" | "18M" | "24M" | "ALL";
// -------------------- i18n --------------------
type LangString = { zh: string; en: string };
function tt(s: LangString, lang?: Lang) {
  return s[(lang || "zh") as "zh" | "en"];
}

const TEXT = {
  title: { zh: "预测 & 补货", en: "Forecast & Replenish" },
  subtitle: {
    zh: "按月级数据预测需求、对比安全库存（普通/大客户）、生成建议补货量与缺货风险。",
    en: "Forecast monthly demand, compare safety stock (Regular/Key Account), and generate reorder & risk signals.",
  },

  sku: { zh: "SKU", en: "SKU" },
  customerType: { zh: "客户类型", en: "Customer Type" },
  regular: { zh: "普通", en: "Regular" },
  keyAccount: { zh: "大客户", en: "Key Account" },

  model: { zh: "主模型", en: "Primary Model" },
  horizonLead: { zh: "预测窗口 / 交期（月）", en: "Horizon / Lead Time (months)" },

  kpi_current: { zh: "当前库存", en: "Current Stock" },
  kpi_safety: { zh: "安全库存", en: "Safety Stock" },
  kpi_risk: { zh: "风险栏", en: "Risk Assessment" },
  kpi_reorder: { zh: "建议补货量", en: "Suggested Reorder" },

  units: { zh: "units", en: "units" },
  suggested: { zh: "建议", en: "suggested" },
  gap: { zh: "差额", en: "gap" },

  demandForecast: { zh: "需求预测（按月）", en: "Demand Forecast (Monthly)" },
  projectedStockout: { zh: "预计缺货月", en: "Projected Stockout Month" },

  tables: { zh: "表格（History / Forecast）", en: "Tables (History / Forecast)" },
  chartHint: { zh: "点击图例可隐藏/显示模型", en: "Click legend to show/hide series" },
  actual: { zh: "历史", en: "Actual" },
  range: { zh: "范围", en: "Range" },

  explainTitle: { zh: "解释 / 补货逻辑", en: "Explanation / Reorder Logic" },
  explainLine1: {
    zh: "建议补货量 = 安全库存 + 交期内预测需求 − 当前库存（最小为 0）。",
    en: "Suggested reorder = Safety stock + Lead-time demand − Current stock (min 0).",
  },

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

  ssSection: {
    zh: "安全库存表（普通 / 大客户）- 上传/更新",
    en: "Safety Stock (Regular / Key Account) - Upload/Update",
  },
  ssHint: {
    zh: "建议格式（长表）：型号 / 客户类型(普通/大客户) / 安全库存",
    en: "Recommended (long format): SKU / CustomerType(普通/大客户) / SafetyStock",
  },
  ssRefresh: { zh: "刷新安全库存配置", en: "Reload Safety Stock Config" },
  ssLoaded: { zh: "当前已加载配置条目：", en: "Loaded config entries: " },

  modelUnavailableTitle: { zh: "部分模型不可用：", en: "Some models are unavailable: " },
};

// -------------------- Helpers --------------------
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function toNum(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function fmtInt(n: number) {
  return Math.round(n).toLocaleString();
}

function normalizeSku(value: unknown) {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function collectLocalSkus() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("inventory_datasets");
    if (!raw) return [];
    const datasets = JSON.parse(raw) as Array<{ data?: Array<Record<string, unknown>> }>;
    if (!Array.isArray(datasets)) return [];
    const out: string[] = [];
    for (const ds of datasets) {
      for (const item of ds.data || []) {
        const sku =
          normalizeSku(item?.SKU) ??
          normalizeSku(item?.sku) ??
          normalizeSku(item?.Sku) ??
          normalizeSku(item?.model) ??
          normalizeSku(item?.Model);
        if (sku) out.push(sku);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function addMonthsISO(iso: string, months: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-11
  const total = m + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const out = new Date(Date.UTC(ny, nm, 1));
  return out.toISOString().slice(0, 10);
}

function formatMonthLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${mm}/${yy}`;
}

// -------------------- Models (monthly) --------------------
function naiveForecast(series: number[], horizon: number) {
  const last = series.at(-1) ?? 0;
  return Array.from({ length: horizon }, () => last);
}

function seasonalNaiveForecast(series: number[], horizon: number, season = 12) {
  const out: number[] = [];
  const n = series.length;
  for (let i = 0; i < horizon; i++) {
    const idx = n - season + (i % season);
    out.push(series[idx] ?? series.at(-1) ?? 0);
  }
  return out;
}

function smaForecast(series: number[], horizon: number, window = 3) {
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

/**
 * Holt-Winters additive (very lightweight)
 * - season length = 12 (monthly)
 * - Works best when >= 24 points; >= 12 points can run but will warn (unstable season).
 */
function holtWintersAdditive(series: number[], horizon: number, season = 12, alpha = 0.3, beta = 0.15, gamma = 0.2) {
  const n = series.length;
  const a = clamp(alpha, 0.05, 0.95);
  const b = clamp(beta, 0.05, 0.95);
  const g = clamp(gamma, 0.05, 0.95);

  // init seasonals: use first season mean
  const firstSeason = series.slice(0, season);
  const seasonAvg = firstSeason.reduce((x, y) => x + y, 0) / Math.max(1, firstSeason.length);

  const s: number[] = Array.from({ length: season }, (_, i) => (firstSeason[i] ?? seasonAvg) - seasonAvg);

  let level = series[0] ?? 0;
  let trend = (series[1] ?? level) - level;

  for (let t = 0; t < n; t++) {
    const y = series[t] ?? 0;
    const si = s[t % season] ?? 0;

    const prevLevel = level;
    const prevTrend = trend;

    level = a * (y - si) + (1 - a) * (prevLevel + prevTrend);
    trend = b * (level - prevLevel) + (1 - b) * prevTrend;
    s[t % season] = g * (y - level) + (1 - g) * si;
  }

  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const si = s[(n + h - 1) % season] ?? 0;
    out.push(level + h * trend + si);
  }
  return out;
}

function modelApplicability(seriesLen: number) {
  const season = 12;

  // 返回：是否可用 + 原因(不可用/警告)
  const ok = (min: number) => seriesLen >= min;

  const map: Record<ModelKey, { usable: boolean; reason?: string; warn?: string }> = {
    NAIVE: { usable: ok(1) },
    SMA: { usable: ok(2), reason: ok(2) ? undefined : "需要至少 2 个点" },
    SES: { usable: ok(2), reason: ok(2) ? undefined : "需要至少 2 个点" },
    HOLT: { usable: ok(3), reason: ok(3) ? undefined : "需要至少 3 个点（趋势）" },
    SNAIVE: { usable: ok(season), reason: ok(season) ? undefined : "需要至少 12 个月（才能用去年同月）" },
    HW: {
      usable: ok(season),
      reason: ok(season) ? undefined : "需要至少 12 个月（季节周期=12）",
      warn: seriesLen >= 12 && seriesLen < 24 ? "建议至少 24 个月，季节性可能不稳定" : undefined,
    },
  };

  return map;
}

function forecastByModel(model: ModelKey, series: number[], horizonMonths: number) {
  const h = clamp(horizonMonths, 1, 24);
  const season = 12;

  switch (model) {
    case "NAIVE":
      return naiveForecast(series, h);
    case "SNAIVE":
      return seasonalNaiveForecast(series, h, season);
    case "SMA":
      return smaForecast(series, h, 3);
    case "SES":
      return sesForecast(series, h, 0.3);
    case "HOLT":
      return holtForecast(series, h, 0.3, 0.2);
    case "HW":
      return holtWintersAdditive(series, h, season, 0.3, 0.15, 0.2);
  }
}

// -------------------- Chart builder --------------------
type ChartRow = {
  t: string;
  actual?: number;
  NAIVE?: number;
  SNAIVE?: number;
  SMA?: number;
  SES?: number;
  HOLT?: number;
  HW?: number;
};

function buildMultiModelChartData(history: DemandPoint[], horizonMonths: number) {
  if (!history.length) {
    return { rows: [], forecastStartDate: "-", applicability: modelApplicability(0) };
  }

  const series = history.map((d) => d.y);
  const horizon = clamp(horizonMonths, 1, 24);

  const lastHistDate = history.at(-1)?.t ?? "2025-01-01";
  const forecastStartDate = addMonthsISO(lastHistDate, 1);

  const applicability = modelApplicability(series.length);

  const preds: Partial<Record<ModelKey, number[]>> = {};
  (["NAIVE", "SNAIVE", "SMA", "SES", "HOLT", "HW"] as ModelKey[]).forEach((m) => {
    if (!applicability[m].usable) return;
    preds[m] = forecastByModel(m, series, horizon).map((x) => Math.max(0, x));
  });

  const rows: ChartRow[] = history.map((p) => ({ t: p.t, actual: p.y }));

  for (let i = 0; i < horizon; i++) {
    const t = addMonthsISO(lastHistDate, i + 1);
    rows.push({
      t,
      NAIVE: preds.NAIVE ? Math.round(preds.NAIVE[i] ?? 0) : undefined,
      SNAIVE: preds.SNAIVE ? Math.round(preds.SNAIVE[i] ?? 0) : undefined,
      SMA: preds.SMA ? Math.round(preds.SMA[i] ?? 0) : undefined,
      SES: preds.SES ? Math.round(preds.SES[i] ?? 0) : undefined,
      HOLT: preds.HOLT ? Math.round(preds.HOLT[i] ?? 0) : undefined,
      HW: preds.HW ? Math.round(preds.HW[i] ?? 0) : undefined,
    });
  }

  return { rows, forecastStartDate, applicability };
}

// -------------------- Range (months) --------------------
const RANGE: { key: RangeKey; label: string; months: number | null }[] = [
  { key: "6M", label: "6个月", months: 6 },
  { key: "12M", label: "12个月", months: 12 },
  { key: "18M", label: "18个月", months: 18 },
  { key: "24M", label: "24个月", months: 24 },
  { key: "ALL", label: "全部", months: null },
];

async function getApiErrorMessage(res: Response, fallback: string) {
  try {
    const data = await res.json();
    if (data?.error) return String(data.error);
  } catch {
    // ignore json parse errors
  }
  return fallback;
}

// -------------------- Page --------------------
export default function Page() {
  const { lang } = useLanguage();

  const companyKey = "customer";

  // API-backed state
  const [skuList, setSkuList] = useState<string[]>([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const [skuError, setSkuError] = useState<string | null>(null);

  const [demandHistory, setDemandHistory] = useState<DemandPoint[]>([]);
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandError, setDemandError] = useState<string | null>(null);

  const [currentStockState, setCurrentStockState] = useState<number | null>(null);
  const [currentStockMonth, setCurrentStockMonth] = useState<string | null>(null);
  const [safetyStockFromApi, setSafetyStockFromApi] = useState<number | null>(null);

  const [sku, setSku] = useState<string>("FWD100");

  // load skus
  useEffect(() => {
    const refreshSkus = async (reason: string) => {
      setSkuLoading(true);
      setSkuError(null);
      try {
        const res = await fetch("/api/inventory/skus", { cache: "no-store" });
        if (!res.ok) {
          const message = await getApiErrorMessage(res, `status ${res.status}`);
          throw new Error(message);
        }
        const data = await res.json();
        const apiList = Array.isArray(data?.skus) ? data.skus : [];
        const localList = collectLocalSkus();
        const merged = Array.from(
          new Set(
            [...apiList, ...localList]
              .map((s) => normalizeSku(s))
              .filter((s): s is string => Boolean(s))
          )
        ).sort((a, b) => a.localeCompare(b));
        setSkuList(merged);
        if (merged.length && !merged.includes(sku)) {
          setSku(merged[0]);
        }
        if (merged.length === 0) {
          setSkuError("未找到 SKU（请确认上传的文件包含型号列）");
        }
        console.log("[sku refresh]", reason, { api: apiList.length, local: localList.length, merged: merged.length });
      } catch (err) {
        console.error(err);
        setSkuError(err instanceof Error ? err.message : "加载 SKU 失败");
      } finally {
        setSkuLoading(false);
      }
    };

    refreshSkus("mount");
    const onFocus = () => refreshSkus("focus");
    const onStorage = (e: StorageEvent) => {
      if (e.key === "inventory_datasets") refreshSkus("storage");
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load demand + current stock when sku changes
  useEffect(() => {
    if (!sku) return;
    const loadDemand = async () => {
      setDemandLoading(true);
      setDemandError(null);
      try {
        const res = await fetch(`/api/inventory/demand?sku=${encodeURIComponent(sku)}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await getApiErrorMessage(res, `status ${res.status}`);
          throw new Error(message);
        }
        const data = await res.json();
        const series = Array.isArray(data?.series) ? data.series : [];
        setDemandHistory(series);
      } catch (err) {
        console.error(err);
        setDemandHistory([]);
        setDemandError(err instanceof Error ? err.message : "暂无数据，无法预测");
      } finally {
        setDemandLoading(false);
      }
    };

    const loadStock = async () => {
      try {
        const res = await fetch(`/api/inventory/currentStock?sku=${encodeURIComponent(sku)}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await getApiErrorMessage(res, `status ${res.status}`);
          throw new Error(message);
        }
        const data = await res.json();
        setCurrentStockState(Number(data?.currentStock ?? 0));
        setCurrentStockMonth(typeof data?.month === "string" ? data.month : null);
      } catch (err) {
        console.error(err);
        setCurrentStockState(null);
        setCurrentStockMonth(null);
      }
    };

    const loadSafetyStock = async () => {
      try {
        const res = await fetch(`/api/inventory/safetyStock?sku=${encodeURIComponent(sku)}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await getApiErrorMessage(res, `status ${res.status}`);
          throw new Error(message);
        }
        const data = await res.json();
        setSafetyStockFromApi(Number(data?.safetyStock ?? 0));
      } catch (err) {
        console.error(err);
        setSafetyStockFromApi(null);
      }
    };

    loadDemand();
    loadStock();
    loadSafetyStock();
  }, [sku]);

  const [customerType, setCustomerType] = useState<CustomerType>("普通");

  // Primary model for KPI/reorder
  const [model, setModel] = useState<ModelKey>("HOLT");

  // Monthly horizon & leadtime (months)
  const [horizonMonths, setHorizonMonths] = useState<number>(6);
  const [leadTimeMonths, setLeadTimeMonths] = useState<number>(1);

  // Range buttons
  const [range, setRange] = useState<RangeKey>("12M");

  // Safety stock map
  const [ssMap, setSsMap] = useState<Record<string, SafetyStockRow>>({});
  useEffect(() => {
    setSsMap(loadSafetyStockMap(companyKey));
  }, []);

  const series = useMemo(() => demandHistory.map((d) => d.y), [demandHistory]);
  const hasDemand = demandHistory.length > 0;

  // current stock from API
  const currentStock = useMemo(() => (Number.isFinite(currentStockState) ? Number(currentStockState) : 0), [currentStockState]);
  const currentStockSub = useMemo(() => {
    if (currentStockMonth) return `${tt(TEXT.units, lang)} · ${currentStockMonth}`;
    return tt(TEXT.units, lang);
  }, [currentStockMonth, lang]);

  // safety stock lookup: prefer API (from database), fallback to localStorage
  const safetyStock = useMemo(() => {
    // First try API value (from database safety_stock column)
    if (safetyStockFromApi != null && Number.isFinite(safetyStockFromApi)) {
      return Number(safetyStockFromApi);
    }
    // Fallback to localStorage config
    const k2 = `${sku}|${customerType}`;
    const row2 = ssMap[k2];
    if (row2?.safetyStock != null) return toNum(row2.safetyStock, 0);

    const row1 = ssMap[sku];
    return row1 ? toNum(row1.safetyStock, 0) : 0;
  }, [safetyStockFromApi, ssMap, sku, customerType]);

  // applicability + auto-fix primary model if not usable
  const applicability = useMemo(() => modelApplicability(series.length), [series.length]);
  useEffect(() => {
    if (!applicability[model]?.usable) {
      const firstOk =
        (["HOLT", "SES", "SMA", "NAIVE"] as ModelKey[]).find((m) => applicability[m]?.usable) ?? "NAIVE";
      setModel(firstOk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.length]);

  // primary model forecast (for KPI/reorder)
  const forecast = useMemo(() => {
    if (!hasDemand) return [];
    const h = clamp(horizonMonths, 1, 24);
    const pred = applicability[model]?.usable ? forecastByModel(model, series, h) : naiveForecast(series, h);
    const lastDate = demandHistory.at(-1)?.t ?? "2025-01-01";
    return Array.from({ length: pred.length }, (_, i) => ({
      t: addMonthsISO(lastDate, i + 1),
      y: Math.round(Math.max(0, pred[i] ?? 0)),
    }));
  }, [hasDemand, model, series, horizonMonths, demandHistory, applicability]);

  // lead-time demand = sum next leadTimeMonths
  const leadDemand = useMemo(() => {
    if (!hasDemand) return 0;
    const lt = clamp(leadTimeMonths, 1, 12);
    return forecast.slice(0, lt).reduce((a, b) => a + b.y, 0);
  }, [hasDemand, forecast, leadTimeMonths]);

  const reorderQty = useMemo(() => {
    const qty = safetyStock + leadDemand - currentStock;
    return Math.max(0, Math.round(qty));
  }, [safetyStock, leadDemand, currentStock]);

  // projected stockout month: based on avg last 3 months demand
  const projectedStockoutMonth = useMemo(() => {
    if (!hasDemand) return null;
    const tail = series.slice(-3);
    const avg = tail.reduce((a, b) => a + b, 0) / Math.max(1, tail.length);
    if (avg <= 0) return null;
    const monthsLeft = Math.floor(currentStock / avg);
    const last = demandHistory.at(-1)?.t ?? "2025-01-01";
    return addMonthsISO(last, monthsLeft);
  }, [hasDemand, series, currentStock, demandHistory]);

  // Risk assessment: compare current stock with safety stock and provide suggestions
  const risk = useMemo(() => {
    if (currentStock >= safetyStock * 1.2) {
      return { 
        label: tt(TEXT.riskLow, lang), 
        desc: tt(TEXT.riskHealthy, lang),
        suggestion: lang === "zh" ? "库存充足，建议维持当前水平" : "Stock is sufficient, maintain current level"
      };
    }
    if (currentStock >= safetyStock) {
      return { 
        label: tt(TEXT.riskMed, lang), 
        desc: tt(TEXT.riskWatch, lang),
        suggestion: lang === "zh" ? "库存正常，建议关注补货时机" : "Stock is normal, monitor reorder timing"
      };
    }
    if (currentStock >= safetyStock * 0.5) {
      return { 
        label: tt(TEXT.riskMed, lang), 
        desc: tt(TEXT.riskWatch, lang),
        suggestion: lang === "zh" ? "库存偏低，建议尽快补货" : "Stock is low, consider reordering soon"
      };
    }
    return { 
      label: tt(TEXT.riskHigh, lang), 
      desc: tt(TEXT.riskAtRisk, lang),
      suggestion: lang === "zh" ? "库存严重不足，建议立即补货" : "Stock is critically low, reorder immediately"
    };
  }, [safetyStock, currentStock, lang]);

  const customerTypeDisplay = useMemo(
    () => (customerType === "普通" ? tt(TEXT.regular, lang) : tt(TEXT.keyAccount, lang)),
    [customerType, lang]
  );

  // Multi-model chart rows
  const { rows: chartRows, forecastStartDate, applicability: chartApplicability } = useMemo(
    () => buildMultiModelChartData(demandHistory, horizonMonths),
    [demandHistory, horizonMonths]
  );

  // display rows: last N months + forecast
  const displayRows = useMemo(() => {
    const hist = chartRows.filter((r) => r.actual != null);
    const fut = chartRows.filter((r) => r.actual == null);
    const months = RANGE.find((x) => x.key === range)?.months;
    if (months == null) return chartRows;
    return [...hist.slice(-months), ...fut];
  }, [chartRows, range]);

  const xTickFormatter = useMemo(() => (value: string) => formatMonthLabel(value), []);

  // legend visibility toggles (only for usable models)
  const [visible, setVisible] = useState<Record<string, boolean>>({
    actual: true,
    NAIVE: true,
    SNAIVE: true,
    SMA: true,
    SES: true,
    HOLT: true,
    HW: true,
  });

  useEffect(() => {
    // if model not usable, auto-hide it
    setVisible((v) => {
      const next = { ...v };
      (["NAIVE", "SNAIVE", "SMA", "SES", "HOLT", "HW"] as ModelKey[]).forEach((m) => {
        if (!chartApplicability[m]?.usable) next[m] = false;
      });
      return next;
    });
  }, [chartApplicability]);


  const COLORS: Record<string, string> = {
    actual: "#22d3ee", // cyan
    NAIVE: "#94a3b8", // slate
    SNAIVE: "#f97316", // orange
    SMA: "#fbbf24", // amber
    SES: "#a3e635", // lime
    HOLT: "#fb7185", // rose
    HW: "#60a5fa", // blue
  };

  // Build "unavailable reasons" line
  const unavailable = useMemo(() => {
    const items: string[] = [];
    (["SNAIVE", "HW", "HOLT", "SES", "SMA"] as ModelKey[]).forEach((m) => {
      const info = applicability[m];
      if (!info?.usable && info?.reason) items.push(`${m}: ${info.reason}`);
    });
    return items;
  }, [applicability]);

  const warnings = useMemo(() => {
    const items: string[] = [];
    (["HW"] as ModelKey[]).forEach((m) => {
      const w = applicability[m]?.warn;
      if (applicability[m]?.usable && w) items.push(`${m}: ${w}`);
    });
    return items;
  }, [applicability]);

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{tt(TEXT.title, lang)}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{tt(TEXT.subtitle, lang)}</p>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          {skuLoading ? "加载 SKU..." : ""}
          {skuError ? skuError : ""}
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">{tt(TEXT.sku, lang)}</div>
          <select
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            {skuList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {!demandHistory.length && (
            <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">
              当前 SKU 暂无月度需求数据，无法生成预测
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">{tt(TEXT.customerType, lang)}</div>
          <div className="grid grid-cols-2 gap-2">
            {(["普通", "大客户"] as CustomerType[]).map((ct) => {
              const label = ct === "普通" ? tt(TEXT.regular, lang) : tt(TEXT.keyAccount, lang);
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
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">{tt(TEXT.model, lang)}</div>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelKey)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            <option value="HOLT" disabled={!applicability.HOLT.usable}>
              Holt {applicability.HOLT.usable ? "" : "（不适用）"}
            </option>
            <option value="SES" disabled={!applicability.SES.usable}>
              SES {applicability.SES.usable ? "" : "（不适用）"}
            </option>
            <option value="SMA" disabled={!applicability.SMA.usable}>
              SMA {applicability.SMA.usable ? "" : "（不适用）"}
            </option>
            <option value="NAIVE" disabled={!applicability.NAIVE.usable}>
              Naive
            </option>
            <option value="SNAIVE" disabled={!applicability.SNAIVE.usable}>
              Seasonal Naive {applicability.SNAIVE.usable ? "" : "（不适用）"}
            </option>
            <option value="HW" disabled={!applicability.HW.usable}>
              Holt-Winters(季节) {applicability.HW.usable ? "" : "（不适用）"}
            </option>
          </select>

          {warnings.length > 0 && (
            <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">
              {warnings.join("；")}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">{tt(TEXT.horizonLead, lang)}</div>
          <div className="flex gap-2">
            <select
              value={horizonMonths}
              onChange={(e) => setHorizonMonths(Number(e.target.value))}
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 px-3 py-2 text-sm text-slate-900 dark:text-white"
            >
              {[3, 6, 9, 12].map((m) => (
                <option key={m} value={m}>
                  {m}M
                </option>
              ))}
            </select>

            <select
              value={leadTimeMonths}
              onChange={(e) => setLeadTimeMonths(Number(e.target.value))}
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 px-3 py-2 text-sm text-slate-900 dark:text-white"
            >
              {[1, 2, 3].map((m) => (
                <option key={m} value={m}>
                  LT {m}M
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KPI title={tt(TEXT.kpi_current, lang)} value={fmtInt(currentStock)} sub={currentStockSub} />
        <KPI title={tt(TEXT.kpi_safety, lang)} value={fmtInt(safetyStock)} sub={customerTypeDisplay} highlight={safetyStock > 0 ? "blue" : "warn"} />
        <RiskKPI title={tt(TEXT.kpi_risk, lang)} risk={risk} />
        <KPI title={tt(TEXT.kpi_reorder, lang)} value={fmtInt(reorderQty)} sub={tt(TEXT.suggested, lang)} highlight={reorderQty > 0 ? "warn" : "ok"} />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        {/* Left */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">{tt(TEXT.demandForecast, lang)}</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">
                Primary: <span className="font-semibold">{model}</span> · Horizon: <span className="font-semibold">{horizonMonths}M</span> · Lead Time:{" "}
                <span className="font-semibold">{leadTimeMonths}M</span>
                <span className="ml-2 text-[11px] opacity-80">· {tt(TEXT.chartHint, lang)}</span>
              </div>

              {unavailable.length > 0 && (
                <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">
                  {tt(TEXT.modelUnavailableTitle, lang)}
                  {unavailable.join("；")}
                </div>
              )}
            </div>

            <div className="text-right">
              <div className="text-xs text-slate-600 dark:text-slate-300">{tt(TEXT.projectedStockout, lang)}</div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">
                {projectedStockoutMonth ? formatMonthLabel(projectedStockoutMonth) : "-"}
              </div>
            </div>
          </div>

          {/* Range + Chart */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tt(TEXT.actual, lang)} + Naive / SeasonalNaive / SMA / SES / Holt / HW
                <span className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Forecast starts at <span className="font-mono">{forecastStartDate}</span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{tt(TEXT.range, lang)}</span>
                {RANGE.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                      range === r.key
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-transparent text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[320px] min-h-[320px] w-full">
              {demandLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">加载需求中...</div>
              ) : !hasDemand ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                  {demandError || "暂无数据，无法预测"}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minHeight={320}>
                  <LineChart data={displayRows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={12} tickFormatter={xTickFormatter} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend onClick={(data: any) => {
                      const key = data?.dataKey ? String(data.dataKey) : "";
                      if (key) setVisible((v) => ({ ...v, [key]: !v[key] }));
                    }} />
                    <ReferenceLine x={forecastStartDate} strokeDasharray="4 4" />

                    {visible.actual && <Line type="monotone" dataKey="actual" name="Actual" stroke={COLORS.actual} strokeWidth={2.6} dot={false} />}

                    {/* dashed forecasts */}
                    {visible.NAIVE && chartApplicability.NAIVE.usable && (
                      <Line type="monotone" dataKey="NAIVE" name="Naive" stroke={COLORS.NAIVE} strokeWidth={2} dot={false} strokeDasharray="6 4" />
                    )}
                    {visible.SNAIVE && chartApplicability.SNAIVE.usable && (
                      <Line type="monotone" dataKey="SNAIVE" name="Seasonal Naive" stroke={COLORS.SNAIVE} strokeWidth={2} dot={false} strokeDasharray="6 4" />
                    )}
                    {visible.SMA && chartApplicability.SMA.usable && (
                      <Line type="monotone" dataKey="SMA" name="SMA" stroke={COLORS.SMA} strokeWidth={2} dot={false} strokeDasharray="6 4" />
                    )}
                    {visible.SES && chartApplicability.SES.usable && (
                      <Line type="monotone" dataKey="SES" name="SES" stroke={COLORS.SES} strokeWidth={2} dot={false} strokeDasharray="6 4" />
                    )}
                    {visible.HOLT && chartApplicability.HOLT.usable && (
                      <Line type="monotone" dataKey="HOLT" name="Holt" stroke={COLORS.HOLT} strokeWidth={2} dot={false} strokeDasharray="6 4" />
                    )}
                    {visible.HW && chartApplicability.HW.usable && (
                      <Line type="monotone" dataKey="HW" name="Holt-Winters" stroke={COLORS.HW} strokeWidth={2} dot={false} strokeDasharray="6 4" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* quick toggles */}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {(["actual", "NAIVE", "SNAIVE", "SMA", "SES", "HOLT", "HW"] as const).map((k) => {
                const isModel = k !== "actual";
                const usable = !isModel ? true : !!chartApplicability[k as ModelKey]?.usable;
                return (
                  <button
                    key={k}
                    onClick={() => usable && setVisible((v) => ({ ...v, [k]: !v[k] }))}
                    className={`rounded-full border px-3 py-1 font-semibold transition-colors ${
                      !usable
                        ? "opacity-40 cursor-not-allowed bg-transparent text-slate-500 border-slate-300 dark:border-slate-700"
                        : visible[k]
                        ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white"
                        : "bg-transparent text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                    }`}
                    title={!usable ? "该模型不适用于当前数据长度" : ""}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
          </div>

          {/* tables */}
          <details className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <summary className="cursor-pointer px-3 py-2 text-xs font-bold bg-slate-50 dark:bg-slate-900/40 text-slate-900 dark:text-white">
              {tt(TEXT.tables, lang)}
            </summary>
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <MiniTable title="History (last 10)" data={demandHistory.slice(-10)} />
              <MiniTable title="Forecast (next 10)" data={forecast.slice(0, 10)} />
            </div>
          </details>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{tt(TEXT.explainTitle, lang)}</div>
            <div className="mt-1 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
              {tt(TEXT.explainLine1, lang)}
              <br />
              交期内预测需求（{leadTimeMonths} 个月）= <span className="font-semibold">{fmtInt(leadDemand)}</span>
            </div>
          </div>
        </div>

        {/* Right */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <div className="text-sm font-bold text-slate-900 dark:text-white">{tt(TEXT.riskTitle, lang)}</div>
            <div className="mt-2 flex items-end justify-between">
              <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{risk.label}</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">{risk.desc}</div>
            </div>
            <div className="mt-3 text-xs text-slate-600 dark:text-slate-300">{risk.suggestion}</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{tt(TEXT.riskRule, lang)}</div>
          </div>
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

function RiskKPI({
  title,
  risk,
}: {
  title: string;
  risk: { label: string; desc: string; suggestion: string };
}) {
  const badgeColor =
    risk.label.includes("LOW") || risk.label.includes("低")
      ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
      : risk.label.includes("HIGH") || risk.label.includes("高")
      ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
      : "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{title}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{risk.label}</div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${badgeColor}`}>{risk.desc}</span>
      </div>
      <div className="mt-2 text-[10px] text-slate-600 dark:text-slate-400 leading-tight">{risk.suggestion}</div>
    </div>
  );
}

function MiniTable({ title, data }: { title: string; data: { t: string; y: number }[] }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-3 py-2 text-xs font-bold bg-slate-50 dark:bg-slate-900/40 text-slate-900 dark:text-white">
        {title}
      </div>
      <table className="w-full text-xs">
        <thead className="text-slate-600 dark:text-slate-300">
          <tr className="border-t border-slate-100 dark:border-slate-700">
            <th className="text-left p-2 font-semibold">月份</th>
            <th className="text-right p-2 font-semibold">数量</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td className="p-2 text-slate-500 dark:text-slate-400" colSpan={2}>
                暂无数据
              </td>
            </tr>
          ) : (
            data.map((d) => (
              <tr key={d.t} className="border-t border-slate-100 dark:border-slate-700">
                <td className="p-2 font-mono text-slate-700 dark:text-slate-200">{d.t}</td>
                <td className="p-2 text-right text-slate-900 dark:text-white">{d.y}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
