"use client";

import { useEffect, useState, useMemo } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ScatterChart, Scatter, CartesianGrid, Legend,
} from "recharts";

/* ─── Types ─────────────────────────────────────────────── */
type SkuPerformance = {
  sku: string;
  category: string | null;
  sample_months: number;
  sales_velocity: number;
  avg_end_stock: number;
  latest_stock: number;
  growth_pct: number;
  turnover_ratio: number;
  margin_pct: number | null;
  gross_profit_avg: number | null;
  price: number | null;
  cost: number | null;
  stock_health: 0 | 1 | 2;
  safety_stock: number | null;
  high_stock: number | null;
  composite_score: number;
  promo_opportunity: boolean;
};

type CategoryStat = {
  category: string;
  sku_count: number;
  avg_score: number;
  avg_velocity: number;
};

type ApiResponse = {
  total_skus: number;
  promo_opportunities: number;
  category_stats: CategoryStat[];
  skus: SkuPerformance[];
  computed_at: string;
};

function normalizeMarketingPayload(raw: unknown): ApiResponse {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    total_skus: typeof d.total_skus === "number" ? d.total_skus : 0,
    promo_opportunities: typeof d.promo_opportunities === "number" ? d.promo_opportunities : 0,
    category_stats: Array.isArray(d.category_stats) ? (d.category_stats as CategoryStat[]) : [],
    skus: Array.isArray(d.skus) ? (d.skus as SkuPerformance[]) : [],
    computed_at: typeof d.computed_at === "string" ? d.computed_at : "",
  };
}

/* ─── AI Advisor Types ───────────────────────────────────── */
type CampaignSuggestion = {
  id: string;
  title: string;
  target_type: "sku" | "category" | "bundle";
  targets: string[];
  timing: string;
  channel: string[];
  mechanic: string;
  discount_pct: number | null;
  priority: "high" | "medium" | "low";
  rationale: string;
  expected_outcome: string;
};

/* ─── Constants ──────────────────────────────────────────── */
const CARD = "rounded-2xl border border-slate-800 bg-slate-900/70";
const TABS_INNER = ["leaderboard", "promo", "category", "ai"] as const;
type InnerTab = (typeof TABS_INNER)[number];
type InnerTabLabelEntry = { zh: string; en: string };
type InnerTabLabelsMap = { [K in InnerTab]: InnerTabLabelEntry };

const STOCK_META = {
  0: { label: { zh: "库存不足", en: "Understocked" }, color: "#f87171", bg: "bg-red-500/20 text-red-300 border-red-500/30" },
  1: { label: { zh: "正常", en: "Healthy" }, color: "#34d399", bg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  2: { label: { zh: "库存过高", en: "Overstocked" }, color: "#fb923c", bg: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
};

const SCORE_COLOR = (s: number) =>
  s >= 70 ? "#22d3ee" : s >= 50 ? "#a78bfa" : s >= 30 ? "#fb923c" : "#94a3b8";

/* ─── Helpers ────────────────────────────────────────────── */
function fmt(n: number | null | undefined, decimals = 0) {
  if (n == null) return "—";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/* ─── Component ──────────────────────────────────────────── */
export default function MarketingPage() {
  const { lang } = useLanguage();
  const isZh = lang === "zh";

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [innerTab, setInnerTab] = useState<InnerTab>("leaderboard");
  const [sortBy, setSortBy] = useState<string>("score");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [searchQ, setSearchQ] = useState<string>("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // AI Advisor state
  const [aiCampaigns, setAiCampaigns] = useState<CampaignSuggestion[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiModelUsed, setAiModelUsed] = useState<string>("");
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string>("");
  const [aiFocus, setAiFocus] = useState<string>("");

  /* Fetch data */
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "300", sort: sortBy });
    if (categoryFilter) params.set("category", categoryFilter);
    fetch(`/api/marketing/performance?${params}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          const msg = typeof d?.error === "string" ? d.error : `HTTP ${r.status}`;
          throw new Error(msg);
        }
        return normalizeMarketingPayload(d);
      })
      .then((d) => setData(d))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Request failed");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [sortBy, categoryFilter]);

  /* Reset page when search changes */
  useEffect(() => { setPage(1); }, [searchQ, categoryFilter]);

  /* Filtered + paged rows */
  const filteredSkus = useMemo(() => {
    if (!data) return [];
    const q = searchQ.trim().toLowerCase();
    const rows = data.skus ?? [];
    return rows.filter(
      (s) => !q || s.sku.toLowerCase().includes(q) || (s.category ?? "").toLowerCase().includes(q)
    );
  }, [data, searchQ]);

  const pagedSkus = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSkus.slice(start, start + PAGE_SIZE);
  }, [filteredSkus, page]);

  const totalPages = Math.ceil(filteredSkus.length / PAGE_SIZE);

  /* Promo list */
  const promoSkus = useMemo(
    () => (data?.skus ?? []).filter((s) => s.promo_opportunity).slice(0, 50),
    [data]
  );

  /* Star/Dog quadrant for scatter */
  const scatterData = useMemo(
    () =>
      (data?.skus ?? [])
        .filter((s) => s.margin_pct !== null)
        .slice(0, 100)
        .map((s) => ({
          sku: s.sku,
          x: s.sales_velocity,
          y: s.margin_pct!,
          score: s.composite_score,
          category: s.category ?? "—",
        })),
    [data]
  );

  /* AI Advisor fetch */
  const fetchAiCampaigns = () => {
    if (!data || data.skus.length === 0) return;
    setAiLoading(true);
    setAiError(null);
    fetch("/api/marketing/ai-advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skus: data.skus.slice(0, 60),
        category_stats: data.category_stats,
        focus: aiFocus.trim(),
        lang,
      }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        setAiCampaigns(Array.isArray(d.campaigns) ? d.campaigns : []);
        setAiModelUsed(d.model_used ?? "");
        setAiGeneratedAt(d.generated_at ?? "");
      })
      .catch((e) => setAiError(e instanceof Error ? e.message : "AI request failed"))
      .finally(() => setAiLoading(false));
  };

  /* ─── UI ──────────────────────────────────────────────── */
  const INNER_TAB_LABELS: InnerTabLabelsMap = {
    leaderboard: { zh: "产品排行榜", en: "Leaderboard" },
    promo: { zh: "推广机会", en: "Promo Opportunities" },
    category: { zh: "品类分析", en: "Category Analysis" },
    ai: { zh: "AI 活动建议", en: "AI Campaigns" },
  };

  if (loading) {
    return (
      <div className={`${CARD} p-8 text-center`}>
        <p className="animate-pulse text-slate-400">{isZh ? "正在计算产品绩效评分…" : "Computing product performance scores…"}</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className={`${CARD} p-8 text-center text-red-400`}>
        {isZh ? `加载失败：${error}` : `Failed to load: ${error}`}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title={isZh ? "分析 SKU 数" : "SKUs Analysed"}
          value={data.total_skus.toLocaleString()}
          color="cyan"
        />
        <KpiCard
          title={isZh ? "品类数" : "Categories"}
          value={data.category_stats.length.toLocaleString()}
          color="purple"
        />
        <KpiCard
          title={isZh ? "推广机会" : "Promo Opportunities"}
          value={data.promo_opportunities.toLocaleString()}
          sub={isZh ? "库存过高 + 利润空间充足" : "Overstocked + margin headroom"}
          color="orange"
        />
        <KpiCard
          title={isZh ? "平均综合评分" : "Avg Composite Score"}
          value={
            data.skus.length
              ? Math.round(data.skus.reduce((s, r) => s + r.composite_score, 0) / data.skus.length).toString()
              : "—"
          }
          sub="/100"
          color="green"
        />
      </div>

      {/* Inner tab nav */}
      <div className={`${CARD} px-5 py-3`}>
        <div className="flex gap-1 border-b border-slate-700">
          {TABS_INNER.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setInnerTab(t)}
              className={`px-4 py-1.5 text-sm font-medium border-b-2 -mb-[1px] transition-colors ${
                innerTab === t
                  ? "border-cyan-400 text-cyan-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {INNER_TAB_LABELS[t][lang]}
              {t === "promo" && data.promo_opportunities > 0 && (
                <span className="ml-1.5 rounded-full bg-orange-500/30 px-1.5 py-0.5 text-[10px] font-bold text-orange-300">
                  {data.promo_opportunities}
                </span>
              )}
              {t === "ai" && (
                <span className="ml-1 text-[10px]">✨</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Leaderboard ─────────────────────────────── */}
      {innerTab === "leaderboard" && (
        <div className={`${CARD} p-4 space-y-3`}>
          {/* Controls */}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={isZh ? "搜索 SKU…" : "Search SKU…"}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 w-36"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="">{isZh ? "全部品类" : "All categories"}</option>
              {data.category_stats.map((c) => (
                <option key={c.category} value={c.category}>{c.category}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="score">{isZh ? "排序：综合评分" : "Sort: Composite score"}</option>
              <option value="velocity">{isZh ? "排序：销售速度" : "Sort: Sales velocity"}</option>
              <option value="margin">{isZh ? "排序：利润率" : "Sort: Margin %"}</option>
              <option value="turnover">{isZh ? "排序：库存周转率" : "Sort: Turnover ratio"}</option>
              <option value="growth">{isZh ? "排序：增长率" : "Sort: Growth rate"}</option>
            </select>
            <span className="ml-auto text-[11px] text-slate-500">
              {filteredSkus.length} {isZh ? "个 SKU" : "SKUs"}
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="text-left py-2 pr-4 font-semibold">#</th>
                  <th className="text-left py-2 pr-4 font-semibold">SKU</th>
                  <th className="text-left py-2 pr-4 font-semibold">{isZh ? "品类" : "Category"}</th>
                  <th className="text-right py-2 pr-4 font-semibold">{isZh ? "综合评分" : "Score"}</th>
                  <th className="text-right py-2 pr-4 font-semibold">{isZh ? "销量/月" : "Vel/Mo"}</th>
                  <th className="text-right py-2 pr-4 font-semibold">{isZh ? "利润率" : "Margin"}</th>
                  <th className="text-right py-2 pr-4 font-semibold">{isZh ? "周转率" : "Turnover"}</th>
                  <th className="text-right py-2 pr-4 font-semibold">{isZh ? "增长" : "Growth"}</th>
                  <th className="text-center py-2 pr-4 font-semibold">{isZh ? "库存状态" : "Stock"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {pagedSkus.map((sku, idx) => {
                  const rank = (page - 1) * PAGE_SIZE + idx + 1;
                  const sm = STOCK_META[sku.stock_health];
                  return (
                    <tr key={sku.sku} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2 pr-4 text-slate-500 font-mono">{rank}</td>
                      <td className="py-2 pr-4 font-mono font-semibold text-slate-100">{sku.sku}</td>
                      <td className="py-2 pr-4 text-slate-400">{sku.category ?? "—"}</td>
                      <td className="py-2 pr-4 text-right">
                        <span
                          className="rounded-full px-2 py-0.5 font-bold"
                          style={{
                            backgroundColor: `${SCORE_COLOR(sku.composite_score)}22`,
                            color: SCORE_COLOR(sku.composite_score),
                          }}
                        >
                          {sku.composite_score}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-200">{fmt(sku.sales_velocity, 1)}</td>
                      <td className="py-2 pr-4 text-right text-slate-200">
                        {sku.margin_pct !== null ? `${sku.margin_pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-200">{sku.turnover_ratio.toFixed(2)}x</td>
                      <td className="py-2 pr-4 text-right">
                        <span className={sku.growth_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {fmtPct(sku.growth_pct)}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-center">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sm.bg}`}>
                          {sm.label[lang]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 disabled:opacity-40"
              >
                {isZh ? "上一页" : "Prev"}
              </button>
              <span className="text-xs text-slate-400">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 disabled:opacity-40"
              >
                {isZh ? "下一页" : "Next"}
              </button>
            </div>
          )}

          {/* Velocity vs Margin scatter */}
          {scatterData.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-400 mb-2">
                {isZh ? "销售速度 vs 利润率（气泡 = 综合评分）" : "Sales Velocity vs Margin % (bubble = composite score)"}
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    type="number" dataKey="x" name={isZh ? "销量/月" : "Velocity"}
                    tick={{ fill: "#94a3b8", fontSize: 10 }} label={{ value: isZh ? "销量/月" : "Vel/Mo", position: "insideBottom", offset: -3, fill: "#64748b", fontSize: 10 }}
                  />
                  <YAxis
                    type="number" dataKey="y" name={isZh ? "利润率%" : "Margin%"}
                    tick={{ fill: "#94a3b8", fontSize: 10 }} label={{ value: "%", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs space-y-0.5">
                          <p className="font-semibold text-slate-100">{d.sku}</p>
                          <p className="text-slate-400">{d.category}</p>
                          <p className="text-cyan-300">{isZh ? "销量" : "Vel"}: {d.x.toFixed(1)} · {isZh ? "利润率" : "Margin"}: {d.y.toFixed(1)}%</p>
                          <p className="text-purple-300">{isZh ? "评分" : "Score"}: {d.score}</p>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    data={scatterData}
                    fill="#22d3ee"
                  >
                    {scatterData.map((d, i) => (
                      <Cell key={i} fill={SCORE_COLOR(d.score)} fillOpacity={0.7} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-1 text-[10px] text-slate-500 justify-center">
                {[{ label: isZh ? "高分 ≥70" : "High ≥70", color: "#22d3ee" }, { label: "50–69", color: "#a78bfa" }, { label: "30–49", color: "#fb923c" }, { label: isZh ? "低分 <30" : "Low <30", color: "#94a3b8" }].map((l) => (
                  <span key={l.label} className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Promo Opportunities ──────────────────────── */}
      {innerTab === "promo" && (
        <div className={`${CARD} p-4 space-y-3`}>
          <div>
            <p className="text-sm font-semibold text-orange-300">
              {isZh ? "推广机会列表" : "Promotion Opportunities"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {isZh
                ? "以下 SKU 库存偏高且利润空间充足，适合通过促销活动清库、拉新。"
                : "These SKUs have excess stock and sufficient margin headroom — ideal candidates for promotional campaigns."}
            </p>
          </div>
          {promoSkus.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              {isZh ? "暂无推广机会" : "No promo opportunities found"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="text-left py-2 pr-4 font-semibold">SKU</th>
                    <th className="text-left py-2 pr-4 font-semibold">{isZh ? "品类" : "Category"}</th>
                    <th className="text-right py-2 pr-4 font-semibold">{isZh ? "当前库存" : "Stock"}</th>
                    <th className="text-right py-2 pr-4 font-semibold">{isZh ? "高库存阈值" : "High threshold"}</th>
                    <th className="text-right py-2 pr-4 font-semibold">{isZh ? "利润率" : "Margin"}</th>
                    <th className="text-right py-2 pr-4 font-semibold">{isZh ? "销量/月" : "Vel/Mo"}</th>
                    <th className="text-right py-2 pr-4 font-semibold">{isZh ? "建议折扣" : "Suggested disc."}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {promoSkus.map((sku) => {
                    // Suggested discount: leave 10% margin buffer
                    const suggestDisc =
                      sku.margin_pct !== null ? Math.max(0, Math.round(sku.margin_pct - 10)) : null;
                    const overstock =
                      sku.high_stock !== null
                        ? Math.round(((sku.latest_stock - sku.high_stock) / sku.high_stock) * 100)
                        : null;
                    return (
                      <tr key={sku.sku} className="hover:bg-slate-800/40">
                        <td className="py-2 pr-4 font-mono font-semibold text-orange-300">{sku.sku}</td>
                        <td className="py-2 pr-4 text-slate-400">{sku.category ?? "—"}</td>
                        <td className="py-2 pr-4 text-right text-slate-200">
                          {fmt(sku.latest_stock)}
                          {overstock !== null && (
                            <span className="ml-1 text-[10px] text-orange-400">(+{overstock}%)</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-500">
                          {sku.high_stock !== null ? fmt(sku.high_stock) : "—"}
                        </td>
                        <td className="py-2 pr-4 text-right text-emerald-400">
                          {sku.margin_pct !== null ? `${sku.margin_pct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-200">{fmt(sku.sales_velocity, 1)}</td>
                        <td className="py-2 pr-4 text-right">
                          {suggestDisc !== null ? (
                            <span className="rounded-full border border-orange-500/30 bg-orange-500/20 px-2 py-0.5 font-semibold text-orange-300">
                              {isZh ? `最高 ${suggestDisc}% 折扣` : `Up to ${suggestDisc}% off`}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-slate-600">
            {isZh
              ? "建议折扣 = 利润率 − 10%（保留利润缓冲）。实际执行前请结合市场竞价情况调整。"
              : "Suggested discount = margin% − 10% buffer. Adjust based on competitive pricing before execution."}
          </p>
        </div>
      )}

      {/* ── Tab: AI Campaign Advisor ──────────────────────── */}
      {innerTab === "ai" && (
        <div className={`${CARD} p-5 space-y-4`}>
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-purple-300">
                {isZh ? "AI 营销活动建议" : "AI Campaign Advisor"}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {isZh
                  ? "基于库存绩效数据，结合当前市场节点，由 AI 生成可落地的营销活动方案。"
                  : "AI-generated campaign suggestions based on your inventory performance and current market context."}
              </p>
            </div>
            {aiModelUsed && (
              <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-300">
                {aiModelUsed}
              </span>
            )}
          </div>

          {/* Focus input + generate button */}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={aiFocus}
              onChange={(e) => setAiFocus(e.target.value)}
              placeholder={
                isZh
                  ? "可选：聚焦品类或 SKU（例如 FWD100 或 运动装备）"
                  : "Optional: focus on category or SKU (e.g. FWD100)"
              }
              className="flex-1 min-w-[200px] rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
            <button
              type="button"
              onClick={fetchAiCampaigns}
              disabled={aiLoading || !data}
              className="rounded-lg border border-purple-500/40 bg-purple-500/20 px-4 py-2 text-xs font-semibold text-purple-300 hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {aiLoading
                ? (isZh ? "AI 生成中…" : "Generating…")
                : aiCampaigns
                ? (isZh ? "重新生成" : "Regenerate")
                : (isZh ? "✨ 生成活动建议" : "✨ Generate Campaigns")}
            </button>
          </div>

          {/* Error */}
          {aiError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
              {isZh ? `生成失败：${aiError}` : `Error: ${aiError}`}
            </div>
          )}

          {/* Loading skeleton */}
          {aiLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-2 animate-pulse">
                  <div className="h-4 w-48 rounded bg-slate-700" />
                  <div className="h-3 w-full rounded bg-slate-700" />
                  <div className="h-3 w-3/4 rounded bg-slate-700" />
                </div>
              ))}
            </div>
          )}

          {/* Campaign cards */}
          {!aiLoading && aiCampaigns && aiCampaigns.length > 0 && (
            <div className="space-y-3">
              {aiCampaigns.map((c) => (
                <CampaignCard key={c.id} campaign={c} isZh={isZh} />
              ))}
              {aiGeneratedAt && (
                <p className="text-[10px] text-slate-600 text-right">
                  {isZh ? "生成于" : "Generated"} {new Date(aiGeneratedAt).toLocaleString("zh-CN")}
                  {aiModelUsed ? ` · ${aiModelUsed}` : ""}
                </p>
              )}
            </div>
          )}

          {/* Empty state */}
          {!aiLoading && !aiError && !aiCampaigns && (
            <div className="py-12 text-center space-y-2">
              <p className="text-3xl">🤖</p>
              <p className="text-sm text-slate-400">
                {isZh
                  ? "点击「生成活动建议」，AI 将分析你的库存数据并给出营销方案。"
                  : 'Click “Generate Campaigns” and AI will analyse your inventory and suggest marketing campaigns.'}
              </p>
              <p className="text-xs text-slate-600">
                {isZh ? "使用 GPT-4.1 · 结合当前市场节点" : "Powered by GPT-4.1 · Context-aware market timing"}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Category Analysis ────────────────────────── */}
      {innerTab === "category" && (
        <div className={`${CARD} p-4 space-y-4`}>
          <p className="text-sm font-semibold text-slate-200">
            {isZh ? "品类综合评分排行" : "Category Performance Ranking"}
          </p>
          {data.category_stats.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              {isZh ? "暂无品类数据" : "No category data available"}
            </p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={data.category_stats.slice(0, 15)}
                  layout="vertical"
                  margin={{ top: 4, right: 40, bottom: 4, left: 90 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis
                    type="category" dataKey="category"
                    tick={{ fill: "#94a3b8", fontSize: 10 }} width={88}
                  />
                  <Tooltip
                    content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as CategoryStat;
                      return (
                        <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs space-y-0.5">
                          <p className="font-semibold text-slate-100">{d.category}</p>
                          <p className="text-slate-400">{isZh ? "SKU 数" : "SKUs"}: {d.sku_count}</p>
                          <p className="text-cyan-300">{isZh ? "平均评分" : "Avg score"}: {d.avg_score}</p>
                          <p className="text-purple-300">{isZh ? "平均销量/月" : "Avg vel/mo"}: {d.avg_velocity.toFixed(1)}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="avg_score" name={isZh ? "平均综合评分" : "Avg Score"} radius={[0, 4, 4, 0]}>
                    {data.category_stats.slice(0, 15).map((entry, i) => (
                      <Cell key={i} fill={SCORE_COLOR(entry.avg_score)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Category table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="text-left py-2 pr-4 font-semibold">#</th>
                      <th className="text-left py-2 pr-4 font-semibold">{isZh ? "品类" : "Category"}</th>
                      <th className="text-right py-2 pr-4 font-semibold">SKU</th>
                      <th className="text-right py-2 pr-4 font-semibold">{isZh ? "平均评分" : "Avg Score"}</th>
                      <th className="text-right py-2 pr-4 font-semibold">{isZh ? "平均销量/月" : "Avg Vel/Mo"}</th>
                      <th className="text-left py-2 font-semibold">{isZh ? "评级" : "Grade"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.category_stats.map((cat, idx) => {
                      const grade =
                        cat.avg_score >= 70
                          ? { label: isZh ? "明星" : "Star", cls: "text-cyan-300 border-cyan-500/30 bg-cyan-500/20" }
                          : cat.avg_score >= 50
                          ? { label: isZh ? "成长" : "Growth", cls: "text-purple-300 border-purple-500/30 bg-purple-500/20" }
                          : cat.avg_score >= 30
                          ? { label: isZh ? "问题" : "Question", cls: "text-orange-300 border-orange-500/30 bg-orange-500/20" }
                          : { label: isZh ? "衰退" : "Dog", cls: "text-slate-400 border-slate-600 bg-slate-800" };
                      return (
                        <tr key={cat.category} className="hover:bg-slate-800/40">
                          <td className="py-2 pr-4 text-slate-500">{idx + 1}</td>
                          <td className="py-2 pr-4 font-semibold text-slate-100">{cat.category}</td>
                          <td className="py-2 pr-4 text-right text-slate-400">{cat.sku_count}</td>
                          <td className="py-2 pr-4 text-right">
                            <span style={{ color: SCORE_COLOR(cat.avg_score) }} className="font-bold">
                              {cat.avg_score}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-right text-slate-200">{cat.avg_velocity.toFixed(1)}</td>
                          <td className="py-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${grade.cls}`}>
                              {grade.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Campaign Card ──────────────────────────────────────── */
const PRIORITY_META = {
  high: { label: { zh: "高优先级", en: "High" }, cls: "border-red-500/40 bg-red-500/15 text-red-300" },
  medium: { label: { zh: "中优先级", en: "Medium" }, cls: "border-yellow-500/40 bg-yellow-500/15 text-yellow-300" },
  low: { label: { zh: "低优先级", en: "Low" }, cls: "border-slate-600 bg-slate-800 text-slate-400" },
};

const TARGET_TYPE_LABEL: Record<string, { zh: string; en: string }> = {
  sku: { zh: "指定 SKU", en: "SKU-level" },
  category: { zh: "品类活动", en: "Category" },
  bundle: { zh: "捆绑促销", en: "Bundle" },
};

function CampaignCard({ campaign: c, isZh }: { campaign: CampaignSuggestion; isZh: boolean }) {
  const prio = PRIORITY_META[c.priority] ?? PRIORITY_META.medium;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 space-y-2 hover:border-slate-600 transition-colors">
      {/* Title row */}
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-100">{c.title}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${prio.cls}`}>
              {prio.label[isZh ? "zh" : "en"]}
            </span>
            <span className="rounded-full border border-slate-600 bg-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
              {(TARGET_TYPE_LABEL[c.target_type] ?? TARGET_TYPE_LABEL.sku)[isZh ? "zh" : "en"]}
            </span>
            {c.discount_pct !== null && c.discount_pct > 0 && (
              <span className="rounded-full border border-orange-500/30 bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-300">
                {isZh ? `最高 ${c.discount_pct}% 折扣` : `Up to ${c.discount_pct}% off`}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors ml-2 flex-shrink-0 mt-0.5"
        >
          {expanded ? (isZh ? "收起" : "Less") : (isZh ? "详情" : "More")}
        </button>
      </div>

      {/* Quick facts row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
        {c.targets.length > 0 && (
          <span>
            <span className="text-slate-500">{isZh ? "目标：" : "Targets: "}</span>
            <span className="text-slate-200 font-mono">{c.targets.slice(0, 5).join(", ")}{c.targets.length > 5 ? ` +${c.targets.length - 5}` : ""}</span>
          </span>
        )}
        <span>
          <span className="text-slate-500">{isZh ? "时间：" : "Timing: "}</span>
          <span className="text-slate-200">{c.timing}</span>
        </span>
        {c.channel.length > 0 && (
          <span>
            <span className="text-slate-500">{isZh ? "渠道：" : "Channels: "}</span>
            <span className="text-slate-200">{c.channel.join(" · ")}</span>
          </span>
        )}
      </div>

      {/* Mechanic pill */}
      <div className="inline-block rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-300">
        {c.mechanic}
      </div>

      {/* Expandable detail */}
      {expanded && (
        <div className="border-t border-slate-700 pt-2 mt-1 space-y-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
              {isZh ? "活动依据" : "Rationale"}
            </p>
            <p className="text-xs text-slate-300">{c.rationale}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
              {isZh ? "预期效果" : "Expected Outcome"}
            </p>
            <p className="text-xs text-slate-300">{c.expected_outcome}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── KPI Card ───────────────────────────────────────────── */
function KpiCard({
  title,
  value,
  sub,
  color = "cyan",
}: {
  title: string;
  value: string;
  sub?: string;
  color?: "cyan" | "purple" | "orange" | "green";
}) {
  const colorMap = {
    cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
    purple: "border-purple-500/30 bg-purple-500/10 text-purple-300",
    orange: "border-orange-500/30 bg-orange-500/10 text-orange-300",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  };
  return (
    <div className={`rounded-2xl border p-4 ${colorMap[color]}`}>
      <p className="text-xs text-slate-400">{title}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] opacity-70">{sub}</p>}
    </div>
  );
}
