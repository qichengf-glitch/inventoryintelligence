"use client";

import Link from "next/link";

import { useLanguage } from "@/components/LanguageProvider";

type DataCenterContentProps = {
  supabaseDashboardUrl: string | null;
};

const CARD_BASE_CLASS =
  "rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-[0_10px_25px_rgba(2,6,23,0.35)]";

export default function DataCenterContent({
  supabaseDashboardUrl,
}: DataCenterContentProps) {
  const { lang } = useLanguage();

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
    </div>
  );
}
