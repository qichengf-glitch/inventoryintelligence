"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ObsolescenceItem, ObsolescenceResponse, ObsolescenceSummary } from "@/app/api/inventory/obsolescence/route";

const CARD = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4";

type RiskTier = "high" | "medium" | "watch" | "unknown";
type FilterTier = RiskTier | "all";

const TIER_META: Record<
  RiskTier,
  { labelZh: string; labelEn: string; colorClass: string; bgClass: string; dotColor: string; descZh: string; descEn: string }
> = {
  high: {
    labelZh: "高风险",
    labelEn: "High Risk",
    colorClass: "text-red-300",
    bgClass: "bg-red-500/15 border-red-400/40",
    dotColor: "bg-red-400",
    descZh: "在库 ≥ 2 年",
    descEn: "≥ 2 years in stock",
  },
  medium: {
    labelZh: "中风险",
    labelEn: "Medium Risk",
    colorClass: "text-amber-300",
    bgClass: "bg-amber-500/15 border-amber-400/40",
    dotColor: "bg-amber-400",
    descZh: "在库 1–2 年",
    descEn: "1–2 years in stock",
  },
  watch: {
    labelZh: "观察中",
    labelEn: "Watch",
    colorClass: "text-cyan-300",
    bgClass: "bg-cyan-500/15 border-cyan-400/40",
    dotColor: "bg-cyan-400",
    descZh: "在库 < 1 年",
    descEn: "< 1 year in stock",
  },
  unknown: {
    labelZh: "批号未知",
    labelEn: "Unknown",
    colorClass: "text-slate-400",
    bgClass: "bg-slate-500/10 border-slate-500/30",
    dotColor: "bg-slate-500",
    descZh: "批号无法解析",
    descEn: "Batch date unparseable",
  },
};

function fmt(n: number) {
  return n.toLocaleString();
}

function fmtCurrency(n: number) {
  if (n >= 10_000) return `¥${(n / 10_000).toFixed(2)}万`;
  return `¥${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function RiskBadge({ tier, lang }: { tier: RiskTier; lang: string }) {
  const meta = TIER_META[tier];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${meta.bgClass} ${meta.colorClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotColor}`} />
      {lang === "zh" ? meta.labelZh : meta.labelEn}
    </span>
  );
}

function SummaryCard({
  tier,
  data,
  lang,
}: {
  tier: RiskTier;
  data: ObsolescenceSummary[RiskTier];
  lang: string;
}) {
  const meta = TIER_META[tier];
  const hasCapital = data.total_capital > 0;

  return (
    <article className={`${CARD} flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${meta.colorClass}`}>
          <span className={`h-2 w-2 rounded-full ${meta.dotColor}`} />
          {lang === "zh" ? meta.labelZh : meta.labelEn}
        </span>
        <span className="text-xs text-slate-500">{lang === "zh" ? meta.descZh : meta.descEn}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-semibold text-slate-100">{fmt(data.batches)}</p>
          <p className="mt-0.5 text-xs text-slate-500">{lang === "zh" ? "批次" : "Batches"}</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-slate-100">{fmt(data.total_stock)}</p>
          <p className="mt-0.5 text-xs text-slate-500">{lang === "zh" ? "库存量" : "Units"}</p>
        </div>
        <div>
          <p className={`text-lg font-semibold ${hasCapital ? meta.colorClass : "text-slate-500"}`}>
            {hasCapital ? fmtCurrency(data.total_capital) : "—"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{lang === "zh" ? "占用资金" : "Capital"}</p>
        </div>
      </div>
    </article>
  );
}

export default function ObsolescencePage() {
  const { lang } = useLanguage();
  const [data, setData] = useState<ObsolescenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTier, setFilterTier] = useState<FilterTier>("all");
  const [searchSku, setSearchSku] = useState("");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/inventory/obsolescence", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed");
        setData(json as ObsolescenceResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const displayed: ObsolescenceItem[] = data
    ? data.items.filter((item) => {
        if (filterTier !== "all" && item.risk_tier !== filterTier) return false;
        if (searchSku && !item.sku.toLowerCase().includes(searchSku.toLowerCase())) return false;
        return true;
      })
    : [];

  const totalCapital = data
    ? data.summary.high.total_capital +
      data.summary.medium.total_capital +
      data.summary.watch.total_capital
    : 0;

  return (
    <div className="space-y-5">
      {data && (
        <p className="text-xs text-slate-500 -mt-3">
          {lang === "zh" ? `数据快照：${data.snapshot_month}` : `Snapshot month: ${data.snapshot_month}`}
        </p>
      )}

      {loading ? (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${CARD} h-32 animate-pulse bg-slate-800/50`} />
          ))}
        </section>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : data ? (
        <>
          {/* 3-tier summary cards */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {(["high", "medium", "watch"] as RiskTier[]).map((tier) => (
              <SummaryCard key={tier} tier={tier} data={data.summary[tier]} lang={lang} />
            ))}
          </section>

          {/* Total capital callout */}
          <section className={`${CARD} flex flex-wrap items-center justify-between gap-4`}>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-slate-400">
                {lang === "zh" ? "总呆滞资金（高＋中＋观察）" : "Total Capital at Risk (High + Medium + Watch)"}
              </p>
              <p className="mt-1 text-3xl font-bold text-slate-100">
                {totalCapital > 0 ? fmtCurrency(totalCapital) : "—"}
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-slate-400">
              <span>
                {lang === "zh" ? "高风险" : "High"}:{" "}
                <span className="font-semibold text-red-300">
                  {data.summary.high.total_capital > 0 ? fmtCurrency(data.summary.high.total_capital) : "—"}
                </span>
              </span>
              <span>
                {lang === "zh" ? "中风险" : "Medium"}:{" "}
                <span className="font-semibold text-amber-300">
                  {data.summary.medium.total_capital > 0 ? fmtCurrency(data.summary.medium.total_capital) : "—"}
                </span>
              </span>
              <span>
                {lang === "zh" ? "观察" : "Watch"}:{" "}
                <span className="font-semibold text-cyan-300">
                  {data.summary.watch.total_capital > 0 ? fmtCurrency(data.summary.watch.total_capital) : "—"}
                </span>
              </span>
            </div>
          </section>

          {/* Filters */}
          <section className={`${CARD} flex flex-wrap items-center gap-3`}>
            <input
              value={searchSku}
              onChange={(e) => setSearchSku(e.target.value)}
              placeholder={lang === "zh" ? "搜索 SKU" : "Search SKU"}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400 w-40"
            />
            {(["all", "high", "medium", "watch", "unknown"] as FilterTier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterTier(t)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterTier === t
                    ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-200"
                    : "border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200"
                }`}
              >
                {t === "all"
                  ? lang === "zh" ? "全部" : "All"
                  : lang === "zh"
                  ? TIER_META[t as RiskTier].labelZh
                  : TIER_META[t as RiskTier].labelEn}
              </button>
            ))}
            <span className="ml-auto text-xs text-slate-500">
              {lang === "zh" ? `显示 ${displayed.length} 条` : `${displayed.length} records`}
            </span>
          </section>

          {/* Detail table */}
          <section className={CARD}>
            {displayed.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                {lang === "zh" ? "暂无匹配数据" : "No matching records"}
              </p>
            ) : (
              <div className="overflow-auto rounded-xl border border-slate-800">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900/95 text-xs uppercase tracking-[0.08em] text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-left">{lang === "zh" ? "批号" : "Batch"}</th>
                      <th className="px-3 py-2 text-left">{lang === "zh" ? "入库日期" : "Inbound"}</th>
                      <th className="px-3 py-2 text-right">{lang === "zh" ? "在库时长" : "Age"}</th>
                      <th className="px-3 py-2 text-right">{lang === "zh" ? "现库存" : "Stock"}</th>
                      <th className="px-3 py-2 text-right">{lang === "zh" ? "单品成本" : "Unit Cost"}</th>
                      <th className="px-3 py-2 text-right">{lang === "zh" ? "占用资金" : "Capital"}</th>
                      <th className="px-3 py-2 text-left">{lang === "zh" ? "风险等级" : "Risk"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map((item) => {
                      const inbound =
                        item.inbound_year > 0
                          ? `${item.inbound_year}-${String(item.inbound_month).padStart(2, "0")}`
                          : "—";
                      const age =
                        item.age_months >= 0
                          ? item.age_months >= 12
                            ? `${Math.floor(item.age_months / 12)}y ${item.age_months % 12}m`
                            : `${item.age_months}m`
                          : "—";

                      return (
                        <tr
                          key={`${item.sku}-${item.batch}`}
                          className="border-t border-slate-800 text-slate-200 hover:bg-slate-800/30"
                        >
                          <td className="px-3 py-2 font-medium">{item.sku}</td>
                          <td className="px-3 py-2 font-mono text-slate-300">{item.batch}</td>
                          <td className="px-3 py-2 text-slate-400">{inbound}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-300">{age}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(item.current_stock)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                            {item.unit_cost !== null ? `¥${item.unit_cost}` : "—"}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums font-medium ${TIER_META[item.risk_tier].colorClass}`}>
                            {item.capital !== null ? fmtCurrency(item.capital) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <RiskBadge tier={item.risk_tier} lang={lang} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
