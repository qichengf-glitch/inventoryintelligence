"use client";

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

type AbcClass = "A" | "B" | "C";
type XyzClass = "X" | "Y" | "Z";

type SkuClassification = {
  sku: string;
  total_sales: number;
  cumulative_pct: number;
  abc: AbcClass;
  cov: number;
  xyz: XyzClass;
  month_count: number;
  avg_monthly_sales: number;
};

type AbcXyzResponse = {
  classifications: SkuClassification[];
  matrix: Record<AbcClass, Record<XyzClass, number>>;
  total_skus: number;
  computed_at: string;
  error?: string;
};

const CARD = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-[0_10px_25px_rgba(2,6,23,0.35)]";

const ABC_COLORS: Record<AbcClass, { badge: string; text: string; glow: string }> = {
  A: { badge: "bg-emerald-500/20 border-emerald-400/50 text-emerald-200", text: "text-emerald-300", glow: "bg-emerald-500/10" },
  B: { badge: "bg-blue-500/20 border-blue-400/50 text-blue-200", text: "text-blue-300", glow: "bg-blue-500/10" },
  C: { badge: "bg-slate-500/20 border-slate-400/50 text-slate-300", text: "text-slate-400", glow: "bg-slate-500/10" },
};

const XYZ_COLORS: Record<XyzClass, { badge: string; text: string }> = {
  X: { badge: "bg-cyan-500/20 border-cyan-400/50 text-cyan-200", text: "text-cyan-300" },
  Y: { badge: "bg-amber-500/20 border-amber-400/50 text-amber-200", text: "text-amber-300" },
  Z: { badge: "bg-red-500/20 border-red-400/50 text-red-200", text: "text-red-300" },
};

const ABC_DESCS: Record<AbcClass, { zh: string; en: string }> = {
  A: { zh: "高价值（前80%销量贡献）", en: "High value — top 80% of sales" },
  B: { zh: "中价值（80-95%销量贡献）", en: "Mid value — 80–95% of sales" },
  C: { zh: "低价值（后5%销量贡献）", en: "Low value — bottom 5% of sales" },
};

const XYZ_DESCS: Record<XyzClass, { zh: string; en: string }> = {
  X: { zh: "需求稳定（变异系数 < 0.5）", en: "Stable demand — CoV < 0.5" },
  Y: { zh: "需求波动（变异系数 0.5–1.0）", en: "Variable demand — CoV 0.5–1.0" },
  Z: { zh: "需求不规则（变异系数 > 1.0）", en: "Erratic demand — CoV > 1.0" },
};

const STRATEGIES: Record<`${AbcClass}${XyzClass}`, { zh: string; en: string }> = {
  AX: { zh: "连续补货，严格安全库存", en: "Continuous replenishment, tight safety stock" },
  AY: { zh: "定期补货，适度安全库存", en: "Periodic review, moderate safety stock" },
  AZ: { zh: "按需补货，重点监控", en: "On-demand order, close monitoring" },
  BX: { zh: "定期补货，标准安全库存", en: "Periodic replenishment, standard safety stock" },
  BY: { zh: "定期补货，弹性库存", en: "Periodic replenishment, flexible buffer" },
  BZ: { zh: "按需补货，降低库存", en: "On-demand order, lean inventory" },
  CX: { zh: "批量采购，减少订单频次", en: "Bulk purchase, lower order frequency" },
  CY: { zh: "最小库存，按需采购", en: "Minimal stock, demand-driven purchase" },
  CZ: { zh: "考虑淘汰或极小批量", en: "Consider discontinuation or micro batches" },
};

export default function LeanStrategyPage() {
  const { lang } = useLanguage();
  const [data, setData] = useState<AbcXyzResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ abc: AbcClass; xyz: XyzClass } | null>(null);
  const [search, setSearch] = useState("");
  const [filterAbc, setFilterAbc] = useState<AbcClass | "">("");
  const [filterXyz, setFilterXyz] = useState<XyzClass | "">("");
  const [sortBy, setSortBy] = useState<"total_sales" | "cov" | "sku">("total_sales");
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/analytics/abc-xyz", { cache: "no-store" });
        const json: AbcXyzResponse = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed");
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!data || data.total_skus === 0) return;
    const generate = async () => {
      setAiLoading(true);
      setAiError(null);
      try {
        const res = await fetch("/api/ai/abc-xyz-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matrix: data.matrix, total_skus: data.total_skus, lang }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed");
        setAiReport(json.report as string);
      } catch (err) {
        setAiError(err instanceof Error ? err.message : "Failed to generate report");
      } finally {
        setAiLoading(false);
      }
    };
    void generate();
  }, [data, lang]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    let rows = data.classifications;
    if (selectedCell) rows = rows.filter((r) => r.abc === selectedCell.abc && r.xyz === selectedCell.xyz);
    if (filterAbc) rows = rows.filter((r) => r.abc === filterAbc);
    if (filterXyz) rows = rows.filter((r) => r.xyz === filterXyz);
    if (search) rows = rows.filter((r) => r.sku.toLowerCase().includes(search.toLowerCase()));
    return [...rows].sort((a, b) => {
      if (sortBy === "total_sales") return b.total_sales - a.total_sales;
      if (sortBy === "cov") return b.cov - a.cov;
      return a.sku.localeCompare(b.sku);
    });
  }, [data, selectedCell, filterAbc, filterXyz, search, sortBy]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-2xl border border-slate-800 bg-slate-900/70" />
        <div className="h-64 rounded-2xl border border-slate-800 bg-slate-900/70" />
        <div className="h-96 rounded-2xl border border-slate-800 bg-slate-900/70" />
      </div>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
        <p className="text-sm text-red-200">{error}</p>
      </section>
    );
  }

  const ABC_ROWS: AbcClass[] = ["A", "B", "C"];
  const XYZ_COLS: XyzClass[] = ["X", "Y", "Z"];

  return (
    <div className="space-y-6">
      {data && (
        <p className="text-xs text-slate-500 -mt-3">
          {lang === "zh" ? `共 ${data.total_skus} 个 SKU · 计算时间` : `${data.total_skus} SKUs · Computed`}:{" "}
          {new Date(data.computed_at).toLocaleString()}
        </p>
      )}

      {/* Legend */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={CARD}>
          <h3 className="text-sm font-semibold text-slate-100 mb-3">
            {lang === "zh" ? "ABC 分类说明" : "ABC Classification"}
          </h3>
          <div className="space-y-2">
            {ABC_ROWS.map((abc) => (
              <div key={abc} className="flex items-start gap-3">
                <span className={`mt-0.5 inline-flex shrink-0 items-center justify-center w-6 h-6 rounded border text-xs font-bold ${ABC_COLORS[abc].badge}`}>
                  {abc}
                </span>
                <p className="text-xs text-slate-400">{lang === "zh" ? ABC_DESCS[abc].zh : ABC_DESCS[abc].en}</p>
              </div>
            ))}
          </div>
        </div>
        <div className={CARD}>
          <h3 className="text-sm font-semibold text-slate-100 mb-3">
            {lang === "zh" ? "XYZ 分类说明" : "XYZ Classification"}
          </h3>
          <div className="space-y-2">
            {XYZ_COLS.map((xyz) => (
              <div key={xyz} className="flex items-start gap-3">
                <span className={`mt-0.5 inline-flex shrink-0 items-center justify-center w-6 h-6 rounded border text-xs font-bold ${XYZ_COLORS[xyz].badge}`}>
                  {xyz}
                </span>
                <p className="text-xs text-slate-400">{lang === "zh" ? XYZ_DESCS[xyz].zh : XYZ_DESCS[xyz].en}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI Report */}
      {(aiLoading || aiReport || aiError) && (
        <section className={CARD}>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 text-xs">AI</span>
            <h2 className="text-sm font-semibold text-slate-100">
              {lang === "zh" ? "AI 分析报告" : "AI Analysis Report"}
            </h2>
            {aiLoading && (
              <span className="ml-auto text-xs text-slate-500 animate-pulse">
                {lang === "zh" ? "正在生成…" : "Generating…"}
              </span>
            )}
          </div>

          {aiLoading && (
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-slate-800 animate-pulse" />
              <div className="h-3 w-5/6 rounded bg-slate-800 animate-pulse" />
              <div className="h-3 w-4/5 rounded bg-slate-800 animate-pulse" />
              <div className="h-3 w-full rounded bg-slate-800 animate-pulse" />
              <div className="h-3 w-3/4 rounded bg-slate-800 animate-pulse" />
            </div>
          )}

          {aiError && !aiLoading && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-red-300">{aiError}</p>
              <button
                type="button"
                onClick={() => {
                  if (!data) return;
                  setAiReport(null);
                  setAiError(null);
                  setAiLoading(true);
                  fetch("/api/ai/abc-xyz-report", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ matrix: data.matrix, total_skus: data.total_skus, lang }),
                  })
                    .then((r) => r.json())
                    .then((j) => {
                      if (j.error) throw new Error(j.error);
                      setAiReport(j.report as string);
                    })
                    .catch((e) => setAiError(e instanceof Error ? e.message : "Failed"))
                    .finally(() => setAiLoading(false));
                }}
                className="text-xs text-cyan-400 hover:text-cyan-200 border border-slate-700 rounded-md px-2 py-1 ml-3 shrink-0"
              >
                {lang === "zh" ? "重试" : "Retry"}
              </button>
            </div>
          )}

          {aiReport && !aiLoading && (
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{aiReport}</p>
          )}
        </section>
      )}

      {/* 3×3 Matrix */}
      {data && (
        <section className={CARD}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-100">
              {lang === "zh" ? "9格策略矩阵" : "9-Cell Strategy Matrix"}
            </h2>
            {selectedCell && (
              <button
                type="button"
                onClick={() => setSelectedCell(null)}
                className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded-md px-2 py-1"
              >
                {lang === "zh" ? "清除筛选" : "Clear filter"}
              </button>
            )}
          </div>
          <p className="mb-4 text-xs text-slate-500">
            {lang === "zh" ? "点击单元格筛选对应 SKU" : "Click a cell to filter SKUs in the table below"}
          </p>

          <div className="overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-12 p-2" />
                  {XYZ_COLS.map((xyz) => (
                    <th key={xyz} className="p-2 text-center">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded border text-xs font-bold ${XYZ_COLORS[xyz].badge}`}>
                        {xyz}
                      </span>
                      <p className="text-xs text-slate-500 mt-1">{lang === "zh" ? XYZ_DESCS[xyz].zh.split("（")[0] : (xyz === "X" ? "Stable" : xyz === "Y" ? "Variable" : "Erratic")}</p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ABC_ROWS.map((abc) => (
                  <tr key={abc}>
                    <td className="p-2 text-center align-middle">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded border text-xs font-bold ${ABC_COLORS[abc].badge}`}>
                        {abc}
                      </span>
                    </td>
                    {XYZ_COLS.map((xyz) => {
                      const count = data.matrix[abc][xyz];
                      const key = `${abc}${xyz}` as `${AbcClass}${XyzClass}`;
                      const strategy = STRATEGIES[key];
                      const isSelected = selectedCell?.abc === abc && selectedCell?.xyz === xyz;
                      return (
                        <td key={xyz} className="p-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedCell(isSelected ? null : { abc, xyz })}
                            className={`w-full rounded-xl border p-3 text-left transition-all ${
                              isSelected
                                ? "border-cyan-400/60 bg-cyan-500/20"
                                : "border-slate-700 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-900/55"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-slate-300">{abc}{xyz}</span>
                              <span className={`text-lg font-bold ${count > 0 ? "text-slate-100" : "text-slate-600"}`}>
                                {count}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 leading-tight">
                              {lang === "zh" ? strategy.zh : strategy.en}
                            </p>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* SKU Table */}
      {data && (
        <section className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-base font-semibold text-slate-100">
              {lang === "zh" ? "SKU 分类明细" : "SKU Classification Table"} ({filteredRows.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === "zh" ? "搜索 SKU" : "Search SKU"}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400 w-36"
              />
              <select
                value={filterAbc}
                onChange={(e) => { setFilterAbc(e.target.value as AbcClass | ""); setSelectedCell(null); }}
                className="rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              >
                <option value="">{lang === "zh" ? "全部 ABC" : "All ABC"}</option>
                {ABC_ROWS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select
                value={filterXyz}
                onChange={(e) => { setFilterXyz(e.target.value as XyzClass | ""); setSelectedCell(null); }}
                className="rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              >
                <option value="">{lang === "zh" ? "全部 XYZ" : "All XYZ"}</option>
                {XYZ_COLS.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              >
                <option value="total_sales">{lang === "zh" ? "总销量排序" : "Sort by Sales"}</option>
                <option value="cov">{lang === "zh" ? "变异系数排序" : "Sort by CoV"}</option>
                <option value="sku">{lang === "zh" ? "SKU 排序" : "Sort by SKU"}</option>
              </select>
            </div>
          </div>

          <div className="overflow-auto rounded-xl border border-slate-800 max-h-[480px]">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-900/95 text-xs uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-center">ABC</th>
                  <th className="px-3 py-2 text-center">XYZ</th>
                  <th className="px-3 py-2 text-center">{lang === "zh" ? "组合" : "Cell"}</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "总销量" : "Total Sales"}</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "月均销量" : "Avg/Mo"}</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "变异系数" : "CoV"}</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "累计占比" : "Cum %"}</th>
                  <th className="px-3 py-2 text-left">{lang === "zh" ? "建议策略" : "Strategy"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                      {lang === "zh" ? "暂无数据" : "No data"}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const key = `${row.abc}${row.xyz}` as `${AbcClass}${XyzClass}`;
                    const strategy = STRATEGIES[key];
                    return (
                      <tr key={row.sku} className="border-t border-slate-800 text-slate-200 hover:bg-slate-800/30">
                        <td className="px-3 py-2 font-medium">{row.sku}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded border text-xs font-bold ${ABC_COLORS[row.abc].badge}`}>
                            {row.abc}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded border text-xs font-bold ${XYZ_COLORS[row.xyz].badge}`}>
                            {row.xyz}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-xs font-bold text-slate-200">
                            {row.abc}{row.xyz}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.total_sales.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.avg_monthly_sales}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span className={XYZ_COLORS[row.xyz].text}>{row.cov.toFixed(3)}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-400">{row.cumulative_pct}%</td>
                        <td className="px-3 py-2 text-xs text-slate-400 max-w-[180px] truncate">
                          {lang === "zh" ? strategy.zh : strategy.en}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
