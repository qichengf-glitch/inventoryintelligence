"use client";

/**
 * /data-center/completeness
 *
 * Data Completeness Management — lists every SKU missing category / cost /
 * price data, supports inline cell editing and bulk CSV import.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompletenessResponse, SkuRecord } from "@/app/api/data-quality/sku-completeness/route";

// ─── Types ────────────────────────────────────────────────────────────────────

type Filter = "all" | "missing_category" | "missing_cost" | "missing_both" | "complete";

type EditState = {
  sku: string;
  field: "category" | "cost" | "price";
  value: string;
  saving: boolean;
};

type ImportState = {
  status: "idle" | "parsing" | "uploading" | "done" | "error";
  message: string;
  succeeded?: number;
  failed?: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CARD_BASE =
  "rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-[0_10px_25px_rgba(2,6,23,0.35)]";

const FILTER_TABS: { key: Filter; labelZh: string; labelEn: string; color: string }[] = [
  { key: "all",              labelZh: "全部",       labelEn: "All",               color: "text-slate-200" },
  { key: "missing_category", labelZh: "缺品类",     labelEn: "Missing Category",  color: "text-amber-300" },
  { key: "missing_cost",     labelZh: "缺成本/价格", labelEn: "Missing Cost/Price", color: "text-orange-300" },
  { key: "missing_both",     labelZh: "全部缺失",   labelEn: "Missing Both",      color: "text-rose-300"   },
  { key: "complete",         labelZh: "完整",       labelEn: "Complete",          color: "text-emerald-300"},
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
  );
}

function StatusBadge({ status }: { status: SkuRecord["status"] }) {
  const map: Record<SkuRecord["status"], { label: string; cls: string }> = {
    complete:         { label: "✓ 完整",   cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
    missing_category: { label: "缺品类",   cls: "bg-amber-500/10  text-amber-300  border-amber-500/20"  },
    missing_cost:     { label: "缺成本",   cls: "bg-orange-500/10 text-orange-300 border-orange-500/20" },
    missing_both:     { label: "全部缺失", cls: "bg-rose-500/10   text-rose-300   border-rose-500/20"   },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ─── Inline edit cell ────────────────────────────────────────────────────────

function EditCell({
  sku,
  field,
  value,
  editState,
  onStartEdit,
  onChangeEdit,
  onSave,
  onCancel,
  placeholder,
}: {
  sku: string;
  field: "category" | "cost" | "price";
  value: string | number | null;
  editState: EditState | null;
  onStartEdit: (sku: string, field: EditState["field"], current: string) => void;
  onChangeEdit: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder: string;
}) {
  const isEditing = editState?.sku === sku && editState?.field === field;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const display =
    value != null && value !== ""
      ? typeof value === "number"
        ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
        : String(value)
      : null;

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type={field === "category" ? "text" : "number"}
          step="any"
          value={editState.value}
          onChange={(e) => onChangeEdit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter")  onSave();
            if (e.key === "Escape") onCancel();
          }}
          className="w-32 rounded border border-cyan-500/50 bg-slate-800 px-2 py-0.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          placeholder={placeholder}
          disabled={editState.saving}
        />
        {editState.saving ? (
          <Spinner />
        ) : (
          <>
            <button
              onClick={onSave}
              className="rounded bg-cyan-600 px-1.5 py-0.5 text-xs text-white hover:bg-cyan-500"
            >
              ✓
            </button>
            <button
              onClick={onCancel}
              className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-400 hover:text-slate-200"
            >
              ✕
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onStartEdit(sku, field, display ?? "")}
      title="点击编辑 / Click to edit"
      className={`group flex items-center gap-1 rounded px-1 py-0.5 text-sm transition-colors hover:bg-slate-700/50 ${
        display ? "text-slate-200" : "text-slate-600 italic"
      }`}
    >
      {display ?? placeholder}
      <span className="hidden text-slate-500 group-hover:inline">✎</span>
    </button>
  );
}

// ─── CSV Import Panel ────────────────────────────────────────────────────────

function CSVImportPanel({
  onImportDone,
  lang,
}: {
  onImportDone: () => void;
  lang: "zh" | "en";
}) {
  const [open, setOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importState, setImportState] = useState<ImportState>({ status: "idle", message: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setCsvText(String(e.target?.result ?? ""));
    reader.readAsText(file, "utf-8");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  };

  const handleUpload = async () => {
    if (!csvText.trim()) return;
    setImportState({ status: "uploading", message: lang === "zh" ? "正在导入…" : "Importing…" });
    try {
      const res = await fetch("/api/data-quality/sku-bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Import failed");

      const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
      setImportState({
        status: "done",
        message: lang === "zh"
          ? `导入完成：${data.succeeded} 行成功${failedCount > 0 ? `，${failedCount} 行失败` : ""}`
          : `Import complete: ${data.succeeded} rows succeeded${failedCount > 0 ? `, ${failedCount} failed` : ""}`,
        succeeded: data.succeeded,
        failed: failedCount,
      });
      setCsvText("");
      onImportDone();
    } catch (err) {
      setImportState({
        status: "error",
        message: err instanceof Error ? err.message : "Import error",
      });
    }
  };

  const TEMPLATE = "sku,category,cost,price\nABC-001,珠光粉,12.50,28.00\nDEF-002,云母片,,15.00\n";

  return (
    <div className={CARD_BASE}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl text-cyan-300">⬆</span>
          <h2 className="text-base font-semibold text-slate-100">
            {lang === "zh" ? "批量导入 CSV" : "Bulk CSV Import"}
          </h2>
        </div>
        <span className="text-slate-500 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      <p className="mt-1 text-sm text-slate-400">
        {lang === "zh"
          ? "上传含 sku / category / cost / price 列的 CSV，批量补齐缺失数据。"
          : "Upload a CSV with sku / category / cost / price columns to fill missing data in bulk."}
      </p>

      {open && (
        <div className="mt-4 space-y-4">
          {/* Template download hint */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
            <p className="text-xs text-slate-400 mb-2">
              {lang === "zh" ? "CSV 模板格式（可直接复制）：" : "CSV template format (copy directly):"}
            </p>
            <pre className="font-mono text-xs text-cyan-200 whitespace-pre-wrap">{TEMPLATE}</pre>
            <button
              onClick={() => {
                const blob = new Blob([TEMPLATE], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = "sku_data_template.csv"; a.click();
                URL.revokeObjectURL(url);
              }}
              className="mt-2 rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              {lang === "zh" ? "下载模板" : "Download Template"}
            </button>
          </div>

          {/* Drop zone */}
          <div
            ref={dropRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-xl border-2 border-dashed border-slate-600 bg-slate-800/30 px-6 py-8 text-center transition-colors hover:border-cyan-500/50 hover:bg-slate-800/50"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
                e.target.value = "";
              }}
            />
            <p className="text-sm text-slate-400">
              {lang === "zh"
                ? "拖拽 CSV 文件到此处，或点击选择文件"
                : "Drag & drop a CSV file here, or click to select"}
            </p>
            <p className="mt-1 text-xs text-slate-600">UTF-8 · .csv</p>
          </div>

          {/* Text area for paste */}
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={lang === "zh" ? "或直接粘贴 CSV 内容…" : "Or paste CSV content here…"}
            rows={6}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
          />

          {/* Status message */}
          {importState.status !== "idle" && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                importState.status === "done"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : importState.status === "error"
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : "border-slate-700 bg-slate-800/50 text-slate-400"
              }`}
            >
              {importState.status === "uploading" ? (
                <span className="flex items-center gap-2"><Spinner />{importState.message}</span>
              ) : (
                importState.message
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setCsvText(""); setImportState({ status: "idle", message: "" }); }}
              className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
            >
              {lang === "zh" ? "清空" : "Clear"}
            </button>
            <button
              onClick={handleUpload}
              disabled={!csvText.trim() || importState.status === "uploading"}
              className="rounded bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {lang === "zh" ? "开始导入" : "Import"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CompletenessPage() {
  // Simple lang detection from localStorage (same pattern as app)
  const [lang, setLang] = useState<"zh" | "en">("zh");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("lang");
      if (stored === "en") setLang("en");
    } catch { /* ignore */ }
  }, []);

  const [filter, setFilter]       = useState<Filter>("all");
  const [search, setSearch]       = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage]           = useState(1);
  const [data, setData]           = useState<CompletenessResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toastMsg, setToastMsg]   = useState<string | null>(null);
  const LIMIT = 50;

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [filter]);

  // ── Fetch data ─────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        filter,
        q: debouncedQ,
        page: String(page),
        limit: String(LIMIT),
      });
      const res = await fetch(`/api/data-quality/sku-completeness?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load");
      setData(json as CompletenessResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQ, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Inline edit ────────────────────────────────────────────────────────────
  const startEdit = (sku: string, field: EditState["field"], current: string) => {
    setSaveError(null);
    setEditState({ sku, field, value: current, saving: false });
  };

  const cancelEdit = () => setEditState(null);

  const saveEdit = async () => {
    if (!editState) return;
    setEditState((prev) => prev ? { ...prev, saving: true } : null);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = { sku: editState.sku };
      if (editState.field === "category") {
        body.category = editState.value.trim() || null;
      } else if (editState.field === "cost") {
        body.cost = editState.value === "" ? null : parseFloat(editState.value);
      } else {
        body.price = editState.value === "" ? null : parseFloat(editState.value);
      }

      const res = await fetch("/api/data-quality/sku-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Save failed");

      setEditState(null);
      showToast(lang === "zh" ? "已保存 ✓" : "Saved ✓");
      fetchData({ silent: true });
    } catch (e) {
      setEditState((prev) => prev ? { ...prev, saving: false } : null);
      setSaveError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  // ── Pagination helpers ──────────────────────────────────────────────────────
  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  // ── Summary stats ───────────────────────────────────────────────────────────
  const s = data?.summary;

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-emerald-500/30 bg-slate-900 px-4 py-2.5 text-sm text-emerald-300 shadow-xl">
          {toastMsg}
        </div>
      )}

      {/* Breadcrumb + Header */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
          <Link href="/data-center" className="hover:text-slate-300">
            {lang === "zh" ? "数据中心" : "Data Center"}
          </Link>
          <span>/</span>
          <span className="text-slate-300">
            {lang === "zh" ? "数据完整性" : "Data Completeness"}
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-slate-100">
          {lang === "zh" ? "数据完整性管理" : "Data Completeness Management"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {lang === "zh"
            ? "查看并补齐缺失品类、成本和价格的 SKU 记录。支持单格编辑或批量 CSV 导入。"
            : "View and fill SKUs missing category, cost, or price. Supports inline editing or bulk CSV import."}
        </p>
      </section>

      {/* KPI summary cards */}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: lang === "zh" ? "SKU 总数" : "Total SKUs",
              value: s.total_skus.toLocaleString(),
              sub: "",
              color: "text-cyan-200",
            },
            {
              label: lang === "zh" ? "品类完整率" : "Category Fill Rate",
              value: `${s.category_pct}%`,
              sub: lang === "zh" ? `${s.missing_category} 缺失` : `${s.missing_category} missing`,
              color: s.category_pct >= 90 ? "text-emerald-300" : s.category_pct >= 70 ? "text-amber-300" : "text-rose-300",
            },
            {
              label: lang === "zh" ? "成本完整率" : "Cost Fill Rate",
              value: `${s.cost_pct}%`,
              sub: lang === "zh" ? `${s.missing_cost} 缺失` : `${s.missing_cost} missing`,
              color: s.cost_pct >= 90 ? "text-emerald-300" : s.cost_pct >= 70 ? "text-amber-300" : "text-rose-300",
            },
            {
              label: lang === "zh" ? "完整 SKU" : "Complete SKUs",
              value: s.complete.toLocaleString(),
              sub: lang === "zh" ? `共 ${s.total_skus} 个` : `of ${s.total_skus}`,
              color: "text-emerald-300",
            },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4"
            >
              <p className="text-xs text-slate-500">{kpi.label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${kpi.color}`}>{kpi.value}</p>
              {kpi.sub && <p className="mt-0.5 text-xs text-slate-500">{kpi.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* CSV Import panel */}
      <CSVImportPanel onImportDone={() => fetchData({ silent: true })} lang={lang} />

      {/* Filter + Search */}
      <div className={CARD_BASE}>
        {/* Filter tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTER_TABS.map((tab) => {
            const count =
              tab.key === "all"              ? s?.total_skus
              : tab.key === "missing_category" ? s?.missing_category
              : tab.key === "missing_cost"     ? s?.missing_cost
              : tab.key === "missing_both"     ? s?.missing_both
              : s?.complete;

            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  filter === tab.key
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                    : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                }`}
              >
                <span className={filter === tab.key ? "text-cyan-200" : tab.color}>
                  {lang === "zh" ? tab.labelZh : tab.labelEn}
                </span>
                {count != null && (
                  <span className="ml-1.5 text-xs text-slate-500">({count.toLocaleString()})</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search bar */}
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">⌕</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "zh" ? "搜索 SKU…" : "Search SKU…"}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 py-1.5 pl-8 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          {(search || filter !== "all") && (
            <button
              onClick={() => { setSearch(""); setFilter("all"); }}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              {lang === "zh" ? "清除筛选" : "Clear filters"}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {saveError && (
              <p className="text-xs text-rose-400">{saveError}</p>
            )}
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? (lang === "zh" ? "刷新中…" : "Refreshing…") : (lang === "zh" ? "刷新" : "Refresh")}
            </button>
          </div>
        </div>

        {/* Table */}
        {loading && !data ? (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
            <Spinner />
            {lang === "zh" ? "加载中…" : "Loading…"}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            {lang === "zh" ? "没有符合条件的记录。" : "No records match the current filters."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900/80">
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 text-left font-medium">SKU</th>
                    <th className="px-4 py-3 text-left font-medium">
                      {lang === "zh" ? "品类" : "Category"}
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      {lang === "zh" ? "成本 (¥)" : "Cost (¥)"}
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      {lang === "zh" ? "销售单价 (¥)" : "Unit Price (¥)"}
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      {lang === "zh" ? "状态" : "Status"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr
                      key={row.sku}
                      className="border-t border-slate-800 transition-colors hover:bg-slate-800/20"
                    >
                      {/* SKU */}
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{row.sku}</td>

                      {/* Category — editable */}
                      <td className="px-4 py-3">
                        <EditCell
                          sku={row.sku}
                          field="category"
                          value={row.category}
                          editState={editState}
                          onStartEdit={startEdit}
                          onChangeEdit={(v) => setEditState((p) => p ? { ...p, value: v } : null)}
                          onSave={saveEdit}
                          onCancel={cancelEdit}
                          placeholder={lang === "zh" ? "— 点击填写 —" : "— click to fill —"}
                        />
                      </td>

                      {/* Cost — editable */}
                      <td className="px-4 py-3">
                        <EditCell
                          sku={row.sku}
                          field="cost"
                          value={row.cost}
                          editState={editState}
                          onStartEdit={startEdit}
                          onChangeEdit={(v) => setEditState((p) => p ? { ...p, value: v } : null)}
                          onSave={saveEdit}
                          onCancel={cancelEdit}
                          placeholder="—"
                        />
                      </td>

                      {/* Price — editable */}
                      <td className="px-4 py-3">
                        <EditCell
                          sku={row.sku}
                          field="price"
                          value={row.price}
                          editState={editState}
                          onStartEdit={startEdit}
                          onChangeEdit={(v) => setEditState((p) => p ? { ...p, value: v } : null)}
                          onSave={saveEdit}
                          onCancel={cancelEdit}
                          placeholder="—"
                        />
                      </td>

                      {/* Status badge */}
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
              <span>
                {lang === "zh"
                  ? `共 ${data.total} 条，第 ${page} / ${totalPages} 页`
                  : `${data.total} records — Page ${page} of ${totalPages}`}
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded border border-slate-700 px-2.5 py-1 hover:bg-slate-800 disabled:opacity-40"
                >
                  ‹
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  const pg = totalPages <= 7
                    ? i + 1
                    : page <= 4
                    ? i + 1
                    : page >= totalPages - 3
                    ? totalPages - 6 + i
                    : page - 3 + i;
                  return (
                    <button
                      key={pg}
                      onClick={() => setPage(pg)}
                      className={`rounded border px-2.5 py-1 ${
                        pg === page
                          ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                          : "border-slate-700 hover:bg-slate-800"
                      }`}
                    >
                      {pg}
                    </button>
                  );
                })}
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border border-slate-700 px-2.5 py-1 hover:bg-slate-800 disabled:opacity-40"
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
