"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

type MovementType = "IN_PURCHASE" | "IN_RETURN" | "OUT_SALES" | "OUT_DAMAGED" | "ADJUSTMENT";

type Movement = {
  id: string;
  sku: string;
  batch: string | null;
  movement_type: MovementType;
  qty: number;
  reference_no: string | null;
  notes: string | null;
  movement_date: string;
  created_by: string | null;
  created_at: string;
};

type Stats = { total_in: number; total_out: number; total_adj: number; total_movements: number };

type ApiResponse = {
  data: Movement[];
  total: number;
  page: number;
  limit: number;
  tableReady: boolean;
  stats: Stats;
  error?: string;
};

const TYPE_META: Record<
  MovementType,
  { labelZh: string; labelEn: string; colorClass: string; bgClass: string }
> = {
  IN_PURCHASE: { labelZh: "采购入库", labelEn: "Purchase In", colorClass: "text-emerald-300", bgClass: "bg-emerald-500/15 border-emerald-400/40" },
  IN_RETURN: { labelZh: "退货入库", labelEn: "Return In", colorClass: "text-teal-300", bgClass: "bg-teal-500/15 border-teal-400/40" },
  OUT_SALES: { labelZh: "销售出库", labelEn: "Sales Out", colorClass: "text-red-300", bgClass: "bg-red-500/15 border-red-400/40" },
  OUT_DAMAGED: { labelZh: "损耗出库", labelEn: "Damaged Out", colorClass: "text-orange-300", bgClass: "bg-orange-500/15 border-orange-400/40" },
  ADJUSTMENT: { labelZh: "库存调整", labelEn: "Adjustment", colorClass: "text-amber-300", bgClass: "bg-amber-500/15 border-amber-400/40" },
};

const ALL_TYPES = Object.keys(TYPE_META) as MovementType[];

const CARD = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4";
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400";

function StatCard({ label, value, toneClass }: { label: string; value: number | string; toneClass: string }) {
  return (
    <article className={CARD}>
      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </article>
  );
}

type FormState = {
  sku: string;
  batch: string;
  movement_type: MovementType;
  qty: string;
  reference_no: string;
  notes: string;
  movement_date: string;
};

const EMPTY_FORM: FormState = {
  sku: "",
  batch: "",
  movement_type: "IN_PURCHASE",
  qty: "",
  reference_no: "",
  notes: "",
  movement_date: new Date().toISOString().slice(0, 10),
};

export default function InOutPage() {
  const { lang } = useLanguage();
  const [movements, setMovements] = useState<Movement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<Stats>({ total_in: 0, total_out: 0, total_adj: 0, total_movements: 0 });
  const [loading, setLoading] = useState(true);
  const [tableReady, setTableReady] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterSku, setFilterSku] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Add modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadMovements = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (filterSku) params.set("sku", filterSku);
      if (filterType) params.set("type", filterType);
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo) params.set("to", filterTo);

      const res = await fetch(`/api/inout/movements?${params}`, { cache: "no-store" });
      const data: ApiResponse = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMovements(data.data);
      setTotal(data.total);
      setStats(data.stats ?? { total_in: 0, total_out: 0, total_adj: 0, total_movements: data.total });
      setTableReady(data.tableReady !== false);
      setPage(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filterSku, filterType, filterFrom, filterTo]);

  useEffect(() => { void loadMovements(1); }, [loadMovements]);

  const handleSubmit = async () => {
    setFormError(null);
    if (!form.sku.trim()) { setFormError(lang === "zh" ? "SKU 不能为空" : "SKU is required"); return; }
    const qty = Number(form.qty);
    if (!Number.isInteger(qty) || qty === 0) { setFormError(lang === "zh" ? "数量必须是非零整数" : "Qty must be a non-zero integer"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/inout/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, qty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setShowModal(false);
      setForm(EMPTY_FORM);
      await loadMovements(1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-5 pb-16">
      {/* Header */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
          {lang === "zh" ? "出入库管理" : "Stock Movements"}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="mt-1 text-2xl font-semibold text-slate-100">
            {lang === "zh" ? "出入库流水" : "In / Out Movement Log"}
          </h1>
          <button
            type="button"
            onClick={() => { setShowModal(true); setForm(EMPTY_FORM); setFormError(null); }}
            className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25 transition-colors"
          >
            {lang === "zh" ? "+ 新增出入库" : "+ Add Movement"}
          </button>
        </div>
        {!tableReady && (
          <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {lang === "zh"
              ? "数据库表 stock_movements 尚未创建。请在 Supabase 中执行 supabase/migrations/20260315000000_create_stock_movements.sql。"
              : "The stock_movements table does not exist yet. Run supabase/migrations/20260315000000_create_stock_movements.sql in Supabase."}
          </p>
        )}
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={lang === "zh" ? "总入库量" : "Total IN"} value={stats.total_in} toneClass="text-emerald-300" />
        <StatCard label={lang === "zh" ? "总出库量" : "Total OUT"} value={stats.total_out} toneClass="text-red-300" />
        <StatCard label={lang === "zh" ? "调整量" : "Adjustments"} value={stats.total_adj} toneClass="text-amber-300" />
        <StatCard label={lang === "zh" ? "总流水条数" : "Total Records"} value={stats.total_movements} toneClass="text-cyan-300" />
      </section>

      {/* Filters */}
      <section className={`${CARD} flex flex-wrap gap-3`}>
        <input
          value={filterSku}
          onChange={(e) => setFilterSku(e.target.value)}
          placeholder={lang === "zh" ? "搜索 SKU" : "Search SKU"}
          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400 w-44"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
        >
          <option value="">{lang === "zh" ? "全部类型" : "All Types"}</option>
          {ALL_TYPES.map((t) => (
            <option key={t} value={t}>
              {lang === "zh" ? TYPE_META[t].labelZh : TYPE_META[t].labelEn}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filterFrom}
          onChange={(e) => setFilterFrom(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
        />
        <span className="self-center text-slate-500 text-xs">{lang === "zh" ? "至" : "to"}</span>
        <input
          type="date"
          value={filterTo}
          onChange={(e) => setFilterTo(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
        />
        <button
          type="button"
          onClick={() => void loadMovements(1)}
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700 transition-colors"
        >
          {lang === "zh" ? "筛选" : "Filter"}
        </button>
        <button
          type="button"
          onClick={() => { setFilterSku(""); setFilterType(""); setFilterFrom(""); setFilterTo(""); }}
          className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:text-slate-100 transition-colors"
        >
          {lang === "zh" ? "清空" : "Clear"}
        </button>
      </section>

      {/* Movement Table */}
      <section className={CARD}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-100">
            {lang === "zh" ? "流水记录" : "Movement Records"} ({total})
          </h2>
        </div>

        {loading ? (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg border border-slate-800 bg-slate-800/50" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : movements.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            {lang === "zh" ? "暂无流水记录" : "No movement records yet"}
          </p>
        ) : (
          <div className="overflow-auto rounded-xl border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-900/95 text-xs uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">{lang === "zh" ? "日期" : "Date"}</th>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">{lang === "zh" ? "批号" : "Batch"}</th>
                  <th className="px-3 py-2 text-left">{lang === "zh" ? "类型" : "Type"}</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "数量" : "Qty"}</th>
                  <th className="px-3 py-2 text-left">{lang === "zh" ? "参考号" : "Reference"}</th>
                  <th className="px-3 py-2 text-left">{lang === "zh" ? "备注" : "Notes"}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const meta = TYPE_META[m.movement_type];
                  const isIn = m.movement_type === "IN_PURCHASE" || m.movement_type === "IN_RETURN";
                  const isOut = m.movement_type === "OUT_SALES" || m.movement_type === "OUT_DAMAGED";
                  return (
                    <tr key={m.id} className="border-t border-slate-800 text-slate-200 hover:bg-slate-800/30">
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{m.movement_date}</td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{m.sku}</td>
                      <td className="px-3 py-2 text-slate-400">{m.batch ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs ${meta.bgClass} ${meta.colorClass}`}>
                          {lang === "zh" ? meta.labelZh : meta.labelEn}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right font-medium tabular-nums ${isIn ? "text-emerald-300" : isOut ? "text-red-300" : "text-amber-300"}`}>
                        {isIn ? "+" : isOut ? "-" : "±"}{Math.abs(m.qty)}
                      </td>
                      <td className="px-3 py-2 text-slate-400">{m.reference_no ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-400 max-w-[160px] truncate">{m.notes ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              {lang === "zh" ? `第 ${page} / ${totalPages} 页` : `Page ${page} of ${totalPages}`}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => void loadMovements(page - 1)}
                className="rounded-md border border-slate-700 px-3 py-1 text-slate-300 disabled:opacity-40 hover:bg-slate-800"
              >
                {lang === "zh" ? "上一页" : "Prev"}
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => void loadMovements(page + 1)}
                className="rounded-md border border-slate-700 px-3 py-1 text-slate-300 disabled:opacity-40 hover:bg-slate-800"
              >
                {lang === "zh" ? "下一页" : "Next"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Add Movement Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-100">
              {lang === "zh" ? "新增出入库记录" : "Add Stock Movement"}
            </h3>

            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-slate-300">
                  SKU <span className="text-red-400">*</span>
                  <input
                    value={form.sku}
                    onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                    placeholder="e.g. FWD100"
                    className={`mt-1 ${INPUT_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-300">
                  {lang === "zh" ? "批号" : "Batch"}
                  <input
                    value={form.batch}
                    onChange={(e) => setForm((f) => ({ ...f, batch: e.target.value }))}
                    placeholder={lang === "zh" ? "可选" : "Optional"}
                    className={`mt-1 ${INPUT_CLASS}`}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-slate-300">
                  {lang === "zh" ? "类型" : "Type"} <span className="text-red-400">*</span>
                  <select
                    value={form.movement_type}
                    onChange={(e) => setForm((f) => ({ ...f, movement_type: e.target.value as MovementType }))}
                    className={`mt-1 ${INPUT_CLASS}`}
                  >
                    {ALL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {lang === "zh" ? TYPE_META[t].labelZh : TYPE_META[t].labelEn}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  {lang === "zh" ? "数量" : "Qty"} <span className="text-red-400">*</span>
                  <input
                    type="number"
                    value={form.qty}
                    onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
                    placeholder={lang === "zh" ? "正/负整数" : "Integer (±)"}
                    className={`mt-1 ${INPUT_CLASS}`}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-slate-300">
                  {lang === "zh" ? "日期" : "Date"}
                  <input
                    type="date"
                    value={form.movement_date}
                    onChange={(e) => setForm((f) => ({ ...f, movement_date: e.target.value }))}
                    className={`mt-1 ${INPUT_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-300">
                  {lang === "zh" ? "参考号" : "Reference No."}
                  <input
                    value={form.reference_no}
                    onChange={(e) => setForm((f) => ({ ...f, reference_no: e.target.value }))}
                    placeholder={lang === "zh" ? "PO/SO/单号（可选）" : "PO/SO/ref (optional)"}
                    className={`mt-1 ${INPUT_CLASS}`}
                  />
                </label>
              </div>

              <label className="block text-sm text-slate-300">
                {lang === "zh" ? "备注" : "Notes"}
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  placeholder={lang === "zh" ? "可选备注" : "Optional notes"}
                  className={`mt-1 ${INPUT_CLASS} resize-none`}
                />
              </label>
            </div>

            {formError && (
              <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {formError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className="rounded-md border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (lang === "zh" ? "保存中..." : "Saving...") : lang === "zh" ? "保存" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
