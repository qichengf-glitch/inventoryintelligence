"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";

type DataCenterContentProps = {
  supabaseDashboardUrl: string | null;
};

type DataTableInfo = {
  name: string;
  rowCount: number | null;
  status: "ok" | "missing" | "error";
  error?: string;
};

const CARD_BASE =
  "rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-[0_10px_25px_rgba(2,6,23,0.35)]";

const ACTION_CARDS = [
  {
    icon: "⬆",
    titleZh: "上传数据",
    titleEn: "Upload Data",
    descZh: "导入 CSV / Excel 库存文件到当前数据表，自动映射列并校验格式。",
    descEn: "Import CSV / Excel inventory files into your data table with auto column mapping.",
    href: "/inventory",
    btnZh: "打开上传",
    btnEn: "Open Uploader",
    external: false,
  },
  {
    icon: "⌕",
    titleZh: "搜索数据",
    titleEn: "Search Data",
    descZh: "按 SKU、月份、品类快速查询和筛选库存记录，支持导出。",
    descEn: "Query and filter inventory rows by SKU, month, or category. Export results.",
    href: "/search",
    btnZh: "打开搜索",
    btnEn: "Open Search",
    external: false,
  },
] as const;

function StatusDot({ status }: { status: DataTableInfo["status"] }) {
  const color =
    status === "ok"
      ? "bg-emerald-400"
      : status === "missing"
      ? "bg-amber-400"
      : "bg-rose-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export default function DataCenterContent({ supabaseDashboardUrl }: DataCenterContentProps) {
  const { lang } = useLanguage();
  const [tableRows, setTableRows] = useState<DataTableInfo[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [tableError, setTableError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const load = async () => {
    setTableLoading(true);
    setTableError(null);
    try {
      const res = await fetch("/api/data-tables", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Failed to load table status");
      setTableRows(Array.isArray(data?.tables) ? data.tables : []);
      setGeneratedAt(typeof data?.generatedAt === "string" ? data.generatedAt : null);
    } catch (error) {
      setTableError(error instanceof Error ? error.message : "Failed to load table status");
      setTableRows([]);
    } finally {
      setTableLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const updatedLabel = useMemo(() => {
    if (!generatedAt) return "";
    const d = new Date(generatedAt);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
  }, [generatedAt, lang]);

  const healthStats = useMemo(() => {
    const online = tableRows.filter((r) => r.status === "ok").length;
    const errors = tableRows.filter((r) => r.status === "error").length;
    const totalRows = tableRows.reduce((s, r) => s + (r.rowCount ?? 0), 0);
    return { online, errors, totalRows, total: tableRows.length };
  }, [tableRows]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-500">
          {lang === "zh" ? "数据中心" : "Data Center"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-100">
          {lang === "zh" ? "数据中心" : "Data Center"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {lang === "zh"
            ? "上传、搜索并管理你的库存数据流程。"
            : "Upload, search, and manage your inventory data pipeline."}
        </p>
      </section>

      {/* Health summary strip */}
      {!tableLoading && tableRows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: lang === "zh" ? "在线表" : "Online Tables",
              value: `${healthStats.online} / ${healthStats.total}`,
              color: healthStats.errors > 0 ? "text-amber-300" : "text-emerald-300",
            },
            {
              label: lang === "zh" ? "异常表" : "Tables w/ Errors",
              value: healthStats.errors,
              color: healthStats.errors > 0 ? "text-rose-300" : "text-slate-400",
            },
            {
              label: lang === "zh" ? "总行数" : "Total Rows",
              value: healthStats.totalRows.toLocaleString(),
              color: "text-cyan-200",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"
            >
              <p className="text-xs text-slate-500">{stat.label}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${stat.color}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Quick action cards */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {ACTION_CARDS.map((card) => (
          <article key={card.href} className={CARD_BASE}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-2xl text-cyan-300 select-none">{card.icon}</span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-100">
                  {lang === "zh" ? card.titleZh : card.titleEn}
                </h2>
                <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                  {lang === "zh" ? card.descZh : card.descEn}
                </p>
              </div>
            </div>
            <Link
              href={card.href}
              className="mt-5 inline-flex rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20 transition-colors"
            >
              {lang === "zh" ? card.btnZh : card.btnEn}
            </Link>
          </article>
        ))}

        {/* Supabase card — secondary visual weight */}
        <article className={`${CARD_BASE} border-dashed`}>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-2xl text-slate-400 select-none">⚙</span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-100">
                {lang === "zh" ? "Supabase 控制台" : "Supabase Console"}
              </h2>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                {lang === "zh"
                  ? "直接在 Supabase 控制台进行表结构变更、SQL 查询和权限管理。"
                  : "Manage table schema, run raw SQL, and configure permissions in Supabase."}
              </p>
            </div>
          </div>
          {supabaseDashboardUrl ? (
            <a
              href={supabaseDashboardUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800/60 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
            >
              {lang === "zh" ? "打开控制台" : "Open Console"}
              <span className="text-slate-500 text-xs">↗</span>
            </a>
          ) : (
            <p className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
              {lang === "zh"
                ? "未配置 Supabase 控制台 URL（SUPABASE_DASHBOARD_URL）"
                : "SUPABASE_DASHBOARD_URL is not configured."}
            </p>
          )}
        </article>
      </section>

      {/* Live table status */}
      <section className={CARD_BASE}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              {lang === "zh" ? "线上数据表" : "Online Data Tables"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {lang === "zh"
                ? "实时读取 Supabase 表状态与行数，每 60 秒自动刷新。"
                : "Live table status and row counts from Supabase. Auto-refreshes every 60 s."}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {updatedLabel && (
              <span className="text-xs text-slate-500">
                {lang === "zh" ? `更新于 ${updatedLabel}` : `Updated ${updatedLabel}`}
              </span>
            )}
            <button
              type="button"
              onClick={load}
              disabled={tableLoading}
              className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {tableLoading
                ? lang === "zh" ? "刷新中…" : "Refreshing…"
                : lang === "zh" ? "刷新" : "Refresh"}
            </button>
          </div>
        </div>

        {tableLoading && tableRows.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
            {lang === "zh" ? "加载中…" : "Loading…"}
          </div>
        ) : tableError ? (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
            {tableError}
          </div>
        ) : tableRows.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">
            {lang === "zh" ? "未找到数据表。" : "No tables found."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/80">
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 text-left font-medium">
                    {lang === "zh" ? "表名" : "Table"}
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    {lang === "zh" ? "状态" : "Status"}
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    {lang === "zh" ? "行数" : "Rows"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => {
                  const statusLabel =
                    row.status === "ok"
                      ? lang === "zh" ? "可用" : "OK"
                      : row.status === "missing"
                      ? lang === "zh" ? "缺失" : "Missing"
                      : lang === "zh" ? "错误" : "Error";
                  const statusText =
                    row.status === "ok"
                      ? "text-emerald-300"
                      : row.status === "missing"
                      ? "text-amber-300"
                      : "text-rose-300";

                  return (
                    <tr key={row.name} className="border-t border-slate-800 hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-slate-200">{row.name}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 ${statusText}`}>
                          <StatusDot status={row.status} />
                          {statusLabel}
                        </span>
                        {row.status === "error" && row.error && (
                          <p className="mt-0.5 text-xs text-rose-400/70 max-w-xs truncate">
                            {row.error}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-200">
                        {typeof row.rowCount === "number" ? row.rowCount.toLocaleString() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
