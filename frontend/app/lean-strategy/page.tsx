"use client";

import { useLanguage } from "@/components/LanguageProvider";

const CARD_BASE_CLASS =
  "rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-[0_10px_25px_rgba(2,6,23,0.35)]";

export default function LeanStrategyPage() {
  const { lang } = useLanguage();

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
          {lang === "zh" ? "精益策略" : "Lean Strategy"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-100">
          {lang === "zh" ? "精益策略" : "Lean Strategy"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {lang === "zh"
            ? "库存策略分层分析模块占位。"
            : "Placeholder modules for inventory strategy segmentation."}
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className={CARD_BASE_CLASS}>
          <h2 className="text-lg font-semibold text-slate-100">ABC Analysis</h2>
          <p className="mt-2 text-sm text-slate-400">
            {lang === "zh"
              ? "按价值贡献对 SKU 进行分类。"
              : "Classify SKUs by value contribution."}
          </p>
          <span className="mt-5 inline-flex rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-400">
            {lang === "zh" ? "即将上线" : "Coming soon"}
          </span>
        </article>

        <article className={CARD_BASE_CLASS}>
          <h2 className="text-lg font-semibold text-slate-100">XYZ Analysis</h2>
          <p className="mt-2 text-sm text-slate-400">
            {lang === "zh"
              ? "按需求波动对 SKU 进行分层。"
              : "Segment SKUs by demand variability."}
          </p>
          <span className="mt-5 inline-flex rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-400">
            {lang === "zh" ? "即将上线" : "Coming soon"}
          </span>
        </article>
      </section>
    </div>
  );
}
