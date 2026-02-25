"use client";

import { useLanguage } from "@/components/LanguageProvider";

export default function SettingsPage() {
  const { lang } = useLanguage();

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
      <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
        {lang === "zh" ? "设置" : "Settings"}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-slate-100">
        {lang === "zh" ? "设置" : "Settings"}
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        {lang === "zh"
          ? "设置页面骨架已就绪，可接入账户、偏好和集成配置。"
          : "Settings shell is ready for account, preferences, and integration options."}
      </p>
    </section>
  );
}
