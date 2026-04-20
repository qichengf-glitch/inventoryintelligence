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

type ModelKey = "NAIVE" | "SNAIVE" | "SMA" | "SES" | "HOLT" | "HW" | "LGBM";
type ClassicalModelKey = Exclude<ModelKey, "LGBM">;
type RangeKey = "6M" | "12M" | "18M" | "24M" | "ALL";

const CLASSICAL_MODEL_KEYS: ClassicalModelKey[] = ["NAIVE", "SNAIVE", "SMA", "SES", "HOLT", "HW"];

function asClassicalModel(value: unknown): ClassicalModelKey | null {
  const s = typeof value === "string" ? value.trim() : "";
  return CLASSICAL_MODEL_KEYS.includes(s as ClassicalModelKey) ? (s as ClassicalModelKey) : null;
}
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
  lgbmBadge: { zh: "ML · LightGBM", en: "ML · LightGBM" },
  lgbmLoading: { zh: "ML 预测加载中…", en: "Loading ML forecast…" },
  lgbmNoData: { zh: "暂无 ML 数据，请先运行训练脚本", en: "No ML data — run train.py first" },
  lgbmMetrics: { zh: "回测误差", en: "Backtest Error" },
  lgbmTrainedAt: { zh: "训练时间", en: "Trained at" },

  advancedMlSummary: { zh: "高级 · 机器学习（实验）", en: "Advanced · ML (experimental)" },
  advancedMlHint: {
    zh: "LightGBM 需先在服务端训练并写入数据库；无数据时主预测仍使用上方经典模型。",
    en: "LightGBM requires server-side training and DB rows; without data, forecasts use the classical model above.",
  },
  useMlPrimary: { zh: "使用 LightGBM 作为主预测模型", en: "Use LightGBM as primary forecast" },

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
    zh: "规则：<安全库存=红色；>安全库存10%=黄色；>=2.75倍=黄色；>=3倍=红色。",
    en: "Rules: < safety stock = red; > +10% = yellow; >=2.75x = yellow; >=3x = red.",
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
  aiRiskTitle: { zh: "AI 分析结果和建议", en: "AI Analysis & Suggestions" },
  aiRiskLoading: { zh: "AI 正在分析当前风险与补货参数...", en: "AI is analyzing current risk and replenishment signals..." },
  aiRiskAuto: { zh: "自动生成", en: "Auto-generated" },
  aiRiskMiniChat: { zh: "小聊天", en: "Mini Chat" },
  aiRiskAsk: { zh: "发送", en: "Send" },
  aiRiskAsking: { zh: "发送中...", en: "Sending..." },
  aiRiskInputPlaceholder: {
    zh: "继续追问（如：为什么建议不补货？）",
    en: "Ask a follow-up (e.g. Why no reorder?)",
  },
  aiRiskChatFallback: {
    zh: "AI 暂不可用，请稍后重试。",
    en: "AI is temporarily unavailable. Please try again.",
  },
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

function buildRiskFallbackAdvice({
  lang,
  risk,
  reorderQty,
  leadDemand,
  projectedStockoutMonth,
}: {
  lang: Lang;
  risk: { tone: "green" | "yellow" | "red"; suggestion: string };
  reorderQty: number;
  leadDemand: number;
  projectedStockoutMonth: string | null;
}) {
  const stockoutText = projectedStockoutMonth
    ? lang === "zh"
      ? `预计缺货月 ${formatMonthLabel(projectedStockoutMonth)}`
      : `Projected stockout: ${formatMonthLabel(projectedStockoutMonth)}`
    : lang === "zh"
    ? "暂无明确缺货月"
    : "No clear stockout month";

  if (lang === "zh") {
    return `AI 分析结果和建议：${risk.suggestion}；交期内需求约 ${fmtInt(leadDemand)}，建议补货量 ${fmtInt(
      reorderQty
    )}。${stockoutText}。`;
  }

  return `AI Analysis & Suggestions: ${risk.suggestion}. Lead-time demand is about ${fmtInt(
    leadDemand
  )}, suggested reorder is ${fmtInt(reorderQty)}. ${stockoutText}.`;
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
    // LGBM 可用性由服务端控制，此处标记为始终可用（实际由 mlForecast 状态决定）
    LGBM: { usable: true },
  };

  return map;
}

type ForecastParams = { alpha?: number; beta?: number; gamma?: number };

function forecastByModel(
  model: ModelKey,
  series: number[],
  horizonMonths: number,
  params: ForecastParams = {}
) {
  const h = clamp(horizonMonths, 1, 24);
  const season = 12;
  const a = params.alpha;
  const b = params.beta;
  const g = params.gamma;

  switch (model) {
    case "NAIVE":
      return naiveForecast(series, h);
    case "SNAIVE":
      return seasonalNaiveForecast(series, h, season);
    case "SMA":
      return smaForecast(series, h, 3);
    case "SES":
      return sesForecast(series, h, a ?? 0.3);
    case "HOLT":
      return holtForecast(series, h, a ?? 0.3, b ?? 0.2);
    case "HW":
      return holtWintersAdditive(series, h, season, a ?? 0.3, b ?? 0.15, g ?? 0.2);
    case "LGBM":
      // LGBM is server-side; caller handles this case before calling forecastByModel
      return naiveForecast(series, h);
    default:
      return naiveForecast(series, h);
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
  LGBM?: number;
};

type MlForecastResult = {
  predictions: Array<{ t: string; y: number }>;
  metrics: { mae: number | null; rmse: number | null; mape: number | null } | null;
  model_version: string | null;
  trained_at: string | null;
  message?: string;
};

type ForecastModelSeries = {
  name: ModelKey;
  nextMonths: Array<{ month: string; value: number }>;
};

type ModelBlendSummary = {
  leadDemandByModel: Array<{ name: ModelKey; leadDemand: number }>;
  medianLeadDemand: number;
  minLeadDemand: number;
  maxLeadDemand: number;
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

function buildModelSnapshot(history: DemandPoint[], horizonMonths: number, leadTimeMonths: number): {
  models: ForecastModelSeries[];
  modelBlend: ModelBlendSummary;
} {
  const { rows, applicability } = buildMultiModelChartData(history, horizonMonths);
  const futureRows = rows.filter((r) => r.actual == null).slice(0, Math.max(1, horizonMonths));
  const modelKeys = (["NAIVE", "SNAIVE", "SMA", "SES", "HOLT", "HW"] as ModelKey[]).filter(
    (m) => applicability[m]?.usable
  );

  const models = modelKeys.map((m) => ({
    name: m,
    nextMonths: futureRows
      .map((r) => ({ month: r.t, value: Number((r as any)[m]) }))
      .filter((x) => Number.isFinite(x.value)),
  }));

  const lt = clamp(leadTimeMonths, 1, 12);
  const leadDemandByModel = models.map((m) => ({
    name: m.name as ModelKey,
    leadDemand: Math.round(m.nextMonths.slice(0, lt).reduce((sum, p) => sum + Number(p.value || 0), 0)),
  }));
  const leadVals = leadDemandByModel.map((x) => x.leadDemand).sort((a, b) => a - b);
  const medianLeadDemand =
    leadVals.length === 0
      ? 0
      : leadVals.length % 2 === 1
      ? leadVals[(leadVals.length - 1) / 2]
      : Math.round((leadVals[leadVals.length / 2 - 1] + leadVals[leadVals.length / 2]) / 2);

  const modelBlend: ModelBlendSummary = {
    leadDemandByModel,
    medianLeadDemand,
    minLeadDemand: leadVals.length ? leadVals[0] : 0,
    maxLeadDemand: leadVals.length ? leadVals[leadVals.length - 1] : 0,
  };

  return { models, modelBlend };
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

  type ModelRec = {
    recommended_model: ModelKey;
    best_alpha: number | null;
    best_beta: number | null;
    best_gamma: number | null;
    mape_at_recommendation: number | null;
    mae_at_recommendation: number | null;
    bias_at_recommendation: number | null;
    sample_months: number | null;
    runner_up_model: string | null;
    runner_up_mape: number | null;
    last_run_date: string | null;
  };

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

  // Model recommendation from backtest
  const [modelRec, setModelRec] = useState<ModelRec | null>(null);
  // Whether the user has manually overridden the recommended model
  const [recOverridden, setRecOverridden] = useState(false);

  // ML forecast state
  const [mlForecast, setMlForecast] = useState<MlForecastResult | null>(null);
  const [mlLoading, setMlLoading] = useState(false);

  const [sku, setSku] = useState<string>("FWD100");

  /** Classical (non-ML) primary; backtest recommendation only touches this. */
  const [classicalModel, setClassicalModel] = useState<ClassicalModelKey>("HW");
  /** When true and ML rows exist, effective primary becomes LGBM (see `primaryModel`). */
  const [mlPrimaryEnabled, setMlPrimaryEnabled] = useState(false);

  const mlDataReady = Boolean(mlForecast?.predictions?.length);
  const primaryModel: ModelKey = useMemo(
    () => (mlPrimaryEnabled && mlDataReady ? "LGBM" : classicalModel),
    [mlPrimaryEnabled, mlDataReady, classicalModel]
  );

  useEffect(() => {
    if (mlPrimaryEnabled && !mlDataReady && !mlLoading) {
      setMlPrimaryEnabled(false);
    }
  }, [mlPrimaryEnabled, mlDataReady, mlLoading]);

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

    const loadRecommendation = async () => {
      try {
        const res = await fetch(
          `/api/forecast/backtest/recommendations?sku=${encodeURIComponent(sku)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = await res.json();
        const rec: ModelRec | null = data?.recommendation ?? null;
        setModelRec(rec);
        // Auto-apply recommended model if user hasn't manually overridden
        if (rec && !recOverridden) {
          const cm = asClassicalModel(rec.recommended_model);
          if (cm) setClassicalModel(cm);
        }
      } catch {
        setModelRec(null);
      }
    };

    const loadMlForecast = async () => {
      setMlLoading(true);
      try {
        const res = await fetch(`/api/forecast/ml?sku=${encodeURIComponent(sku)}`, { cache: "no-store" });
        if (!res.ok) { setMlForecast(null); return; }
        const data = await res.json();
        setMlForecast(data as MlForecastResult);
      } catch {
        setMlForecast(null);
      } finally {
        setMlLoading(false);
      }
    };

    loadDemand();
    loadStock();
    loadSafetyStock();
    loadRecommendation();
    loadMlForecast();
  }, [sku]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset override flag when SKU changes so recommendation is auto-applied
  useEffect(() => {
    setRecOverridden(false);
    setMlPrimaryEnabled(false);
  }, [sku]);

  const [customerType, setCustomerType] = useState<CustomerType>("普通");

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

  // applicability + auto-fix classical primary if not usable
  const applicability = useMemo(() => modelApplicability(series.length), [series.length]);
  useEffect(() => {
    if (!applicability[classicalModel]?.usable) {
      const firstOk =
        (["HW", "HOLT", "SES", "SMA", "NAIVE"] as ClassicalModelKey[]).find((m) => applicability[m]?.usable) ??
        "NAIVE";
      setClassicalModel(firstOk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.length]);

  // primary model forecast (for KPI/reorder)
  const forecast = useMemo(() => {
    if (!hasDemand) return [];
    const h = clamp(horizonMonths, 1, 24);

    // When LGBM is primary, use ML predictions from API
    if (primaryModel === "LGBM" && mlForecast && mlForecast.predictions.length > 0) {
      return mlForecast.predictions.slice(0, h).map((p) => ({
        t: p.t,
        y: Math.round(Math.max(0, p.y)),
      }));
    }

    // Use optimised params from backtest recommendation when available
    const recParams: ForecastParams =
      modelRec && !recOverridden
        ? {
            alpha: modelRec.best_alpha ?? undefined,
            beta: modelRec.best_beta ?? undefined,
            gamma: modelRec.best_gamma ?? undefined,
          }
        : {};
    const effectiveModel = primaryModel === "LGBM" ? "HOLT" : primaryModel; // fallback if no ML data
    const pred = applicability[effectiveModel]?.usable
      ? forecastByModel(effectiveModel, series, h, recParams)
      : naiveForecast(series, h);
    const lastDate = demandHistory.at(-1)?.t ?? "2025-01-01";
    return Array.from({ length: pred.length }, (_, i) => ({
      t: addMonthsISO(lastDate, i + 1),
      y: Math.round(Math.max(0, pred[i] ?? 0)),
    }));
  }, [hasDemand, primaryModel, series, horizonMonths, demandHistory, applicability, modelRec, recOverridden, mlForecast]);

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
    if (safetyStock <= 0) {
      return {
        label: tt(TEXT.riskLow, lang),
        desc: tt(TEXT.riskHealthy, lang),
        suggestion: lang === "zh" ? "未配置安全库存，暂按正常状态展示" : "Safety stock is not configured; shown as normal.",
        tone: "green" as const,
      };
    }
    if (currentStock <= 0 || currentStock < safetyStock) {
      return {
        label: tt(TEXT.riskHigh, lang),
        desc: lang === "zh" ? "过低库存（红色）" : "Low stock (Red)",
        suggestion: lang === "zh" ? "库存低于安全库存，建议立即补货" : "Stock is below safety stock. Reorder now.",
        tone: "red" as const,
      };
    }
    if (currentStock >= safetyStock * 3) {
      return {
        label: tt(TEXT.riskHigh, lang),
        desc: lang === "zh" ? "过高库存（红色）" : "Overstock x3 (Red)",
        suggestion: lang === "zh" ? "库存已达安全库存3倍及以上，建议去库存" : "Stock is >= 3x safety. Start de-stocking actions.",
        tone: "red" as const,
      };
    }
    if (currentStock >= safetyStock * 2.75) {
      return {
        label: tt(TEXT.riskMed, lang),
        desc: lang === "zh" ? "高库存（黄色）x2.75" : "High stock x2.75 (Yellow)",
        suggestion: lang === "zh" ? "库存接近过高阈值，建议控制补货节奏" : "Close to critical overstock; slow replenishment.",
        tone: "yellow" as const,
      };
    }
    if (currentStock > safetyStock * 1.1) {
      return {
        label: tt(TEXT.riskMed, lang),
        desc: lang === "zh" ? "高于安全库存10%（黄色）" : "Above safety +10% (Yellow)",
        suggestion: lang === "zh" ? "库存偏高，建议谨慎补货并加快消化" : "Stock is above target; replenish carefully.",
        tone: "yellow" as const,
      };
    }
    return {
      label: tt(TEXT.riskLow, lang),
      desc: tt(TEXT.riskHealthy, lang),
      suggestion: lang === "zh" ? "库存处于目标区间，可维持当前策略" : "Stock is in target range; keep current strategy.",
      tone: "green" as const,
    };
  }, [safetyStock, currentStock, lang]);

  const [aiRiskInsight, setAiRiskInsight] = useState<string>("");
  const [aiRiskLoading, setAiRiskLoading] = useState(false);
  const [aiRiskError, setAiRiskError] = useState<string | null>(null);
  const [aiChatMessages, setAiChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [aiChatError, setAiChatError] = useState<string | null>(null);

  const aiRiskFallback = useMemo(
    () =>
      buildRiskFallbackAdvice({
        lang,
        risk,
        reorderQty,
        leadDemand,
        projectedStockoutMonth,
      }),
    [lang, risk, reorderQty, leadDemand, projectedStockoutMonth]
  );

  useEffect(() => {
    if (!sku) return;
    // Wait until demand data has finished loading and we actually have history.
    // This prevents sending the AI request with currentStock=0 / leadDemand=0
    // while data is still in-flight (race condition).
    if (demandLoading) return;
    if (demandHistory.length === 0) return;
    // Also wait for currentStock to resolve (null means still loading)
    if (currentStockState === null) return;

    const timer = window.setTimeout(async () => {
      setAiRiskLoading(true);
      setAiRiskError(null);

      try {
        const multiModelSnapshot = buildModelSnapshot(demandHistory, horizonMonths, leadTimeMonths);
        const question =
          lang === "zh"
            ? `请综合所有可用预测模型（NAIVE/SNAIVE/SMA/SES/HOLT/HW）后输出一句简短建议，以“AI 分析结果和建议：”开头，不超过120字。SKU=${sku}；风险=${risk.label}/${risk.desc}；当前库存=${currentStock}；安全库存=${safetyStock}；交期内需求=${leadDemand}；建议补货=${reorderQty}；预计缺货月=${projectedStockoutMonth ?? "无"}。`
            : `Synthesize all available forecasting models (NAIVE/SNAIVE/SMA/SES/HOLT/HW) and return one short advice sentence starting with "AI Analysis & Suggestions:" (<=120 chars). SKU=${sku}; risk=${risk.label}/${risk.desc}; current_stock=${currentStock}; safety_stock=${safetyStock}; lead_demand=${leadDemand}; reorder=${reorderQty}; projected_stockout=${projectedStockoutMonth ?? "n/a"}.`;

        const res = await fetch("/api/ai/forecast-advice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            lang,
            model: "gpt-4o-mini",
            recentChat: [],
            forecastSummary: {
              sku,
              model: primaryModel,
              horizonMonths,
              leadTimeMonths,
              currentStock,
              safetyStock,
              leadDemand,
              reorderQty,
              projectedStockoutMonth,
              risk,
              models: multiModelSnapshot.models,
              modelBlend: multiModelSnapshot.modelBlend,
            },
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "AI request failed");
        }

        const answer = typeof data?.answer === "string" ? data.answer.trim() : "";
        setAiRiskInsight(answer || aiRiskFallback);
      } catch (err) {
        setAiRiskError(err instanceof Error ? err.message : "AI request failed");
        setAiRiskInsight(aiRiskFallback);
      } finally {
        setAiRiskLoading(false);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [
    sku,
    risk,
    currentStock,
    currentStockState,
    safetyStock,
    leadDemand,
    reorderQty,
    projectedStockoutMonth,
    demandHistory,
    demandLoading,
    lang,
    primaryModel,
    horizonMonths,
    leadTimeMonths,
    aiRiskFallback,
  ]);

  const handleMiniChatAsk = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = aiChatInput.trim();
    if (!prompt || !sku || aiChatLoading) return;

    setAiChatInput("");
    setAiChatLoading(true);
    setAiChatError(null);
    setAiChatMessages((prev) => [...prev, { role: "user", text: prompt }]);

    try {
      const multiModelSnapshot = buildModelSnapshot(demandHistory, horizonMonths, leadTimeMonths);
      const recentChat = [
        ...(aiRiskInsight ? [{ role: "assistant" as const, text: aiRiskInsight }] : []),
        ...aiChatMessages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
        { role: "user" as const, text: prompt },
      ];

      const res = await fetch("/api/ai/forecast-advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "forecast",
          question: prompt,
          lang,
          model: "gpt-4o-mini",
          recentChat,
          forecastSummary: {
            sku,
            model: primaryModel,
            horizonMonths,
            leadTimeMonths,
            currentStock,
            safetyStock,
            leadDemand,
            reorderQty,
            projectedStockoutMonth,
            risk,
            models: multiModelSnapshot.models,
            modelBlend: multiModelSnapshot.modelBlend,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "AI request failed");
      }

      const answer =
        typeof data?.answer === "string" && data.answer.trim()
          ? data.answer.trim()
          : tt(TEXT.aiRiskChatFallback, lang);
      setAiChatMessages((prev) => [...prev, { role: "assistant", text: answer }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI request failed";
      setAiChatError(message);
      setAiChatMessages((prev) => [...prev, { role: "assistant", text: tt(TEXT.aiRiskChatFallback, lang) }]);
    } finally {
      setAiChatLoading(false);
    }
  };

  const customerTypeDisplay = useMemo(
    () => (customerType === "普通" ? tt(TEXT.regular, lang) : tt(TEXT.keyAccount, lang)),
    [customerType, lang]
  );

  // Multi-model chart rows
  const { rows: baseChartRows, forecastStartDate, applicability: chartApplicability } = useMemo(
    () => buildMultiModelChartData(demandHistory, horizonMonths),
    [demandHistory, horizonMonths]
  );

  // Merge LGBM predictions into chart rows
  const chartRows: ChartRow[] = useMemo(() => {
    if (!mlForecast || !mlForecast.predictions.length) return baseChartRows;
    const lgbmMap = new Map(mlForecast.predictions.map((p) => [p.t, Math.round(p.y)]));
    return baseChartRows.map((row) => ({
      ...row,
      LGBM: lgbmMap.get(row.t) ?? undefined,
    }));
  }, [baseChartRows, mlForecast]);

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
    LGBM: true,
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
    LGBM: "#c084fc", // purple — ML model
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

  // Persist a compact summary for the home AI assistant.
  useEffect(() => {
    if (typeof window === "undefined" || !hasDemand) return;

    const multiModelSnapshot = buildModelSnapshot(demandHistory, horizonMonths, leadTimeMonths);

    const payload = {
      sku,
      model: primaryModel,
      horizonMonths,
      leadTimeMonths,
      currentStock,
      safetyStock,
      leadDemand,
      reorderQty,
      projectedStockoutMonth,
      risk,
      models: multiModelSnapshot.models.map((m) => ({
        name: m.name,
        nextMonths: m.nextMonths.slice(0, 6),
      })),
      modelBlend: multiModelSnapshot.modelBlend,
      generatedAt: new Date().toISOString(),
    };

    localStorage.setItem("ii:forecast:latest", JSON.stringify(payload));
  }, [
    hasDemand,
    sku,
    primaryModel,
    horizonMonths,
    leadTimeMonths,
    currentStock,
    safetyStock,
    leadDemand,
    reorderQty,
    projectedStockoutMonth,
    risk,
    chartRows,
    chartApplicability,
    demandHistory,
  ]);

  // Model blend snapshot for the table
  const modelBlendSnapshot = useMemo(
    () => (hasDemand ? buildModelSnapshot(demandHistory, horizonMonths, leadTimeMonths) : null),
    [hasDemand, demandHistory, horizonMonths, leadTimeMonths]
  );

  const CARD = "rounded-2xl border border-slate-800 bg-slate-900/70 shadow-[0_10px_25px_rgba(2,6,23,0.35)]";
  const SELECT_CLS = "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400";

  return (
    <div className="space-y-4">

      {/* Controls row */}
      <div className={`${CARD} p-4`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* SKU */}
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-1.5">{tt(TEXT.sku, lang)}</p>
            <select value={sku} onChange={(e) => setSku(e.target.value)} className={SELECT_CLS}>
              {skuList.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {skuLoading && <p className="mt-1 text-[11px] text-slate-500">加载中…</p>}
            {skuError && <p className="mt-1 text-[11px] text-amber-400">{skuError}</p>}
            {!demandHistory.length && !skuLoading && (
              <p className="mt-1 text-[11px] text-amber-400">该 SKU 暂无月度数据</p>
            )}
          </div>

          {/* Customer type */}
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-1.5">{tt(TEXT.customerType, lang)}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(["普通", "大客户"] as CustomerType[]).map((ct) => (
                <button
                  key={ct}
                  type="button"
                  onClick={() => setCustomerType(ct)}
                  className={`rounded-xl border px-2 py-2 text-xs font-semibold transition-colors ${
                    customerType === ct
                      ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-200"
                      : "border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {ct === "普通" ? tt(TEXT.regular, lang) : tt(TEXT.keyAccount, lang)}
                </button>
              ))}
            </div>
          </div>

          {/* Primary model */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-xs font-semibold text-slate-400">{tt(TEXT.model, lang)}</p>
              {modelRec && !recOverridden && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  AI推荐{modelRec.mape_at_recommendation != null ? ` · MAPE ${modelRec.mape_at_recommendation.toFixed(1)}%` : ""}
                </span>
              )}
              {modelRec && recOverridden && (
                <button
                  type="button"
                  onClick={() => {
                    setRecOverridden(false);
                    setMlPrimaryEnabled(false);
                    const cm = asClassicalModel(modelRec.recommended_model);
                    if (cm) setClassicalModel(cm);
                  }}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 underline"
                >
                  {lang === "zh" ? "恢复推荐" : "Use recommended"}
                </button>
              )}
            </div>
            <select
              value={classicalModel}
              onChange={(e) => {
                setClassicalModel(e.target.value as ClassicalModelKey);
                setRecOverridden(true);
                setMlPrimaryEnabled(false);
              }}
              className={SELECT_CLS}
            >
              {(["HOLT", "SES", "SMA", "NAIVE", "SNAIVE", "HW"] as ClassicalModelKey[]).map((m) => (
                <option key={m} value={m} disabled={!applicability[m].usable}>
                  {m === "SNAIVE" ? "Seasonal Naive" : m === "HW" ? "Holt-Winters" : m}
                  {!applicability[m].usable ? "（不适用）" : ""}
                  {modelRec?.recommended_model === m && !recOverridden ? " ★" : ""}
                </option>
              ))}
            </select>
            <details className="mt-2 rounded-lg border border-slate-800/80 bg-slate-950/40">
              <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200 [&::-webkit-details-marker]:hidden flex items-center gap-1">
                <span className="text-slate-500 select-none" aria-hidden>
                  ▸
                </span>
                {tt(TEXT.advancedMlSummary, lang)}
              </summary>
              <div className="border-t border-slate-800/80 px-2 py-2 space-y-2">
                <p className="text-[10px] text-slate-500 leading-relaxed">{tt(TEXT.advancedMlHint, lang)}</p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-600"
                    checked={mlPrimaryEnabled}
                    disabled={!mlDataReady}
                    onChange={(e) => setMlPrimaryEnabled(e.target.checked)}
                  />
                  <span className="text-[11px] text-slate-300">{tt(TEXT.useMlPrimary, lang)}</span>
                </label>
                {mlLoading && <p className="text-[10px] text-slate-500">{tt(TEXT.lgbmLoading, lang)}</p>}
                {!mlLoading && !mlDataReady && mlForecast?.message && (
                  <p className="text-[10px] text-amber-400/90">{mlForecast.message}</p>
                )}
              </div>
            </details>
            {warnings.length > 0 && <p className="mt-1 text-[11px] text-amber-400">{warnings.join("；")}</p>}
          </div>

          {/* Horizon + Lead time */}
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-1.5">{tt(TEXT.horizonLead, lang)}</p>
            <div className="flex gap-2">
              <select value={horizonMonths} onChange={(e) => setHorizonMonths(Number(e.target.value))} className={SELECT_CLS}>
                {[3, 6, 9, 12].map((m) => <option key={m} value={m}>{m}M</option>)}
              </select>
              <select value={leadTimeMonths} onChange={(e) => setLeadTimeMonths(Number(e.target.value))} className={SELECT_CLS}>
                {[1, 2, 3].map((m) => <option key={m} value={m}>LT {m}M</option>)}
              </select>
            </div>
          </div>
        </div>

        {unavailable.length > 0 && (
          <p className="mt-3 text-[11px] text-amber-400/80">
            {tt(TEXT.modelUnavailableTitle, lang)}{unavailable.join("；")}
          </p>
        )}
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI title={tt(TEXT.kpi_current, lang)} value={fmtInt(currentStock)} sub={currentStockSub} />
        <KPI title={tt(TEXT.kpi_safety, lang)} value={fmtInt(safetyStock)} sub={customerTypeDisplay} highlight={safetyStock > 0 ? "blue" : "warn"} />
        <RiskKPI title={tt(TEXT.kpi_risk, lang)} risk={risk} />
        <KPI title={tt(TEXT.kpi_reorder, lang)} value={fmtInt(reorderQty)} sub={tt(TEXT.suggested, lang)} highlight={reorderQty > 0 ? "warn" : "ok"} />
      </div>

      {/* Main content: chart + AI panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">

        {/* Chart card */}
        <div className={`${CARD} p-4 space-y-3`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-100">{tt(TEXT.demandForecast, lang)}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {lang === "zh" ? "主模型" : "Primary"}：
                <span className="text-slate-200 font-medium">
                  {primaryModel === "LGBM"
                    ? lang === "zh"
                      ? "LGBM（实验）"
                      : "LGBM (experimental)"
                    : primaryModel}
                </span>
                {modelRec && !recOverridden && primaryModel !== "LGBM" && modelRec.best_alpha != null && (
                  <span className="text-emerald-400/80 ml-1">
                    (α={modelRec.best_alpha}
                    {modelRec.best_beta != null ? ` β=${modelRec.best_beta}` : ""}
                    {modelRec.best_gamma != null ? ` γ=${modelRec.best_gamma}` : ""}
                    )
                  </span>
                )}
                {" · "}预测：<span className="text-slate-200 font-medium">{horizonMonths}M</span>
                {" · "}交期：<span className="text-slate-200 font-medium">{leadTimeMonths}M</span>
                {" · "}<span className="text-slate-500">{tt(TEXT.chartHint, lang)}</span>
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-slate-400">{tt(TEXT.projectedStockout, lang)}</p>
              <p className={`text-sm font-bold mt-0.5 ${projectedStockoutMonth ? "text-red-300" : "text-slate-400"}`}>
                {projectedStockoutMonth ? formatMonthLabel(projectedStockoutMonth) : "—"}
              </p>
            </div>
          </div>

          {/* Range buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">{tt(TEXT.range, lang)}</span>
            {RANGE.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={`rounded-full border px-3 py-0.5 text-xs font-semibold transition-colors ${
                  range === r.key
                    ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-200"
                    : "border-slate-700 text-slate-400 hover:text-slate-200"
                }`}
              >
                {r.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-slate-500">
              {lang === "zh" ? "预测起点" : "Forecast from"} <span className="font-mono text-slate-400">{forecastStartDate}</span>
            </span>
          </div>

          {/* Chart */}
          <div className="h-[300px] w-full rounded-xl border border-slate-800 bg-slate-950/60 p-2">
            {demandLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500 animate-pulse">
                {lang === "zh" ? "加载需求中…" : "Loading demand…"}
              </div>
            ) : !hasDemand ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">
                {demandError || (lang === "zh" ? "暂无数据，无法预测" : "No data available")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={displayRows} margin={{ top: 6, right: 10, bottom: 6, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: "#94a3b8" }} minTickGap={14} tickFormatter={xTickFormatter} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: "#94a3b8" }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    onClick={(data: any) => {
                      const key = data?.dataKey ? String(data.dataKey) : "";
                      if (key) setVisible((v) => ({ ...v, [key]: !v[key] }));
                    }}
                  />
                  <ReferenceLine x={forecastStartDate} strokeDasharray="4 4" stroke="#475569" />
                  {visible.actual && <Line type="monotone" dataKey="actual" name="历史" stroke={COLORS.actual} strokeWidth={2.5} dot={false} />}
                  {visible.NAIVE && chartApplicability.NAIVE.usable && <Line type="monotone" dataKey="NAIVE" name="Naive" stroke={COLORS.NAIVE} strokeWidth={1.5} dot={false} strokeDasharray="6 3" />}
                  {visible.SNAIVE && chartApplicability.SNAIVE.usable && <Line type="monotone" dataKey="SNAIVE" name="SNaive" stroke={COLORS.SNAIVE} strokeWidth={1.5} dot={false} strokeDasharray="6 3" />}
                  {visible.SMA && chartApplicability.SMA.usable && <Line type="monotone" dataKey="SMA" name="SMA" stroke={COLORS.SMA} strokeWidth={1.5} dot={false} strokeDasharray="6 3" />}
                  {visible.SES && chartApplicability.SES.usable && <Line type="monotone" dataKey="SES" name="SES" stroke={COLORS.SES} strokeWidth={1.5} dot={false} strokeDasharray="6 3" />}
                  {visible.HOLT && chartApplicability.HOLT.usable && <Line type="monotone" dataKey="HOLT" name="Holt" stroke={COLORS.HOLT} strokeWidth={1.5} dot={false} strokeDasharray="6 3" />}
                  {visible.HW && chartApplicability.HW.usable && <Line type="monotone" dataKey="HW" name="HW" stroke={COLORS.HW} strokeWidth={1.5} dot={false} strokeDasharray="6 3" />}
                  {visible.LGBM && mlForecast && mlForecast.predictions.length > 0 && (
                    <Line type="monotone" dataKey="LGBM" name="LGBM (ML)" stroke={COLORS.LGBM} strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Model toggle pills */}
          <div className="flex flex-wrap gap-1.5">
            {(["actual", "NAIVE", "SNAIVE", "SMA", "SES", "HOLT", "HW"] as const).map((k) => {
              const isModel = k !== "actual";
              const usable = !isModel || !!chartApplicability[k as ModelKey]?.usable;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => usable && setVisible((v) => ({ ...v, [k]: !v[k] }))}
                  style={{ borderColor: usable ? COLORS[k] : undefined, color: visible[k] && usable ? COLORS[k] : undefined }}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-all ${
                    !usable
                      ? "opacity-30 cursor-not-allowed border-slate-700 text-slate-600"
                      : visible[k]
                      ? "opacity-100"
                      : "opacity-40"
                  }`}
                  title={!usable ? "该模型不适用于当前数据长度" : ""}
                >
                  {k === "actual" ? (lang === "zh" ? "历史" : "Actual") : k}
                </button>
              );
            })}
          </div>

          {/* Model blend comparison table */}
          {modelBlendSnapshot && modelBlendSnapshot.modelBlend.leadDemandByModel.length > 0 && (
            <div className="rounded-xl border border-slate-800 overflow-hidden">
              <div className="px-3 py-2 bg-slate-900/60 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-300">
                  {lang === "zh" ? `各模型交期需求对比（${leadTimeMonths}个月）` : `Lead-time demand by model (${leadTimeMonths}M)`}
                </p>
                <div className="flex gap-3 text-[10px] text-slate-500">
                  <span>{lang === "zh" ? "中位数" : "Median"}: <span className="text-slate-300 font-mono">{fmtInt(modelBlendSnapshot.modelBlend.medianLeadDemand)}</span></span>
                  <span>{lang === "zh" ? "区间" : "Range"}: <span className="text-slate-300 font-mono">{fmtInt(modelBlendSnapshot.modelBlend.minLeadDemand)} – {fmtInt(modelBlendSnapshot.modelBlend.maxLeadDemand)}</span></span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody>
                    <tr className="divide-x divide-slate-800">
                      {modelBlendSnapshot.modelBlend.leadDemandByModel.map(({ name, leadDemand: ld }) => (
                        <td key={name} className={`px-3 py-2 text-center ${name === primaryModel ? "bg-cyan-500/10" : ""}`}>
                          <p className="text-[10px] text-slate-500 mb-0.5" style={{ color: COLORS[name] ?? undefined }}>{name}</p>
                          <p className="font-mono font-semibold text-slate-100">{fmtInt(ld)}</p>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Reorder logic */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5">
            <p className="text-xs font-semibold text-slate-400 mb-1">{tt(TEXT.explainTitle, lang)}</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              {tt(TEXT.explainLine1, lang)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {lang === "zh" ? "交期内预测需求" : "Lead-time demand"}（{leadTimeMonths}{lang === "zh" ? "月" : "M"}）= <span className="font-semibold text-slate-200">{fmtInt(leadDemand)}</span>
            </p>
          </div>

          {/* History / Forecast tables */}
          <details className="rounded-xl border border-slate-800 overflow-hidden">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-400 bg-slate-900/40 hover:text-slate-200">
              {tt(TEXT.tables, lang)}
            </summary>
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <MiniTable title={lang === "zh" ? "历史（最近10条）" : "History (last 10)"} data={demandHistory.slice(-10)} />
              <MiniTable title={lang === "zh" ? "预测（未来10条）" : "Forecast (next 10)"} data={forecast.slice(0, 10)} />
            </div>
          </details>
        </div>

        {/* ── Right column wrapper — keeps the 2-col grid stable ── */}
        <div className="space-y-3">

          {/* Backtest Accuracy Card */}
          {modelRec && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 uppercase tracking-wide">
                  {lang === "zh" ? "回测精度" : "Backtest Accuracy"}
                </span>
                {modelRec.last_run_date && (
                  <span className="text-[10px] text-emerald-400/60">
                    {lang === "zh" ? "更新" : "Updated"}: {modelRec.last_run_date.slice(0, 10)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="text-emerald-200">
                  {lang === "zh" ? "推荐模型" : "Best model"}:{" "}
                  <span className="font-semibold">{modelRec.recommended_model}</span>
                </span>
                {modelRec.mape_at_recommendation != null && (
                  <span className="text-emerald-200">MAPE <span className="font-semibold">{modelRec.mape_at_recommendation.toFixed(1)}%</span></span>
                )}
                {modelRec.mae_at_recommendation != null && (
                  <span className="text-emerald-200">MAE <span className="font-semibold">{modelRec.mae_at_recommendation.toFixed(1)}</span></span>
                )}
                {modelRec.bias_at_recommendation != null && (
                  <span className="text-emerald-200">
                    {lang === "zh" ? "偏差" : "Bias"}{" "}
                    <span className={`font-semibold ${modelRec.bias_at_recommendation > 0 ? "text-amber-300" : "text-sky-300"}`}>
                      {modelRec.bias_at_recommendation > 0 ? "+" : ""}{modelRec.bias_at_recommendation.toFixed(1)}
                    </span>
                  </span>
                )}
              </div>
              {(modelRec.sample_months != null || modelRec.runner_up_model) && (
                <p className="text-[10px] text-emerald-400/60 leading-relaxed">
                  {modelRec.sample_months != null && (lang === "zh" ? `基于 ${modelRec.sample_months} 个月样本` : `${modelRec.sample_months}-month sample`)}
                  {modelRec.runner_up_model && (
                    <span>
                      {modelRec.sample_months != null ? " · " : ""}
                      {lang === "zh" ? "备选" : "Runner-up"}: {modelRec.runner_up_model}
                      {modelRec.runner_up_mape != null ? ` (MAPE ${modelRec.runner_up_mape.toFixed(1)}%)` : ""}
                    </span>
                  )}
                </p>
              )}
            </div>
          )}

          {/* ML Forecast Metrics Card */}
          {(mlForecast || mlLoading) && (
            <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-purple-400/40 bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300 uppercase tracking-wide">
                  {tt(TEXT.lgbmBadge, lang)}
                </span>
                {mlForecast?.trained_at && (
                  <span className="text-[10px] text-purple-400/70">
                    {tt(TEXT.lgbmTrainedAt, lang)}: {mlForecast.trained_at.slice(0, 10)}
                  </span>
                )}
              </div>
              {mlLoading && (
                <p className="text-xs text-purple-300/70 animate-pulse">{tt(TEXT.lgbmLoading, lang)}</p>
              )}
              {!mlLoading && mlForecast && mlForecast.predictions.length === 0 && (
                <p className="text-xs text-purple-300/70">{tt(TEXT.lgbmNoData, lang)}</p>
              )}
              {!mlLoading && mlForecast?.metrics && (() => {
                const mape = mlForecast.metrics.mape != null ? mlForecast.metrics.mape * 100 : null;
                const mae = mlForecast.metrics.mae ?? null;
                // Reliability: warn if MAPE > 200% or MAE > 3x average velocity (heuristic)
                const unreliable = (mape != null && mape > 200) || (mae != null && mae > 500);
                return (
                  <>
                    {unreliable && (
                      <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
                        <span className="text-amber-400 mt-0.5">⚠</span>
                        <p className="text-[10px] text-amber-300 leading-relaxed">
                          {lang === "zh"
                            ? "此 SKU 需求稀少或波动极大，ML 指标失真（MAPE 对零需求无效）。建议参考统计模型。"
                            : "This SKU has sparse/volatile demand — ML metrics are distorted (MAPE is meaningless near-zero). Consider statistical models instead."}
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3 text-xs">
                      {mae != null && (
                        <span className={unreliable ? "text-purple-300/50" : "text-purple-200"}>
                          MAE <span className="font-semibold">{mae.toFixed(1)}</span>
                        </span>
                      )}
                      {mlForecast.metrics.rmse != null && (
                        <span className={unreliable ? "text-purple-300/50" : "text-purple-200"}>
                          RMSE <span className="font-semibold">{mlForecast.metrics.rmse.toFixed(1)}</span>
                        </span>
                      )}
                      {mape != null && (
                        <span className={unreliable ? "text-purple-300/50 line-through" : "text-purple-200"}>
                          MAPE <span className="font-semibold">{mape.toFixed(1)}%</span>
                        </span>
                      )}
                      {!unreliable && (
                        <span className="text-purple-400/60">· {lang === "zh" ? "回测误差（walk-forward）" : "walk-forward backtest error"}</span>
                      )}
                    </div>
                  </>
                );
              })()}
              {!mlLoading && mlForecast && mlForecast.predictions.length > 0 && (
                <p className="text-[10px] text-purple-400/60">
                  {lang === "zh"
                    ? `预测未来 ${mlForecast.predictions.length} 个月 · 版本 ${mlForecast.model_version ?? "—"} · 图表中以紫色虚线展示`
                    : `${mlForecast.predictions.length}-month forecast · version ${mlForecast.model_version ?? "—"} · shown as purple dashed line`}
                </p>
              )}
            </div>
          )}

          {/* AI copilot panel */}
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-indigo-200">{tt(TEXT.aiRiskTitle, lang)}</p>
            <span className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
              {tt(TEXT.aiRiskMiniChat, lang)}
            </span>
          </div>

          <div className="rounded-xl border border-indigo-400/20 bg-slate-900/40 px-3 py-2.5 text-xs leading-relaxed text-indigo-100/90 min-h-[56px]">
            {aiRiskLoading
              ? <span className="animate-pulse text-indigo-300/70">{tt(TEXT.aiRiskLoading, lang)}</span>
              : aiRiskInsight || aiRiskFallback}
          </div>

          {(aiRiskError || aiChatError) && (
            <p className="text-[10px] text-indigo-300/70">
              {lang === "zh" ? "AI 暂不可用，已展示本地建议。" : "AI unavailable — fallback shown."}
            </p>
          )}

          {/* Chat history */}
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-indigo-400/20 bg-slate-900/30 p-2">
            {aiChatMessages.length === 0 ? (
              <p className="text-[11px] text-indigo-300/60">
                {lang === "zh" ? "可在此追问模型与补货细节。" : "Ask follow-up questions here."}
              </p>
            ) : (
              aiChatMessages.map((msg, idx) => (
                <div
                  key={`${msg.role}-${idx}`}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
                    msg.role === "user"
                      ? "ml-8 bg-indigo-600/80 text-white"
                      : "mr-8 bg-indigo-500/15 text-indigo-100"
                  }`}
                >
                  {msg.text}
                </div>
              ))
            )}
            {aiChatLoading && (
              <div className="mr-8 rounded-lg bg-indigo-500/15 px-2.5 py-1.5 text-[11px] text-indigo-300 animate-pulse">
                {tt(TEXT.aiRiskAsking, lang)}
              </div>
            )}
          </div>

          {/* Chat input */}
          <form onSubmit={handleMiniChatAsk} className="flex items-center gap-2">
            <input
              value={aiChatInput}
              onChange={(e) => setAiChatInput(e.target.value)}
              placeholder={tt(TEXT.aiRiskInputPlaceholder, lang)}
              className="min-w-0 flex-1 rounded-xl border border-indigo-400/30 bg-slate-900/40 px-3 py-1.5 text-xs text-indigo-100 placeholder:text-indigo-400/50 outline-none focus:border-indigo-400"
            />
            <button
              type="submit"
              disabled={aiChatLoading || !aiChatInput.trim()}
              className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tt(TEXT.aiRiskAsk, lang)}
            </button>
          </form>
        </div>

        {/* end right column wrapper */}
        </div>
      </div>
    </div>
  );
}

// -------------------- Components --------------------
function KPI({ title, value, sub, highlight }: { title: string; value: string; sub?: string; highlight?: "ok" | "warn" | "blue" }) {
  const badge =
    highlight === "warn" ? "bg-red-500/15 text-red-300 border border-red-400/30"
    : highlight === "ok" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30"
    : "bg-blue-500/15 text-blue-300 border border-blue-400/30";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-xs font-semibold text-slate-400">{title}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-2xl font-extrabold text-slate-100">{value}</p>
        {sub && <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${badge}`}>{sub}</span>}
      </div>
    </div>
  );
}

function RiskKPI({ title, risk }: { title: string; risk: { label: string; desc: string; suggestion: string; tone: "green" | "yellow" | "red" } }) {
  const badgeColor =
    risk.tone === "red" ? "bg-red-500/15 text-red-300 border border-red-400/30"
    : risk.tone === "yellow" ? "bg-amber-500/15 text-amber-300 border border-amber-400/30"
    : "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-xs font-semibold text-slate-400">{title}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-2xl font-extrabold text-slate-100">{risk.label}</p>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${badgeColor}`}>{risk.desc}</span>
      </div>
      <p className="mt-2 text-[10px] text-slate-400 leading-tight">{risk.suggestion}</p>
    </div>
  );
}

function MiniTable({ title, data }: { title: string; data: { t: string; y: number }[] }) {
  return (
    <div className="rounded-xl border border-slate-800 overflow-hidden">
      <div className="px-3 py-2 text-xs font-semibold text-slate-300 bg-slate-900/60">{title}</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-t border-slate-800 text-slate-400">
            <th className="text-left p-2 font-medium">月份</th>
            <th className="text-right p-2 font-medium">数量</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr><td className="p-2 text-slate-500" colSpan={2}>暂无数据</td></tr>
          ) : (
            data.map((d) => (
              <tr key={d.t} className="border-t border-slate-800">
                <td className="p-2 font-mono text-slate-300">{d.t}</td>
                <td className="p-2 text-right text-slate-100">{d.y}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
