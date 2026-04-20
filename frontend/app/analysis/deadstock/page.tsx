"use client";

import { useEffect, useState, useMemo } from "react";
import { useLanguage } from "@/components/LanguageProvider";

/* ── Types ─────────────────────────────────────────────────── */
type DeadstockItem = {
  sku: string;
  category: string | null;
  current_stock: number;
  velocity_recent: number;
  velocity_prior: number;
  velocity_trend_pct: number;
  months_to_zero: number | null;
  risk_tier: "critical" | "high" | "medium" | "low" | "healthy";
  risk_score: number;
  last_sale_month: string | null;
};

type DeadstockResponse = {
  total_skus: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  healthy: number;
  items: DeadstockItem[];
  computed_at: string;
};

/* ── Constants ──────────────────────────────────────────────── */
const CARD = "rounded-2xl border border-slate-800 bg-slate-900/70";

const TIER_META = {
  critical: {
    zh: "濒危滞销",
    en: "Critical",
    cls: "border-red-500/40 bg-red-500/15 text-red-300",
    dot: "bg-red-400",
    bar: "#f87171",
  },
  high: {
    zh: "高风险",
    en: "High Risk",
    cls: "border-orange-500/40 bg-orange-500/15 text-orange-300",
    dot: "bg-orange-400",
    bar: "#fb923c",
  },
  medium: {
    zh: "中风险",
    en: "Medium Risk",
    cls: "border-yellow-500/40 bg-yellow-500/15 text-yellow-300",
    dot: "bg-yellow-400",
    bar: "#fbbf24",
  },
  low: {
    zh: "低风险",
    en: "Low",
    cls: "border-slate-600 bg-slate-800 text-slate-400",
    dot: "bg-slate-500",
    bar: "#64748b",
  },
  healthy: {
    zh: "健康",
    en: "Healthy",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    dot: "bg-emerald-400",
    bar: "#34d399",
  },
};

type FilterTier = "all" | "critical" | "high" | "medium" | "low" | "healthy";

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}
function fmtPct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
function fmtMths(n: number | null) {
  if (n === null) return "∞";
  if (n > 99) return ">99";
  return `${n.toFixed(1)} mo`;
}

/* ── Component ──────────────────────────────────────────────── */
export default function DeadstockPage() {
  const { lang } = useLanguage();
  const isZh = lang === "zh";

  const [data, setData] = useState<DeadstockResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTier, setFilterTier] = useState<FilterTier>("all");
  const [searchQ, setSearchQ] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  useEffect(() => {
    setLoading(true);
    fetch("/api/analysis/deadstock")
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
        return d as DeadstockResponse;
      })
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Request failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { setPage(1); }, [filterTier, searchQ]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = searchQ.trim().toLowerCase();
    return data.items.filter(item => {
      if (filterTier !== "all" && item.risk_tier !== filterTier) return false;
      if (q && !item.sku.toLowerCase().includes(q) && !(item.category ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, filterTier, searchQ]);

  const paged = useMemo(() => {
    const s = (page - 1) * PAGE_SIZE;
    return filtered.slice(s, s + PAGE_SIZE);
  }, [filtered, page]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  if (loading) {
    return (
      <div className={`${CARD} p-8 text-center`}>
        <p className="animate-pulse text-slate-400">
          {isZh ? "正在计算滞销风险评分…" : "Computing dead-stock risk scores…"}
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className={`${CARD} p-8 text-center text-red-400`}>
        {isZh ? `加载失败：${error}` : `Failed: ${error}`}
      </div>
    );
  }
  if (!data) return null;

  const totalAtRisk = data.critical + data.high + data.medium;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["critical", "high", "medium", "low", "healthy"] as const).map(tier => {
          const m = TIER_META[tier];
          const count = data[tier];
          return (
            <button
              key={tier}
              type="button"
              onClick={() => setFilterTier(f => f === tier ? "all" : tier)}
              className={`rounded-2xl border p-4 text-left transition-all ${m.cls} ${filterTier === tier ? "ring-2 ring-white/20 scale-[1.02]" : "hover:scale-[1.01]"}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`h-2 w-2 rounded-full ${m.dot}`} />
                <p className="text-[11px] font-medium opacity-80">{m[isZh ? "zh" : "en"]}</p>
              </div>
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-[10px] opacity-60 mt-0.5">{isZh ? "个 SKU" : "SKUs"}</p>
            </button>
          );
        })}
      </div>

      {/* Risk summary banner */}
      {totalAtRisk > 0 && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <p className="text-sm text-red-200">
            {isZh
              ? `${data.critical} 个濒危、${data.high} 个高风险 SKU 需要关注。预计在 3 个月内可能出现严重滞销。`
              : `${data.critical} critical and ${data.high} high-risk SKUs need attention. Potential dead stock within 3 months.`}
          </p>
        </div>
      )}

      {/* Table */}
      <div className={`${CARD} p-4 space-y-3`}>
        {/* Controls */}
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder={isZh ? "搜索 SKU…" : "Search SKU…"}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 w-36"
          />
          <select
            value={filterTier}
            onChange={e => setFilterTier(e.target.value as FilterTier)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">{isZh ? "全部风险等级" : "All tiers"}</option>
            {(["critical", "high", "medium", "low", "healthy"] as const).map(t => (
              <option key={t} value={t}>{TIER_META[t][isZh ? "zh" : "en"]} ({data[t]})</option>
            ))}
          </select>
          <span className="ml-auto text-[11px] text-slate-500">
            {filtered.length} {isZh ? "个 SKU" : "SKUs"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400">
                <th className="text-left py-2 pr-3 font-semibold">SKU</th>
                <th className="text-left py-2 pr-3 font-semibold">{isZh ? "品类" : "Category"}</th>
                <th className="text-center py-2 pr-3 font-semibold">{isZh ? "风险等级" : "Risk"}</th>
                <th className="text-right py-2 pr-3 font-semibold">{isZh ? "风险分" : "Score"}</th>
                <th className="text-right py-2 pr-3 font-semibold">{isZh ? "当前库存" : "Stock"}</th>
                <th className="text-right py-2 pr-3 font-semibold">{isZh ? "近3月销量/mo" : "Vel 3M"}</th>
                <th className="text-right py-2 pr-3 font-semibold">{isZh ? "速度趋势" : "Trend"}</th>
                <th className="text-right py-2 pr-3 font-semibold">{isZh ? "预计清零" : "To Zero"}</th>
                <th className="text-right py-2 font-semibold">{isZh ? "最后销售月" : "Last Sale"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {paged.map(item => {
                const tm = TIER_META[item.risk_tier];
                const trendColor = item.velocity_trend_pct >= 10
                  ? "text-emerald-400"
                  : item.velocity_trend_pct <= -20
                  ? "text-red-400"
                  : "text-yellow-400";
                return (
                  <tr key={item.sku} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2 pr-3 font-mono font-semibold text-slate-100">{item.sku}</td>
                    <td className="py-2 pr-3 text-slate-400">{item.category ?? "—"}</td>
                    <td className="py-2 pr-3 text-center">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tm.cls}`}>
                        {tm[isZh ? "zh" : "en"]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <div className="h-1.5 rounded-full bg-slate-700 w-12">
                          <div
                            className="h-1.5 rounded-full transition-all"
                            style={{ width: `${item.risk_score}%`, backgroundColor: tm.bar }}
                          />
                        </div>
                        <span style={{ color: tm.bar }} className="font-bold w-6 text-right">{item.risk_score}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right text-slate-200">{fmt(item.current_stock)}</td>
                    <td className="py-2 pr-3 text-right text-slate-200">{item.velocity_recent.toFixed(1)}</td>
                    <td className={`py-2 pr-3 text-right font-semibold ${trendColor}`}>
                      {fmtPct(item.velocity_trend_pct)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <span className={item.months_to_zero !== null && item.months_to_zero < 3 ? "text-red-400 font-semibold" : "text-slate-300"}>
                        {fmtMths(item.months_to_zero)}
                      </span>
                    </td>
                    <td className="py-2 text-right text-slate-500 font-mono text-[10px]">
                      {item.last_sale_month ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 disabled:opacity-40"
            >
              {isZh ? "上一页" : "Prev"}
            </button>
            <span className="text-xs text-slate-400">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 disabled:opacity-40"
            >
              {isZh ? "下一页" : "Next"}
            </button>
          </div>
        )}

        {/* Legend */}
        <div className="border-t border-slate-800 pt-3 text-[10px] text-slate-500 space-y-0.5">
          <p>
            <span className="text-slate-400 font-medium">{isZh ? "速度趋势" : "Trend"}：</span>
            {isZh
              ? "近3个月平均月销量 vs 前3个月。负值代表销量下滑。"
              : "Recent 3-month avg vs prior 3-month avg. Negative = declining demand."}
          </p>
          <p>
            <span className="text-slate-400 font-medium">{isZh ? "预计清零" : "To Zero"}：</span>
            {isZh
              ? "按当前销速，库存可支撑的月数。∞ 表示暂无销量，库存持续积压。"
              : "Months until stock hits zero at current velocity. ∞ = zero sales, stock accumulating."}
          </p>
        </div>
      </div>
    </div>
  );
}
