"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import ScopedCopilotWidget from "@/components/copilot/ScopedCopilotWidget";
import { useLanguage } from "@/components/LanguageProvider";
import type { AlertItem, AlertsResponse } from "@/lib/alerts/types";
import { DEFAULT_HIGH_STOCK, DEFAULT_SAFETY_STOCK } from "@/lib/alerts/computeAlerts";

type SlowMover = {
  sku: string;
  current_stock: number;
  months_without_movement: number;
  last_out_month: string | null;
  avg_monthly_out: number;
};

type ViewKey = "oos" | "low" | "high";

const VIEW_META: Record<
  ViewKey,
  { titleZh: string; titleEn: string; badgeClass: string; sortHintZh: string; sortHintEn: string }
> = {
  oos: {
    titleZh: "缺货 (OOS)",
    titleEn: "Out of Stock (OOS)",
    badgeClass: "border-red-400/40 bg-red-500/15 text-red-200",
    sortHintZh: "OnHand 升序",
    sortHintEn: "OnHand ascending",
  },
  low: {
    titleZh: "低库存 (LOW)",
    titleEn: "Low Stock (LOW)",
    badgeClass: "border-amber-400/40 bg-amber-500/15 text-amber-200",
    sortHintZh: "OnHand 升序",
    sortHintEn: "OnHand ascending",
  },
  high: {
    titleZh: "高库存 (HIGH)",
    titleEn: "High Stock (HIGH)",
    badgeClass: "border-violet-400/40 bg-violet-500/15 text-violet-200",
    sortHintZh: "OnHand 降序",
    sortHintEn: "OnHand descending",
  },
};

function statusBadgeClass(status: AlertItem["status"]) {
  if (status === "OOS") return VIEW_META.oos.badgeClass;
  if (status === "LOW") return VIEW_META.low.badgeClass;
  return VIEW_META.high.badgeClass;
}

function CountCard({
  label,
  value,
  toneClass,
}: {
  label: string;
  value: number;
  toneClass: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${toneClass}`}>{value}</p>
    </article>
  );
}

function TopListCard({
  title,
  items,
  lang,
}: {
  title: string;
  items: AlertItem[];
  lang: "zh" | "en";
}) {
  return (
    <article className="flex h-full min-h-[480px] flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">{lang === "zh" ? "暂无数据" : "No data"}</p>
        ) : (
          items.map((item) => (
            <div
              key={`${title}-${item.sku}`}
              className="grid h-10 grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)_minmax(0,0.7fr)_76px] items-center gap-2 rounded-lg border border-slate-800 px-2 text-xs"
            >
              <span className="truncate text-slate-200">{item.sku}</span>
              <span className="truncate text-slate-300">OnHand {item.on_hand}</span>
              <span className="text-slate-400">SS {item.safety_stock}</span>
              <span className={`inline-flex justify-center rounded-md border px-1 py-0.5 ${statusBadgeClass(item.status)}`}>
                {item.status}
              </span>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function AlertWindow({
  viewKey,
  lang,
  rows,
  search,
  onSearchChange,
  onEdit,
}: {
  viewKey: ViewKey;
  lang: "zh" | "en";
  rows: AlertItem[];
  search: string;
  onSearchChange: (value: string) => void;
  onEdit: (item: AlertItem) => void;
}) {
  const meta = VIEW_META[viewKey];
  const title = lang === "zh" ? meta.titleZh : meta.titleEn;
  const sortHint = lang === "zh" ? meta.sortHintZh : meta.sortHintEn;
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => item.sku.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {lang === "zh" ? "数量" : "Count"}: {filteredRows.length} · {sortHint}
          </p>
        </div>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={lang === "zh" ? "搜索 SKU" : "Search SKU"}
          className="w-full max-w-[220px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400"
        />
      </div>

      <div className="mt-4 max-h-[360px] overflow-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-900/95 text-xs uppercase tracking-[0.08em] text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">SKU</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "现有库存" : "OnHand"}</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "安全库存" : "Safety"}</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "高库存阈值" : "High"}</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "状态" : "Status"}</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "建议补货量" : "Replenish Qty"}</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "操作" : "Action"}</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>
                  {lang === "zh" ? "暂无数据" : "No data"}
                </td>
              </tr>
            ) : (
              filteredRows.map((item) => (
                <tr key={`${viewKey}-${item.sku}`} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2 font-medium">{item.sku}</td>
                  <td className="px-3 py-2">{item.on_hand}</td>
                  <td className="px-3 py-2">{item.safety_stock}</td>
                  <td className="px-3 py-2">{item.high_stock}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs ${statusBadgeClass(item.status)}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">{item.suggested_replenish_qty}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      className="rounded-md border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20"
                    >
                      {lang === "zh" ? "设置阈值" : "Set Threshold"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AlertsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-28 rounded-2xl border border-slate-800 bg-slate-900/70" />
      <div className="h-72 rounded-2xl border border-slate-800 bg-slate-900/70" />
      <div className="h-72 rounded-2xl border border-slate-800 bg-slate-900/70" />
      <div className="h-72 rounded-2xl border border-slate-800 bg-slate-900/70" />
    </div>
  );
}

function normalizeError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return fallback;
}

export default function AlertsPage() {
  const { lang } = useLanguage();
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewSearch, setViewSearch] = useState<Record<ViewKey, string>>({
    oos: "",
    low: "",
    high: "",
  });

  const [editing, setEditing] = useState<AlertItem | null>(null);
  const [thresholdSafety, setThresholdSafety] = useState("");
  const [thresholdHigh, setThresholdHigh] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [slowMovers, setSlowMovers] = useState<SlowMover[]>([]);
  const [slowMoversLoading, setSlowMoversLoading] = useState(true);
  const [slowMoversSearch, setSlowMoversSearch] = useState("");

  const loadAlerts = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/inventory/alerts?month=latest", {
        cache: "no-store",
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(normalizeError(payload, "加载预警数据失败"));
      }
      setAlerts(payload as AlertsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载预警数据失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadAlerts();
  }, []);

  useEffect(() => {
    const loadSlow = async () => {
      setSlowMoversLoading(true);
      try {
        const res = await fetch("/api/inventory/slow-movers", { cache: "no-store" });
        const data = await res.json();
        setSlowMovers(data.slow_movers ?? []);
      } catch {
        setSlowMovers([]);
      } finally {
        setSlowMoversLoading(false);
      }
    };
    void loadSlow();
  }, []);

  const exportAlertsToExcel = () => {
    if (!alerts) return;
    const allItems = [
      ...alerts.views.oos.map((i) => ({ ...i, category: "OOS" })),
      ...alerts.views.low.map((i) => ({ ...i, category: "LOW" })),
      ...alerts.views.high.map((i) => ({ ...i, category: "HIGH" })),
    ];
    const ws = XLSX.utils.json_to_sheet(
      allItems.map((i) => ({
        SKU: i.sku,
        Status: i.status,
        OnHand: i.on_hand,
        SafetyStock: i.safety_stock,
        HighStock: i.high_stock,
        ReplenishQty: i.suggested_replenish_qty,
        Action: i.suggested_action,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Alerts");
    if (slowMovers.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(
        slowMovers.map((s) => ({
          SKU: s.sku,
          CurrentStock: s.current_stock,
          MonthsWithoutMovement: s.months_without_movement,
          LastOutMonth: s.last_out_month ?? "—",
          AvgMonthlyOut: s.avg_monthly_out,
        }))
      );
      XLSX.utils.book_append_sheet(wb, ws2, "SlowMovers");
    }
    XLSX.writeFile(wb, `inventory-alerts-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const filteredSlowMovers = useMemo(() => {
    const q = slowMoversSearch.trim().toLowerCase();
    if (!q) return slowMovers;
    return slowMovers.filter((s) => s.sku.toLowerCase().includes(q));
  }, [slowMovers, slowMoversSearch]);

  const openThresholdEditor = (item: AlertItem) => {
    setEditing(item);
    setThresholdSafety(String(item.safety_stock));
    setThresholdHigh(String(item.high_stock));
    setSaveError(null);
  };

  const applyOptimisticThresholds = (sku: string, safety: number, high: number) => {
    setAlerts((prev) => {
      if (!prev) return prev;
      const patch = (item: AlertItem): AlertItem =>
        item.sku === sku
          ? {
              ...item,
              safety_stock: safety,
              high_stock: high,
              suggested_replenish_qty: Math.max(0, safety - item.on_hand),
            }
          : item;
      return {
        ...prev,
        top10: {
          oos: prev.top10.oos.map(patch),
          low: prev.top10.low.map(patch),
          high: prev.top10.high.map(patch),
        },
        views: {
          oos: prev.views.oos.map(patch),
          low: prev.views.low.map(patch),
          high: prev.views.high.map(patch),
        },
      };
    });
  };

  const handleSaveThreshold = async () => {
    if (!editing || saving) return;
    setSaveError(null);
    setSaving(true);

    const safetyText = thresholdSafety.trim();
    const highText = thresholdHigh.trim();
    const safetyValue = safetyText === "" ? null : Number(safetyText);
    const highValue = highText === "" ? null : Number(highText);

    const isValid =
      (safetyValue == null || (Number.isInteger(safetyValue) && safetyValue >= 0)) &&
      (highValue == null || (Number.isInteger(highValue) && highValue >= 0));

    if (!isValid) {
      setSaveError("阈值必须是大于等于 0 的整数或留空。");
      setSaving(false);
      return;
    }

    const optimisticSafety = safetyValue ?? DEFAULT_SAFETY_STOCK;
    const optimisticHigh = highValue ?? DEFAULT_HIGH_STOCK;
    applyOptimisticThresholds(editing.sku, optimisticSafety, optimisticHigh);

    try {
      const res = await fetch("/api/inventory/thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: editing.sku,
          safety_stock: safetyValue,
          high_stock: highValue,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(normalizeError(payload, "阈值更新失败"));
      }
      setEditing(null);
      await loadAlerts(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "阈值更新失败");
    } finally {
      setSaving(false);
    }
  };

  const contextData = useMemo(() => {
    if (!alerts) return null;
    return {
      counts: alerts.counts,
      top10: alerts.top10,
      updated_at: alerts.updated_at,
      as_of: alerts.as_of,
    };
  }, [alerts]);

  return (
    <div className="space-y-5 pb-16">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Inventory Alert</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="mt-1 text-2xl font-semibold text-slate-100">
            {lang === "zh" ? "库存预警中心" : "Inventory Alert Center"}
          </h1>
          {alerts && (
            <button
              type="button"
              onClick={exportAlertsToExcel}
              className="rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/25 transition-colors"
            >
              {lang === "zh" ? "导出 Excel" : "Export Excel"}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {lang === "zh"
            ? "基于安全库存阈值的缺货/低库存/高库存预警（Strategy A）。"
            : "Threshold-based OOS/LOW/HIGH alerting with manual safety stock strategy."}
        </p>
        {alerts && (
          <p className="mt-2 text-xs text-slate-500">
            {lang === "zh" ? "统计月份" : "As of"}: {alerts.as_of} ·{" "}
            {lang === "zh" ? "更新时间" : "Updated at"}: {alerts.updated_at}
            {refreshing ? (lang === "zh" ? " · 刷新中..." : " · refreshing...") : ""}
          </p>
        )}
      </section>

      {loading ? (
        <AlertsSkeleton />
      ) : error ? (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => void loadAlerts()}
            className="mt-3 rounded-md border border-red-400/40 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/20"
          >
            {lang === "zh" ? "重试" : "Retry"}
          </button>
        </section>
      ) : alerts ? (
        <>
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <CountCard
              label={lang === "zh" ? "缺货 (OOS)" : "OOS"}
              value={alerts.counts.oos}
              toneClass="text-red-300"
            />
            <CountCard
              label={lang === "zh" ? "低库存 (LOW)" : "LOW"}
              value={alerts.counts.low}
              toneClass="text-amber-300"
            />
            <CountCard
              label={lang === "zh" ? "高库存 (HIGH)" : "HIGH"}
              value={alerts.counts.high}
              toneClass="text-violet-300"
            />
          </section>

          <section className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-3">
            <TopListCard title={lang === "zh" ? "Top10 缺货" : "Top10 OOS"} items={alerts.top10.oos} lang={lang} />
            <TopListCard title={lang === "zh" ? "Top10 低库存" : "Top10 LOW"} items={alerts.top10.low} lang={lang} />
            <TopListCard title={lang === "zh" ? "Top10 高库存" : "Top10 HIGH"} items={alerts.top10.high} lang={lang} />
          </section>

          <section className="space-y-4">
            <AlertWindow
              viewKey="oos"
              lang={lang}
              rows={alerts.views.oos}
              search={viewSearch.oos}
              onSearchChange={(value) => setViewSearch((prev) => ({ ...prev, oos: value }))}
              onEdit={openThresholdEditor}
            />
            <AlertWindow
              viewKey="low"
              lang={lang}
              rows={alerts.views.low}
              search={viewSearch.low}
              onSearchChange={(value) => setViewSearch((prev) => ({ ...prev, low: value }))}
              onEdit={openThresholdEditor}
            />
            <AlertWindow
              viewKey="high"
              lang={lang}
              rows={alerts.views.high}
              search={viewSearch.high}
              onSearchChange={(value) => setViewSearch((prev) => ({ ...prev, high: value }))}
              onEdit={openThresholdEditor}
            />
          </section>
        </>
      ) : null}

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-lg font-semibold text-slate-100">
              {lang === "zh" ? "设置阈值" : "Set Threshold"} · {editing.sku}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {lang === "zh"
                ? `安全库存与高库存阈值。留空则使用默认值（${DEFAULT_SAFETY_STOCK}/${DEFAULT_HIGH_STOCK}）。`
                : `Safety/high stock thresholds. Leave blank to use defaults (${DEFAULT_SAFETY_STOCK}/${DEFAULT_HIGH_STOCK}).`}
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-sm text-slate-300">
                safety_stock
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={thresholdSafety}
                  onChange={(event) => setThresholdSafety(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
              <label className="block text-sm text-slate-300">
                high_stock
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={thresholdHigh}
                  onChange={(event) => setThresholdHigh(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
            </div>

            {saveError && (
              <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {saveError}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveThreshold()}
                disabled={saving}
                className="rounded-md border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? (lang === "zh" ? "保存中..." : "Saving...") : lang === "zh" ? "保存" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slow Movers Section */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              {lang === "zh" ? "滞销预警 (Slow Movers)" : "Slow Movers Alert"}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === "zh"
                ? "有库存但连续 2+ 个月无出库的 SKU"
                : "SKUs with stock but zero outbound for 2+ consecutive months"}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-200">
              {slowMovers.length} SKU
            </span>
            <input
              value={slowMoversSearch}
              onChange={(e) => setSlowMoversSearch(e.target.value)}
              placeholder={lang === "zh" ? "搜索 SKU" : "Search SKU"}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400 w-36"
            />
          </div>
        </div>

        {slowMoversLoading ? (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-8 rounded-lg bg-slate-800/50" />)}
          </div>
        ) : filteredSlowMovers.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            {lang === "zh" ? "暂无滞销 SKU" : "No slow movers detected"}
          </p>
        ) : (
          <div className="max-h-[320px] overflow-auto rounded-xl border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-900/95 text-xs uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "当前库存" : "Stock"}</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "滞销月数" : "Idle Months"}</th>
                  <th className="px-3 py-2 text-left">{lang === "zh" ? "最后出库月" : "Last Out Month"}</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "月均出库" : "Avg Out/Mo"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSlowMovers.map((s) => (
                  <tr key={s.sku} className="border-t border-slate-800 text-slate-200 hover:bg-slate-800/30">
                    <td className="px-3 py-2 font-medium">{s.sku}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.current_stock.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs ${
                        s.months_without_movement >= 3
                          ? "border-red-400/40 bg-red-500/15 text-red-200"
                          : "border-amber-400/40 bg-amber-500/15 text-amber-200"
                      }`}>
                        {s.months_without_movement}mo
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{s.last_out_month ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">{s.avg_monthly_out}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ScopedCopilotWidget
        endpoint="/api/copilot/alerts"
        pageScope="alerts"
        title={lang === "zh" ? "预警 Copilot" : "Alerts Copilot"}
        subtitle={lang === "zh" ? "仅回答库存预警页问题" : "Alerts-page only answers"}
        scopeInstruction="Only answer alerts-page questions and redirect out-of-scope users to /home."
        contextData={contextData}
        suggestedPrompts={[
          "哪些 SKU 目前缺货最严重？",
          "LOW 列表里优先补货哪些？",
          "如何设置某个 SKU 的阈值？",
        ]}
      />
    </div>
  );
}
