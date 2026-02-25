"use client";

import { useLanguage } from "@/components/LanguageProvider";

export default function InOutPage() {
  const { lang } = useLanguage();

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
      <p className="text-xs uppercase tracking-[0.15em] text-slate-400">出入库管理</p>
      <h1 className="mt-1 text-2xl font-semibold text-slate-100">出入库管理</h1>
      <p className="mt-2 text-sm text-slate-400">
        {lang === "zh"
          ? "页面骨架已就绪，后续可接入出入库流水、审批与盘点模块。"
          : "Page shell is ready for in/out movement, approval, and stock-taking modules."}
      </p>
    </section>
  );
}
