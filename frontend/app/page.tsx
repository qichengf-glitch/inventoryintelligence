"use client";

import { useEffect, useMemo, useState } from "react";

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

export default function HomePage() {
  const { lang } = useLanguage();
  const [summary, setSummary] = useState<DashboardSummary>(FALLBACK_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>("");

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
    if (typeof window === "undefined") return;

    const rawUser = localStorage.getItem("ii:mock-user");
    if (!rawUser) return;

    try {
      const parsed = JSON.parse(rawUser) as { name?: string };
      if (parsed?.name) {
        setDisplayName(parsed.name);
      }
    } catch {
      setDisplayName("");
    }
  }, []);

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
