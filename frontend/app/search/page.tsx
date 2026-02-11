"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useLanguage } from "@/components/LanguageProvider";

type InventoryItem = {
  id: string;

  // 核心
  model: string;     // 型号
  batch: string;     // 批号
  category: string;  // 类别

  // 扩展字段（如果上传解析没映射，会为空）
  lastBalance?: number;     // 上月结存
  outbound?: number;        // 本月领用
  sales?: number;           // 本月销售
  currentBalance: number;   // 本月结存（筛选/显示用）
  subtotal?: number;        // 小记
  safetyStock?: number;     // 安全库存
  location?: string;        // 存放位置
  monthEndCount?: number;   // 月底盘存
  gainLoss?: number;        // 盘盈/亏
  note?: string;            // 备注

  status: "Normal" | "Low" | "Out";
};

type SavedDataset = {
  fileName: string;
  uploadDate: string;
  rowCount: number;
  size: string;
  data: InventoryItem[];
};

type ParsedQuery = {
  text: string;
  sku?: string;
  model?: string;
  batch?: string;
  category?: string;
  status?: "Normal" | "Low" | "Out";
  month?: string;
  min?: number;
  max?: number;
};

function parseQuery(input: string): ParsedQuery {
  const q = input.trim();
  if (!q) return { text: "" };

  const parts = q.split(/\s+/);
  const rest: string[] = [];
  const out: ParsedQuery = { text: "" };

  for (const p of parts) {
    const m = p.match(/^(\w+):(.+)$/);
    if (!m) {
      rest.push(p);
      continue;
    }
    const key = m[1].toLowerCase();
    const val = m[2].trim();

    if (key === "sku") out.sku = val;
    else if (key === "model") out.model = val;
    else if (key === "batch") out.batch = val;
    else if (key === "category") out.category = val;
    else if (key === "status" && (val === "Normal" || val === "Low" || val === "Out")) out.status = val;
    else if (key === "month") out.month = val;
    else if (key === "min") out.min = Number(val);
    else if (key === "max") out.max = Number(val);
    else rest.push(p);
  }

  out.text = rest.join(" ");
  return out;
}

function safeLower(s: string | number | null | undefined) {
  return String(s ?? "").toLowerCase();
}

function highlight(text: string, needle: string) {
  const t = String(text ?? "");
  const n = needle.trim();
  if (!n) return <>{t}</>;
  const idx = t.toLowerCase().indexOf(n.toLowerCase());
  if (idx === -1) return <>{t}</>;
  const before = t.slice(0, idx);
  const match = t.slice(idx, idx + n.length);
  const after = t.slice(idx + n.length);
  return (
    <>
      {before}
      <mark className="bg-yellow-200/60 dark:bg-yellow-400/20 px-0.5 rounded">
        {match}
      </mark>
      {after}
    </>
  );
}

export default function SearchClient() {
  const { lang } = useLanguage();

  // Search input
  const [query, setQuery] = useState("");

  // Filters UI
  const [datasetScope, setDatasetScope] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "Normal" | "Low" | "Out">("ALL");
  const [minBalance, setMinBalance] = useState<string>("");
  const [maxBalance, setMaxBalance] = useState<string>("");

  // ===== scroll sync refs =====
const topScrollRef = useRef<HTMLDivElement | null>(null);
const tableScrollRef = useRef<HTMLDivElement | null>(null);

useEffect(() => {
  const top = topScrollRef.current;
  const body = tableScrollRef.current;
  if (!top || !body) return;

  const syncFromTop = () => {
    body.scrollLeft = top.scrollLeft;
  };
  const syncFromBody = () => {
    top.scrollLeft = body.scrollLeft;
  };

  top.addEventListener("scroll", syncFromTop, { passive: true });
  body.addEventListener("scroll", syncFromBody, { passive: true });

  // 初始对齐
  top.scrollLeft = body.scrollLeft;

  return () => {
    top.removeEventListener("scroll", syncFromTop);
    body.removeEventListener("scroll", syncFromBody);
  };
}, []);

  // Load datasets from localStorage
  const [datasets, setDatasets] = useState<SavedDataset[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("inventory_datasets");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setDatasets(parsed as SavedDataset[]);
    } catch {}
  }, []);

  // Flatten rows with dataset info
  const rows = useMemo(() => {
    const out: Array<{ ds: SavedDataset; item: InventoryItem }> = [];
    for (const ds of datasets) {
      if (datasetScope !== "ALL" && ds.fileName !== datasetScope) continue;
      for (const item of ds.data || []) out.push({ ds, item });
    }
    return out;
  }, [datasets, datasetScope]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const { item } of rows) {
      if (item.category) set.add(item.category);
    }
    return ["ALL", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [rows]);

  const parsed = useMemo(() => parseQuery(query), [query]);

  const effectiveMin = useMemo(() => {
    const a = minBalance.trim() ? Number(minBalance) : undefined;
    const b = parsed.min;
    if (typeof a === "number" && !Number.isNaN(a)) return a;
    if (typeof b === "number" && !Number.isNaN(b)) return b;
    return undefined;
  }, [minBalance, parsed.min]);

  const effectiveMax = useMemo(() => {
    const a = maxBalance.trim() ? Number(maxBalance) : undefined;
    const b = parsed.max;
    if (typeof a === "number" && !Number.isNaN(a)) return a;
    if (typeof b === "number" && !Number.isNaN(b)) return b;
    return undefined;
  }, [maxBalance, parsed.max]);

  const effectiveStatus = useMemo(() => {
    if (statusFilter !== "ALL") return statusFilter;
    return parsed.status;
  }, [statusFilter, parsed.status]);

  const effectiveCategory = useMemo(() => {
    if (categoryFilter !== "ALL") return categoryFilter;
    return parsed.category;
  }, [categoryFilter, parsed.category]);

  const results = useMemo(() => {
    const t = safeLower(parsed.text);
    const sku = safeLower(parsed.sku || parsed.model);
    const batch = safeLower(parsed.batch);
    const cat = safeLower(effectiveCategory);
    const month = safeLower(parsed.month);
    const st = effectiveStatus;

    const res = rows.filter(({ ds, item }) => {
      if (month && !safeLower(ds.fileName).includes(month)) return false;
      if (cat && cat !== "all" && safeLower(item.category) !== cat) return false;
      if (st && item.status !== st) return false;

      if (typeof effectiveMin === "number" && item.currentBalance < effectiveMin) return false;
      if (typeof effectiveMax === "number" && item.currentBalance > effectiveMax) return false;

      if (sku && !safeLower(item.model).includes(sku)) return false;
      if (batch && !safeLower(item.batch).includes(batch)) return false;

      if (t) {
        const blob = `${item.model} ${item.batch} ${item.category} ${item.location ?? ""} ${item.note ?? ""} ${ds.fileName}`.toLowerCase();
        if (!blob.includes(t)) return false;
      }
      return true;
    });

    const rank = (s: InventoryItem["status"]) => (s === "Out" ? 0 : s === "Low" ? 1 : 2);
    res.sort((a, b) => {
      const r = rank(a.item.status) - rank(b.item.status);
      if (r !== 0) return r;
      return a.item.currentBalance - b.item.currentBalance;
    });

    return res;
  }, [rows, parsed, effectiveCategory, effectiveStatus, effectiveMin, effectiveMax]);

  const summary = useMemo(() => {
    const total = results.length;
    const low = results.filter((r) => r.item.status === "Low").length;
    const out = results.filter((r) => r.item.status === "Out").length;
    const sumQty = results.reduce((acc, r) => acc + (Number(r.item.currentBalance) || 0), 0);
    return { total, low, out, sumQty };
  }, [results]);

  const activeFilters = useMemo(() => {
    const chips: string[] = [];
    if (datasetScope !== "ALL") chips.push(`dataset=${datasetScope}`);
    if (effectiveCategory) chips.push(`category=${effectiveCategory}`);
    if (effectiveStatus) chips.push(`status=${effectiveStatus}`);
    if (typeof effectiveMin === "number") chips.push(`min=${effectiveMin}`);
    if (typeof effectiveMax === "number") chips.push(`max=${effectiveMax}`);
    if (parsed.month) chips.push(`month=${parsed.month}`);
    if (parsed.sku || parsed.model) chips.push(`sku=${parsed.sku || parsed.model}`);
    if (parsed.batch) chips.push(`batch=${parsed.batch}`);
    if (parsed.text) chips.push(`text="${parsed.text}"`);
    return chips;
  }, [datasetScope, effectiveCategory, effectiveStatus, effectiveMin, effectiveMax, parsed.month, parsed.sku, parsed.model, parsed.batch, parsed.text]);

  const keywordForHighlight = useMemo(() => {
    if (parsed.text.trim()) return parsed.text.trim();
    if ((parsed.sku || parsed.model)?.trim()) return (parsed.sku || parsed.model)!.trim();
    if (parsed.batch?.trim()) return parsed.batch.trim();
    if (effectiveCategory?.trim() && effectiveCategory !== "ALL") return effectiveCategory.trim();
    return "";
  }, [parsed.text, parsed.sku, parsed.model, parsed.batch, effectiveCategory]);

  const limit = 300;
  const shown = results.slice(0, limit);

  const TEXT = {
    title: { zh: "库存搜索", en: "Inventory Search" },
    subtitle: { zh: "支持语法：sku: / category: / status: / batch: / min: / max: / month:", en: "Supported: sku: / category: / status: / batch: / min: / max: / month:" },
    noData: {
      zh: "还没有数据。请去「库存管理」上传文件并点击「保存到数据库」。",
      en: "No data yet. Go to Inventory and upload, then click Save to Database.",
    },
    filters: { zh: "筛选", en: "Filters" },
    dataset: { zh: "数据集", en: "Dataset" },
    category: { zh: "类别", en: "Category" },
    status: { zh: "状态", en: "Status" },
    balanceRange: { zh: "结存范围（本月结存）", en: "Balance Range (Current)" },
    reset: { zh: "重置", en: "Reset" },
    results: { zh: "结果", en: "Results" },
    active: { zh: "已应用筛选", en: "Active filters" },
    model: { zh: "型号/SKU", en: "Model/SKU" },
    batch: { zh: "批号", en: "Batch" },
    from: { zh: "来源文件", en: "Dataset" },
    showFirst: { zh: "为避免卡顿，仅显示前", en: "For performance, showing first" },
    rows: { zh: "条", en: "rows" },
  } as const;

  const statusLabel = (s: "Normal" | "Low" | "Out") => {
    if (lang === "zh") return s === "Normal" ? "正常" : s === "Low" ? "缺货预警" : "已售罄";
    return s === "Normal" ? "Normal" : s === "Low" ? "Low" : "Out";
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-blue-700 dark:text-blue-400">{TEXT.title[lang]}</h1>
        <p className="mt-1 text-sm opacity-70">{TEXT.subtitle[lang]}</p>
      </div>

      {/* Top search bar */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg">
        <div className="flex gap-3 items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={lang === "zh" ? '例如：sku:FWD111 category:xxx status:Low min:0 max:50 month:2025-03' : "e.g. sku:FWD111 category:xxx status:Low min:0 max:50 month:2025-03"}
            className="w-full bg-transparent outline-none text-base px-2 py-3"
            onKeyDown={(e) => e.key === "Enter" && setQuery((v) => v)}
          />
          <button onClick={() => setQuery((v) => v)} className="shrink-0 rounded-xl px-4 py-2 bg-blue-600 hover:bg-blue-500">
            {lang === "zh" ? "搜索" : "Search"}
          </button>
        </div>

        {/* Quick chips */}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {["status:Low", "status:Out", "min:0", "max:50", "month:2025-03"].map((s) => (
            <button
              key={s}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
              onClick={() => setQuery((prev) => (prev ? prev + " " + s : s))}
            >
              + {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
        {/* Filters */}
        <aside className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="font-bold mb-4">{TEXT.filters[lang]}</div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold opacity-70 mb-1">{TEXT.dataset[lang]}</label>
              <select
                value={datasetScope}
                onChange={(e) => setDatasetScope(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              >
                <option value="ALL">{lang === "zh" ? "全部" : "All"}</option>
                {datasets.map((d) => (
                  <option key={d.fileName} value={d.fileName}>
                    {d.fileName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold opacity-70 mb-1">{TEXT.category[lang]}</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c === "ALL" ? (lang === "zh" ? "全部" : "All") : c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold opacity-70 mb-1">{TEXT.status[lang]}</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "ALL" | "Normal" | "Low" | "Out")}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              >
                <option value="ALL">{lang === "zh" ? "全部" : "All"}</option>
                <option value="Normal">{statusLabel("Normal")}</option>
                <option value="Low">{statusLabel("Low")}</option>
                <option value="Out">{statusLabel("Out")}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold opacity-70 mb-1">{TEXT.balanceRange[lang]}</label>
              <div className="flex gap-2">
                <input
                  value={minBalance}
                  onChange={(e) => setMinBalance(e.target.value)}
                  placeholder={lang === "zh" ? "最小" : "Min"}
                  className="w-1/2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
                  inputMode="numeric"
                />
                <input
                  value={maxBalance}
                  onChange={(e) => setMaxBalance(e.target.value)}
                  placeholder={lang === "zh" ? "最大" : "Max"}
                  className="w-1/2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
                  inputMode="numeric"
                />
              </div>
              <div className="mt-2 text-xs opacity-60">
                {lang === "zh" ? "也可直接在搜索框用 min:/max:" : "You can also use min:/max: in query."}
              </div>
            </div>

            <button
              onClick={() => {
                setDatasetScope("ALL");
                setCategoryFilter("ALL");
                setStatusFilter("ALL");
                setMinBalance("");
                setMaxBalance("");
                setQuery("");
              }}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
            >
              {TEXT.reset[lang]}
            </button>
          </div>
        </aside>

        {/* Results */}
        <main className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-bold">
                {TEXT.results[lang]} <span className="opacity-70 text-sm">({summary.total})</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  Low: <b>{summary.low}</b>
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  Out: <b>{summary.out}</b>
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  {lang === "zh" ? "结存合计" : "Qty sum"}: <b>{summary.sumQty}</b>
                </span>
              </div>
            </div>

            <div className="mt-3 text-xs opacity-70">
              <span className="font-bold mr-2">{TEXT.active[lang]}:</span>
              {activeFilters.length === 0 ? (
                <span>{lang === "zh" ? "无" : "None"}</span>
              ) : (
                <span className="inline-flex flex-wrap gap-2">
                  {activeFilters.map((c) => (
                    <span key={c} className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                      {c}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>

          {datasets.length === 0 ? (
            <div className="px-5 py-10 opacity-75">{TEXT.noData[lang]}</div>
        ) : (
            <div className="overflow-hidden">
              {/* 顶部可拖动横向 bar */}
              <div
                ref={topScrollRef}
                className="scrollbar-nice overflow-x-auto overflow-y-hidden border-b border-white/10"
              >
                {/* 只用于制造顶部滚动条的宽度，先写死即可 */}
                <div className="h-3" style={{ width: "2600px" }} />
              </div>
          
              {/* 表格滚动区域：横向 + 纵向（右侧会出现可拖动竖向 bar） */}
              <div
                ref={tableScrollRef}
                className="scrollbar-nice max-h-[70vh] overflow-auto"
              >
                <table className="min-w-max w-full text-sm text-left">
                  <thead className="bg-white/5 border-b border-white/10 uppercase tracking-wider opacity-80 sticky top-0 z-20">
                    <tr>
                      <th className="px-5 py-3 font-bold">{TEXT.model[lang]}</th>
                      <th className="px-5 py-3 font-bold">{TEXT.batch[lang]}</th>
                      <th className="px-5 py-3 font-bold">{TEXT.category[lang]}</th>
          
                      <th className="px-5 py-3 font-bold text-right">上月结存</th>
                      <th className="px-5 py-3 font-bold text-right">本月领用</th>
                      <th className="px-5 py-3 font-bold text-right">本月销售</th>
                      <th className="px-5 py-3 font-bold text-right">本月结存</th>
          
                      <th className="px-5 py-3 font-bold text-right">小记</th>
                      <th className="px-5 py-3 font-bold text-right">安全库存</th>
                      <th className="px-5 py-3 font-bold">存放位置</th>
                      <th className="px-5 py-3 font-bold text-right">月底盘存</th>
                      <th className="px-5 py-3 font-bold text-right">盘盈/亏</th>
          
                      <th className="px-5 py-3 font-bold text-center">{TEXT.status[lang]}</th>
                      <th className="px-5 py-3 font-bold">{TEXT.from[lang]}</th>
                      <th className="px-5 py-3 font-bold">备注</th>
                    </tr>
                  </thead>
          
                  <tbody className="divide-y divide-white/10">
                    {shown.map(({ ds, item }) => (
                      <tr key={`${ds.fileName}-${item.id}`} className="hover:bg-white/5">
                        <td className="px-5 py-3 font-semibold">
                          {highlight(item.model, keywordForHighlight)}
                        </td>
                        <td className="px-5 py-3 opacity-80">
                          {highlight(item.batch, keywordForHighlight)}
                        </td>
                        <td className="px-5 py-3 opacity-80">
                          {highlight(item.category, keywordForHighlight)}
                        </td>
          
                        <td className="px-5 py-3 text-right">{item.lastBalance ?? ""}</td>
                        <td className="px-5 py-3 text-right">{item.outbound ?? ""}</td>
                        <td className="px-5 py-3 text-right">{item.sales ?? ""}</td>
                        <td className="px-5 py-3 text-right font-bold">{item.currentBalance}</td>
          
                        <td className="px-5 py-3 text-right">{item.subtotal ?? ""}</td>
                        <td className="px-5 py-3 text-right">{item.safetyStock ?? ""}</td>
                        <td className="px-5 py-3 opacity-80">{item.location ?? ""}</td>
                        <td className="px-5 py-3 text-right">{item.monthEndCount ?? ""}</td>
                        <td className="px-5 py-3 text-right">{item.gainLoss ?? ""}</td>
          
                        <td className="px-5 py-3 text-center">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold border ${
                              item.status === "Normal"
                                ? "bg-green-900/30 text-green-300 border-green-800"
                                : item.status === "Low"
                                ? "bg-yellow-900/30 text-yellow-300 border-yellow-800"
                                : "bg-red-900/30 text-red-300 border-red-800"
                            }`}
                          >
                            {statusLabel(item.status)}
                          </span>
                        </td>
          
                        <td className="px-5 py-3 opacity-70">
                          {highlight(ds.fileName, keywordForHighlight)}
                        </td>
                        <td className="px-5 py-3 opacity-70">{item.note ?? ""}</td>
                      </tr>
                    ))}
          
                    {shown.length === 0 && (
                      <tr>
                        <td className="px-5 py-10 opacity-70" colSpan={15}>
                          {lang === "zh"
                            ? "没有匹配结果。试试：status:Low 或 category:xxx 或 min:0 max:50"
                            : "No results. Try: status:Low, category:xxx, min:0 max:50"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
          
                {results.length > limit && (
                  <div className="px-5 py-3 text-xs opacity-60 border-t border-white/10">
                    {TEXT.showFirst[lang]} {limit} {TEXT.rows[lang]}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}