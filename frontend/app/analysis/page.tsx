"use client";

import Link from "next/link";

import { useLanguage } from "@/components/LanguageProvider";

const CARD_BASE_CLASS =
  "rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-[0_10px_25px_rgba(2,6,23,0.35)]";

export default function AnalysisPage() {
  const { lang } = useLanguage();

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
          {lang === "zh" ? "分析" : "Analysis"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-100">
          {lang === "zh" ? "分析" : "Analysis"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {lang === "zh"
            ? "打开预测与优化分析入口。"
            : "Open analysis workstreams for forecasting and inventory optimization."}
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className={CARD_BASE_CLASS}>
          <h2 className="text-lg font-semibold text-slate-100">
            {lang === "zh" ? "需求预测" : "Forecasting"}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {lang === "zh" ? "需求预测分析工作区。" : "Demand forecasting workspace."}
          </p>
          <Link
            href="/analytics/forecast"
            className="mt-5 inline-flex rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20"
          >
            {lang === "zh" ? "打开模块" : "Open module"}
          </Link>
        </article>

        <article className={CARD_BASE_CLASS}>
          <h2 className="text-lg font-semibold text-slate-100">
            {lang === "zh" ? "补货建议" : "Replenishment Suggestions"}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {lang === "zh"
              ? "补货建议模块占位。"
              : "Placeholder for replenishment recommendation logic."}
          </p>
          <span className="mt-5 inline-flex rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-400">
            {lang === "zh" ? "即将上线" : "Coming soon"}
          </span>
        </article>

        <article className={CARD_BASE_CLASS}>
          <h2 className="text-lg font-semibold text-slate-100">
            {lang === "zh" ? "周转建议" : "Turnover Suggestions"}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {lang === "zh"
              ? "周转优化建议模块占位。"
              : "Placeholder for turnover optimization suggestions."}
          </p>
          <span className="mt-5 inline-flex rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-400">
            {lang === "zh" ? "即将上线" : "Coming soon"}
          </span>
        </article>
      </section>
    </div>
  );
}
