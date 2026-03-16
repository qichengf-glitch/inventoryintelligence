"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";

const TABS = [
  { label: { zh: "需求预测", en: "Forecast" }, href: "/analysis/forecast" },
  { label: { zh: "精益策略", en: "Lean Strategy" }, href: "/analysis/lean-strategy" },
  { label: { zh: "呆滞预警", en: "Obsolescence" }, href: "/analysis/obsolescence" },
];

export default function AnalysisLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { lang } = useLanguage();

  return (
    <div className="space-y-5 pb-16">
      {/* Header */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
          {lang === "zh" ? "分析" : "Analysis"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-100">
          {lang === "zh" ? "分析工作台" : "Analytics Workbench"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {lang === "zh"
            ? "需求预测、ABC/XYZ 精益分类、呆滞库存风险三位一体分析。"
            : "Demand forecasting, ABC/XYZ lean classification, and obsolescence risk — all in one place."}
        </p>

        {/* Tab nav */}
        <div className="mt-4 flex gap-1 border-b border-slate-700">
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-[1px] transition-colors ${
                  active
                    ? "border-cyan-400 text-cyan-300"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600"
                }`}
              >
                {tab.label[lang]}
              </Link>
            );
          })}
        </div>
      </section>

      {children}
    </div>
  );
}
