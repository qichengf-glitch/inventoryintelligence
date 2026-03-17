"use client";

import { useMemo, useState, useEffect, useCallback } from "react";

import CopilotPanel from "@/components/copilot/CopilotPanel";
import KpiGrid from "@/components/home/KpiGrid";
import StockStatusChart from "@/components/home/StockStatusChart";
import { useLanguage } from "@/components/LanguageProvider";
import type { DashboardSummary } from "@/lib/dashboard/getDashboardSummary";

const REFRESH_INTERVAL_MS = 45_000;

const FALLBACK_SUMMARY: DashboardSummary = {
  generatedAt: new Date(0).toISOString(),
  latestMonth: null,
  previousMonth: null,
  kpis: [
    {
      id: "kpi_1",
      title: "Total SKUs",
      value: 0,
      delta: null,
      deltaType: "percent",
      subtext: "Latest month",
    },
    {
      id: "kpi_2",
      title: "At Risk SKUs",
      value: 0,
      delta: null,
      deltaType: "number",
      subtext: "Low + Out of stock",
    },
    {
      id: "kpi_3",
      title: "Current Stock Units",
      value: 0,
      delta: null,
      deltaType: "percent",
      subtext: "Sum of latest stock",
    },
    {
      id: "kpi_4",
      title: "Monthly Sales",
      value: 0,
      delta: null,
      deltaType: "percent",
      subtext: "Sum of latest sales",
    },
  ],
  stockStatus: {
    basis: "% of SKUs",
    totalSkus: 0,
    counts: {
      low_stock: 0,
      out_of_stock: 0,
      over_stock: 0,
      normal_stock: 0,
    },
    percentages: {
      low_stock: 0,
      out_of_stock: 0,
      over_stock: 0,
      normal_stock: 0,
    },
  },
  meta: {
    sampledRows: 0,
    truncated: false,
  },
};

type HomeDashboardProps = {
  displayName?: string;
};

export default function HomeDashboard({ displayName = "" }: HomeDashboardProps) {
  const { lang } = useLanguage();
  const [summary, setSummary] = useState<DashboardSummary>(FALLBACK_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);

  // AI insight state
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date()),
    [lang]
  );
  const updatedAtLabel = useMemo(() => {
    if (!summary.generatedAt) return "";
    const date = new Date(summary.generatedAt);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
  }, [summary.generatedAt, lang]);
  const kpiDisplay = useMemo(() => {
    return summary.kpis.map((item) => {
      const zhMap: Record<string, { title: string; subtext?: string }> = {
        kpi_1: { title: "SKU 总数", subtext: "最新月份" },
        kpi_2: { title: "风险 SKU", subtext: "低库存 + 缺货" },
        kpi_3: { title: "当前库存总量", subtext: "最新库存汇总" },
        kpi_4: { title: "月销售总量", subtext: "最新月份销售" },
      };
      if (lang !== "zh") return item;
      const mapped = zhMap[item.id];
      if (!mapped) return item;
      return {
        ...item,
        title: mapped.title,
        subtext: mapped.subtext,
      };
    });
  }, [summary.kpis, lang]);

  useEffect(() => {
    let disposed = false;

    const loadSummary = async () => {
      try {
        const response = await fetch("/api/dashboard/summary", {
          cache: "no-store",
        });

        if (!response.ok) return;

        const data = (await response.json()) as DashboardSummary;
        if (!disposed) {
          setSummary(data);
        }
      } catch {
        // Keep existing state.
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    };

    loadSummary();
    const intervalId = window.setInterval(loadSummary, REFRESH_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const fetchAiInsight = useCallback(async () => {
    setAiLoading(true);
    setAiInsight(null);
    try {
      const { kpis, stockStatus, latestMonth } = summary;
      const question =
        lang === "zh"
          ? `请用2-4句话解读以下本月库存数据的核心亮点和风险，并给出1-2条最高优先级行动建议。数据：最新月份=${latestMonth}；SKU总数=${kpis.find(k=>k.id==="kpi_1")?.value}；风险SKU=${kpis.find(k=>k.id==="kpi_2")?.value}；当前库存=${kpis.find(k=>k.id==="kpi_3")?.value}；月销售=${kpis.find(k=>k.id==="kpi_4")?.value}；健康=${stockStatus.percentages.normal_stock?.toFixed(1)}%；低库存=${stockStatus.percentages.low_stock?.toFixed(1)}%；缺货=${stockStatus.percentages.out_of_stock?.toFixed(1)}%；过库存=${stockStatus.percentages.over_stock?.toFixed(1)}%。`
          : `In 2-4 sentences, highlight the key insights and risks from this month's inventory data, then give 1-2 top-priority action items. Data: latest_month=${latestMonth}; skus=${kpis.find(k=>k.id==="kpi_1")?.value}; at_risk_skus=${kpis.find(k=>k.id==="kpi_2")?.value}; stock=${kpis.find(k=>k.id==="kpi_3")?.value}; sales=${kpis.find(k=>k.id==="kpi_4")?.value}; healthy=${stockStatus.percentages.normal_stock?.toFixed(1)}%; low=${stockStatus.percentages.low_stock?.toFixed(1)}%; out=${stockStatus.percentages.out_of_stock?.toFixed(1)}%; over=${stockStatus.percentages.over_stock?.toFixed(1)}%.`;

      const res = await fetch("/api/ai/forecast-advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          scope: "home",
          lang,
          dashboardSummaryContext: { kpis, stockStatus, latestMonth },
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setAiInsight(data?.answer ?? null);
    } catch {
      setAiInsight(lang === "zh" ? "AI 暂时不可用，请稍后重试。" : "AI temporarily unavailable.");
    } finally {
      setAiLoading(false);
    }
  }, [summary, lang]);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
            {lang === "zh" ? "首页" : "Home"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-100">
            {displayName
              ? lang === "zh"
                ? `欢迎，${displayName}`
                : `Welcome, ${displayName}`
              : lang === "zh"
              ? "欢迎"
              : "Welcome"}
          </h1>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.15em] text-slate-500">
            {lang === "zh" ? "今天" : "Today"}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-200">{todayLabel}</p>
          <p className="mt-1 text-xs text-slate-500">
            {isLoading
              ? lang === "zh"
                ? "正在刷新仪表盘..."
                : "Refreshing dashboard..."
              : updatedAtLabel
              ? lang === "zh"
                ? `更新时间 ${updatedAtLabel}`
                : `Updated ${updatedAtLabel}`
              : lang === "zh"
              ? "刚刚更新"
              : "Updated just now"}
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <KpiGrid items={kpiDisplay} />
        </div>
        <div className="xl:col-span-5">
          <StockStatusChart data={summary.stockStatus} />
        </div>
      </section>

      {/* AI one-click insight panel */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
              {lang === "zh" ? "AI 数据解读" : "AI Insight"}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === "zh" ? "一键生成本月数据摘要与行动建议" : "Generate a summary and action items for this month"}
            </p>
          </div>
          <button
            type="button"
            onClick={fetchAiInsight}
            disabled={aiLoading || isLoading}
            className="shrink-0 flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {aiLoading ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                {lang === "zh" ? "生成中…" : "Generating…"}
              </>
            ) : (
              <>
                ✦ {lang === "zh" ? "AI 解读" : "AI Insight"}
              </>
            )}
          </button>
        </div>

        {aiInsight && (
          <div className="rounded-xl border border-slate-700/60 bg-slate-800/50 px-4 py-3 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
            {aiInsight}
          </div>
        )}

        {!aiInsight && !aiLoading && (
          <p className="text-xs text-slate-600 italic">
            {lang === "zh" ? "点击「AI 解读」按钮生成本月数据洞察。" : "Click the button above to generate insights."}
          </p>
        )}
      </section>

      <CopilotPanel
        summaryContext={{
          latestMonth: summary.latestMonth,
          kpis: summary.kpis,
          stockStatus: summary.stockStatus,
        }}
      />
    </div>
  );
}
