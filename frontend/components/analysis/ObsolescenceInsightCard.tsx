"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import InsightCard from "@/components/insight/InsightCard";
import type { ObsolescenceResponse } from "@/app/api/inventory/obsolescence/route";

type Props = {
  data: ObsolescenceResponse;
  lang: string;
};

export default function ObsolescenceInsightCard({ data, lang }: Props) {
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generatedForMonth = useRef<string | null>(null);

  const totalCapital =
    data.summary.high.total_capital +
    data.summary.medium.total_capital +
    data.summary.watch.total_capital;

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      // Pass top items (sorted by risk tier then capital) for rich context
      const topItems = data.items.slice(0, 10).map((item) => ({
        sku: item.sku,
        batch: item.batch,
        age_months: item.age_months,
        current_stock: item.current_stock,
        capital: item.capital,
        risk_tier: item.risk_tier,
      }));

      const res = await fetch("/api/ai/obsolescence-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotMonth: data.snapshot_month,
          summary: data.summary,
          totalCapital,
          topItems,
          lang,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setReport(json.report);
      generatedForMonth.current = data.snapshot_month;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate insight");
    } finally {
      setLoading(false);
    }
  }, [data, lang, totalCapital]);

  useEffect(() => {
    if (
      data.snapshot_month &&
      data.items.length > 0 &&
      generatedForMonth.current !== data.snapshot_month &&
      !loading
    ) {
      void generate();
    }
  }, [data.snapshot_month, data.items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return <InsightCard report={report} loading={loading} error={error} lang={lang} onRefresh={generate} />;
}
