"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import InsightCard from "@/components/insight/InsightCard";
import type { DashboardSummary } from "@/lib/dashboard/getDashboardSummary";

type Props = {
  summary: DashboardSummary;
  lang: string;
};

export default function DashboardInsightCard({ summary, lang }: Props) {
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generatedForMonth = useRef<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      // Fetch slow movers in parallel for richer context
      const [slowRes] = await Promise.allSettled([
        fetch("/api/inventory/slow-movers", { cache: "no-store" }),
      ]);
      let slowMovers: any[] = [];
      if (slowRes.status === "fulfilled" && slowRes.value.ok) {
        const j = await slowRes.value.json();
        slowMovers = Array.isArray(j) ? j.slice(0, 8) : [];
      }

      const res = await fetch("/api/ai/dashboard-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latestMonth: summary.latestMonth,
          previousMonth: summary.previousMonth,
          kpis: summary.kpis,
          stockCounts: summary.stockStatus.counts,
          stockPercentages: summary.stockStatus.percentages,
          totalSkus: summary.stockStatus.totalSkus,
          slowMovers,
          lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setReport(data.report);
      generatedForMonth.current = summary.latestMonth;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate insight");
    } finally {
      setLoading(false);
    }
  }, [summary, lang]);

  // Auto-generate when real data arrives (latestMonth becomes non-null)
  useEffect(() => {
    if (
      summary.latestMonth &&
      summary.stockStatus.totalSkus > 0 &&
      generatedForMonth.current !== summary.latestMonth &&
      !loading
    ) {
      void generate();
    }
  }, [summary.latestMonth, summary.stockStatus.totalSkus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!summary.latestMonth && !loading) return null;

  return <InsightCard report={report} loading={loading} error={error} lang={lang} onRefresh={generate} />;
}
