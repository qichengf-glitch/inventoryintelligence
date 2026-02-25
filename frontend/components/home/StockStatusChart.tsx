"use client";

import type { StockStatusBreakdown } from "@/lib/dashboard/getStockStatusBreakdown";
import { useLanguage } from "@/components/LanguageProvider";

type StockStatusChartProps = {
  data: StockStatusBreakdown;
};

const CHART_ROWS = [
  {
    key: "low_stock" as const,
    label: { zh: "低库存", en: "Low stock" },
    color: "#fbbf24",
  },
  {
    key: "out_of_stock" as const,
    label: { zh: "缺货", en: "Out of stock" },
    color: "#f43f5e",
  },
  {
    key: "over_stock" as const,
    label: { zh: "高库存", en: "Over stock" },
    color: "#a78bfa",
  },
  {
    key: "normal_stock" as const,
    label: { zh: "正常库存", en: "Normal stock" },
    color: "#22d3ee",
  },
];

export default function StockStatusChart({ data }: StockStatusChartProps) {
  const { lang } = useLanguage();
  const rows = CHART_ROWS.map((row) => ({
    ...row,
    percent: Math.max(0, data.percentages[row.key]),
    count: data.counts[row.key],
  }));

  const totalPercent = rows.reduce((total, row) => total + row.percent, 0);
  const normalizedRows =
    totalPercent > 0
      ? rows.map((row) => ({ ...row, normalizedPercent: (row.percent / totalPercent) * 100 }))
      : rows.map((row) => ({ ...row, normalizedPercent: 0 }));

  let cursor = 0;
  const segments: string[] = [];
  for (const row of normalizedRows) {
    const start = cursor;
    const end = Math.min(100, start + row.normalizedPercent);
    if (end > start) {
      segments.push(`${row.color} ${start}% ${end}%`);
    }
    cursor = end;
  }
  if (cursor < 100) {
    segments.push(`#1e293b ${cursor}% 100%`);
  }

  const ringBackground =
    segments.length > 0
      ? `conic-gradient(${segments.join(", ")})`
      : "conic-gradient(#1e293b 0% 100%)";

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-[0_10px_25px_rgba(2,6,23,0.35)]">
      <div className="mb-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">
          {lang === "zh" ? "库存状态" : "Inventory Status"}
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          {(lang === "zh" ? "% SKU占比" : data.basis)} · {data.totalSkus.toLocaleString()}{" "}
          {lang === "zh" ? "个 SKU" : "SKUs"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <div className="grid place-items-center">
          <div
            className="relative h-44 w-44 rounded-full"
            style={{ background: ringBackground }}
            aria-label={lang === "zh" ? "库存状态环形图" : "Inventory status donut chart"}
          >
            <div className="absolute inset-[22%] grid place-items-center rounded-full border border-slate-700 bg-slate-950 text-center">
              <p className="text-xl font-semibold text-slate-100">
                {data.totalSkus.toLocaleString()}
              </p>
              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">
                {lang === "zh" ? "SKU" : "SKUs"}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {rows.map((row) => {
            const percent = row.percent;
            const count = row.count;
            return (
              <div
                key={row.key}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm"
              >
                <span className="inline-flex items-center gap-2 text-slate-200">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: row.color }}
                    aria-hidden
                  />
                  {row.label[lang]}
                </span>
                <span className="text-slate-300">
                  {percent.toFixed(1)}% ({count})
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
