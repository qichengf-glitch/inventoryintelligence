"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { lang } = useLanguage();

  return (
    <div className="space-y-5 pb-16">
      <section className="rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-950/40 via-slate-900/70 to-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-violet-300/80">
          {lang === "zh" ? "专栏" : "Spotlight"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-100">
          {lang === "zh" ? "营销专栏" : "Marketing Hub"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {lang === "zh"
            ? "SKU 绩效、促销机会与品类洞察——与库存分析并列的独立营销视图。"
            : "SKU performance, promo opportunities, and category insights — a dedicated marketing view alongside inventory analytics."}
        </p>
        <p className="mt-3 text-xs text-slate-500">
          <Link
            href="/analysis/forecast"
            className="text-violet-300/90 hover:text-violet-200 underline underline-offset-2"
          >
            {lang === "zh" ? "← 返回分析工作台" : "← Back to Analytics Workbench"}
          </Link>
        </p>
      </section>

      {children}
    </div>
  );
}
