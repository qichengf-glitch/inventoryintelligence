"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

type ReportType = "management" | "warehouse" | "purchasing" | "sales" | "finance";
type ReportState = "idle" | "loading" | "done" | "error";

// ─── Persona definitions ─────────────────────────────────────────────────────

const PERSONAS: {
  type: ReportType;
  icon: string;
  labelZh: string;
  labelEn: string;
  roleZh: string;
  roleEn: string;
  focusZh: string;
  focusEn: string;
  accent: string;
  activeBorder: string;
  activeBg: string;
  activeText: string;
}[] = [
  {
    type: "management",
    icon: "📊",
    labelZh: "管理层",
    labelEn: "Management",
    roleZh: "CEO · 总经理 · 董事",
    roleEn: "CEO · GM · Directors",
    focusZh: "整体健康评级、KPI 趋势、核心风险、决策建议",
    focusEn: "Health rating, KPI trends, top risks, executive decisions",
    accent: "cyan",
    activeBorder: "border-cyan-400/50",
    activeBg: "bg-cyan-500/10",
    activeText: "text-cyan-200",
  },
  {
    type: "warehouse",
    icon: "🏭",
    labelZh: "仓库主管",
    labelEn: "Warehouse",
    roleZh: "仓库主管 · 库管员",
    roleEn: "Warehouse Supervisor · Stock Clerk",
    focusZh: "补货优先级、空间压力、操作重点清单",
    focusEn: "Replenishment priority, space pressure, ops task list",
    accent: "emerald",
    activeBorder: "border-emerald-400/50",
    activeBg: "bg-emerald-500/10",
    activeText: "text-emerald-200",
  },
  {
    type: "purchasing",
    icon: "🛒",
    labelZh: "采购",
    labelEn: "Purchasing",
    roleZh: "采购经理 · 供应链",
    roleEn: "Procurement Manager · Supply Chain",
    focusZh: "立即补货 vs 暂缓采购、采购节奏、预算方向",
    focusEn: "Buy now vs hold, order cadence, budget guidance",
    accent: "violet",
    activeBorder: "border-violet-400/50",
    activeBg: "bg-violet-500/10",
    activeText: "text-violet-200",
  },
  {
    type: "sales",
    icon: "📣",
    labelZh: "销售 / 营销",
    labelEn: "Sales / Marketing",
    roleZh: "销售经理 · 市场团队",
    roleEn: "Sales Manager · Marketing Team",
    focusZh: "可推销产品、断货风险、滞销品促销机会",
    focusEn: "Push products, stockout risks, clearance opportunities",
    accent: "orange",
    activeBorder: "border-orange-400/50",
    activeBg: "bg-orange-500/10",
    activeText: "text-orange-200",
  },
  {
    type: "finance",
    icon: "💰",
    labelZh: "财务",
    labelEn: "Finance",
    roleZh: "财务总监 · 财务经理",
    roleEn: "CFO · Finance Manager",
    focusZh: "资金占压、减值风险、现金流影响、周转优化",
    focusEn: "Trapped capital, write-down risk, cash flow, turnover",
    accent: "amber",
    activeBorder: "border-amber-400/50",
    activeBg: "bg-amber-500/10",
    activeText: "text-amber-200",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith("## "))
          return <h2 key={i} className="mt-5 mb-2 text-base font-bold text-cyan-300">{line.slice(3)}</h2>;
        if (line.startsWith("### "))
          return <h3 key={i} className="mt-3 mb-1 text-sm font-semibold text-cyan-200">{line.slice(4)}</h3>;
        if (line.startsWith("- ") || line.startsWith("* "))
          return <li key={i} className="ml-4 text-sm leading-7 text-slate-200 list-disc"><BoldText text={line.slice(2)} /></li>;
        if (line.trim() === "")
          return <div key={i} className="h-2" />;
        return <p key={i} className="text-sm leading-7 text-slate-200"><BoldText text={line} /></p>;
      })}
    </div>
  );
}

function BoldText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1
          ? <strong key={i} className="font-semibold text-slate-100">{p}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

type ReportResult = {
  report: string;
  model: string;
  lang: "zh" | "en";
  reportType: ReportType;
  month: string;
  generatedAt: string;
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportCenterDashboard({ displayName = "" }: { displayName?: string }) {
  const { lang } = useLanguage();

  const [selectedType, setSelectedType] = useState<ReportType>("management");
  const [reportLang,   setReportLang]   = useState<"zh" | "en">(lang);
  const [state,        setState]        = useState<ReportState>("idle");
  const [result,       setResult]       = useState<ReportResult | null>(null);
  const [errorMsg,     setErrorMsg]     = useState("");
  const [copied,       setCopied]       = useState(false);

  const activePersona = PERSONAS.find(p => p.type === selectedType)!;

  const handleGenerate = async () => {
    setState("loading");
    setErrorMsg("");
    setResult(null);
    try {
      const res = await fetch("/api/ai/full-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: reportLang, reportType: selectedType }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed");
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
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `report-${selectedType}-${result.month ?? "latest"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 pb-16">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
          {lang === "zh" ? "报表中心" : "Report Center"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-100">
          {lang === "zh" ? "AI 报告生成" : "AI Report Generator"}
          {displayName && <span className="ml-2 text-base font-normal text-slate-400">· {displayName}</span>}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {lang === "zh"
            ? "选择你的角色，AI 会生成专门针对你关心内容的报告。"
            : "Pick your role — AI generates a report focused on what matters to you."}
        </p>
      </section>

      {/* ── Persona selector ───────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <p className="mb-3 text-xs uppercase tracking-[0.12em] text-slate-400">
          {lang === "zh" ? "我是…" : "I am…"}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {PERSONAS.map(p => {
            const active = selectedType === p.type;
            return (
              <button
                key={p.type}
                type="button"
                onClick={() => { setSelectedType(p.type); setState("idle"); setResult(null); }}
                className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all ${
                  active
                    ? `${p.activeBorder} ${p.activeBg}`
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-600 hover:bg-slate-900"
                }`}
              >
                <span className="text-2xl">{p.icon}</span>
                <div>
                  <p className={`text-sm font-semibold ${active ? p.activeText : "text-slate-200"}`}>
                    {lang === "zh" ? p.labelZh : p.labelEn}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 leading-4">
                    {lang === "zh" ? p.roleZh : p.roleEn}
                  </p>
                </div>
                {active && (
                  <p className="text-xs text-slate-400 leading-4 border-t border-slate-700/50 pt-2 w-full">
                    {lang === "zh" ? p.focusZh : p.focusEn}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Language + Generate ─────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center gap-4">
          {/* Language toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{lang === "zh" ? "报告语言：" : "Language:"}</span>
            <div className="flex rounded-xl border border-slate-700 overflow-hidden">
              {(["zh", "en"] as const).map(l => (
                <button key={l} type="button"
                  onClick={() => setReportLang(l)}
                  className={`px-3 py-1.5 text-xs font-medium transition ${
                    reportLang === l
                      ? "bg-slate-700 text-slate-100"
                      : "text-slate-400 hover:text-slate-200"
                  }`}>
                  {l === "zh" ? "中文" : "EN"}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={state === "loading"}
            className={`rounded-xl border px-6 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${activePersona.activeBorder} ${activePersona.activeBg} ${activePersona.activeText} hover:brightness-110`}
          >
            {state === "loading" ? (lang === "zh" ? "生成中…" : "Generating…")
              : state === "done"   ? (lang === "zh" ? "重新生成" : "Regenerate")
              : (lang === "zh" ? `生成${activePersona.labelZh}报告` : `Generate ${activePersona.labelEn} Report`)}
          </button>

          {/* What's in this report */}
          {state === "idle" && (
            <p className="text-xs text-slate-500">
              {lang === "zh" ? `包含：${activePersona.focusZh}` : `Covers: ${activePersona.focusEn}`}
            </p>
          )}
        </div>
      </section>

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {state === "loading" && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-cyan-400" />
          <p className="text-sm text-slate-400 animate-pulse">
            {lang === "zh" ? "AI 正在撰写报告，请稍候（约 20-40 秒）…" : "AI is writing your report (~20-40 s)…"}
          </p>
        </section>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {state === "error" && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
          <p className="text-sm text-red-200">{errorMsg}</p>
          <button type="button" onClick={() => void handleGenerate()}
            className="mt-3 rounded-md border border-red-400/40 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/20">
            {lang === "zh" ? "重试" : "Retry"}
          </button>
        </section>
      )}

      {/* ── Report output ───────────────────────────────────────────────────── */}
      {state === "done" && result && (() => {
        const persona = PERSONAS.find(p => p.type === result.reportType) ?? activePersona;
        return (
          <section className="rounded-2xl border border-slate-700/60 bg-[linear-gradient(135deg,rgba(8,47,73,0.85),rgba(15,23,42,0.95))] shadow-[0_18px_50px_rgba(8,47,73,0.3)]">
            {/* Report header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{persona.icon}</span>
                <div>
                  <p className={`text-sm font-semibold ${persona.activeText}`}>
                    {lang === "zh" ? persona.labelZh : persona.labelEn}
                    {lang === "zh" ? "报告" : " Report"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {result.month} · {result.model} · {new Date(result.generatedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => void handleCopy()}
                  className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition">
                  {copied ? (lang === "zh" ? "已复制！" : "Copied!") : (lang === "zh" ? "复制全文" : "Copy")}
                </button>
                <button type="button" onClick={handleDownload}
                  className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition">
                  {lang === "zh" ? "下载 .txt" : "Download .txt"}
                </button>
              </div>
            </div>
            {/* Report body */}
            <div className="px-6 py-6">
              <RenderMarkdown text={result.report} />
            </div>
          </section>
        );
      })()}
    </div>
  );
}
