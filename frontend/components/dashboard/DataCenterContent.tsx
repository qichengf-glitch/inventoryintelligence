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

const CARD_BASE_CLASS =
  "rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-[0_10px_25px_rgba(2,6,23,0.35)]";

export default function DataCenterContent({
  supabaseDashboardUrl,
}: DataCenterContentProps) {
  const { lang } = useLanguage();
  const [tableRows, setTableRows] = useState<DataTableInfo[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [tableError, setTableError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      setTableLoading(true);
      setTableError(null);
      try {
        const res = await fetch("/api/data-tables", { cache: "no-store" });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Failed to load table status");
        }

        if (!disposed) {
          setTableRows(Array.isArray(data?.tables) ? data.tables : []);
          setGeneratedAt(typeof data?.generatedAt === "string" ? data.generatedAt : null);
        }
      } catch (error) {
        if (!disposed) {
          setTableError(error instanceof Error ? error.message : "Failed to load table status");
          setTableRows([]);
        }
      } finally {
        if (!disposed) {
          setTableLoading(false);
        }
      }
    };

    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const updatedLabel = useMemo(() => {
    if (!generatedAt) return "";
    const date = new Date(generatedAt);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
  }, [generatedAt, lang]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
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

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className={CARD_BASE_CLASS}>
          <h2 className="text-lg font-semibold text-slate-100">
            {lang === "zh" ? "上传数据" : "Upload Data"}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {lang === "zh"
              ? "导入库存文件到当前数据表。"
              : "Import your inventory files into the current data table."}
          </p>
          <Link
            href="/inventory"
            className="mt-5 inline-flex rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20"
          >
            {lang === "zh" ? "打开上传" : "Open uploader"}
          </Link>
        </article>

        <article className={CARD_BASE_CLASS}>
          <h2 className="text-lg font-semibold text-slate-100">
            {lang === "zh" ? "搜索数据" : "Search Data"}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {lang === "zh"
              ? "在一个页面里查询和筛选库存记录。"
              : "Query and filter existing inventory rows in one place."}
          </p>
          <Link
            href="/search"
            className="mt-5 inline-flex rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20"
          >
            {lang === "zh" ? "打开搜索" : "Open search"}
          </Link>
        </article>

        <article className={CARD_BASE_CLASS}>
          <h2 className="text-lg font-semibold text-slate-100">
            {lang === "zh" ? "打开 Supabase" : "Open Supabase"}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {lang === "zh"
              ? "跳转 Supabase 控制台进行表级操作。"
              : "Jump to your Supabase dashboard for table-level operations."}
          </p>
          {supabaseDashboardUrl ? (
            <a
              href={supabaseDashboardUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20"
            >
              {lang === "zh" ? "打开控制台" : "Open dashboard"}
            </a>
          ) : (
            <p className="mt-5 text-xs text-amber-300">
              {lang === "zh"
                ? "未检测到 Supabase 控制台 URL 配置。"
                : "Missing Supabase dashboard URL config."}
            </p>
          )}
        </article>
      </section>

      <section className={CARD_BASE_CLASS}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">
              {lang === "zh" ? "线上数据表" : "Online Data Tables"}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {lang === "zh"
                ? "实时读取 Supabase 表状态和行数。"
                : "Live status and row counts from Supabase tables."}
            </p>
          </div>
          {updatedLabel && (
            <span className="text-xs text-slate-400">
              {lang === "zh" ? `更新于 ${updatedLabel}` : `Updated ${updatedLabel}`}
            </span>
          )}
        </div>

        {tableLoading ? (
          <div className="text-sm text-slate-300">{lang === "zh" ? "加载中..." : "Loading..."}</div>
        ) : tableError ? (
          <div className="text-sm text-rose-300">{tableError}</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/80 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left">{lang === "zh" ? "表名" : "Table"}</th>
                  <th className="px-3 py-2 text-left">{lang === "zh" ? "状态" : "Status"}</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "行数" : "Rows"}</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => {
                  const statusColor =
                    row.status === "ok"
                      ? "text-emerald-300"
                      : row.status === "missing"
                      ? "text-amber-300"
                      : "text-rose-300";
                  const statusText =
                    row.status === "ok"
                      ? lang === "zh"
                        ? "可用"
                        : "OK"
                      : row.status === "missing"
                      ? lang === "zh"
                        ? "缺失"
                        : "Missing"
                      : lang === "zh"
                      ? "错误"
                      : "Error";

                  return (
                    <tr key={row.name} className="border-t border-slate-800 text-slate-200">
                      <td className="px-3 py-2 font-mono">{row.name}</td>
                      <td className={`px-3 py-2 ${statusColor}`} title={row.error || ""}>
                        {statusText}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {typeof row.rowCount === "number" ? row.rowCount.toLocaleString() : "-"}
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
