"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

type ReportState = "idle" | "loading" | "done" | "error";

const TEXT = {
  pageLabel: { zh: "报表中心", en: "Report Center" },
  title: { zh: "AI 报告生成", en: "AI Report Generator" },
  subtitle: {
    zh: "基于当月全量数据，由 GPT-4.1 自动生成可发送给老板或客户的专业库存管理报告。",
    en: "Automatically generate a professional inventory management report from this month's data using GPT-4.1 — ready to send to management or clients.",
  },
  langLabel: { zh: "报告语言", en: "Report Language" },
  langZh: { zh: "中文", en: "Chinese" },
  langEn: { zh: "英文", en: "English" },
  generate: { zh: "生成报告", en: "Generate Report" },
  regenerate: { zh: "重新生成", en: "Regenerate" },
  loading: { zh: "AI 正在撰写报告，请稍候（约 20-40 秒）…", en: "AI is writing the report, please wait (~20-40 s)…" },
  copy: { zh: "复制全文", en: "Copy Report" },
  copied: { zh: "已复制！", en: "Copied!" },
  download: { zh: "下载 .txt", en: "Download .txt" },
  generatedAt: { zh: "生成时间", en: "Generated at" },
  model: { zh: "模型", en: "Model" },
  month: { zh: "数据月份", en: "Data month" },
  tip: {
    zh: "提示：生成的报告包含执行摘要、库存健康分析、核心风险、销售匹配度分析及行动计划，适合直接发送给管理层或客户。",
    en: "Tip: The report includes an executive summary, inventory health analysis, key risks, sales alignment, and an action plan — ready to send to management or clients.",
  },
};

function t(str: { zh: string; en: string }, lang: "zh" | "en") {
  return str[lang] ?? str.zh;
}

/** Render Markdown-like text: ## headers, **bold**, - list items */
function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) {
          return (
            <h2 key={i} className="mt-5 mb-2 text-base font-bold text-cyan-300">
              {line.slice(3)}
            </h2>
          );
        }
        if (line.startsWith("### ")) {
          return (
            <h3 key={i} className="mt-3 mb-1 text-sm font-semibold text-cyan-200">
              {line.slice(4)}
            </h3>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          const content = line.slice(2);
          return (
            <li key={i} className="ml-4 text-sm leading-7 text-slate-200 list-disc">
              <BoldText text={content} />
            </li>
          );
        }
        if (line.trim() === "") {
          return <div key={i} className="h-2" />;
        }
        return (
          <p key={i} className="text-sm leading-7 text-slate-200">
            <BoldText text={line} />
          </p>
        );
      })}
    </div>
  );
}

function BoldText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-slate-100">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

type ReportResult = {
  report: string;
  model: string;
  lang: "zh" | "en";
  month: string;
  generatedAt: string;
};

export default function ReportCenterDashboard({ displayName = "" }: { displayName?: string }) {
  const { lang } = useLanguage();
  const [reportLang, setReportLang] = useState<"zh" | "en">(lang);
  const [state, setState] = useState<ReportState>("idle");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setState("loading");
    setErrorMsg("");
    setResult(null);

    try {
      const res = await fetch("/api/ai/full-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: reportLang }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Report generation failed");
      }
      setResult(data as ReportResult);
      setState("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  };

  const handleCopy = async () => {
    if (!result?.report) return;
    await navigator.clipboard.writeText(result.report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!result?.report) return;
    const blob = new Blob([result.report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-report-${result.month ?? "latest"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Page header */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
          {t(TEXT.pageLabel, lang)}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-100">
          {t(TEXT.title, lang)}
          {displayName ? (
            <span className="ml-2 text-base font-normal text-slate-400">
              · {displayName}
            </span>
          ) : null}
        </h1>
        <p className="mt-2 text-sm text-slate-400">{t(TEXT.subtitle, lang)}</p>
      </section>

      {/* Config + generate */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs uppercase tracking-[0.12em] text-slate-400 mb-2">
              {t(TEXT.langLabel, lang)}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReportLang("zh")}
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  reportLang === "zh"
                    ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-100"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                }`}
              >
                🇨🇳 {t(TEXT.langZh, lang)}
              </button>
              <button
                type="button"
                onClick={() => setReportLang("en")}
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  reportLang === "en"
                    ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-100"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                }`}
              >
                🇺🇸 {t(TEXT.langEn, lang)}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={state === "loading"}
            className="rounded-xl border border-cyan-400/50 bg-cyan-500/20 px-6 py-2.5 text-sm font-semibold text-cyan-100 shadow-[0_4px_20px_rgba(34,211,238,0.18)] hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60 transition"
          >
            {state === "loading"
              ? "..."
              : state === "done"
              ? t(TEXT.regenerate, lang)
              : t(TEXT.generate, lang)}
          </button>
        </div>

        {/* Tip */}
        <p className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/30 px-4 py-3 text-xs text-slate-400 leading-5">
          💡 {t(TEXT.tip, lang)}
        </p>
      </section>

      {/* Loading state */}
      {state === "loading" && (
        <section className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-8 text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-cyan-400" />
          <p className="text-sm text-slate-400 animate-pulse">{t(TEXT.loading, lang)}</p>
        </section>
      )}

      {/* Error state */}
      {state === "error" && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
          <p className="text-sm text-red-200">{errorMsg}</p>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            className="mt-3 rounded-md border border-red-400/40 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/20"
          >
            {lang === "zh" ? "重试" : "Retry"}
          </button>
        </section>
      )}

      {/* Report output */}
      {state === "done" && result && (
        <section className="rounded-2xl border border-cyan-400/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.85),rgba(15,23,42,0.95))] shadow-[0_18px_50px_rgba(8,47,73,0.3)]">
          {/* Report header bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 px-6 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-cyan-300/80">
                {t(TEXT.month, lang)}: {result.month} · {t(TEXT.model, lang)}: {result.model}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {t(TEXT.generatedAt, lang)}: {new Date(result.generatedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
              >
                {copied ? t(TEXT.copied, lang) : t(TEXT.copy, lang)}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
              >
                {t(TEXT.download, lang)}
              </button>
            </div>
          </div>

          {/* Report body */}
          <div className="px-6 py-6">
            <RenderMarkdown text={result.report} />
          </div>
        </section>
      )}
    </div>
  );
}
