"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { type InventoryStatus } from "@/lib/inventoryStatus";

type InventoryItem = {
  id: string;

  // 核心
  model: string;     // 型号
  batch: string;     // 批号
  category: string;  // 类别

  // 扩展字段（如果上传解析没映射，会为空）
  lastBalance?: number;     // 上月结存
  inbound?: number;         // 本月入库
  outbound?: number;        // 本月领用
  sales?: number;           // 本月销售
  currentBalance: number;   // 本月结存（筛选/显示用）
  subtotal?: number;        // 小记
  noteValue?: number;       // Note_value
  safetyStock?: number;     // 安全库存
  location?: string;        // 存放位置
  monthEndCount?: number;   // 月底盘存
  monthEndInventory?: number; // month_end_inventory
  gainLoss?: number;        // 盘盈/亏
  inventoryDiff?: number;   // inventory_diff
  note?: string;            // 备注
  remark?: string;          // Remark
  time?: string;            // Time

  status: InventoryStatus;
  raw?: Record<string, unknown>; // 保留原始行用于动态展示/导出
};

type SavedDataset = {
  fileName: string;
  uploadDate: string;
  rowCount: number;
  size: string;
  data: InventoryItem[];
  month?: string;
};

type ParsedQuery = {
  text: string;
  sku?: string;
  model?: string;
  batch?: string;
  category?: string;
  status?: InventoryStatus;
  month?: string;
  min?: number;
  max?: number;
};

const STATUS_VALUES: InventoryStatus[] = ["Out", "Low", "Overstock", "HighNearCritical", "High", "Normal"];

const STATUS_LOOKUP = new Map<string, InventoryStatus>([
  ...STATUS_VALUES.map((status) => [status.toLowerCase(), status] as const),
  ["lowstock", "Low"],
  ["outofstock", "Out"],
  ["highstock", "High"],
  ["high2.75", "HighNearCritical"],
  ["over", "Overstock"],
]);

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
    else if (key === "status") {
      const parsedStatus = STATUS_LOOKUP.get(val.toLowerCase());
      if (parsedStatus) out.status = parsedStatus;
      else rest.push(p);
    }
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

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (typeof window === "undefined") return;
  if (!rows.length) return;
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [headers.join(",")]
    .concat(rows.map((r) => headers.map((h) => escape((r as any)[h])).join(",")))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function SearchClient() {
  const { lang } = useLanguage();

  // Search input
  const [query, setQuery] = useState("");

  // Filters UI
  const [datasetScope, setDatasetScope] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | InventoryStatus>("ALL");
  const [minBalance, setMinBalance] = useState<string>("");
  const [maxBalance, setMaxBalance] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);

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
    const loadAll = async () => {
      try {
        const res = await fetch("/api/inventory/all", { cache: "no-store" });
        if (!res.ok) {
          setDatasets([]);
          return;
        }
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        setDatasets([
          {
            fileName: "Supabase Database",
            uploadDate: new Date().toISOString(),
            rowCount: items.length,
            size: `${Math.round(items.length * 0.5)} KB`,
            data: items as InventoryItem[],
            month: "ALL",
          },
        ]);
      } catch {
        setDatasets([]);
      }
    };
    loadAll();
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

    const rank = (s: InventoryItem["status"]) => {
      switch (s) {
        case "Out":
          return 0;
        case "Low":
          return 1;
        case "Overstock":
          return 2;
        case "HighNearCritical":
          return 3;
        case "High":
          return 4;
        default:
          return 5;
      }
    };
    res.sort((a, b) => {
      const r = rank(a.item.status) - rank(b.item.status);
      if (r !== 0) return r;
      return a.item.currentBalance - b.item.currentBalance;
    });

    return res;
  }, [rows, parsed, effectiveCategory, effectiveStatus, effectiveMin, effectiveMax]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, datasetScope, categoryFilter, statusFilter, minBalance, maxBalance]);

  const summary = useMemo(() => {
    const total = results.length;
    const low = results.filter((r) => r.item.status === "Low").length;
    const out = results.filter((r) => r.item.status === "Out").length;
    const high = results.filter((r) => r.item.status === "High").length;
    const nearCritical = results.filter((r) => r.item.status === "HighNearCritical").length;
    const overstock = results.filter((r) => r.item.status === "Overstock").length;
    const sumQty = results.reduce((acc, r) => acc + (Number(r.item.currentBalance) || 0), 0);
    return { total, low, out, high, nearCritical, highTotal: high + nearCritical, overstock, sumQty };
  }, [results]);

  const TEXT = {
    title: { zh: "库存搜索", en: "Inventory Search" },
    subtitle: { zh: "支持语法：sku: / category: / status: / batch: / min: / max: / month:", en: "Supported: sku: / category: / status: / batch: / min: / max: / month:" },
    noData: {
      zh: "还没有数据。请去「库存管理」上传文件并点击「保存到数据库」。",
      en: "No data yet. Go to Inventory and upload, then click Save to Database.",
    },
    downloadFiltered: { zh: "下载筛选结果", en: "Download filtered" },
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

  // 动态列：基础顺序 + 原始字段
  const baseColumns: Array<{ key: string; label: string }> = [
    { key: "SKU", label: TEXT.model[lang] },
    { key: "Batch", label: TEXT.batch[lang] },
    { key: "Category", label: TEXT.category[lang] },
    { key: "Last_Month_Stock", label: "Last_Month_Stock" },
    { key: "month_in", label: "month_in" },
    { key: "month_out", label: "month_out" },
    { key: "month_sales", label: "month_sales" },
    { key: "month_end_stock", label: "month_end_stock" },
    { key: "Note_value", label: "Note_value" },
    { key: "safety_stock", label: "safety_stock" },
    { key: "Location", label: "Location" },
    { key: "month_end_inventory", label: "month_end_inventory" },
    { key: "inventory_diff", label: "inventory_diff" },
    { key: "Remark", label: "Remark" },
    { key: "Time", label: "Time" },
    { key: "Status", label: TEXT.status[lang] },
    { key: "Dataset", label: TEXT.from[lang] },
  ];

  const extraKeys = useMemo(() => {
    const set = new Set<string>();
    const sample = results.slice(0, 500); // 限制数量避免性能问题
    sample.forEach(({ item }) => {
      Object.keys(item.raw || {}).forEach((k) => {
        if (!baseColumns.some((c) => c.key === k)) set.add(k);
      });
    });
    return Array.from(set).sort();
  }, [results]);

  const displayColumns = useMemo(
    () => baseColumns.concat(extraKeys.map((k) => ({ key: k, label: k }))),
    [baseColumns, extraKeys]
  );

  const buildCsvRows = (cols: string[], source: typeof results) =>
    source.map(({ ds, item }) => {
      const row: Record<string, unknown> = {};
      cols.forEach((key) => {
        switch (key) {
          case "SKU": row[key] = item.model; break;
          case "Batch": row[key] = item.batch; break;
          case "Category": row[key] = item.category; break;
          case "Last_Month_Stock": row[key] = item.lastBalance; break;
          case "month_in": row[key] = item.inbound; break;
          case "month_out": row[key] = item.outbound; break;
          case "month_sales": row[key] = item.sales; break;
          case "month_end_stock": row[key] = item.currentBalance; break;
          case "Note_value": row[key] = item.noteValue ?? item.currentBalance; break;
          case "safety_stock": row[key] = item.safetyStock; break;
          case "Location": row[key] = item.location; break;
          case "month_end_inventory": row[key] = item.monthEndCount ?? item.monthEndInventory; break;
          case "inventory_diff": row[key] = item.gainLoss ?? item.inventoryDiff; break;
          case "Remark": row[key] = item.remark ?? item.note; break;
          case "Time": row[key] = item.time; break;
          case "Status": row[key] = item.status; break;
          case "Dataset": row[key] = ds.fileName; break;
          default:
            row[key] = item.raw && key in item.raw ? (item.raw as any)[key] : undefined;
        }
      });
      return row;
    });

  const handleDownloadFiltered = () => {
    if (!results.length) return;
    downloadCsv("inventory_filtered", buildCsvRows(displayColumns.map((c) => c.key), results));
  };


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

  const pageSize = 300;
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const shown = results.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const statusLabel = (s: InventoryStatus) => {
    if (lang === "zh") {
      if (s === "Normal") return "正常";
      if (s === "Low") return "低于安全库存";
      if (s === "Out") return "已售罄";
      if (s === "High") return "高于安全库存10%";
      if (s === "HighNearCritical") return "高于安全库存2.75倍";
      return "过高库存(>=3倍)";
    }
    if (s === "Normal") return "Normal";
    if (s === "Low") return "Below Safety Stock";
    if (s === "Out") return "Out";
    if (s === "High") return "Above Safety +10%";
    if (s === "HighNearCritical") return "Above Safety x2.75";
    return "Overstock (>=x3)";
  };

  const statusBadgeClass = (s: InventoryStatus) => {
    const raw = String(s);
    if (raw === "Overstock" || raw.toLowerCase().includes("overstock")) {
      return "border-orange-300 bg-orange-500/30 text-orange-50";
    }
    if (raw === "Out") {
      return "border-red-300 bg-red-500/35 text-red-50";
    }
    if (raw === "Low") {
      return "border-yellow-300 bg-yellow-500/30 text-yellow-50";
    }
    if (raw === "High" || raw === "HighNearCritical" || raw.toLowerCase().includes("high")) {
      return "border-emerald-300 bg-emerald-500/30 text-emerald-50";
    }
    return "border-emerald-300 bg-emerald-500/30 text-emerald-50";
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
            placeholder={lang === "zh" ? '例如：sku:FWD111 category:xxx status:Low status:High min:0 max:50 month:2025-03' : "e.g. sku:FWD111 category:xxx status:Low status:High min:0 max:50 month:2025-03"}
            className="w-full bg-transparent outline-none text-base px-2 py-3"
            onKeyDown={(e) => e.key === "Enter" && setQuery((v) => v)}
          />
          <button onClick={() => setQuery((v) => v)} className="shrink-0 rounded-xl px-4 py-2 bg-blue-600 hover:bg-blue-500">
            {lang === "zh" ? "搜索" : "Search"}
          </button>
        </div>

        {/* Quick chips */}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {["status:Low", "status:High", "status:Overstock", "min:0", "max:50", "month:2025-03"].map((s) => (
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
                onChange={(e) => setStatusFilter(e.target.value as "ALL" | InventoryStatus)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              >
                <option value="ALL">{lang === "zh" ? "全部" : "All"}</option>
                {STATUS_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
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
        <div className="space-y-3">
        <main className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-bold">
                {TEXT.results[lang]} <span className="opacity-70 text-sm">({summary.total})</span>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <div className="flex flex-wrap gap-2 text-xs rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2">
                  <span className="rounded-full border border-yellow-400/60 bg-yellow-500/20 px-3 py-1.5 text-yellow-100">
                    Low: <b>{summary.low}</b>
                  </span>
                  <span className="rounded-full border border-red-400/70 bg-red-500/25 px-3 py-1.5 text-red-100">
                    Out: <b>{summary.out}</b>
                  </span>
                  <span className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-3 py-1.5 text-emerald-100">
                    High(1.1x~2.99x): <b>{summary.highTotal}</b>
                  </span>
                  <span className="rounded-full border border-orange-400/70 bg-orange-500/25 px-3 py-1.5 text-orange-100">
                    Overstock(x3): <b>{summary.overstock}</b>
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-slate-100">
                    {lang === "zh" ? "结存合计" : "Qty sum"}: <b>{summary.sumQty}</b>
                  </span>
                </div>
                <button
                  onClick={handleDownloadFiltered}
                  disabled={!results.length}
                  className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition-all border border-blue-400/50 text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-500 hover:to-blue-500 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {TEXT.downloadFiltered[lang]}
                </button>
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
                <div className="h-3" style={{ width: "2600px" }} />
              </div>

              {/* 表格滚动区域 */}
              <div ref={tableScrollRef} className="scrollbar-nice max-h-[70vh] overflow-auto">
                <table className="min-w-max w-full text-sm text-left">
                  <thead className="bg-white/5 border-b border-white/10 uppercase tracking-wider opacity-80 sticky top-0 z-20">
                    <tr>
                      {displayColumns.map((col) => (
                        <th key={col.key} className="px-5 py-3 font-bold text-right first:text-left first:pl-5 last:pr-5">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-white/10">
                    {shown.map(({ ds, item }) => (
                      <tr key={`${ds.fileName}-${item.id}`} className="hover:bg-white/5">
                        {displayColumns.map((col, idx) => {
                          const key = col.key;
                          let val: unknown;
                          switch (key) {
                            case "SKU": val = item.model; break;
                            case "Batch": val = item.batch; break;
                            case "Category": val = item.category; break;
                            case "Last_Month_Stock": val = item.lastBalance; break;
                            case "month_in": val = item.inbound; break;
                            case "month_out": val = item.outbound; break;
                            case "month_sales": val = item.sales; break;
                            case "month_end_stock": val = item.currentBalance; break;
                            case "Note_value": val = item.noteValue ?? item.subtotal; break;
                            case "safety_stock": val = item.safetyStock; break;
                            case "Location": val = item.location; break;
                            case "month_end_inventory": val = item.monthEndCount ?? item.monthEndInventory; break;
                            case "inventory_diff": val = item.gainLoss ?? item.inventoryDiff; break;
                            case "Remark": val = item.remark ?? item.note; break;
                            case "Time": val = item.time; break;
                            case "Status": val = item.status; break;
                            case "Dataset": val = ds.fileName; break;
                            default:
                              val = item.raw && key in (item.raw as any) ? (item.raw as any)[key] : "";
                          }
                          const isNumeric = typeof val === "number";
                          const isStatusColumn = key === "Status";
                          const content = isStatusColumn ? (
                            <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold shadow-sm ${statusBadgeClass(item.status)}`}>
                              {statusLabel(item.status)}
                            </span>
                          ) : idx === 0 ? (
                            highlight(String(val ?? ""), keywordForHighlight)
                          ) : (
                            String(val ?? "")
                          );
                          return (
                            <td
                              key={key}
                              className={`px-5 py-3 ${idx === 0 ? "font-semibold" : key === "Status" ? "" : "opacity-80"} ${isNumeric ? "text-right font-mono" : ""}`}
                            >
                              {content}
                            </td>
                          );
                        })}
                      </tr>
                    ))}

                    {shown.length === 0 && (
                      <tr>
                        <td className="px-5 py-10 opacity-70" colSpan={displayColumns.length}>
                          {lang === "zh"
                            ? "没有匹配结果。试试：status:Low / status:High / status:Overstock 或 category:xxx"
                            : "No results. Try: status:Low / status:High / status:Overstock or category:xxx"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

              </div>
            </div>
          )}
        </main>
        {results.length > pageSize && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-xs opacity-70">
              {lang === "zh"
                ? `第 ${page} / ${totalPages} 页（每页 ${pageSize} 条）`
                : `Page ${page} / ${totalPages} (${pageSize} rows per page)`}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {lang === "zh" ? "上一页" : "Prev"}
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {lang === "zh" ? "下一页" : "Next"}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
