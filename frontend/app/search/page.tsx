"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";
import { type InventoryAnalysisStatus } from "@/lib/inventory/status";

type InventoryItem = {
  id: string;
  model: string;
  batch: string;
  category: string;
  lastBalance?: number;
  inbound?: number;
  outbound?: number;
  sales?: number;
  currentBalance: number;
  subtotal?: number;
  noteValue?: number;
  safetyStock?: number | null;
  location?: string;
  monthEndCount?: number;
  monthEndInventory?: number;
  gainLoss?: number;
  inventoryDiff?: number;
  note?: string;
  remark?: string;
  time?: string;
  month?: string;
  sku?: string;
  total_month_end_stock?: number;
  total_month_in?: number;
  total_month_out?: number;
  total_month_sales?: number;
  dataset_id?: string | null;
  updated_at?: string | null;
  status: InventoryAnalysisStatus;
  raw?: Record<string, unknown>;
};

type SavedDataset = {
  fileName: string;
  uploadDate: string;
  rowCount: number;
  size: string;
  data: InventoryItem[];
  month?: string;
};

type SearchStatus = InventoryAnalysisStatus;

type ParsedQuery = {
  text: string;
  sku?: string;
  model?: string;
  batch?: string;
  category?: string;
  status?: SearchStatus;
  month?: string;
  min?: number;
  max?: number;
};

const STATUS_VALUES: SearchStatus[] = [
  "OUT",
  "LOW",
  "NORMAL",
  "OVERSTOCK",
  "UNMAINTAINED",
  "HIGH",
];

const STATUS_LOOKUP = new Map<string, SearchStatus>([
  ...STATUS_VALUES.map((status) => [status.toLowerCase(), status] as const),
  ["out", "OUT"],
  ["low", "LOW"],
  ["normal", "NORMAL"],
  ["over", "OVERSTOCK"],
  ["overstock", "OVERSTOCK"],
  ["high", "HIGH"],
  ["unmaintained", "UNMAINTAINED"],
  ["缺货", "OUT"],
  ["低库存", "LOW"],
  ["正常", "NORMAL"],
  ["高库存", "OVERSTOCK"],
  ["未维护", "UNMAINTAINED"],
]);

type MainTableColumnKey =
  | "month"
  | "sku"
  | "category"
  | "safety_stock"
  | "total_month_end_stock"
  | "total_month_in"
  | "total_month_out"
  | "status"
  | "batch";

type MainTableColumn = {
  key: MainTableColumnKey;
  label: {
    zh: string;
    en: string;
  };
  width: number;
  isNumeric?: boolean;
};

const MAIN_TABLE_COLUMNS: MainTableColumn[] = [
  { key: "month", label: { zh: "月份", en: "MONTH" }, width: 120 },
  { key: "sku", label: { zh: "SKU", en: "SKU" }, width: 160 },
  { key: "batch", label: { zh: "批号", en: "BATCH" }, width: 180 },
  { key: "category", label: { zh: "类别", en: "CATEGORY" }, width: 180 },
  { key: "safety_stock", label: { zh: "安全库存", en: "SAFETY_STOCK" }, width: 140, isNumeric: true },
  { key: "total_month_end_stock", label: { zh: "本月结存", en: "TOTAL_MONTH_END_STOCK" }, width: 180, isNumeric: true },
  { key: "total_month_in", label: { zh: "本月入库", en: "TOTAL_MONTH_IN" }, width: 160, isNumeric: true },
  { key: "total_month_out", label: { zh: "本月出库", en: "TOTAL_MONTH_OUT" }, width: 160, isNumeric: true },
  { key: "status", label: { zh: "状态", en: "STATUS" }, width: 140 },
];

function getStatusDisplayLabel(status: InventoryAnalysisStatus, lang: string) {
  if (lang === "zh") {
    if (status === "OUT") return "缺货";
    if (status === "LOW") return "低库存";
    if (status === "NORMAL") return "正常";
    if (status === "OVERSTOCK") return "高库存";
    if (status === "UNMAINTAINED") return "未维护";
    return "偏高";
  }

  if (status === "OUT") return "Out";
  if (status === "LOW") return "Low";
  if (status === "NORMAL") return "Normal";
  if (status === "OVERSTOCK") return "Overstock";
  if (status === "UNMAINTAINED") return "Unmaintained";
  return "High";
}

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
    } else if (key === "month") out.month = val;
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

  const [query, setQuery] = useState("");
  const [datasetScope, setDatasetScope] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | SearchStatus>("ALL");
  const [sortBy, setSortBy] = useState<"status" | "category" | "sku" | "balance">("status");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [minBalance, setMinBalance] = useState<string>("");
  const [maxBalance, setMaxBalance] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [latestMonthUsed, setLatestMonthUsed] = useState<string | null>(null);
  const [dataScope, setDataScope] = useState<"ALL_MONTHS" | "LATEST_MONTH">("ALL_MONTHS");

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
    top.scrollLeft = body.scrollLeft;

    return () => {
      top.removeEventListener("scroll", syncFromTop);
      body.removeEventListener("scroll", syncFromBody);
    };
  }, []);

  const [datasets, setDatasets] = useState<SavedDataset[]>([]);
  useEffect(() => {
    const loadAll = async () => {
      try {
        const res = await fetch("/api/inventory/all", { cache: "no-store" });
        if (!res.ok) {
          setDatasets([]);
          setLatestMonthUsed(null);
          setDataScope("ALL_MONTHS");
          return;
        }

        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        const latestMonth = data.latestMonthUsed ? String(data.latestMonthUsed) : null;
        const resolvedDataScope =
          data.dataScope === "ALL_MONTHS" ? "ALL_MONTHS" : "LATEST_MONTH";

        setLatestMonthUsed(latestMonth);
        setDataScope(resolvedDataScope);
        setDatasets([
          {
            fileName: "Supabase Database",
            uploadDate: new Date().toISOString(),
            rowCount: items.length,
            size: `${Math.round(items.length * 0.5)} KB`,
            data: items as InventoryItem[],
            month: latestMonth || "ALL",
          },
        ]);
      } catch {
        setDatasets([]);
        setLatestMonthUsed(null);
        setDataScope("ALL_MONTHS");
      }
    };

    loadAll();
  }, []);

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

  const availableStatuses = useMemo(() => {
    const counts = new Map<SearchStatus, number>();
    for (const { item } of rows) {
      const status = item.status as SearchStatus;
      if (!STATUS_VALUES.includes(status)) continue;
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }

    return STATUS_VALUES.filter((status) => (counts.get(status) ?? 0) > 0);
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
      const itemMonth = safeLower(item.month ?? item.time);
      if (month && !itemMonth.includes(month)) return false;
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

    const rank = (s: InventoryAnalysisStatus) => {
      switch (s) {
        case "OUT":
          return 0;
        case "LOW":
          return 1;
        case "NORMAL":
          return 2;
        case "OVERSTOCK":
          return 3;
        case "UNMAINTAINED":
          return 4;
        case "HIGH":
          return 5;
        default:
          return 6;
      }
    };

    res.sort((a, b) => {
      let result = 0;
      if (sortBy === "status") {
        result = rank(a.item.status) - rank(b.item.status);
      } else if (sortBy === "category") {
        result = String(a.item.category || "").localeCompare(String(b.item.category || ""));
      } else if (sortBy === "sku") {
        result = String(a.item.model || "").localeCompare(String(b.item.model || ""));
      } else {
        result = Number(a.item.currentBalance || 0) - Number(b.item.currentBalance || 0);
      }

      if (result === 0) {
        result = String(a.item.model || "").localeCompare(String(b.item.model || ""));
      }

      return sortOrder === "desc" ? -result : result;
    });

    return res;
  }, [rows, parsed, effectiveCategory, effectiveStatus, effectiveMin, effectiveMax, sortBy, sortOrder]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, datasetScope, categoryFilter, statusFilter, minBalance, maxBalance, sortBy, sortOrder]);

  useEffect(() => {
    if (statusFilter !== "ALL" && !availableStatuses.includes(statusFilter)) {
      setStatusFilter("ALL");
    }
  }, [statusFilter, availableStatuses]);

  const summary = useMemo(() => {
    const total = results.length;
    const low = results.filter((r) => r.item.status === "LOW").length;
    const out = results.filter((r) => r.item.status === "OUT").length;
    const overstock = results.filter((r) => r.item.status === "OVERSTOCK").length;
    const normal = results.filter((r) => r.item.status === "NORMAL").length;
    const unmaintained = results.filter((r) => r.item.status === "UNMAINTAINED").length;
    const sumQty = results.reduce((acc, r) => acc + (Number(r.item.currentBalance) || 0), 0);
    return { total, low, out, overstock, normal, unmaintained, sumQty };
  }, [results]);

  const TEXT = {
    title: { zh: "库存搜索", en: "Inventory Search" },
    subtitle: {
      zh: "支持语法：sku: / category: / status: / batch: / min: / max: / month:",
      en: "Supported: sku: / category: / status: / batch: / min: / max: / month:",
    },
    noData: {
      zh: "还没有数据。请去「库存管理」上传文件并点击「保存到数据库」。",
      en: "No data yet. Go to Inventory and upload, then click Save to Database.",
    },
    downloadFiltered: { zh: "下载筛选结果", en: "Download filtered" },
    filters: { zh: "筛选", en: "Filters" },
    dataset: { zh: "数据集", en: "Dataset" },
    category: { zh: "类别", en: "Category" },
    status: { zh: "状态", en: "Status" },
    sortBy: { zh: "排序字段", en: "Sort by" },
    sortOrder: { zh: "排序方向", en: "Order" },
    balanceRange: { zh: "结存范围（本月结存）", en: "Balance Range (Current)" },
    reset: { zh: "重置", en: "Reset" },
    results: { zh: "结果", en: "Results" },
    active: { zh: "已应用筛选", en: "Active filters" },
    latestMonth: { zh: "最新月份", en: "Latest month" },
    dataScope: { zh: "数据范围", en: "Data scope" },
    allMonths: { zh: "全部月份", en: "All months" },
    rows: { zh: "条", en: "rows" },
    kpiLow: { zh: "低库存", en: "Low" },
    kpiOut: { zh: "缺货", en: "Out" },
    kpiOverstock: { zh: "高库存", en: "Overstock" },
    kpiNormal: { zh: "正常", en: "Normal" },
    kpiUnmaintained: { zh: "未维护", en: "Unmaintained" },
    qtySum: { zh: "结存合计", en: "Qty sum" },
  } as const;

  const mainTableTotalWidth = useMemo(
    () => MAIN_TABLE_COLUMNS.reduce((sum, col) => sum + col.width, 0),
    []
  );

  const buildCsvRows = (cols: MainTableColumnKey[], source: typeof results) =>
    source.map(({ item }) => {
      const row: Record<string, unknown> = {};
      cols.forEach((key) => {
        switch (key) {
          case "month":
            row[key] = item.month;
            break;
          case "sku":
            row[key] = item.sku ?? item.model;
            break;
          case "category":
            row[key] = item.category && item.category !== "-" ? item.category : "-";
            break;
          case "safety_stock":
            row[key] = item.safetyStock ?? "-";
            break;
          case "total_month_end_stock":
            row[key] = item.total_month_end_stock ?? item.currentBalance;
            break;
          case "total_month_in":
            row[key] = item.total_month_in ?? item.inbound;
            break;
          case "total_month_out":
            row[key] = item.total_month_out ?? item.outbound;
            break;
          case "status":
            row[key] = item.status;
            break;
          case "batch":
            row[key] = item.batch && item.batch.trim() ? item.batch : "-";
            break;
        }
      });
      return row;
    });

  const handleDownloadFiltered = () => {
    if (!results.length) return;
    downloadCsv(
      "inventory_filtered",
      buildCsvRows(MAIN_TABLE_COLUMNS.map((c) => c.key), results)
    );
  };

  const activeFilters = useMemo(() => {
    const chips: string[] = [];
    const labels =
      lang === "zh"
        ? {
            dataset: "数据集",
            category: "类别",
            status: "状态",
            sort: "排序",
            min: "最小值",
            max: "最大值",
            month: "月份",
            sku: "SKU",
            batch: "批号",
            text: "关键词",
            latestMonth: "最新月份",
          }
        : {
            dataset: "dataset",
            category: "category",
            status: "status",
            sort: "sort",
            min: "min",
            max: "max",
            month: "month",
            sku: "sku",
            batch: "batch",
            text: "text",
            latestMonth: "latestMonth",
          };

    if (datasetScope !== "ALL") chips.push(`${labels.dataset}=${datasetScope}`);
    if (effectiveCategory) chips.push(`${labels.category}=${effectiveCategory}`);
    if (effectiveStatus) {
      chips.push(`${labels.status}=${getStatusDisplayLabel(effectiveStatus, lang)}`);
    }
    chips.push(`${labels.sort}=${sortBy}:${sortOrder}`);
    if (typeof effectiveMin === "number") chips.push(`${labels.min}=${effectiveMin}`);
    if (typeof effectiveMax === "number") chips.push(`${labels.max}=${effectiveMax}`);
    if (parsed.month) chips.push(`${labels.month}=${parsed.month}`);
    if (parsed.sku || parsed.model) chips.push(`${labels.sku}=${parsed.sku || parsed.model}`);
    if (parsed.batch) chips.push(`${labels.batch}=${parsed.batch}`);
    if (parsed.text) chips.push(`${labels.text}=\"${parsed.text}\"`);
    if (dataScope === "ALL_MONTHS") {
      chips.push(`${labels.latestMonth}=${TEXT.allMonths[lang]}`);
    } else if (latestMonthUsed) {
      chips.push(`${labels.latestMonth}=${latestMonthUsed}`);
    }
    return chips;
  }, [
    lang,
    dataScope,
    datasetScope,
    effectiveCategory,
    effectiveStatus,
    sortBy,
    sortOrder,
    effectiveMin,
    effectiveMax,
    parsed.month,
    parsed.sku,
    parsed.model,
    parsed.batch,
    parsed.text,
    latestMonthUsed,
    TEXT.allMonths,
  ]);

  const keywordForHighlight = useMemo(() => {
    if (parsed.text.trim()) return parsed.text.trim();
    if ((parsed.sku || parsed.model)?.trim()) return (parsed.sku || parsed.model)!.trim();
    if (parsed.batch?.trim()) return parsed.batch.trim();
    if (effectiveCategory?.trim() && effectiveCategory !== "ALL") return effectiveCategory.trim();
    return "";
  }, [parsed.text, parsed.sku, parsed.model, parsed.batch, effectiveCategory]);

  const quickFilters = useMemo(
    () =>
      [
        {
          token: "status:LOW",
          label: lang === "zh" ? "低库存" : "status:LOW",
        },
        {
          token: "status:OVERSTOCK",
          label: lang === "zh" ? "高库存" : "status:OVERSTOCK",
        },
        {
          token: "status:OUT",
          label: lang === "zh" ? "缺货" : "status:OUT",
        },
        {
          token: "status:UNMAINTAINED",
          label: lang === "zh" ? "未维护" : "status:UNMAINTAINED",
        },
        {
          token: "min:0",
          label: lang === "zh" ? "最小=0" : "min:0",
        },
        {
          token: "max:50",
          label: lang === "zh" ? "最大=50" : "max:50",
        },
      ] as const,
    [lang]
  );

  const pageSize = 300;
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const shown = results.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const statusLabel = (s: InventoryAnalysisStatus) => {
    return getStatusDisplayLabel(s, lang);
  };

  const statusBadgeClass = (s: InventoryAnalysisStatus) => {
    if (s === "OUT") {
      return "border-red-300 bg-red-500/35 text-red-50";
    }
    if (s === "LOW") {
      return "border-yellow-300 bg-yellow-500/30 text-yellow-50";
    }
    if (s === "OVERSTOCK" || s === "HIGH") {
      return "border-violet-300 bg-violet-500/30 text-violet-50";
    }
    if (s === "UNMAINTAINED") {
      return "border-slate-300 bg-slate-500/30 text-slate-100";
    }
    return "border-emerald-300 bg-emerald-500/30 text-emerald-50";
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-blue-700 dark:text-blue-400">{TEXT.title[lang]}</h1>
        <p className="mt-1 text-sm opacity-70">{TEXT.subtitle[lang]}</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg">
        <div className="flex gap-3 items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              lang === "zh"
                ? "例如：sku:FWD111 category:银白系列 status:LOW min:0 max:50 month:2025-03"
                : "e.g. sku:FWD111 category:Silver status:LOW min:0 max:50 month:2025-03"
            }
            className="w-full bg-transparent outline-none text-base px-2 py-3"
            onKeyDown={(e) => e.key === "Enter" && setQuery((v) => v)}
          />
          <button
            onClick={() => setQuery((v) => v)}
            className="shrink-0 rounded-xl px-4 py-2 bg-blue-600 hover:bg-blue-500"
          >
            {lang === "zh" ? "搜索" : "Search"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {quickFilters.map((chip) => (
            <button
              key={chip.token}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
              onClick={() =>
                setQuery((prev) =>
                  prev ? prev + " " + chip.token : chip.token
                )
              }
            >
              + {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
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
                onChange={(e) => setStatusFilter(e.target.value as "ALL" | SearchStatus)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              >
                <option value="ALL">{lang === "zh" ? "全部" : "All"}</option>
                {availableStatuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold opacity-70 mb-1">{TEXT.sortBy[lang]}</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "status" | "category" | "sku" | "balance")}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              >
                <option value="status">{lang === "zh" ? "状态" : "Status"}</option>
                <option value="category">{lang === "zh" ? "类别" : "Category"}</option>
                <option value="sku">SKU</option>
                <option value="balance">{lang === "zh" ? "结存" : "Balance"}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold opacity-70 mb-1">{TEXT.sortOrder[lang]}</label>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              >
                <option value="asc">{lang === "zh" ? "升序" : "Ascending"}</option>
                <option value="desc">{lang === "zh" ? "降序" : "Descending"}</option>
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
                setSortBy("status");
                setSortOrder("asc");
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
                      {TEXT.kpiLow[lang]}: <b>{summary.low}</b>
                    </span>
                    <span className="rounded-full border border-red-400/70 bg-red-500/25 px-3 py-1.5 text-red-100">
                      {TEXT.kpiOut[lang]}: <b>{summary.out}</b>
                    </span>
                    <span className="rounded-full border border-violet-400/70 bg-violet-500/25 px-3 py-1.5 text-violet-100">
                      {TEXT.kpiOverstock[lang]}: <b>{summary.overstock}</b>
                    </span>
                    <span className="rounded-full border border-cyan-400/60 bg-cyan-500/20 px-3 py-1.5 text-cyan-100">
                      {TEXT.kpiNormal[lang]}: <b>{summary.normal}</b>
                    </span>
                    <span className="rounded-full border border-slate-300/70 bg-slate-500/25 px-3 py-1.5 text-slate-100">
                      {TEXT.kpiUnmaintained[lang]}: <b>{summary.unmaintained}</b>
                    </span>
                    <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-slate-100">
                      {TEXT.qtySum[lang]}: <b>{summary.sumQty}</b>
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
              <div className="mt-2 text-xs opacity-70">
                {TEXT.dataScope[lang]}:{" "}
                <span className="font-semibold">
                  {dataScope === "ALL_MONTHS"
                    ? TEXT.allMonths[lang]
                    : latestMonthUsed || "-"}
                </span>
              </div>
            </div>

            {datasets.length === 0 ? (
              <div className="px-5 py-10 opacity-75">{TEXT.noData[lang]}</div>
            ) : (
              <div className="overflow-hidden">
                <div
                  ref={topScrollRef}
                  className="scrollbar-nice overflow-x-auto overflow-y-hidden border-b border-white/10"
                >
                  <div className="h-3" style={{ width: "2600px" }} />
                </div>

                <div ref={tableScrollRef} className="scrollbar-nice max-h-[70vh] overflow-auto">
                  <table
                    className="table-fixed text-sm"
                    style={{ width: `${mainTableTotalWidth}px` }}
                  >
                    <colgroup>
                      {MAIN_TABLE_COLUMNS.map((col) => (
                        <col key={col.key} style={{ width: `${col.width}px` }} />
                      ))}
                    </colgroup>
                    <thead className="bg-white/5 border-b border-white/10 uppercase tracking-wider opacity-80 sticky top-0 z-20">
                      <tr>
                        {MAIN_TABLE_COLUMNS.map((col) => (
                          <th
                            key={col.key}
                            className="px-3 py-3 font-bold text-center"
                          >
                            {lang === "zh" ? col.label.zh : col.label.en}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-white/10">
                      {shown.map(({ ds, item }) => {
                        const rowSku = item.sku ?? item.model;
                        const rowValues: Record<MainTableColumnKey, unknown> = {
                          month: item.month ?? "-",
                          sku: rowSku,
                          category:
                            item.category && item.category.trim() && item.category !== "-"
                              ? item.category
                              : "-",
                          safety_stock: item.safetyStock ?? "-",
                          total_month_end_stock:
                            item.total_month_end_stock ?? item.currentBalance ?? 0,
                          total_month_in: item.total_month_in ?? item.inbound ?? 0,
                          total_month_out: item.total_month_out ?? item.outbound ?? 0,
                          status: item.status,
                          batch: item.batch && item.batch.trim() ? item.batch : "-",
                        };

                        return (
                          <tr
                            key={`${ds.fileName}-${item.id}`}
                            className="hover:bg-white/5"
                          >
                            {MAIN_TABLE_COLUMNS.map((col, idx) => {
                              const value = rowValues[col.key];
                              const isStatusColumn = col.key === "status";
                              const alignClass = isStatusColumn
                                ? "text-center"
                                : col.isNumeric
                                ? "text-right font-mono"
                                : "text-left";
                              const content = isStatusColumn ? (
                                <span
                                  className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold shadow-sm ${statusBadgeClass(item.status)}`}
                                >
                                  {statusLabel(item.status)}
                                </span>
                              ) : idx === 0 ? (
                                highlight(String(value ?? ""), keywordForHighlight)
                              ) : (
                                String(value ?? "")
                              );

                              return (
                                <td
                                  key={col.key}
                                  className={`px-3 py-3 align-middle ${alignClass} ${
                                    idx === 0 ? "font-semibold" : "opacity-80"
                                  }`}
                                >
                                  {content}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}

                      {shown.length === 0 && (
                        <tr>
                          <td className="px-5 py-10 opacity-70" colSpan={MAIN_TABLE_COLUMNS.length}>
                            {lang === "zh"
                              ? "没有匹配结果。试试：status:LOW / status:OVERSTOCK / status:OUT 或 category:虹彩系列"
                              : "No results. Try: status:LOW / status:OVERSTOCK / status:OUT or category:Rainbow"}
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
